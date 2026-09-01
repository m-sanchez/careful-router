import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ANTHROPIC_MODELS, LOCAL_EXAMPLE } from '../src/registry.ts';
import { POLICY, route } from '../src/route.ts';

const ROOT = new URL('../', import.meta.url);
const PKG = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  version: string;
};

test('zero runtime dependencies, as the badge and the install section say', () => {
  assert.equal(PKG.dependencies, undefined);
  assert.equal(PKG.peerDependencies, undefined);
});

test('the core makes zero network calls: nothing in src can reach the network', () => {
  const sources = readdirSync(new URL('src/', ROOT)).filter((f) => f.endsWith('.ts'));
  assert.ok(sources.length >= 8, 'the scan found the sources');
  const reachesNetwork =
    /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|node:(http|https|net|tls|dgram|dns)|require\(['"](http|https|net|tls|dgram|dns)['"]\)/;
  for (const file of sources) {
    const text = readFileSync(new URL(`src/${file}`, ROOT), 'utf8');
    assert.doesNotMatch(text, reachesNetwork, `${file} must not reach the network`);
  }
});

test('a record freezes every input the decision read', () => {
  const record = route({ task: 'freeze me', requires: ['vision'] }, [
    ...ANTHROPIC_MODELS,
    LOCAL_EXAMPLE
  ], { anthropic: 'closed', ollama: 'half-open' });

  assert.deepEqual(Object.keys(record.request).sort(), [
    'boundary',
    'expectedInTokens',
    'expectedOutTokens',
    'maxInUsdMicrosPerMTok',
    'maxOutUsdMicrosPerMTok',
    'minContextTokens',
    'minOutputTokens',
    'requires',
    'task'
  ]);
  assert.deepEqual(record.policy, POLICY);
  assert.equal(record.registry.length, 5);
  assert.deepEqual(record.availability, { anthropic: 'closed', ollama: 'half-open' });
  assert.equal(record.candidates.length, 5);
  assert.ok(record.eliminations.length > 0);
  for (const hash of [record.policyHash, record.registryHash, record.recordHash]) {
    assert.match(hash, /^[0-9a-f]{64}$/);
  }
});
