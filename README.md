# careful-router

![TypeScript](https://img.shields.io/badge/TypeScript-erasable_syntax-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/node-%3E%3D22.18-5FA04E?logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/runtime_dependencies-0-B45309)
[![CI](https://github.com/m-sanchez/careful-router/actions/workflows/test.yml/badge.svg)](https://github.com/m-sanchez/careful-router/actions/workflows/test.yml)
![License](https://img.shields.io/badge/license-MIT-6E6E6E)
[![npm](https://img.shields.io/npm/v/@m-sanchez/careful-router?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@m-sanchez/careful-router)

> **In plain English:** this sends each request to the right model for the job and the cost: a cheap model for easy work, a strong one for hard work.

LLM routing with an audit trail. Route by capability record and cost, refuse
when no model qualifies, replay every decision.

[More tools](https://github.com/m-sanchez) · [Working rules](https://miguelsanchez.co.uk/ethics) ·
[Worked example: routing-study](https://github.com/m-sanchez/routing-study)

*Provenance: this came out of one body of production LLM work, extracted and
generalised into a standalone package. First published 2026-08-31.*

Most routers optimise where the query goes. This one can also prove why,
and says no when no model qualifies. The policy is deterministic code you
can read, not a learned model; every decision emits a record that freezes
everything it depended on; and a refusal names the constraint that failed
and the nearest serviceable fact, never a silent fallback.

```ts
import {
  route,
  selectedModel,
  toAnthropicRequest,
  ANTHROPIC_MODELS,
  LOCAL_EXAMPLE
} from '@m-sanchez/careful-router';

const record = route(
  { task: 'summarize case notes', requires: ['tools'], boundary: 'local-only' },
  [...ANTHROPIC_MODELS, LOCAL_EXAMPLE]
);

record.outcome;       // { kind: 'selected', model: 'llama3.1:8b' }
record.eliminations;  // every ruled-out model, with stage and written reason
record.recordHash;    // SHA-256 over the canonical record

toAnthropicRequest(record);  // { model: 'llama3.1:8b', max_tokens: 8192 }
selectedModel(record);       // the ModelRecord, from the record's own snapshot
```

The core makes zero network calls. `toAnthropicRequest(record)` shapes the
selection for the official Anthropic SDK - it resolves the id against the
record's *own* frozen registry, and throws by name on a routed no rather than
emitting a body with `max_tokens: NaN`. Execution is yours.

## The policy is published, not learned

Elimination stages run in a fixed order: `availability → boundary →
capabilities → context → output → budget-in → budget-out`. The policy
descriptor is hashed into every record, so a record also proves *which*
policy decided.

**Cheapest means cheapest.** Tell the router what the call is expected to
weigh and it ranks by expected spend:

```ts
route(
  { task: 'summarize case notes', expectedInTokens: 100_000, expectedOutTokens: 500 },
  registry
);
```

On that workload a $1-in/$30-out model costs 115,000 micro-USD and a
$5-in/$2-out model costs 501,000. Summing the two *rates* - 31 against 7 -
picks the second, at 4.4x the money. Spend is compared as
`expectedInTokens * inUsdMicrosPerMTok + expectedOutTokens * outUsdMicrosPerMTok`,
undivided, so the comparison stays in exact integers. State both volumes or
neither; a fractional one is refused by name. Without volumes the
policy falls back to the rate sum, which orders cost correctly **only when
input and output volumes are equal** - and says so in `POLICY.selection`
rather than calling itself cheapest. Ties go to the larger context window,
then lexicographic id.

**Nearest means nearest.** When the pool empties, the refusal facts are
ordered by distance to the constraint that *failed* - the shortfall for
context and output, the overage for budget, the count of missing capabilities
- so the path to yes names the most achievable option, not the cheapest one:

```ts
route({ task: 'long answer', minOutputTokens: 200_000 }, registry).outcome.pathToYes;
// nearest serviceable: claude-sonnet-5, needs a max output of 200000 (has 128000)
// not llama3.1:8b, which is free, 8,192-capped, and 24x short
```

The full refusal:

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

A third thing can move: the policy itself. `replay` reads the record's own
policy version and hash *before* re-deriving anything, so a version bump is
reported as drift against the code, never as a fault in the archive:

```ts
replay(recordWrittenIn2024);
// policyDrift:    true
// hashIntact:     true
// verifiedUnder:  '1.0.0'
// detail: 'written under policy 1.0.0; this build implements 2.0.0.
//          Re-derived under policy 1.0.0 the record is bit-identical:
//          the decision stands, the policy moved'
```

`POLICY_HISTORY` keeps every policy version this build can re-derive under -
descriptor, normalization, ranking and refusal ordering - so an old record is
replayed under the policy that wrote it. That is what "a record proves *which*
policy decided" has to mean for the frozen descriptor to be more than a stored
string. A record naming a policy this build has never shipped says exactly
that, and is not re-derived.

The bit-identical claim rests on a canonical byte form, shared verbatim with
the other packages in this family, and specified in `src/canonical.ts`:

> Object keys sorted by code unit, no insignificant whitespace,
> undefined-valued properties omitted, strings JSON-escaped, SHA-256 hex over
> UTF-8. Numbers: finite only; -0 normalised to 0; integer-valued numbers must
> be SAFE integers and print as integers; non-integers must satisfy
> `|x| >= 1e-4` and print as the shortest round-trip decimal. The floor exists
> because JS writes `0.000007` where Python writes `7e-06` - refusing those
> values is what makes the byte form portable across languages.

`test/fixtures/canonical-form.fixture.json` is the shared conformance fixture:
27 accepted values with their exact bytes and hashes, 8 refused ones. The same
file ships in the sibling packages, so a divergence surfaces as a failing case
rather than as two packages hashing one value two ways.

That is a rule about bytes. This package's separate rule that **costs travel as
integer micro-USD per million tokens** (`$5.00/MTok = 5_000_000`, never floats)
is a rule about a price sheet, and is enforced where a violation can name the
model and the field - see `validateRegistry` below.

## Also in the box

- **`CircuitBreaker`**: per-provider closed/open/half-open with an
  injectable clock. `tryAcquire` claims the single half-open trial slot
  (named for the mutation it is), and an abandoned trial expires after a
  cooldown instead of locking the provider out. Snapshots feed routing, so
  an unavailable provider is eliminated *in writing*.
- **`validateRegistry(models)`**: named problems with a pinned snapshot -
  `claude-sonnet-5.inUsdMicrosPerMTok is 2.5 (not an integer); costs are
  integer micro-USD per MTok - $2.50/MTok is 2500000` - plus duplicate ids and
  negative values. `route()` runs it first, so a missed conversion fails by
  name before any routing happens instead of anonymously from inside a hash.
  `microsPerMTok(2.5) === 2_500_000` and `usdPerMTok(2_500_000) === '$2.50'`
  are the blessed conversions in both directions.
- **`repairJson`**: an enumerated repair ladder for model output
  (`parse-direct → strip-code-fence → extract-first-object`). Each success
  is labelled with its rung; output that fails every rung is rejected with
  the attempt list, never massaged until it parses.

## Honest limits

- The default registry is illustrative: real model ids, synthetic numbers,
  there to exercise the policy. Pin your own snapshot for anything real.
- `replay` detects edits by anyone who did not re-run `hashOf`, which this
  package exports. No signature, no external anchor: the record proves
  internal consistency, not custody.
- `POLICY_HISTORY` reaches back only to policy 1.0.0, the first published one.
  A record from a policy this build does not carry is reported as
  unre-derivable, not guessed at.

## Install

```bash
npm install @m-sanchez/careful-router
```

Also installable from a pinned git tag:
`github:m-sanchez/careful-router#v2.0.1`. CI proves the packed tarball
imports cleanly. Zero runtime dependencies.

## Develop

```bash
npm ci            # dev-only: typescript
npm test
npm run typecheck
```

Node 22.18+ (erasable-syntax TypeScript; node runs the sources directly).

## The tests are the point

[`CLAIMS.md`](CLAIMS.md) maps every falsifiable claim on this page to the test
that would fail if it stopped being true. The headlines:

| Test | Claim |
| :-- | :-- |
| cheapest qualifying model wins | the policy optimises cost, not prestige |
| a 100K-in/500-out job picks the model that actually costs less | "cheapest" is expected spend, not a sum of two rates |
| nearest serviceable is the smallest shortfall, not the cheapest | a refusal names the achievable path, not the free one |
| local-only routes to the local model | a data boundary is a constraint, not a preference |
| impossible budget → routed no with nearest fact | refusal carries its own path to yes |
| open circuit eliminates at availability, in writing | the router routes around failure and says so |
| replay matches after the world changes | the record's inputs are frozen, so the decision replays |
| tampered record fails replay, named | the audit trail defends itself |
| a policy bump replays as drift, not as a forged record | the archive is not blamed when the code moves |
| an archived 1.0.0 record replays under 1.0.0, bit-identical | the frozen policy descriptor is executable, not decorative |
| repriced registry flips reevaluate, not replay | yesterday's decision and today's answer are different questions |
| truncated JSON fails every rung | repair is enumerated; completion would be fabrication |
| an array wrapped in prose is refused, not element-extracted | a different value is not a repaired value |
| the README quickstart produces a valid request body | the documented call path is executed, not just described |
| an empty registry names its constraint in both fields | a refusal cannot contradict itself |
| a dollars-for-micros cost is refused, naming model and field | the adopter's likeliest mistake fails early, not anonymously |
| duplicate ids cannot bend the canonical order | the bit-identical claim survives hostile input |
| an abandoned circuit trial expires | no permanent lock-out from a lost callback |
