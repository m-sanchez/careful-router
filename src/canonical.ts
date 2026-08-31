/** Canonical bytes for hashing. The bit-identical replay claim rests here,
 * so the rules are strict and named in the README:
 *   - object keys sorted lexicographically, no insignificant whitespace
 *   - numbers must be finite integers (costs travel as micro-USD integers)
 *   - hash algorithm is SHA-256, hex-encoded
 * Two semantically identical records produce the same bytes, or one of them
 * was never canonical to begin with. */

import { createHash } from 'node:crypto';

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new TypeError(
          `non-integer number ${value} cannot be canonicalized; represent it as an integer (e.g. micro-units)`
        );
      }
      return String(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`cannot canonicalize a ${typeof value}`);
  }
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hashOf(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
