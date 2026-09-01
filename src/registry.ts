/** Default registry: ILLUSTRATIVE capability records in the shape the
 * router expects, plus a local example. The model ids are real; the
 * numbers are synthetic and exist to exercise the policy, exactly like
 * the fixture data in careful-verifier. Pin your own snapshot with your
 * provider's current prices for anything real - the registry you route
 * over is the registry your records freeze. */

import type { ModelRecord, RouteRecord } from './types.ts';

const M = 1_000_000; // $1/MTok in micro-USD

export const ANTHROPIC_MODELS: ModelRecord[] = [
  {
    id: 'claude-fable-5',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    inUsdMicrosPerMTok: 10 * M,
    outUsdMicrosPerMTok: 50 * M,
    capabilities: ['tools', 'vision', 'thinking'],
    boundary: 'external'
  },
  {
    id: 'claude-opus-5',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    inUsdMicrosPerMTok: 5 * M,
    outUsdMicrosPerMTok: 25 * M,
    capabilities: ['tools', 'vision', 'thinking'],
    boundary: 'external'
  },
  {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    inUsdMicrosPerMTok: 2 * M,
    outUsdMicrosPerMTok: 10 * M,
    capabilities: ['tools', 'vision', 'thinking'],
    boundary: 'external'
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    contextWindow: 200_000,
    maxOutput: 64_000,
    inUsdMicrosPerMTok: 1 * M,
    outUsdMicrosPerMTok: 5 * M,
    capabilities: ['tools', 'vision'],
    boundary: 'external'
  }
];

/** Example of a registry entry whose data never leaves the machine. */
export const LOCAL_EXAMPLE: ModelRecord = {
  id: 'llama3.1:8b',
  provider: 'ollama',
  contextWindow: 128_000,
  maxOutput: 8_192,
  inUsdMicrosPerMTok: 0,
  outUsdMicrosPerMTok: 0,
  capabilities: ['tools'],
  boundary: 'local'
};

/** The dollars-to-micro-USD conversion the integer-cost rule rests on, as one
 * blessed implementation instead of a comment. $3.00/MTok is 3_000_000. */
export function microsPerMTok(usdPerMillionTokens: number): number {
  if (!Number.isFinite(usdPerMillionTokens) || usdPerMillionTokens < 0) {
    throw new TypeError(`a price must be a non-negative finite number, got ${usdPerMillionTokens}`);
  }
  const micros = Math.round(usdPerMillionTokens * 1_000_000);
  if (Math.abs(usdPerMillionTokens * 1_000_000 - micros) > 1e-6) {
    throw new TypeError(
      `$${usdPerMillionTokens}/MTok is finer than micro-USD and cannot be represented exactly`
    );
  }
  return micros;
}

/** The inverse, for display: 3_000_000 reads back as "$3.00". */
export function usdPerMTok(micros: number): string {
  if (!Number.isSafeInteger(micros)) {
    throw new TypeError(`a micro-USD rate must be a safe integer, got ${micros}`);
  }
  const negative = micros < 0;
  const abs = Math.abs(micros);
  const whole = Math.floor(abs / 1_000_000);
  const fraction = String(abs % 1_000_000).padStart(6, '0').replace(/0+$/, '');
  const decimals = fraction.length < 2 ? fraction.padEnd(2, '0') : fraction;
  return `${negative ? '-' : ''}$${whole}.${decimals}`;
}

const COST_FIELDS = ['inUsdMicrosPerMTok', 'outUsdMicrosPerMTok'] as const;
const TOKEN_FIELDS = ['contextWindow', 'maxOutput'] as const;

/** Named problems with a registry snapshot, in the order they were found.
 * An empty array means the snapshot is routable.
 *
 * This is the home of the integer-micro-USD rule. The canonical byte form
 * accepts 2.5; a price sheet does not, because $2.50/MTok entered as 2.5 is
 * a missed conversion and the router would otherwise certify it. Failing here
 * names the model and the field, before any routing work happens. */
export function validateRegistry(models: ModelRecord[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  models.forEach((m, index) => {
    if (typeof m?.id !== 'string' || m.id.length === 0) {
      problems.push(`the model at index ${index} has no id; a record names its selection by id`);
      return;
    }
    if (seen.has(m.id)) {
      problems.push(`duplicate model id "${m.id}"; a registry must name each model once`);
    }
    seen.add(m.id);
    for (const field of COST_FIELDS) {
      const v = m[field];
      if (!Number.isFinite(v) || !Number.isInteger(v)) {
        problems.push(
          `${m.id}.${field} is ${v} (not an integer); costs are integer micro-USD per MTok - ` +
            (Number.isFinite(v)
              ? `${usdPerMTok(microsPerMTok(v))}/MTok is ${microsPerMTok(v)}`
              : 'give it a finite integer')
        );
      } else if (v < 0) {
        problems.push(`${m.id}.${field} is ${v} (negative); a price cannot be below zero`);
      } else if (!Number.isSafeInteger(v)) {
        problems.push(`${m.id}.${field} is ${v} (outside the safe integer range)`);
      }
    }
    for (const field of TOKEN_FIELDS) {
      const v = m[field];
      if (!Number.isSafeInteger(v)) {
        problems.push(`${m.id}.${field} is ${v}; token counts are safe whole numbers`);
      } else if (v < 0) {
        problems.push(`${m.id}.${field} is ${v} (negative); token counts cannot be below zero`);
      }
    }
  });
  return problems;
}

/** The ModelRecord a record selected, resolved against the record's OWN frozen
 * registry - the audit-correct lookup, since that snapshot is what the
 * decision was made on, not whatever the registry holds today. Null when the
 * outcome was a routed no. */
export function selectedModel(record: RouteRecord): ModelRecord | null {
  if (record.outcome.kind !== 'selected') return null;
  const id = record.outcome.model;
  return record.registry.find((m) => m.id === id) ?? null;
}

/** Shape a selection into the request body for the official Anthropic SDK.
 * careful-router makes no network calls; hand this to your own client.
 *
 * Takes the RouteRecord or the selected ModelRecord, so the one function that
 * faces the outside world cannot emit a request the router's own output stage
 * would have eliminated - and cannot silently emit {model: undefined,
 * max_tokens: NaN} either. A routed no throws, by name. */
export function toAnthropicRequest(
  selection: ModelRecord | RouteRecord,
  opts: { maxTokens?: number } = {}
): { model: string; max_tokens: number } {
  const model = isRouteRecord(selection) ? selectedModel(selection) : selection;
  if (model == null) {
    const outcome = (selection as RouteRecord).outcome;
    throw new TypeError(
      outcome.kind === 'cannot-route'
        ? `this record is a routed no at ${outcome.blockingStage}; there is no model to request`
        : `the record's own frozen registry has no model "${outcome.model}"`
    );
  }
  if (typeof model.id !== 'string' || !Number.isSafeInteger(model.maxOutput)) {
    throw new TypeError('a request needs a model with an id and an integer maxOutput');
  }
  return {
    model: model.id,
    max_tokens: Math.min(opts.maxTokens ?? 16_000, model.maxOutput)
  };
}

function isRouteRecord(value: ModelRecord | RouteRecord): value is RouteRecord {
  return typeof (value as RouteRecord).recordHash === 'string';
}
