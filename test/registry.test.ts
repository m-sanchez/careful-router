import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../src/canonical.ts';
import {
  ANTHROPIC_MODELS,
  LOCAL_EXAMPLE,
  microsPerMTok,
  usdPerMTok,
  validateRegistry
} from '../src/registry.ts';
import { replay } from '../src/replay.ts';
import { route } from '../src/route.ts';
import type { ModelRecord } from '../src/types.ts';

const REGISTRY: ModelRecord[] = [...ANTHROPIC_MODELS, LOCAL_EXAMPLE];

test('a dollars-for-micros mistake is refused up front, naming the model and the field', () => {
  // The README tells every serious adopter to pin their own snapshot, and
  // every provider price sheet is in dollars. $2.50/MTok entered as 2.5 is
  // the first mistake that adopter makes; the canonical byte form now accepts
  // 2.5, so nothing downstream will catch it.
  const priced = REGISTRY.map((m) =>
    m.id === 'claude-sonnet-5' ? { ...m, inUsdMicrosPerMTok: 2.5 } : m
  );
  assert.throws(
    () => route({ task: 'anything', requires: ['tools'] }, priced),
    /claude-sonnet-5\.inUsdMicrosPerMTok is 2\.5 \(not an integer\); costs are integer micro-USD per MTok - \$2\.50\/MTok is 2500000/
  );
});

test('a duplicate model id is refused: the record could not name its own selection', () => {
  const dup = REGISTRY.map((m) => (m.id === 'claude-opus-5' ? { ...m, id: 'claude-sonnet-5' } : m));
  assert.throws(() => route({ task: 't' }, dup), /duplicate model id "claude-sonnet-5"/);
});

test('a negative cost is refused, naming the model and the field', () => {
  const negative = REGISTRY.map((m) =>
    m.id === 'claude-haiku-4-5' ? { ...m, outUsdMicrosPerMTok: -5_000_000 } : m
  );
  assert.throws(
    () => route({ task: 't' }, negative),
    /claude-haiku-4-5\.outUsdMicrosPerMTok is -5000000 \(negative\)/
  );
});

test('validation is a decision-time guard, so an archived record still replays', () => {
  const record = route({ task: 't', requires: ['tools'] }, REGISTRY);
  // A snapshot today's rules would refuse, frozen into a record written before
  // those rules existed. Replay re-derives frozen inputs; it must not throw.
  const archived = { ...record, registry: [...record.registry, { ...record.registry[0] }] };
  const resealed = { ...archived, registryHash: hashOf(archived.registry) };
  const result = replay({ ...resealed, recordHash: hashOf(stripHash(resealed)) });
  assert.equal(typeof result.detail, 'string');
});

test('validateRegistry returns named problems and an empty list for a good snapshot', () => {
  assert.deepEqual(validateRegistry(REGISTRY), []);
  assert.deepEqual(validateRegistry([]), []);
  const problems = validateRegistry([
    { ...LOCAL_EXAMPLE, inUsdMicrosPerMTok: 3.5 },
    { ...LOCAL_EXAMPLE, maxOutput: -1 }
  ]);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /llama3\.1:8b\.inUsdMicrosPerMTok is 3\.5 \(not an integer\)/);
  assert.match(problems[1], /duplicate model id "llama3\.1:8b"/);
  assert.match(problems[2], /llama3\.1:8b\.maxOutput is -1 \(negative\)/);
});

test('the dollars-to-micro-USD conversion has one blessed implementation', () => {
  assert.equal(microsPerMTok(3), 3_000_000);
  assert.equal(microsPerMTok(2.5), 2_500_000);
  assert.equal(microsPerMTok(0.25), 250_000);
  assert.equal(microsPerMTok(0), 0);
  assert.throws(() => microsPerMTok(1e-7), /finer than micro-USD/);
  assert.throws(() => microsPerMTok(-1), /non-negative/);
});

test('usdPerMTok reads an integer rate back as dollars', () => {
  assert.equal(usdPerMTok(3_000_000), '$3.00');
  assert.equal(usdPerMTok(2_500_000), '$2.50');
  assert.equal(usdPerMTok(250_000), '$0.25');
  assert.equal(usdPerMTok(1), '$0.000001');
  assert.equal(usdPerMTok(0), '$0.00');
  assert.throws(() => usdPerMTok(1.5), /safe integer/);
});

function stripHash(record: ReturnType<typeof route>): Omit<ReturnType<typeof route>, 'recordHash'> {
  const { recordHash, ...body } = record;
  void recordHash;
  return body;
}
