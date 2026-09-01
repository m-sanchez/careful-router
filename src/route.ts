/** The deterministic route policy. Elimination stages run in a fixed,
 * published order; the survivors are ranked by a fixed, published rule; and
 * every elimination lands in the record with its reason. When nothing
 * survives, the refusal names the stage that emptied the pool and the
 * cheapest fact that would change the answer - never a silent fallback. */

import { hashOf } from './canonical.ts';
import { validateRegistry } from './registry.ts';
import type {
  AvailabilitySnapshot,
  Elimination,
  ModelRecord,
  NearestFact,
  Outcome,
  PolicyDescriptor,
  RouteRecord,
  RouteRequest
} from './types.ts';

export const POLICY: PolicyDescriptor = {
  version: '2.0.0',
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
    'when the request states expectedInTokens and expectedOutTokens: least expected spend, expectedInTokens * inUsdMicrosPerMTok + expectedOutTokens * outUsdMicrosPerMTok, in integer micro-USD; otherwise cheapest by inUsdMicrosPerMTok + outUsdMicrosPerMTok, which assumes equal input and output volumes; ties broken by larger contextWindow, then lexicographic id',
  nearest:
    'refusal facts are ordered by distance to the constraint that failed - shortfall for context and output, overage for budget, count of missing capabilities, constant elsewhere - then by the selection order'
};

/** Policy 1.0.0, as shipped through 2.0.1, kept verbatim so a record written
 * under it still hashes to its own policyHash and re-derives under its own
 * rules. Its stage table is the current one: the checks and the wouldNeed
 * strings never changed, only the two ordering rules did. */
const POLICY_1_0_0: PolicyDescriptor = {
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
};

/** A policy version in executable form: its descriptor, and the three rules a
 * decision reads. replay() re-derives an old record through the entry for the
 * version that wrote it, which is what "a record proves which policy decided"
 * has to mean for it to be more than a stored string. */
export interface PolicyRules {
  descriptor: PolicyDescriptor;
  /** fill the request's defaults exactly as this policy did */
  normalize: (req: RouteRequest) => Required<RouteRequest>;
  /** order the survivors; the first is the selection */
  rank: (models: ModelRecord[], req: Required<RouteRequest>) => ModelRecord[];
  /** order the refusal facts when this stage empties the pool */
  nearest: (
    lastAlive: ModelRecord[],
    stage: Stage,
    req: Required<RouteRequest>
  ) => ModelRecord[];
  stages: Stage[];
}

export type Stage = {
  name: string;
  /** null = survives; string = elimination reason */
  check: (m: ModelRecord, req: Required<RouteRequest>, avail: AvailabilitySnapshot) => string | null;
  /** what this model would need for the stage to pass - the nearest-serviceable fact */
  wouldNeed: (m: ModelRecord, req: Required<RouteRequest>) => string;
  /** how far this model is from passing, in the stage's own units. Lower is
   * nearer. Ranking refusal facts by cost instead named the FARTHEST candidate
   * as the path to yes. The units differ per stage and are never compared
   * across stages: only one stage empties the pool. */
  distance: (m: ModelRecord, req: Required<RouteRequest>) => number;
};

