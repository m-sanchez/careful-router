import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANTHROPIC_MODELS,
  LOCAL_EXAMPLE,
  selectedModel,
  toAnthropicRequest
} from '../src/registry.ts';
import { route } from '../src/route.ts';

/** The README's own quickstart, run verbatim. CI proved the tarball imports;
 * it never proved the documented usage works. */
test('the README quickstart produces a request body the Anthropic API accepts', () => {
  const record = route(
    { task: 'summarize case notes', requires: ['tools'], boundary: 'local-only' },
    [...ANTHROPIC_MODELS, LOCAL_EXAMPLE]
  );

  assert.deepEqual(record.outcome, { kind: 'selected', model: 'llama3.1:8b' });
  assert.ok(record.eliminations.length > 0);
  assert.match(record.recordHash, /^[0-9a-f]{64}$/);

  // README: "toAnthropicRequest(selectedRecord) shapes the selection for the
  // official Anthropic SDK". A body with model: undefined and max_tokens: NaN
  // serialises to {"max_tokens":null} and fails as an opaque 400.
  const body = toAnthropicRequest(record);
  assert.ok(Number.isSafeInteger(body.max_tokens), `max_tokens was ${body.max_tokens}`);
  // the exact body the README prints
  assert.deepEqual(body, { model: 'llama3.1:8b', max_tokens: 8_192 });
  assert.deepEqual(JSON.parse(JSON.stringify(body)), body);
});

test('selectedModel resolves against the record\'s own frozen registry, not today\'s', () => {
  const record = route({ task: 'read a screenshot', requires: ['vision'] }, [
    ...ANTHROPIC_MODELS,
    LOCAL_EXAMPLE
  ]);
  const model = selectedModel(record);
  assert.equal(model?.id, 'claude-haiku-4-5');
  // The world moves on; the record does not. The lookup uses the snapshot the
  // decision was made on, so an audit reads the prices that actually decided.
  assert.equal(model?.inUsdMicrosPerMTok, 1_000_000);
  assert.equal(toAnthropicRequest(record, { maxTokens: 200_000 }).max_tokens, 64_000);
});

test('a routed no cannot be shaped into a request; it throws by name', () => {
  const record = route(
    { task: 'cheap vision', requires: ['vision'], maxInUsdMicrosPerMTok: 500_000 },
    [...ANTHROPIC_MODELS, LOCAL_EXAMPLE]
  );
  assert.equal(record.outcome.kind, 'cannot-route');
  assert.equal(selectedModel(record), null);
  assert.throws(() => toAnthropicRequest(record), /routed no at budget-in/);
});

test('a bare ModelRecord still works, and max_tokens never exceeds maxOutput', () => {
  const body = toAnthropicRequest(LOCAL_EXAMPLE);
  assert.deepEqual(body, { model: 'llama3.1:8b', max_tokens: 8_192 });
});
