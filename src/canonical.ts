/** The family canonical byte form. One rule, three packages: careful-router,
 * frozen-eval and grounded-claims all canonicalize by these rules, so a value
 * hashes to the same bytes wherever it is hashed. The bit-identical replay
 * claim rests here.
 *
 * Object keys sorted by code unit, no insignificant whitespace,
 * undefined-valued properties omitted, strings JSON-escaped, SHA-256 hex over
 * UTF-8. Numbers: finite only; -0 normalised to 0; integer-valued numbers must
 * be SAFE integers and print as integers; non-integers must satisfy |x| >= 1e-4
 * and print as the shortest round-trip decimal. The floor exists because JS
 * writes 0.000007 where Python writes 7e-06 - refusing those values is what
 * makes the byte form portable across languages.
 *
 * The floor is a property of BYTES, not of money. This package's own rule that
 * costs travel as integer micro-USD is a domain rule about a price sheet, and
 * lives in validateRegistry, where a violation can name the model and field. */

import { createHash } from 'node:crypto';

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new TypeError(`non-finite number ${value} cannot be canonicalized`);
      }
      const v = Object.is(value, -0) ? 0 : value;
      if (Number.isInteger(v)) {
        if (!Number.isSafeInteger(v)) {
          throw new TypeError(
            `integer ${v} is outside the safe integer range and cannot be canonicalized exactly`
          );
        }
        return String(v);
      }
      if (Math.abs(v) < 1e-4) {
        throw new TypeError(
          `non-integer ${v} is below the canonical magnitude floor of 1e-4 and cannot be canonicalized; rescale it (e.g. to micro-units)`
        );
      }
      return String(v);
    }
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
