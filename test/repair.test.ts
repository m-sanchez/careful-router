import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairJson } from '../src/repair.ts';

test('clean JSON parses on the first rung with no repairs applied', () => {
  const r = repairJson('{"a": 1}');
  assert.ok(r.ok);
  assert.equal(r.rung, 'parse-direct');
  assert.deepEqual(r.repairsApplied, []);
});

test('a fenced block parses on the named rung, labelled as repaired', () => {
  const r = repairJson('```json\n{"a": 1}\n```');
  assert.ok(r.ok);
  assert.equal(r.rung, 'strip-code-fence');
  assert.deepEqual(r.repairsApplied, ['strip-code-fence']);
});

test('prose around an object parses via extract-first-object', () => {
  const r = repairJson('Here is the result you asked for: {"a": {"b": "}"}} hope it helps');
  assert.ok(r.ok);
  assert.equal(r.rung, 'extract-first-object');
  assert.deepEqual(r.value, { a: { b: '}' } });
});

test('garbage is rejected with the full attempt list, never massaged', () => {
  const r = repairJson('no json here at all');
  assert.ok(!r.ok);
  assert.deepEqual(r.attempted, ['parse-direct', 'strip-code-fence', 'extract-first-object']);
  assert.match(r.reason, /rejected, not massaged/);
});

test('a truncated object fails every rung rather than being completed', () => {
  const r = repairJson('{"a": {"b": 1}');
  assert.ok(!r.ok);
});
