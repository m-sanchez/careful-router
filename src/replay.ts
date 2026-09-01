/** Replay and re-evaluate are different questions, kept as different
 * functions.
 *
 * replay(record) asks: does this record still support its own outcome? It
 * re-derives the decision from the record's frozen inputs and recomputes the
 * hashes. Prices and providers may have changed since; replay does not care,
 * because the frozen snapshots are the inputs. The POLICY may have changed
 * too, and that is reported as drift against the code, never as a fault in
 * the record: an old record is re-derived under the policy that wrote it.
 *
 * reevaluate(record, today) asks: would today's registry and availability
 * give the same answer to the old request? A changed answer is not an error -
 * it is information, returned as a diff. */

import { hashOf } from './canonical.ts';
import { deriveRecord, POLICY, POLICY_HISTORY, route } from './route.ts';
import type { AvailabilitySnapshot, ModelRecord, Outcome, RouteRecord } from './types.ts';

export interface ReplayResult {
  /** this build's running policy re-derives the record, bit-identically */
  matches: boolean;
  /** the record's own bytes still hash to the hashes it carries */
  hashIntact: boolean;
  /** the frozen inputs re-derive the recorded outcome, under the policy that
   * wrote it when this build still has that policy */
  outcomeMatches: boolean;
  /** the record was written under a different policy version than this build
   * implements. Not a fault in the record - the code moved, not the archive. */
  policyDrift: boolean;
  /** the policy version under which the record re-derives bit-identically, or
   * null if no policy this build knows does */
  verifiedUnder: string | null;
  /** the re-derivation, under the record's own policy when known */
  recomputed: RouteRecord;
  detail: string;
}

export function replay(record: RouteRecord): ReplayResult {
  const { recordHash, ...body } = record;
  const hashIntact = hashOf(body) === recordHash && hashOf(record.registry) === record.registryHash;

  // The record's own policy is read BEFORE anything is re-derived. Deriving
  // first and comparing after is what made a version bump look like a forgery.
  const writtenUnder = record.policy.version;
  const rules = POLICY_HISTORY[writtenUnder];
  const knownPolicy = rules != null && hashOf(rules.descriptor) === record.policyHash;
  const policyDrift = writtenUnder !== POLICY.version;

  const recomputed = deriveRecord(
    record.request,
    record.registry,
    record.availability,
    knownPolicy ? rules : undefined
  );
  const outcomeMatches = hashOf(recomputed.outcome) === hashOf(record.outcome);
  const bitIdentical =
    hashIntact && knownPolicy && outcomeMatches && recomputed.recordHash === record.recordHash;
  const verifiedUnder = bitIdentical ? writtenUnder : null;
  const matches = bitIdentical && !policyDrift;

  return {
    matches,
    hashIntact,
    outcomeMatches,
    policyDrift,
    verifiedUnder,
    recomputed,
    detail: detailFor({
      hashIntact,
      policyDrift,
      knownPolicy,
      bitIdentical,
      outcomeMatches,
      writtenUnder
    })
  };
}

function detailFor(f: {
  hashIntact: boolean;
  policyDrift: boolean;
  knownPolicy: boolean;
  bitIdentical: boolean;
  outcomeMatches: boolean;
  writtenUnder: string;
}): string {
  if (!f.hashIntact) return 'the record was altered after it was written';
  const drift = `written under policy ${f.writtenUnder}; this build implements ${POLICY.version}`;
  if (!f.knownPolicy) {
    return f.policyDrift
      ? `${drift}, and has no record of policy ${f.writtenUnder}, so the decision cannot be re-derived`
      : `this record names policy ${f.writtenUnder} but its descriptor does not match this build's policy ${f.writtenUnder}`;
  }
  if (f.policyDrift) {
    return f.bitIdentical
      ? `${drift}. Re-derived under policy ${f.writtenUnder} the record is bit-identical: the decision stands, the policy moved`
      : `${drift}. Re-derived under policy ${f.writtenUnder} the frozen inputs do not support the recorded outcome`;
  }
  return f.bitIdentical
    ? 'the frozen inputs re-derive the recorded outcome, bit-identical'
    : 'the recorded outcome does not follow from its own frozen inputs';
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
