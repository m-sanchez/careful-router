/** The deterministic route policy. Elimination stages run in a fixed,
 * published order; the survivors are ranked by a fixed, published rule; and
 * every elimination lands in the record with its reason. When nothing
 * survives, the refusal names the stage that emptied the pool and the
 * cheapest fact that would change the answer - never a silent fallback. */

import { hashOf } from './canonical.ts';
import type {
  AvailabilitySnapshot,
  Elimination,
  ModelRecord,
  NearestFact,
  Outcome,
  RouteRecord,
  RouteRequest
} from './types.ts';

export const POLICY = {
  version: '1.0.0',
  stages: [
    'availability',
    'boundary',
    'capabilities',
    'context',
    'output',
    'budget-in',
    'budget-out'
  ],
  selection:
    'cheapest by inUsdMicrosPerMTok + outUsdMicrosPerMTok; ties broken by larger contextWindow, then lexicographic id'
} as const;

type Stage = {
  name: string;
  /** null = survives; string = elimination reason */
  check: (m: ModelRecord, req: Required<RouteRequest>, avail: AvailabilitySnapshot) => string | null;
  /** what this model would need for the stage to pass - the nearest-serviceable fact */
  wouldNeed: (m: ModelRecord, req: Required<RouteRequest>) => string;
};

const STAGES: Stage[] = [
  {
    name: 'availability',
    check: (m, _req, avail) =>
      (avail[m.provider] ?? 'closed') === 'open' ? `provider ${m.provider} circuit is open` : null,
    wouldNeed: (m) => `provider ${m.provider} back within its failure budget`
  },
  {
    name: 'boundary',
    check: (m, req) =>
      req.boundary === 'local-only' && m.boundary !== 'local'
        ? 'data may not leave the machine; model is external'
        : null,
    wouldNeed: () => 'a request without the local-only boundary'
  },
  {
    name: 'capabilities',
    check: (m, req) => {
      const missing = req.requires.filter((c) => !m.capabilities.includes(c));
      return missing.length > 0 ? `missing capability: ${missing.join(', ')}` : null;
    },
    wouldNeed: (m, req) =>
      `capability ${req.requires.filter((c) => !m.capabilities.includes(c)).join(', ')}`
  },
  {
    name: 'context',
    check: (m, req) =>
      m.contextWindow < req.minContextTokens
        ? `context window ${m.contextWindow} < required ${req.minContextTokens}`
        : null,
    wouldNeed: (m, req) => `a context window of ${req.minContextTokens} (has ${m.contextWindow})`
  },
  {
    name: 'output',
    check: (m, req) =>
      m.maxOutput < req.minOutputTokens
        ? `max output ${m.maxOutput} < required ${req.minOutputTokens}`
        : null,
    wouldNeed: (m, req) => `a max output of ${req.minOutputTokens} (has ${m.maxOutput})`
  },
  {
    name: 'budget-in',
    check: (m, req) =>
      req.maxInUsdMicrosPerMTok >= 0 && m.inUsdMicrosPerMTok > req.maxInUsdMicrosPerMTok
        ? `input cost ${m.inUsdMicrosPerMTok} > budget ${req.maxInUsdMicrosPerMTok}`
        : null,
    wouldNeed: (m) => `an input budget of at least ${m.inUsdMicrosPerMTok} micro-USD/MTok`
  },
  {
    name: 'budget-out',
    check: (m, req) =>
      req.maxOutUsdMicrosPerMTok >= 0 && m.outUsdMicrosPerMTok > req.maxOutUsdMicrosPerMTok
        ? `output cost ${m.outUsdMicrosPerMTok} > budget ${req.maxOutUsdMicrosPerMTok}`
        : null,
    wouldNeed: (m) => `an output budget of at least ${m.outUsdMicrosPerMTok} micro-USD/MTok`
  }
];

/** Fill defaults so the frozen request is complete, not implicit. */
export function normalizeRequest(req: RouteRequest): Required<RouteRequest> {
  return {
    task: req.task,
    requires: [...(req.requires ?? [])].sort(),
    minContextTokens: req.minContextTokens ?? 0,
    minOutputTokens: req.minOutputTokens ?? 0,
    maxInUsdMicrosPerMTok: req.maxInUsdMicrosPerMTok ?? -1,
    maxOutUsdMicrosPerMTok: req.maxOutUsdMicrosPerMTok ?? -1,
    boundary: req.boundary ?? 'any'
  };
}

/** Deterministic candidate ordering: the tie-break is part of the policy. */
export function rankCandidates(models: ModelRecord[]): ModelRecord[] {
  return [...models].sort((a, b) => {
    const costA = a.inUsdMicrosPerMTok + a.outUsdMicrosPerMTok;
    const costB = b.inUsdMicrosPerMTok + b.outUsdMicrosPerMTok;
    if (costA !== costB) return costA - costB;
    if (a.contextWindow !== b.contextWindow) return b.contextWindow - a.contextWindow;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Route a request over a registry snapshot. Pure: same inputs, same record. */
export function route(
  request: RouteRequest,
  registry: ModelRecord[],
  availability: AvailabilitySnapshot = {}
): RouteRecord {
  const req = normalizeRequest(request);
  const ranked = rankCandidates(registry);
  const eliminations: Elimination[] = [];

  let survivors = ranked;
  let blockingStage = '';
  let lastAlive: ModelRecord[] = ranked;
  for (const stage of STAGES) {
    const next: ModelRecord[] = [];
    for (const m of survivors) {
      const reason = stage.check(m, req, availability);
      if (reason === null) next.push(m);
      else eliminations.push({ model: m.id, stage: stage.name, reason });
    }
    if (next.length === 0 && survivors.length > 0) {
      blockingStage = stage.name;
      lastAlive = survivors;
      survivors = next;
      break;
    }
    survivors = next;
  }

  let outcome: Outcome;
  if (survivors.length > 0) {
    outcome = { kind: 'selected', model: survivors[0].id };
  } else if (ranked.length === 0) {
    // an empty registry is its own constraint, named consistently in both
    // fields of the refusal
    outcome = {
      kind: 'cannot-route',
      blockingStage: 'empty-registry',
      nearest: [],
      pathToYes: 'register a model; the registry is empty'
    };
  } else {
    const stage = STAGES.find((s) => s.name === blockingStage);
    const nearest: NearestFact[] =
      stage == null
        ? []
        : rankCandidates(lastAlive).map((m) => ({ model: m.id, wouldNeed: stage.wouldNeed(m, req) }));
    outcome = {
      kind: 'cannot-route',
      blockingStage,
      nearest,
      pathToYes:
        nearest.length > 0
          ? `nearest serviceable: ${nearest[0].model}, needs ${nearest[0].wouldNeed}`
          : `every candidate fell before ${blockingStage}`
    };
  }

  const registrySnapshot = [...registry].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
  const body = {
    version: 1 as const,
    request: req,
    policy: { version: POLICY.version, stages: [...POLICY.stages], selection: POLICY.selection },
    policyHash: hashOf(POLICY),
    registry: registrySnapshot,
    registryHash: hashOf(registrySnapshot),
    availability,
    candidates: ranked.map((m) => m.id),
    eliminations,
    outcome
  };
  return { ...body, recordHash: hashOf(body) };
}
