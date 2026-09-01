/** Replay and re-evaluate are different questions, kept as different
 * functions.
 *
 * replay(record) asks: does this record still support its own outcome? It
 * re-derives the decision from the record's frozen inputs and recomputes the
 * hashes. Prices and providers may have changed since; replay does not care,
 * because the frozen snapshots are the inputs.
 *
 * reevaluate(record, today) asks: would today's registry and availability
 * give the same answer to the old request? A changed answer is not an error -
 * it is information, returned as a diff. */

import { hashOf } from './canonical.ts';
import { deriveRecord, route } from './route.ts';
import type { AvailabilitySnapshot, ModelRecord, Outcome, RouteRecord } from './types.ts';

export interface ReplayResult {
  matches: boolean;
  hashIntact: boolean;
  outcomeMatches: boolean;
  recomputed: RouteRecord;
  detail: string;
}

export function replay(record: RouteRecord): ReplayResult {
  const { recordHash, ...body } = record;
  const hashIntact = hashOf(body) === recordHash && hashOf(record.registry) === record.registryHash;
  const recomputed = deriveRecord(record.request, record.registry, record.availability);
  const outcomeMatches = hashOf(recomputed.outcome) === hashOf(record.outcome);
  const matches = hashIntact && outcomeMatches && recomputed.recordHash === record.recordHash;
  return {
    matches,
    hashIntact,
    outcomeMatches,
    recomputed,
    detail: matches
      ? 'the frozen inputs re-derive the recorded outcome, bit-identical'
      : !hashIntact
        ? 'the record was altered after it was written'
        : 'the recorded outcome does not follow from its own frozen inputs'
  };
}

export interface ReevaluateResult {
  changed: boolean;
  before: Outcome;
  after: Outcome;
  record: RouteRecord;
  detail: string;
}

export function reevaluate(
  record: RouteRecord,
  registry: ModelRecord[],
  availability: AvailabilitySnapshot = {}
): ReevaluateResult {
  const fresh = route(record.request, registry, availability);
  const changed = hashOf(fresh.outcome) !== hashOf(record.outcome);
  return {
    changed,
    before: record.outcome,
    after: fresh.outcome,
    record: fresh,
    detail: changed
      ? "today's policy inputs give a different answer to the old request"
      : "today's policy inputs still give the recorded answer"
  };
}
