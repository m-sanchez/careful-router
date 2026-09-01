import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANTHROPIC_MODELS, LOCAL_EXAMPLE } from '../src/registry.ts';
import { deriveRecord, route } from '../src/route.ts';
import type { ModelRecord } from '../src/types.ts';

const REGISTRY: ModelRecord[] = [...ANTHROPIC_MODELS, LOCAL_EXAMPLE];

test('the cheapest qualifying model wins, not the most impressive', () => {
  const record = route({ task: 'label a ticket', requires: ['tools'] }, REGISTRY);
  assert.equal(record.outcome.kind, 'selected');
  assert.equal((record.outcome as { model: string }).model, 'llama3.1:8b'); // costs zero
});

test('a capability requirement eliminates with a written reason', () => {
  const record = route({ task: 'read a screenshot', requires: ['vision'] }, REGISTRY);
  assert.equal((record.outcome as { model: string }).model, 'claude-haiku-4-5');
  const local = record.eliminations.find((e) => e.model === 'llama3.1:8b');
  assert.equal(local?.stage, 'capabilities');
  assert.match(local!.reason, /missing capability: vision/);
});

test('local-only boundary routes to the model that never leaves the machine', () => {
  const record = route({ task: 'summarize case notes', boundary: 'local-only' }, REGISTRY);
  assert.equal((record.outcome as { model: string }).model, 'llama3.1:8b');
  assert.ok(record.eliminations.every((e) => e.stage === 'boundary'));
});

test('context demands walk the selection up the registry', () => {
  const record = route(
    { task: 'whole-repo review', requires: ['vision'], minContextTokens: 500_000 },
    REGISTRY
  );
  assert.equal((record.outcome as { model: string }).model, 'claude-sonnet-5');
});

test('an impossible budget is a routed no with the nearest serviceable fact', () => {
  const record = route(
    { task: 'cheap vision', requires: ['vision'], maxInUsdMicrosPerMTok: 500_000 },
    REGISTRY
  );
  assert.equal(record.outcome.kind, 'cannot-route');
  const refusal = record.outcome as Extract<typeof record.outcome, { kind: 'cannot-route' }>;
  assert.equal(refusal.blockingStage, 'budget-in');
  assert.equal(refusal.nearest[0].model, 'claude-haiku-4-5');
  assert.match(refusal.nearest[0].wouldNeed, /1000000 micro-USD/);
  assert.match(refusal.pathToYes, /nearest serviceable: claude-haiku-4-5/);
});

test('an open provider circuit eliminates at availability, visibly', () => {
  const record = route({ task: 'anything', requires: ['tools'] }, REGISTRY, {
    ollama: 'open'
  });
  assert.equal((record.outcome as { model: string }).model, 'claude-haiku-4-5');
  const local = record.eliminations.find((e) => e.model === 'llama3.1:8b');
  assert.equal(local?.stage, 'availability');
  assert.match(local!.reason, /circuit is open/);
});

test('candidate ordering is deterministic: cost, then context, then id', () => {
  const clone = (id: string): ModelRecord => ({
    id,
    provider: 'p',
    contextWindow: 100,
    maxOutput: 100,
    inUsdMicrosPerMTok: 5,
    outUsdMicrosPerMTok: 5,
    capabilities: [],
    boundary: 'external'
  });
  const record = route({ task: 't' }, [clone('beta'), clone('alpha')]);
  assert.deepEqual(record.candidates, ['alpha', 'beta']);
  assert.equal((record.outcome as { model: string }).model, 'alpha');
});

test('an empty registry refuses with a path to yes, never throws', () => {
  const record = route({ task: 't' }, []);
  assert.equal(record.outcome.kind, 'cannot-route');
  assert.match((record.outcome as { pathToYes: string }).pathToYes, /register a model/);
});

test('an empty registry names its own constraint consistently in both fields', () => {
  const record = route({ task: 't' }, []);
  const refusal = record.outcome as Extract<typeof record.outcome, { kind: 'cannot-route' }>;
  assert.equal(refusal.blockingStage, 'empty-registry');
  assert.match(refusal.pathToYes, /registry is empty/);
});

test('duplicate ids cannot make the canonical snapshot order engine-dependent', () => {
  const dup = {
    id: 'same',
    provider: 'p',
    contextWindow: 10,
    maxOutput: 10,
    inUsdMicrosPerMTok: 1,
    outUsdMicrosPerMTok: 1,
    capabilities: [],
    boundary: 'external' as const
  };
  // route() refuses duplicate ids outright now, but replay re-derives archived
  // records through deriveRecord without that guard, so the canonical ordering
  // property still has to hold against hostile input.
  const a = deriveRecord({ task: 't' }, [dup, { ...dup }]);
  const b = deriveRecord({ task: 't' }, [{ ...dup }, dup]);
  assert.equal(a.registryHash, b.registryHash);
});
