# armature-lint

Soft design rules for a learning design kept in an [Armature](https://github.com/mossglenn/armature) hub: objectives no item assesses, items below their objective's Bloom's level, formative checks placed before the teaching, AI-drafted records no person has reviewed. Lint reads the hub at one commit through `/api/v1` and says what each rule flags. It is a client of the hub like any other tool. It never touches the store and runs no code inside the hub.

**Status: L1** (2026-11-22). The rule engine (`@armature/lint`, ten rules) and a command line that runs it once against any hub and ref. Next: L2, `watch` beside a desktop hub and a service beside a remote, posting check runs that a merge or a push can require (Armature's ADR-0070, built). The plan, with every decision and its reason, is [docs/plan.md](docs/plan.md); the whole design is Armature's [docs/lint-plan.md](https://github.com/mossglenn/armature/blob/main/docs/lint-plan.md).

## Running it

Needs Node 22 or later, pnpm 10 (`corepack enable` gives it), and a hub to read.

```sh
pnpm install
pnpm run build                                # → dist/armature-lint.mjs
node dist/armature-lint.mjs run               # main on http://localhost:3100
node dist/armature-lint.mjs run --branch amos_unit-3 --event merge --base main
node dist/armature-lint.mjs rules             # the catalog with its defaults
```

```
armature-lint: main at dstusmy2prvvqssqu0k70v9qqihyd0i, as a merge

warn    coverage.uncovered
          "Describe Model Training" is Uncovered in "How AI Systems Work": no delivered item assesses it, and none in review either.
...
pass: 8 warnings, 7 for information.
```

| Option | Meaning |
| --- | --- |
| `--hub URL` | The hub's origin; else `ARMATURE_HUB_URL`, else `http://localhost:3100` |
| `--branch NAME` / `--ref COMMIT` | What to lint; `main` by default |
| `--event commit\|push\|merge` | Which of each rule's actions applies; `commit` by default |
| `--base NAME` / `--base-ref COMMIT` | The merge target, for `coverage.regressed` |
| `--policy FILE` | A policy (below) |
| `--json` | The result as JSON, the shape a check run will carry |
| `--verbose` | Each hit's record id and module |

Identity, as the other Armature tools take it: `ARMATURE_USER` (sent as `Armature-User` under the header resolver) or `ARMATURE_TOKEN` (a bearer token under `oidc`).

Exit status: **0** pass, **1** fail (a hit the policy requires), **2** could not run.

## Policy

Each rule has an action at each event: `off`, `inform`, `warn` or `require`. With no policy, the defaults apply, and no default is `require`. A policy changes them:

```json
{ "rules": {
    "alignment.bloom-gap": "require",
    "coverage.uncovered": { "merge": "require" },
    "orphan.unreferenced": "off" } }
```

One action applies at every event; an object names some events and keeps the defaults for the rest. The result fails when any hit resolves to `require`. The same object is what a required check's `params` will carry on a hub (L3), so a policy written here moves there unchanged.

## The rules

| Rule | Flags |
| --- | --- |
| `coverage.uncovered` | A declared objective no delivered item assesses |
| `coverage.over-assessed` | A declared objective with more items than the threshold allows |
| `coverage.regressed` | A declared objective whose verdict is lower than on the merge target |
| `alignment.bloom-gap` | An item below the Bloom's level of an objective it assesses |
| `alignment.untargeted-objective` | An objective no activity targets |
| `alignment.triangle-incomplete` | A declared objective missing an activity, a placed item or a formative use in its module |
| `order.assessed-before-practiced` | An item used formatively before any activity that targets its objective |
| `review.self-attested-only` | An item attested only by its own author |
| `review.agent-unattested` | A record an agent created with no current affirmation by a person |
| `orphan.unreferenced` | An artifact nothing references |

Lint reports records, never people: no rule or output groups hits by author (Armature's ADR-0021). A hit becomes part of the design record only when a person keeps it as a finding (L3).

## Development

```sh
pnpm run typecheck
pnpm test                                     # the rules, the engine, the command line against a fake hub
ARMATURE_HUB_URL=http://localhost:3198 pnpm test   # and against a real hub serving Armature's main seed
```

A hub over a fresh main seed, from an Armature checkout, on a database of its own so nothing else is disturbed:

```sh
export TERMINUS_DB=armature_lint
node scripts/load_schema.js --recreate && node scripts/seed_data.js
cd app && npm run build:hub && TERMINUS_DB=armature_lint PORT=3198 HOST=127.0.0.1 node dist/server.mjs
```

Lint writes nothing, so a run leaves the store as it found it. `@armature/client` and `@armature/types` are pinned to an Armature commit in `package.json`; CI's contract job seeds that commit's main seed.

## License

MIT
