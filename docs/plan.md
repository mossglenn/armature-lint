# Lint: plan

*Status: L1 built 2026-11-22, L2 2026-11-25, not yet released. The whole design (why Lint lives outside the hub, the hub's checks, the gate, the local runner, the catalog, the build order) is Armature's [`docs/lint-plan.md`](https://github.com/mossglenn/armature/blob/main/docs/lint-plan.md), with ADR-0070 behind it. This file holds what is Lint's alone: the decisions taken in this repository, the choices made while building, and where each step stands.*

## 1. Where it stands

| Step | What | State |
| --- | --- | --- |
| **L1** | `@armature/lint` (the engine, ten rules), `armature-lint run` and `rules`, policy from a local file | Built 2026-11-22 |
| **L2** | `armature-lint watch` against a workspace hub; `armature-lint serve` against a remote, posting runs as the agent its requirements name (`agent:lint/service` by convention) | Built 2026-11-25; the program's Tools list that starts `watch` is Armature's step P1 |
| L3 | Layering over requirement `params`, `keep` (a hit as a `DesignFinding`), suppression by a Dismissed finding, `requirement set` | Not started |
| Later | The three prerequisite rules, when the hub's path read exists (Armature's SESSION.md item 18) | Waiting |

## 2. Decisions taken (Amos)

On 2026-11-22, for L1:

1. **This repository:** `mossglenn/armature-lint`, public, MIT, beside `armature-mcp`.
2. **Ten rules in L1, as planned.** `prereq.cycle`, `prereq.assessed-before-taught` and `prereq.bloom-descends` wait for the path read, so that Lint stays one of the clients the path read's ADR is tested against, rather than hand-coding traversals over the export and never needing it.
3. **"Rule" is kept** for what Lint's catalog holds, accepting the collision with Armature's naming vocabulary, which gives "rule" to the hub's invariants in what people read (its row "A rule", collision 19). A note on that row says Lint's rules are a check's, advisory, never the hub's.

On 2026-11-25, for L2:

4. **Lint installed with no rules set up still runs.** `watch` posts a run under the check name `lint`, as a `commit`, with `--policy` or the defaults, on every workspace head that no personal Lint requirement binds. The run counts toward nothing; it is the status a person sees on their commit.
5. **A static token for `serve` under `oidc`:** `ARMATURE_TOKEN`, renewed by the operator. The client credentials grant (the viewer's `viewerToken.ts`, with its rule that a secret travels only over `https`) comes when the service is first deployed on an instance under `oidc`.
6. **No `detailsUrl` pages yet.** A run carries its summary and counts; `armature-lint run --ref <commit>` reproduces its detail exactly, since a run is recomputable. Pages come when someone reads runs on a remote.
7. **A sweep, not a stored cursor.** On start, after `hub.started`, and when the hub cannot resume from a cursor, the loop checks every head again, skipping a head that already holds its own run under the same check and hash. No state file.

## 3. Choices made in building, open to overrule

In L1:

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

In L2 (`follow.ts`, `modes.ts`, `report.ts`; the reasons are at the top of each):

- **Two commands, one loop.** `watch` refuses a remote hub and `serve` a workspace hub, each naming the other command; both refuse a hub without `armature/checks`. A hub unreachable at start is exit 2, left to whatever started the process (the Tools list's backoff, a container's restart policy); once following, an unreachable hub is waited for, the delay doubling from 1 s to 30 s.
- **`serve` answers only the requirements that name it as `reporter`**, since a run by anyone else counts toward nothing (the hub's trust rule). It reads the `Active` `CheckRequirement`s on `main` whose check is `lint` or under `lint/`, and their `paramsHash` from `GET /checks/requirements` once per distinct target, again on `requirement.changed`.
- **Which branches `serve` checks:** every branch a requirement binds a merge from: into another branch than itself (any branch, when the requirement is `locked`), from a source its `fromPrefix` admits. `main` is never a source, since a merge from `main` is how a branch brings it in and no gate stops it. The event is `merge` and the requirement's target is the base for `coverage.regressed`. It does not wait for a merge request to be opened: a run already at the head is what lets the merge through at once.
- **One run per check name and hash at a commit.** Two requirements with the same check and params but different targets would differ only in `coverage.regressed`; the gate reads the newest run under the hash, so the first target's stands for both.
- **What `watch` posts on a workspace head:** each personal Lint requirement (from `checks.json`) as a `push` under its hash, or, with none, `lint` as a `commit` (decision 4); and a preview of each remote Lint requirement mirrored for the workspace's merge into its parent (`from` in its record), as a `merge` under the remote's check name and hash, its summary beginning "Preview of the remote's …", unless a personal requirement has the same name. `main` there is the remote's mirror and is never checked.
- **A push is checked once, at its last commit.** After an answer with events the loop waits 500 ms and drains what followed (up to ten answers) before checking, keeping the newest commit per branch.
- **`watch` holds the feed for 10 s, and against an older hub sweeps after every quiet answer.** A personal requirement lives in `checks.json`, which the program's Settings writes without a commit; the rehearsal found a push left `checks_pending` after the file changed, since the feed told nothing of it. Armature added the event the same day (its revision 2026-11-25; ADR-0070's note of that day): a workspace hub at that revision tells the change as `requirement.changed` with `personal`, which `watch` answers with a sweep like any requirement change, and the program's own save wakes it at once. Against such a hub `watch` no longer sweeps when the feed is quiet; against an older one it does, a head already checked under the current hash costing three reads on loopback. Which it is, `watch` reads from `GET /discover`'s `versions` (`PERSONAL_EVENTS_REVISION`), still asking for `HUB_REVISION`, so either hub answers it. It keeps the 10 s hold on both, since a file edited by hand wakes no request and is told, or swept for, at the next answer.
- **An `error` run only for what would fail the same way again.** A requirement whose `params` are not a Lint policy, or a read the hub refuses with a 4xx (a 403 for a branch this identity may not read), gets an `error` run saying so, which the gate reads as not satisfied. A hub down or failing (no answer, a 5xx) gets no run: the loop retries the same commit, since an `error` run would stand at that head as a failed check and the sweep would skip it. The same for the merge target's coverage: a target the hub does not hold leaves `coverage.regressed` not run, a failing read is retried rather than taken as nothing regressed. A commit the hub no longer holds is skipped.
- **`watch` ends when its standard input closes** (unless that is a terminal), as the Tools list stops what it started; `serve` ignores its standard input, which a container gives as already closed. Both end on SIGINT and SIGTERM.
- **The seed test reads at the seed's last commit,** the newest on `main` whose message starts "Seed demo data:", since the contract test of `serve` writes to `main` and may run beside it.

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
- **`alignment.triangle-incomplete`, 7 for information:** every declaration lacks a formative use (the seed's one formative use is of an item that assesses nothing), and the rule repeats the two above per module.
- **Quiet:** no item below its objective's level, nothing over-assessed, no orphan, no agent-created record, no self-attested item (the one attestation is the reviewer's, of the designer's item).

Two overlaps for Amos's review, left as they are: the triangle's "no activity" restates `untargeted-objective` per module, and its "no placed item" restates `coverage.uncovered`. The triangle is off at commit and informational elsewhere, so the overlap costs lines, not verdicts. Narrowing it to the formative side alone would remove the repetition and make it a different rule.

## 6. L2, rehearsed (its exit)

Armature's lint plan §15 gives L2 two exits: a commit on the desktop shows a lint status within 5 s on the seed, and the service survives a hub restart without missing a head. Both were rehearsed on 2026-11-25 against hubs built from Armature's `main` (revision 2026-11-21): a remote on port 3198 over a fresh main seed, and a workspace hub on port 3197 cloned from it, its action routes on, running the built `dist/armature-lint.mjs`.

- **`watch`, a local commit:** its run was on the workspace hub 535 ms after the write returned, the 500 ms settle included. Started again on the same head, the sweep posted nothing, the run already being there. Closing its standard input ended it in 9 ms, exit 0.
- **The push gate:** with `checks.json` requiring `coverage.uncovered` at a push, `lint/personal` failed (3 required) and the push was 422 `checks_failed`. With the file changed to `warn`, the push was 409 `checks_pending` at once (the choice in §3 that this found: before it, the push stayed pending until the next commit) and, 12 s later, 200 with `lint/personal` passing. Against a workspace hub at revision 2026-11-25, rehearsed later that day: no line and no run during 12 quiet seconds, and after a hand edit of the file a run under the new hash 8.5 s later (told at the feed's next answer) and the push 200; the program's own save, which wakes the feed at once, is held by Armature's `core.test.ts`.
- **`serve`, a commit on a bound branch:** its run, by the requirement's agent under the hub's hash, within 5 s, asserted by `test/serve.contract.test.ts` in CI as well. A restart of the hub is tested against the fake hub (`hub.started`, then a sweep that finds a head moved while the hub was down), since the contract test cannot restart the hub it is given.

## 7. Verification

`pnpm test` runs a failing and a passing case for each rule over hand-built snapshots (`test/fixtures.ts`), the engine and the policy, and the command line against a fake hub that records what it was asked (every read after the export names the export's commit). With `ARMATURE_HUB_URL` set, `test/seed.test.ts` runs against a real hub as well: CI's `contract` job seeds Armature's main seed at the commit `package.json` pins and starts its hub, as `armature-mcp`'s CI does with the ICICLE seed.

Since L2, `test/follow.test.ts` drives `watch` and `serve` against a hub that remembers (`test/hub.ts`: branches, the feed and its cursor, runs, requirements, workspaces, personal requirements), with the feed's held request running a test's next step: which branches and check names, the settle, a restart, a lost cursor, a changed requirement, an unreachable hub and the doubling wait, a head already checked, a personal requirement changed without a commit, the local policy, the signal, each role refused. `test/serve.contract.test.ts` runs `serve` against the real hub; it registers `agent:lint/contract` and an Advisory requirement bound by `fromPrefix` to the branch `lint-contract` alone, reused on every run, so a local database grows by two commits a run and CI's is fresh. The workspace side has no contract test (it would need a workspace hub cloned in CI); §6's rehearsal stands for it until the program's Tools list is rehearsed with it.
