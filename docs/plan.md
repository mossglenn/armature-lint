# Lint: plan

*Status: L1 built 2026-11-22, not yet released. The whole design (why Lint lives outside the hub, the hub's checks, the gate, the local runner, the catalog, the build order) is Armature's [`docs/lint-plan.md`](https://github.com/mossglenn/armature/blob/main/docs/lint-plan.md), with ADR-0070 behind it. This file holds what is Lint's alone: the decisions taken in this repository, the choices made while building, and where each step stands.*

## 1. Where it stands

| Step | What | State |
| --- | --- | --- |
| **L1** | `@armature/lint` (the engine, ten rules), `armature-lint run` and `rules`, policy from a local file | Built 2026-11-22 |
| L2 | `watch` against a workspace hub; the service against a remote, posting runs as `agent:lint/service` | Not started; the hub's half is built (ADR-0070) |
| L3 | Layering over requirement `params`, `keep` (a hit as a `DesignFinding`), suppression by a Dismissed finding, `requirement set` | Not started |
| Later | The three prerequisite rules, when the hub's path read exists (Armature's SESSION.md item 18) | Waiting |

## 2. Decisions taken (2026-11-22, Amos)

1. **This repository:** `mossglenn/armature-lint`, public, MIT, beside `armature-mcp`.
2. **Ten rules in L1, as planned.** `prereq.cycle`, `prereq.assessed-before-taught` and `prereq.bloom-descends` wait for the path read, so that Lint stays one of the clients the path read's ADR is tested against, rather than hand-coding traversals over the export and never needing it.
3. **"Rule" is kept** for what Lint's catalog holds, accepting the collision with Armature's naming vocabulary, which gives "rule" to the hub's invariants in what people read (its row "A rule", collision 19). A note on that row says Lint's rules are a check's, advisory, never the hub's.

## 3. Choices made in building, open to overrule

- **Every read at one commit.** The export is read first, at the branch or commit asked for; every later read names the commit the export was served from (`load.ts`).
- **The hub's derivations are reused, never recomputed.** Coverage verdicts and Bloom gaps come from the coverage and alignment reads, so Lint cannot disagree with the viewer about what "Uncovered" means. Only what no read gives is computed here: reverse references, a module's triangle, a formative use against teaching order.
- **`order.assessed-before-practiced` reads formative uses only.** An `Assessment` has no place in a module's teaching order (it names its module and nothing more), so a summative placement cannot come "before" an activity. The rule flags an item used formatively (ADR-0061) earlier than every activity in the module that targets its objective. When assessments join the module-content read (Armature's SESSION.md item 11, carried), the rule can follow them.
- **An attestation on one part counts as an attestation of the record**, in both review rules: they ask whether anyone else looked, not whether every part was affirmed.
- **`review.agent-unattested` needs a current affirmation:** an Affirmed attestation by a person that the attestations read calls `Stale` does not count, and the hit says it was affirmed only before the latest change. Without the read (a snapshot built by hand), the export's attestations stand.
- **`orphan.unreferenced` counts every reference field**, as the impact read does (a note's `subject` included), and leaves out what nothing references by design: `Course`, `DesignNote`, `DesignFinding`, `LearningMetric`. Relationship documents are not artifacts and are never checked.
- **`coverage.regressed` ranks OverAssessed with FullyAssessed**, so a move between them is no regression; a declaration the target lacks is not compared.
- **A triangle's summative side** is any item with a placement in the module's assessments, delivered or in review.
- **The policy file's shape is the future `params`:** `{ "rules": { "<id>": action | { "commit"?, "push"?, "merge"? } } }`, one parser for both. A rule id this Lint does not know is a warning, so a policy written for a newer Lint still runs; an unknown action or event is an error.
- **`HUB_REVISION` is 2026-11-20**, what remote instances serve (Armature's `REMOTE_REVISION`); every route L1 reads is older.
- **The export is read under the `full` profile,** since the review rules need to tell an agent from a person (`User.externalId` under `agent:`). Under `oidc` a caller who is not a maintainer gets the users its records name, which is all these rules use.

## 4. The rules

`armature-lint rules` prints them with their defaults; `src/rules/` holds one file per family, each with its reasoning at the top. Defaults are quiet by design (Armature's lint plan §13): no rule requires anything without a policy.

| Rule | Scope | commit | push | merge | Reads |
| --- | --- | --- | --- | --- | --- |
| `coverage.uncovered` | graph | inform | warn | warn | coverage |
| `coverage.over-assessed` | graph | inform | inform | inform | coverage |
| `coverage.regressed` | graph | off | warn | warn | coverage at the ref and at `--base` |
| `alignment.bloom-gap` | graph | inform | warn | warn | alignment |
| `alignment.untargeted-objective` | graph | inform | warn | warn | alignment |
| `alignment.triangle-incomplete` | graph | off | inform | inform | coverage, module content, export |
| `order.assessed-before-practiced` | graph | inform | warn | warn | module content, export |
| `review.self-attested-only` | document | off | inform | inform | export |
| `review.agent-unattested` | document | inform | warn | warn | export, attestations |
| `orphan.unreferenced` | graph | off | inform | inform | export |

## 5. The seed, reviewed (L1's exit)

The plan's exit for L1 asks for the seed's results reviewed so the defaults aren't noisy. `test/seed.test.ts` holds them as a snapshot, run in CI against Armature's main seed at the pinned commit. At a merge: **8 warnings, 7 for information, pass**; at a commit, 8 for information.

- **`coverage.uncovered`, 3 warnings:** Describe Model Training (no item at all; the seed's draft item assesses nothing), Identify AI Limitations and Evaluate Appropriate AI Use (each with one item in review, which the hit says). The seed holds these to show the projected figure.
- **`alignment.untargeted-objective`, 5 warnings:** only Module 1 has activities in the seed; Modules 2 and 3 have none. True of the seed, and the loudest part of the result.
- **`alignment.triangle-incomplete`, 7 for information:** every declaration lacks a formative use but none (the seed has one formative use, of an item that assesses nothing), and repeats the two rules above per module.
- **Quiet:** no item below its objective's level, nothing over-assessed, no orphan, no agent-created record, no self-attested item (the one attestation is the reviewer's, of the designer's item).

Two overlaps for Amos's review, left as they are: the triangle's "no activity" restates `untargeted-objective` per module, and its "no placed item" restates `coverage.uncovered`. The triangle is off at commit and informational elsewhere, so the overlap costs lines, not verdicts. Narrowing it to the formative side alone would remove the repetition and make it a different rule.

## 6. Verification

`pnpm test` runs a failing and a passing case for each rule over hand-built snapshots (`test/fixtures.ts`), the engine and the policy, and the command line against a fake hub that records what it was asked (every read after the export names the export's commit). With `ARMATURE_HUB_URL` set, `test/seed.test.ts` runs against a real hub as well: CI's `contract` job seeds Armature's main seed at the commit `package.json` pins and starts its hub, as `armature-mcp`'s CI does with the ICICLE seed.
