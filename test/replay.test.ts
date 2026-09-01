import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hashOf } from '../src/canonical.ts';
import { ANTHROPIC_MODELS, LOCAL_EXAMPLE } from '../src/registry.ts';
import { replay } from '../src/replay.ts';
import { POLICY, route } from '../src/route.ts';
import type { ModelRecord, RouteRecord } from '../src/types.ts';

const REGISTRY: ModelRecord[] = [...ANTHROPIC_MODELS, LOCAL_EXAMPLE];

/** A real record, written by the released 2.0.1 build under policy 1.0.0 and
 * kept verbatim. routing-study pins this package by git tag, so archives like
 * this one are exactly what a policy bump lands on. */
const ARCHIVED = JSON.parse(
  readFileSync(new URL('./fixtures/record-policy-1.0.0.json', import.meta.url), 'utf8')
) as RouteRecord;

test('the archived record is intact and was written under an older policy', () => {
  const { recordHash, ...body } = ARCHIVED;
  assert.equal(hashOf(body), recordHash, 'the fixture has not been edited');
  assert.equal(ARCHIVED.policy.version, '1.0.0');
  assert.notEqual(POLICY.version, '1.0.0');
});

test('a policy bump is reported as drift, never as a forged record', () => {
  const result = replay(ARCHIVED);
  assert.ok(result.hashIntact, 'the record is intact');
  assert.ok(result.policyDrift, 'the policy moved, not the record');
  assert.match(result.detail, /written under policy 1\.0\.0; this build implements 2\.0\.0/);
  assert.doesNotMatch(result.detail, /altered/);
  assert.doesNotMatch(result.detail, /does not follow from its own frozen inputs/);
});

test('an old record still replays under the policy that wrote it', () => {
  const result = replay(ARCHIVED);
  // Under policy 1.0.0 the record re-derives bit-identically: the decision
  // stands, only the policy moved.
  assert.ok(result.outcomeMatches);
  assert.equal(result.verifiedUnder, '1.0.0');
  assert.equal(result.recomputed.recordHash, ARCHIVED.recordHash);
  assert.equal(
    (result.recomputed.outcome as { pathToYes: string }).pathToYes,
    'nearest serviceable: llama3.1:8b, needs a max output of 200000 (has 8192)'
  );
});

test('a record written under a policy this build has never seen says so', () => {
  const invented = { version: '0.9.0', stages: ['everything'], selection: 'vibes' };
  const drifted = reseal({ ...ARCHIVED, policy: invented, policyHash: hashOf(invented) });
  const result = replay(drifted);
  assert.ok(result.hashIntact);
  assert.ok(result.policyDrift);
  assert.equal(result.verifiedUnder, null);
  assert.match(result.detail, /no record of policy 0\.9\.0/);
  assert.doesNotMatch(result.detail, /altered/);
});

test('a record naming this policy version but not this policy is not verified', () => {
  const fake = { ...POLICY, selection: 'whatever I felt like' };
  const forged = reseal({ ...ARCHIVED, policy: fake, policyHash: hashOf(fake) });
  const result = replay(forged);
  assert.ok(result.hashIntact, 'the hashes were recomputed by the forger');
  assert.ok(!result.matches);
  assert.equal(result.verifiedUnder, null);
  assert.match(result.detail, /does not match this build/);
});

test('a record written by this build still replays bit-identically', () => {
  const record = route({ task: 'audit me', requires: ['vision'] }, REGISTRY);
  const result = replay(record);
  assert.ok(result.matches);
  assert.ok(!result.policyDrift);
  assert.equal(result.verifiedUnder, POLICY.version);
  assert.match(result.detail, /bit-identical/);
});

function reseal(record: RouteRecord): RouteRecord {
  const { recordHash, ...body } = record;
  void recordHash;
  return { ...body, recordHash: hashOf(body) } as RouteRecord;
}