const STAGES: Stage[] = [
  {
    name: 'availability',
    check: (m, _req, avail) =>
      (avail[m.provider] ?? 'closed') === 'open' ? `provider ${m.provider} circuit is open` : null,
    wouldNeed: (m) => `provider ${m.provider} back within its failure budget`,
    // an open circuit is one recovery away, for every model behind it
    distance: () => 1
  },
  {
    name: 'boundary',
    check: (m, req) =>
      req.boundary === 'local-only' && m.boundary !== 'local'
        ? 'data may not leave the machine; model is external'
        : null,
    wouldNeed: () => 'a request without the local-only boundary',
    // a boundary is not a dial: every external model is the same one step away
    distance: () => 1
  },
  {
    name: 'capabilities',
    check: (m, req) => {
      const missing = req.requires.filter((c) => !m.capabilities.includes(c));
      return missing.length > 0 ? `missing capability: ${missing.join(', ')}` : null;
    },
    wouldNeed: (m, req) =>
      `capability ${req.requires.filter((c) => !m.capabilities.includes(c)).join(', ')}`,
    distance: (m, req) => req.requires.filter((c) => !m.capabilities.includes(c)).length
  },
  {
    name: 'context',
    check: (m, req) =>
      m.contextWindow < req.minContextTokens
        ? `context window ${m.contextWindow} < required ${req.minContextTokens}`
        : null,
    wouldNeed: (m, req) => `a context window of ${req.minContextTokens} (has ${m.contextWindow})`,
    distance: (m, req) => req.minContextTokens - m.contextWindow
  },
  {
    name: 'output',
    check: (m, req) =>
      m.maxOutput < req.minOutputTokens
        ? `max output ${m.maxOutput} < required ${req.minOutputTokens}`
        : null,
    wouldNeed: (m, req) => `a max output of ${req.minOutputTokens} (has ${m.maxOutput})`,
    distance: (m, req) => req.minOutputTokens - m.maxOutput
  },
  {
    name: 'budget-in',
    check: (m, req) =>
      req.maxInUsdMicrosPerMTok >= 0 && m.inUsdMicrosPerMTok > req.maxInUsdMicrosPerMTok
        ? `input cost ${m.inUsdMicrosPerMTok} > budget ${req.maxInUsdMicrosPerMTok}`
        : null,
    wouldNeed: (m) => `an input budget of at least ${m.inUsdMicrosPerMTok} micro-USD/MTok`,
    distance: (m, req) => m.inUsdMicrosPerMTok - req.maxInUsdMicrosPerMTok
  },
  {
    name: 'budget-out',
    check: (m, req) =>
      req.maxOutUsdMicrosPerMTok >= 0 && m.outUsdMicrosPerMTok > req.maxOutUsdMicrosPerMTok
        ? `output cost ${m.outUsdMicrosPerMTok} > budget ${req.maxOutUsdMicrosPerMTok}`
        : null,
    wouldNeed: (m) => `an output budget of at least ${m.outUsdMicrosPerMTok} micro-USD/MTok`,
    distance: (m, req) => m.outUsdMicrosPerMTok - req.maxOutUsdMicrosPerMTok
  }
];

const CURRENT_RULES: PolicyRules = {
  descriptor: POLICY,
  normalize: (req) => normalizeRequest(req),
  rank: (models, req) => rankCandidates(models, req),
  nearest: (lastAlive, stage, req) =>
    // lastAlive is already in selection order and Array.prototype.sort is
    // stable, so ordering by distance keeps the selection order as the
    // tie-break without a second key.
    [...lastAlive].sort((a, b) => stage.distance(a, req) - stage.distance(b, req)),
  stages: STAGES
};

const RULES_1_0_0: PolicyRules = {
  descriptor: POLICY_1_0_0,
  normalize: (req) =>
    ({
      task: req.task,
      requires: [...(req.requires ?? [])].sort(),
      minContextTokens: req.minContextTokens ?? 0,
      minOutputTokens: req.minOutputTokens ?? 0,
      maxInUsdMicrosPerMTok: req.maxInUsdMicrosPerMTok ?? -1,
      maxOutUsdMicrosPerMTok: req.maxOutUsdMicrosPerMTok ?? -1,
      boundary: req.boundary ?? 'any'
      // no expected volumes: 1.0.0 had no such field, and a frozen request
      // must canonicalize to the bytes it was written with
    }) as Required<RouteRequest>,
  rank: (models) => rankCandidates(models),
  nearest: (lastAlive) => rankCandidates(lastAlive),
  stages: STAGES
};

/** Every policy this build can re-derive a record under, keyed by version. */
export const POLICY_HISTORY: Readonly<Record<string, PolicyRules>> = {
  '1.0.0': RULES_1_0_0,
  [POLICY.version]: CURRENT_RULES
};

/** Fill defaults so the frozen request is complete, not implicit. */
export function normalizeRequest(req: RouteRequest): Required<RouteRequest> {
  return {
    task: req.task,
    requires: [...(req.requires ?? [])].sort(),
    minContextTokens: req.minContextTokens ?? 0,
    minOutputTokens: req.minOutputTokens ?? 0,
    maxInUsdMicrosPerMTok: req.maxInUsdMicrosPerMTok ?? -1,
    maxOutUsdMicrosPerMTok: req.maxOutUsdMicrosPerMTok ?? -1,
    expectedInTokens: req.expectedInTokens ?? -1,
    expectedOutTokens: req.expectedOutTokens ?? -1,
    boundary: req.boundary ?? 'any'
  };
}

/** What this request is expected to cost on this model, in integer micro-USD
 * scaled by a million tokens. The scale factor is the same for every
 * candidate, so the undivided sum orders spend exactly; dividing by 1e6 would
 * reintroduce floats to compare numbers that are already exact. */
function expectedSpend(m: ModelRecord, req: Required<RouteRequest>): number {
  const spend =
    req.expectedInTokens * m.inUsdMicrosPerMTok + req.expectedOutTokens * m.outUsdMicrosPerMTok;
  if (!Number.isSafeInteger(spend)) {
    throw new RangeError(
      `expected spend for ${m.id} (${req.expectedInTokens} in, ${req.expectedOutTokens} out) leaves the exact integer range; state the volumes in smaller units`
    );
  }
  return spend;
}

