# Claims

Every externally falsifiable behavioural claim this package makes about
itself - in `README.md` and in the `package.json` description - and the
executable test that would fail if the claim stopped being true.

Run them all with `npm test`. A claim with no enforcing test is either not a
behavioural claim (the disclosures at the bottom) or is enforced by CI
configuration rather than by a test, which is said so explicitly.

## package.json description

> LLM routing with an audit trail: route by capability record and cost,
> refuse when no model qualifies, replay every decision.

| Claim | Enforcing test |
| :-- | :-- |
| routes by capability record | `test/route.test.ts::a capability requirement eliminates with a written reason` |
| routes by cost | `test/policy.test.ts::cheapest means least expected spend when the request states its volumes` |
| refuses when no model qualifies | `test/route.test.ts::an impossible budget is a routed no with the nearest serviceable fact` |
| every decision replays | `test/replay.test.ts::a record written by this build still replays bit-identically` |
| there is an audit trail: a record freezes what the decision read | `test/package.test.ts::a record freezes every input the decision read` |

## Headline

| Claim | Enforcing test |
| :-- | :-- |
| "the right model for the job and the cost" | `test/policy.test.ts::cheapest means least expected spend when the request states its volumes` |
| "a cheap model for easy work, a strong one for hard work" | `test/route.test.ts::context demands walk the selection up the registry` |
| "says no when no model qualifies" | `test/route.test.ts::an empty registry refuses with a path to yes, never throws` |
| the policy optimises cost, not prestige: the cheapest qualifying model wins | `test/route.test.ts::the cheapest qualifying model wins, not the most impressive` |
| a data boundary is a constraint, not a preference: `local-only` routes to the local model | `test/route.test.ts::local-only boundary routes to the model that never leaves the machine` |
| "every decision emits a record that freezes everything it depended on" | `test/package.test.ts::a record freezes every input the decision read` |
| "the policy is deterministic code": same inputs, same record | `test/audit.test.ts::two identical decisions produce identical record hashes` |
| "a refusal names the constraint that failed" | `test/route.test.ts::an empty registry names its own constraint consistently in both fields` |
| "and the nearest serviceable fact" | `test/policy.test.ts::nearest serviceable on output is the smallest shortfall, not the cheapest` |
| "never a silent fallback" | `test/route.test.ts::an impossible budget is a routed no with the nearest serviceable fact` |

## Quickstart

| Claim | Enforcing test |
| :-- | :-- |
| the quickstart snippet runs and selects `llama3.1:8b` | `test/quickstart.test.ts::the README quickstart produces a request body the Anthropic API accepts` |
| `record.eliminations` carries every ruled-out model with stage and reason | `test/route.test.ts::a capability requirement eliminates with a written reason` |
| `record.recordHash` is a SHA-256 over the canonical record | `test/package.test.ts::a record freezes every input the decision read` |
| `toAnthropicRequest(record)` returns `{ model: 'llama3.1:8b', max_tokens: 8192 }` | `test/quickstart.test.ts::the README quickstart produces a request body the Anthropic API accepts` |
| `selectedModel(record)` resolves against the record's own frozen registry | `test/quickstart.test.ts::selectedModel resolves against the record's own frozen registry, not today's` |
| `toAnthropicRequest` throws by name on a routed no instead of emitting `max_tokens: NaN` | `test/quickstart.test.ts::a routed no cannot be shaped into a request; it throws by name` |
| `max_tokens` never exceeds the model's `maxOutput` | `test/quickstart.test.ts::a bare ModelRecord still works, and max_tokens never exceeds maxOutput` |
| the core makes zero network calls | `test/package.test.ts::the core makes zero network calls: nothing in src can reach the network` |

## The policy is published, not learned

