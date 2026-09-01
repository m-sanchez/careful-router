import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalize, hashOf } from '../src/canonical.ts';

/** The shared family fixture: one canonical byte form, three packages. The
 * copy under test/fixtures is byte-identical to the one the other packages
 * carry, so a divergence in any implementation shows up as a failing case
 * here rather than as two packages hashing the same value differently. */
interface AcceptCase {
  name: string;
  value: unknown;
  canonical: string;
  sha256: string;
}
interface RejectCase {
  name: string;
  kind: 'nonFinite' | 'unsafeInteger' | 'belowFloor' | 'unsupportedType';
  reason: string;
}

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/canonical-form.fixture.json', import.meta.url), 'utf8')
) as { accept: AcceptCase[]; reject: RejectCase[] };

/** JSON cannot carry NaN, Infinity, undefined or a function, so the reject
 * cases name the value instead of holding it. */
function rejectedValue(c: RejectCase): unknown {
  switch (c.name) {
    case 'NaN':
      return NaN;
    case 'Infinity':
      return Infinity;
    case '-Infinity':
      return -Infinity;
    case 'unsafe integer':
      return 9007199254740993;
    case 'tiny non-integer':
      return 1e-7;
    case 'seven micro':
      return 0.000007;
    case 'undefined at root':
      return undefined;
    case 'function':
      return () => 1;
    default:
      throw new Error(`unmapped reject case ${c.name}`);
  }
}

test('every accept case in the shared fixture produces the fixture bytes', () => {
  assert.equal(FIXTURE.accept.length, 27);
  for (const c of FIXTURE.accept) {
    assert.equal(canonicalize(c.value), c.canonical, `canonical text for ${c.name}`);
  }
});

test('every accept case in the shared fixture produces the fixture sha256', () => {
  for (const c of FIXTURE.accept) {
    assert.equal(hashOf(c.value), c.sha256, `sha256 for ${c.name}`);
  }
});

test('every reject case in the shared fixture is refused, not hashed', () => {
  assert.equal(FIXTURE.reject.length, 8);
  for (const c of FIXTURE.reject) {
    assert.throws(() => canonicalize(rejectedValue(c)), TypeError, `${c.name}: ${c.reason}`);
  }
});

test('-0 normalises to 0, which JSON cannot carry into the fixture', () => {
  assert.equal(canonicalize(-0), '0');
  assert.equal(hashOf(-0), hashOf(0));
  assert.equal(canonicalize({ v: -0 }), '{"v":0}');
});

test('undefined-valued properties are omitted, which JSON cannot carry either', () => {
  const withUndefined = { a: 1, b: undefined, c: 3 };
  const omitted = FIXTURE.accept.find((c) => c.name === 'undefined props omitted')!;
  assert.equal(canonicalize(withUndefined), omitted.canonical);
  assert.equal(hashOf(withUndefined), omitted.sha256);
});
