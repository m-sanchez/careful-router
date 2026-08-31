# careful-router

![TypeScript](https://img.shields.io/badge/TypeScript-erasable_syntax-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/node-%3E%3D22.6-5FA04E?logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/runtime_dependencies-0-B45309)
![Tests](https://img.shields.io/badge/tests-25_passing-2F6F44)
![License](https://img.shields.io/badge/license-MIT-6E6E6E)

LLM routing with an audit trail. Route by capability record and cost, refuse
when no model qualifies, replay every decision.

[More tools](https://github.com/m-sanchez) · [Working rules](https://miguelsanchez.co.uk/ethics)

Most routers optimise where the query goes. This one can also prove why,
and says no when no model qualifies. The policy is deterministic code you
can read, not a learned model; every decision emits a record that freezes
everything it depended on; and a refusal names the constraint that failed
and the nearest serviceable fact, never a silent fallback.

```ts
import { route, ANTHROPIC_MODELS, LOCAL_EXAMPLE } from 'careful-router';

const record = route(
  { task: 'summarize case notes', requires: ['tools'], boundary: 'local-only' },
  [...ANTHROPIC_MODELS, LOCAL_EXAMPLE]
);

record.outcome;       // { kind: 'selected', model: 'llama3.1:8b' }
record.eliminations;  // every ruled-out model, with stage and written reason
record.recordHash;    // SHA-256 over the canonical record
```

The core makes zero network calls. `toAnthropicRequest(record.outcome.model)`
shapes the selection for the official Anthropic SDK; execution is yours.

## The policy is published, not learned

Elimination stages run in a fixed order: `availability → boundary →
capabilities → context → output → budget-in → budget-out`, and the survivor
ranking is one sentence: cheapest by input + output cost, ties broken by
larger context window, then lexicographic id. The policy descriptor is
hashed into every record, so a record also proves *which* policy decided.

When the pool empties, the outcome is a routed no:

```ts
{
  kind: 'cannot-route',
  blockingStage: 'budget-in',
  nearest: [{ model: 'claude-haiku-4-5', wouldNeed: 'an input budget of at least 1000000 micro-USD/MTok' }],
  pathToYes: 'nearest serviceable: claude-haiku-4-5, needs an input budget of at least 1000000 micro-USD/MTok'
}
```

## Replay is not re-evaluation

A `RouteRecord` freezes the request, the policy (version + hash), the
registry snapshot (+ hash), pricing, and the provider circuit states.

- **`replay(record)`** re-derives the decision from the record's own frozen
  inputs: bit-identical, even after prices change or providers vanish. A
  tampered record fails with the alteration named.
- **`reevaluate(record, todaysRegistry)`** applies today's inputs to the old
  request and returns the diff. A changed answer is information, not an
  error.

The bit-identical claim rests on a canonical byte form, specified in
`src/canonical.ts`: object keys sorted, no insignificant whitespace,
SHA-256, and **all numbers are integers**: costs travel as micro-USD per
million tokens (`$5.00/MTok = 5_000_000`), never floats. Non-integer numbers
are refused at the boundary.

## Also in the box

- **`CircuitBreaker`**: per-provider closed/open/half-open with an
  injectable clock; a half-open circuit admits exactly one trial. Snapshots
  feed routing, so an unavailable provider is eliminated *in writing*.
- **`repairJson`**: an enumerated repair ladder for model output
  (`parse-direct → strip-code-fence → extract-first-object`). Each success
  is labelled with its rung; output that fails every rung is rejected with
  the attempt list, never massaged until it parses.

## Run

```bash
npm install       # dev-only: typescript
npm test          # node's built-in runner, via --experimental-strip-types
npm run typecheck
```

Node 22.6+ (the source is erasable-syntax TypeScript, so node runs it
directly). Zero runtime dependencies.

## The tests are the point

| Test | Claim |
| :-- | :-- |
| cheapest qualifying model wins | the policy optimises cost, not prestige |
| local-only routes to the local model | a data boundary is a constraint, not a preference |
| impossible budget → routed no with nearest fact | refusal carries its own path to yes |
| open circuit eliminates at availability, in writing | the router routes around failure and says so |
| replay matches after the world changes | the record's inputs are frozen, so the decision replays |
| tampered record fails replay, named | the audit trail defends itself |
| repriced registry flips reevaluate, not replay | yesterday's decision and today's answer are different questions |
| truncated JSON fails every rung | repair is enumerated; completion would be fabrication |