| Claim | Enforcing test |
| :-- | :-- |
| stages run in the published order, `availability` first | `test/route.test.ts::an open provider circuit eliminates at availability, visibly` |
| the policy descriptor is hashed into every record | `test/package.test.ts::a record freezes every input the decision read` |
| stating volumes ranks by expected spend, not by the rate sum | `test/policy.test.ts::cheapest means least expected spend when the request states its volumes` |
| the worked numbers: 115,000 micro-USD against 501,000, and the rate sum picks the dearer one | `test/policy.test.ts::the README arithmetic holds: 115,000 micro-USD against 501,000` |
| the comparison stays in exact integers | `test/policy.test.ts::expected spend that leaves the exact integer range refuses rather than mis-ranks` |
| without volumes the rate sum stands, and is right at equal volumes | `test/policy.test.ts::the rate sum is right when input and output volumes are equal` |
| `POLICY.selection` says the fallback assumes equal volumes rather than calling itself cheapest | `test/policy.test.ts::the policy descriptor says the rate-sum fallback assumes equal volumes` |
| ties go to the larger context window, then lexicographic id | `test/route.test.ts::candidate ordering is deterministic: cost, then context, then id` |
| refusal facts are ordered by distance to the constraint that failed - output shortfall | `test/policy.test.ts::nearest serviceable on output is the smallest shortfall, not the cheapest` |
| - context shortfall | `test/policy.test.ts::nearest serviceable on context is the smallest shortfall` |
| - budget overage | `test/policy.test.ts::nearest serviceable on budget is the smallest overage` |
| - count of missing capabilities | `test/policy.test.ts::nearest serviceable on capabilities counts what is missing` |
| the exact `pathToYes` the README prints for a 200,000-token output | `test/policy.test.ts::nearest serviceable on output is the smallest shortfall, not the cheapest` |
| the full refusal shape (`kind`, `blockingStage`, `nearest`, `pathToYes`) for the budget-in example | `test/route.test.ts::an impossible budget is a routed no with the nearest serviceable fact` |
| the request the ranking used is frozen into the record | `test/policy.test.ts::the frozen request carries the volumes the ranking used` |
| state both volumes or neither; a fractional one is refused by name | `test/policy.test.ts::a fractional or one-sided volume is refused by name` |

## Replay is not re-evaluation

| Claim | Enforcing test |
| :-- | :-- |
| a `RouteRecord` freezes request, policy + hash, registry snapshot + hash, pricing and circuit states | `test/package.test.ts::a record freezes every input the decision read` |
| `replay` re-derives bit-identically after the world changes | `test/audit.test.ts::replay re-derives the outcome from frozen inputs after the world changes` |
| a tampered record fails replay with the alteration named | `test/audit.test.ts::a tampered record fails replay with the alteration named` |
| `reevaluate` returns a changed answer as a diff, not an error | `test/audit.test.ts::reevaluate reports a changed answer as information, not an error` |
| `reevaluate` on an unchanged world confirms the recorded answer | `test/audit.test.ts::reevaluate with an unchanged world confirms the recorded answer` |
| a policy bump is reported as drift, never as a forged record | `test/replay.test.ts::a policy bump is reported as drift, never as a forged record` |
| the drift detail names both versions, and `verifiedUnder` names the policy that verifies it | `test/replay.test.ts::an old record still replays under the policy that wrote it` |
| `POLICY_HISTORY` re-derives an old record under the policy that wrote it, bit-identically | `test/replay.test.ts::an old record still replays under the policy that wrote it` |
| a record naming a policy this build never shipped says so and is not re-derived | `test/replay.test.ts::a record written under a policy this build has never seen says so` |
| a record naming this policy version but not this descriptor is not verified | `test/replay.test.ts::a record naming this policy version but not this policy is not verified` |
| validation added after a record was written does not break its replay | `test/registry.test.ts::validation is a decision-time guard, so an archived record still replays` |

## The canonical byte form

| Claim | Enforcing test |
| :-- | :-- |
| the quoted rule is what the code implements, on 27 accepted values | `test/canonical.test.ts::every accept case in the shared fixture produces the fixture bytes` |
| the same values hash to the fixture's SHA-256 | `test/canonical.test.ts::every accept case in the shared fixture produces the fixture sha256` |
| the 8 refused values are refused, not hashed | `test/canonical.test.ts::every reject case in the shared fixture is refused, not hashed` |
| -0 normalises to 0 | `test/canonical.test.ts::-0 normalises to 0, which JSON cannot carry into the fixture` |
| undefined-valued properties are omitted | `test/canonical.test.ts::undefined-valued properties are omitted, which JSON cannot carry either` |
| key order does not change the bytes | `test/audit.test.ts::canonical bytes are key-order independent` |
| a value below the 1e-4 floor is refused; a finite non-integer above it is not | `test/audit.test.ts::the canonical boundary refuses what it cannot write portably` |
| duplicate registry entries cannot make the canonical order engine-dependent | `test/route.test.ts::duplicate ids cannot make the canonical snapshot order engine-dependent` |
| costs travel as integer micro-USD, enforced where it can name the model and field | `test/registry.test.ts::a dollars-for-micros mistake is refused up front, naming the model and the field` |

