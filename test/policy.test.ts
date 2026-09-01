import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANTHROPIC_MODELS, LOCAL_EXAMPLE } from '../src/registry.ts';
import { POLICY, route } from '../src/route.ts';
import type { ModelRecord } from '../src/types.ts';

const REGISTRY: ModelRecord[] = [...ANTHROPIC_MODELS, LOCAL_EXAMPLE];

function model(id: string, inRate: number, outRate: number): ModelRecord {
  return {
    id,
    provider: 'p',
    contextWindow: 1_000_000,
    maxOutput: 64_000,
    inUsdMicrosPerMTok: inRate,
    outUsdMicrosPerMTok: outRate,
    capabilities: ['tools'],
    boundary: 'external'
  };
}

// $1/MTok in, $30/MTok out vs $5/MTok in, $2/MTok out. The rate sum says
// cheap-out (7M) beats cheap-in (31M). On the README's own workload shape -
// summarize 100K tokens into 500 - cheap-in costs 115,000 micro-USD and
// cheap-out costs 501,000: 4.4x more, chosen by the rule the README sells as
// "the right model for the job and the cost".
const CHEAP_IN = model('cheap-in', 1_000_000, 30_000_000);
const CHEAP_OUT = model('cheap-out', 5_000_000, 2_000_000);

test('cheapest means least expected spend when the request states its volumes', () => {
  const record = route(
    {
      task: 'summarize 100k tokens into 500',
      expectedInTokens: 100_000,
      expectedOutTokens: 500
    },
    [CHEAP_IN, CHEAP_OUT]
  );
  assert.equal((record.outcome as { model: string }).model, 'cheap-in');
});

test('the rate sum is right when input and output volumes are equal', () => {
  const record = route(
    { task: 'chat', expectedInTokens: 1_000, expectedOutTokens: 1_000 },
    [CHEAP_IN, CHEAP_OUT]
  );
  assert.equal((record.outcome as { model: string }).model, 'cheap-out');
});

test('the policy descriptor says the rate-sum fallback assumes equal volumes', () => {
  assert.match(POLICY.selection, /expected spend/);
  assert.match(POLICY.selection, /equal input and output volumes/);
});

test('nearest serviceable on output is the smallest shortfall, not the cheapest', () => {
  const record = route({ task: 'long answer', minOutputTokens: 200_000 }, REGISTRY);
  const refusal = record.outcome as Extract<typeof record.outcome, { kind: 'cannot-route' }>;
  assert.equal(refusal.blockingStage, 'output');
  // llama3.1:8b caps at 8,192 - 24x short - and is free, so cost order named
  // it the nearest. The 128K models are 72K short.
  assert.equal(refusal.nearest[0].model, 'claude-sonnet-5');
  assert.match(refusal.pathToYes, /nearest serviceable: claude-sonnet-5/);
  assert.deepEqual(
    refusal.nearest.map((n) => n.model),
    ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5', 'claude-haiku-4-5', 'llama3.1:8b']
  );
});

test('nearest serviceable on capabilities counts what is missing', () => {
  const two = [ANTHROPIC_MODELS.find((m) => m.id === 'claude-haiku-4-5')!, LOCAL_EXAMPLE];
  const record = route({ task: 'hard', requires: ['thinking', 'vision', 'tools'] }, two);
  const refusal = record.outcome as Extract<typeof record.outcome, { kind: 'cannot-route' }>;
  assert.equal(refusal.blockingStage, 'capabilities');
  // haiku is missing one capability, llama is missing two.
  assert.equal(refusal.nearest[0].model, 'claude-haiku-4-5');
  assert.match(refusal.nearest[0].wouldNeed, /capability thinking/);
});

test('nearest serviceable on context is the smallest shortfall', () => {
  const record = route({ task: 'whole repo', minContextTokens: 2_000_000 }, REGISTRY);
  const refusal = record.outcome as Extract<typeof record.outcome, { kind: 'cannot-route' }>;
  assert.equal(refusal.blockingStage, 'context');
  assert.equal(refusal.nearest[0].model, 'claude-sonnet-5'); // 1M window, cheapest of the 1M tier
  assert.equal(refusal.nearest[refusal.nearest.length - 1].model, 'llama3.1:8b'); // 128K window
});

test('nearest serviceable on budget is the smallest overage', () => {
  const record = route(
    { task: 'cheap vision', requires: ['vision'], maxInUsdMicrosPerMTok: 500_000 },
    REGISTRY
  );
  const refusal = record.outcome as Extract<typeof record.outcome, { kind: 'cannot-route' }>;
  assert.equal(refusal.blockingStage, 'budget-in');
  assert.equal(refusal.nearest[0].model, 'claude-haiku-4-5'); // 1M over vs sonnet's 2M
  assert.deepEqual(
    refusal.nearest.map((n) => n.model),
    ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5']
  );
});

test('the frozen request carries the volumes the ranking used', () => {
  const record = route(
    { task: 'summarize', expectedInTokens: 100_000, expectedOutTokens: 500 },
    [CHEAP_IN, CHEAP_OUT]
  );
  assert.equal(record.request.expectedInTokens, 100_000);
  assert.equal(record.request.expectedOutTokens, 500);
  // absent volumes freeze as the not-stated sentinel, not as a guess
  assert.equal(route({ task: 't' }, [CHEAP_IN]).request.expectedInTokens, -1);
});

test('a fractional or one-sided volume is refused by name', () => {
  assert.throws(
    () => route({ task: 't', expectedInTokens: 100.5, expectedOutTokens: 500 }, [CHEAP_IN]),
    /expectedInTokens is 100\.5; expected volumes are whole, non-negative token counts/
  );
  assert.throws(
    () => route({ task: 't', expectedInTokens: 100 }, [CHEAP_IN]),
    /state both expectedInTokens and expectedOutTokens or neither/
  );
});

test('expected spend that leaves the exact integer range refuses rather than mis-ranks', () => {
  assert.throws(
    () => route({ task: 't', expectedInTokens: 10_000_000_000, expectedOutTokens: 0 }, [CHEAP_IN]),
    /expected spend for cheap-in .* leaves the exact integer range/
  );
});
