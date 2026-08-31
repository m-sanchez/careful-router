/** An enumerated repair ladder for model output that should be JSON.
 *
 * Each rung is named and fixed; the result reports which rung succeeded and
 * every rung that was attempted. There is no freeform repair - output that
 * fails every rung is rejected with the attempt list, never massaged until
 * it parses. A repaired parse is still labelled as repaired. */

export interface RepairSuccess {
  ok: true;
  value: unknown;
  rung: string;
  repairsApplied: string[];
}

export interface RepairFailure {
  ok: false;
  attempted: string[];
  reason: string;
}

type Rung = { name: string; transform: (text: string) => string | null };

const LADDER: Rung[] = [
  { name: 'parse-direct', transform: (t) => t },
  {
    name: 'strip-code-fence',
    transform: (t) => {
      const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(t);
      return m ? m[1] : null;
    }
  },
  {
    name: 'extract-first-object',
    transform: (t) => {
      // If the first JSON opener in the text is '[', the model produced an
      // array; pulling an element out of it would return a value the model
      // never produced. That is massaging, and the ladder refuses it.
      const firstBrace = t.indexOf('{');
      const firstBracket = t.indexOf('[');
      if (firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace)) return null;
      const start = firstBrace;
      if (start < 0) return null;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < t.length; i++) {
        const ch = t[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) return t.slice(start, i + 1);
        }
      }
      return null;
    }
  }
];

export function repairJson(text: string): RepairSuccess | RepairFailure {
  const attempted: string[] = [];
  for (const rung of LADDER) {
    attempted.push(rung.name);
    const candidate = rung.transform(text);
    if (candidate === null) continue;
    try {
      const value = JSON.parse(candidate);
      return {
        ok: true,
        value,
        rung: rung.name,
        repairsApplied: rung.name === 'parse-direct' ? [] : [rung.name]
      };
    } catch {
      // fall through to the next rung
    }
  }
  return {
    ok: false,
    attempted,
    reason: 'no enumerated rung produced valid JSON; the output is rejected, not massaged'
  };
}