## Also in the box

| Claim | Enforcing test |
| :-- | :-- |
| circuit: closed / open / half-open with an injectable clock | `test/circuit.test.ts::consecutive failures open the circuit at the threshold` |
| circuit: `tryAcquire` claims the single half-open trial slot | `test/circuit.test.ts::after the cooldown the circuit admits exactly one trial, and an abandoned trial expires` |
| circuit: an abandoned trial expires instead of locking the provider out | `test/circuit.test.ts::an abandoned trial expires after a cooldown instead of locking the provider out` |
| circuit: a snapshot feeds routing, and an unavailable provider is eliminated in writing | `test/route.test.ts::an open provider circuit eliminates at availability, visibly` |
| circuit: a snapshot freezes every provider state for the record | `test/circuit.test.ts::snapshot freezes every provider state for the audit record` |
| `validateRegistry` names the model and the field, with the quoted message | `test/registry.test.ts::a dollars-for-micros mistake is refused up front, naming the model and the field` |
| `validateRegistry` catches duplicate ids | `test/registry.test.ts::a duplicate model id is refused: the record could not name its own selection` |
| `validateRegistry` catches negative values | `test/registry.test.ts::a negative cost is refused, naming the model and the field` |
| `route()` runs the validation first, before any routing work | `test/registry.test.ts::a dollars-for-micros mistake is refused up front, naming the model and the field` |
| `microsPerMTok(2.5) === 2_500_000` | `test/registry.test.ts::the dollars-to-micro-USD conversion has one blessed implementation` |
| `usdPerMTok(2_500_000) === '$2.50'` | `test/registry.test.ts::usdPerMTok reads an integer rate back as dollars` |
| the shipped default registry is itself valid under those rules | `test/registry.test.ts::validateRegistry returns named problems and an empty list for a good snapshot` |
| `repairJson` runs the named ladder and labels the rung that succeeded | `test/repair.test.ts::a fenced block parses on the named rung, labelled as repaired` |
| a direct parse applies no repairs | `test/repair.test.ts::repairsApplied is empty on a direct parse and names the rung otherwise` |
| output that fails every rung is rejected with the attempt list | `test/repair.test.ts::garbage is rejected with the full attempt list, never massaged` |
| a truncated object is never completed | `test/repair.test.ts::a truncated object fails every rung rather than being completed` |
| an array wrapped in prose is refused rather than element-extracted | `test/repair.test.ts::a clean top-level array parses direct; one wrapped in prose is refused, not rewritten` |

## Install and develop

| Claim | Enforcing test |
| :-- | :-- |
| zero runtime dependencies | `test/package.test.ts::zero runtime dependencies, as the badge and the install section say` |
| the packed tarball imports cleanly | `.github/workflows/test.yml`, step `install proof` - CI, not a unit test |
| node runs the sources directly on 22, 24 and 26 | `.github/workflows/test.yml`, the `node` matrix running `npm test` against `test/*.test.ts` - CI, not a unit test |
| erasable-syntax TypeScript | `tsconfig.json` `erasableSyntaxOnly: true`, checked by `npm run typecheck` in CI |

## Disclosures, not capability claims

These sentences claim *less* than the code does. Nothing executable enforces
them, and nothing should: if one became false the package would be stronger,
not broken.

- "The default registry is illustrative: real model ids, synthetic numbers."
  The half of this that a test can hold - that the shipped snapshot is a valid
  registry - is enforced by
  `test/registry.test.ts::validateRegistry returns named problems and an empty list for a good snapshot`.
  That the ids match a live provider catalogue cannot be checked without a
  network call, which this package does not make.
- "No signature, no external anchor: the record proves internal consistency,
  not custody."
- "`POLICY_HISTORY` reaches back only to policy 1.0.0, the first published
  one." The behaviour when a policy is missing is enforced by
  `test/replay.test.ts::a record written under a policy this build has never seen says so`.
- The provenance line and the badge links are not behavioural claims.