function statesVolumes(req: Required<RouteRequest>): boolean {
  return req.expectedInTokens >= 0 && req.expectedOutTokens >= 0;
}

/** Deterministic candidate ordering: the tie-break is part of the policy.
 *
 * With expected volumes, cost order is expected SPEND. Without them it falls
 * back to the sum of the two rates, which orders cost correctly only when the
 * input and output volumes are equal - said plainly in POLICY.selection,
 * because no summarization, extraction or RAG workload has that shape. */
export function rankCandidates(
  models: ModelRecord[],
  req?: Required<RouteRequest>
): ModelRecord[] {
  const bySpend = req != null && statesVolumes(req);
  const cost = new Map<ModelRecord, number>();
  for (const m of models) {
    cost.set(m, bySpend ? expectedSpend(m, req) : m.inUsdMicrosPerMTok + m.outUsdMicrosPerMTok);
  }
  return [...models].sort((a, b) => {
    const costA = cost.get(a) ?? 0;
    const costB = cost.get(b) ?? 0;
    if (costA !== costB) return costA - costB;
    if (a.contextWindow !== b.contextWindow) return b.contextWindow - a.contextWindow;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Route a request over a registry snapshot. Pure: same inputs, same record.
 *
 * The snapshot is validated first, so a missed dollars-to-micro-USD
 * conversion fails by name before any routing work happens rather than
 * anonymously from inside a hash. */
export function route(
  request: RouteRequest,
  registry: ModelRecord[],
  availability: AvailabilitySnapshot = {}
): RouteRecord {
  const requestProblems = validateRequest(request);
  if (requestProblems.length > 0) {
    throw new TypeError(`this request cannot be routed: ${requestProblems.join('; ')}`);
  }
  const problems = validateRegistry(registry);
  if (problems.length > 0) {
    throw new TypeError(`this registry cannot be routed over: ${problems.join('; ')}`);
  }
  return deriveRecord(request, registry, availability);
}

/** Re-derive a decision WITHOUT validating the registry, under a named policy.
 * replay() uses this: a record freezes the snapshot it was decided on, and a
 * rule written after the record was written must turn neither the archive into
 * an exception nor its author into a suspect. */
export function deriveRecord(
  request: RouteRequest,
  registry: ModelRecord[],
  availability: AvailabilitySnapshot = {},
  rules: PolicyRules = CURRENT_RULES
): RouteRecord {
  const req = rules.normalize(request);
  const ranked = rules.rank(registry, req);
  const eliminations: Elimination[] = [];

  let survivors = ranked;
  let blockingStage = '';
  let lastAlive: ModelRecord[] = ranked;
  for (const stage of rules.stages) {
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
    const stage = rules.stages.find((s) => s.name === blockingStage);
    const nearest: NearestFact[] =
      stage == null
        ? []
        : rules
            .nearest(lastAlive, stage, req)
            .map((m) => ({ model: m.id, wouldNeed: stage.wouldNeed(m, req) }));
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
    policy: { ...rules.descriptor, stages: [...rules.descriptor.stages] },
    policyHash: hashOf(rules.descriptor),
    registry: registrySnapshot,
    registryHash: hashOf(registrySnapshot),
    availability,
    candidates: ranked.map((m) => m.id),
    eliminations,
    outcome
  };
  return { ...body, recordHash: hashOf(body) };
}

/** Named problems with a request, checked before any routing work. Volumes are
 * whole token counts; a float here is a units mistake, and the ranking they
 * drive has to stay exact.
 *
 * -1 is the not-stated sentinel a normalized request carries, so a frozen
 * request handed back to route() by reevaluate() validates unchanged. */
function validateRequest(request: RouteRequest): string[] {
  const problems: string[] = [];
  for (const field of ['expectedInTokens', 'expectedOutTokens'] as const) {
    const v = request[field];
    if (!stated(v)) continue;
    if (!Number.isSafeInteger(v) || v < 0) {
      problems.push(`${field} is ${v}; expected volumes are whole, non-negative token counts`);
    }
  }
  const count = [request.expectedInTokens, request.expectedOutTokens].filter(stated).length;
  if (count === 1) {
    problems.push(
      'state both expectedInTokens and expectedOutTokens or neither; one volume cannot order spend'
    );
  }
  return problems;
}

function stated(v: number | undefined): v is number {
  return v !== undefined && v !== -1;
}
