import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, hashOf } from '../src/canonical.ts';
import { ANTHROPIC_MODELS, LOCAL_EXAMPLE } from '../src/registry.ts';
import { reevaluate, replay } from '../src/replay.ts';
import { route } from '../src/route.ts';

const REGISTRY = [...ANTHROPIC_MODELS, LOCAL_EXAMPLE];

test('canonical bytes are key-order independent', () => {
  assert.equal(canonicalize({ b: 1, a: [2, 'x'] }), canonicalize({ a: [2, 'x'], b: 1 }));
  assert.equal(hashOf({ b: 1, a: 2 }), hashOf({ a: 2, b: 1 }));
});

test('floats are refused at the canonical boundary', () => {
  assert.throws(() => canonicalize({ cost: 4.99 }), /micro-units/);
});

test('two identical decisions produce identical record hashes', () => {
  const a = route({ task: 'same', requires: ['tools'] }, REGISTRY);
  const b = route({ task: 'same', requires: ['tools'] }, REGISTRY);
  assert.equal(a.recordHash, b.recordHash);
});

test('replay re-derives the outcome from frozen inputs after the world changes', () => {
  const record = route({ task: 'audit me', requires: ['vision'] }, REGISTRY);
  // The world moves on: prices change, providers vanish. The record does not.
  const result = replay(record);
  assert.ok(result.matches);
  assert.ok(result.hashIntact);
  assert.equal(result.recomputed.recordHash, record.recordHash);
});

test('a tampered record fails replay with the alteration named', () => {
  const record = route({ task: 'audit me', requires: ['vision'] }, REGISTRY);
  const tampered = { ...record, outcome: { kind: 'selected' as const, model: 'claude-opus-5' } };
  const result = replay(tampered);
  assert.ok(!result.matches);
  assert.ok(!result.hashIntact);
  assert.match(result.detail, /altered/);
});

test('reevaluate reports a changed answer as information, not an error', () => {
  const record = route({ task: 'vision please', requires: ['vision'] }, REGISTRY);
  const repriced = REGISTRY.map((m) =>
    m.id === 'claude-haiku-4-5' ? { ...m, inUsdMicrosPerMTok: 99_000_000 } : m
  );
  const result = reevaluate(record, repriced);
  assert.ok(result.changed);
  assert.equal((result.before as { model: string }).model, 'claude-haiku-4-5');
  assert.equal((result.after as { model: string }).model, 'claude-sonnet-5');
});

test('reevaluate with an unchanged world confirms the recorded answer', () => {
  const record = route({ task: 'vision please', requires: ['vision'] }, REGISTRY);
  const result = reevaluate(record, REGISTRY);
  assert.ok(!result.changed);
});
