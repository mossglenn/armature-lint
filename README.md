# armature-lint

Soft design rules for a learning design kept in an [Armature](https://github.com/mossglenn/armature) hub: objectives no item assesses, items below their objective's Bloom's level, formative checks placed before the teaching, AI-drafted records no person has reviewed. Lint reads the hub at one commit through `/api/v1` and says what each rule flags. It is a client of the hub like any other tool. It never touches the store and runs no code inside the hub.

**Status: L2** (2026-11-25). The rule engine (`@armature/lint`, ten rules); a command line that runs it once against any hub and ref (L1, 2026-11-22); and `watch` beside a desktop hub and `serve` beside a remote, posting check runs that a push or a merge can require (Armature's ADR-0070). Next: L3, layering several requirements' policies, keeping a hit as a finding, and writing requirements from the command line. The plan, with every decision and its reason, is [docs/plan.md](docs/plan.md); the whole design is Armature's [docs/lint-plan.md](https://github.com/mossglenn/armature/blob/main/docs/lint-plan.md).

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

## Checking as you work: `watch`

Beside a desktop (workspace) hub, `watch` follows the hub's event feed and posts a check run on each new head of each workspace, which the desktop program and other tools show on that commit:

```sh
ARMATURE_HUB_URL=http://localhost:3101 ARMATURE_USER=you@example.edu ARMATURE_LOCAL_TOKEN=<the pairing key> \
  node dist/armature-lint.mjs watch [--policy FILE]
```

```
armature-lint watch: following http://localhost:3101, reporting as User/you.
lint: you_unit-3 at 42d722d9…, as a commit: pass, 8 for information
```

- **With no rules set up**, it posts `lint` as a commit, under `--policy` or the defaults.
- **With a personal requirement** naming a Lint check in the program's Settings (`checks.json` in the hub's folder), it posts that check as a push, so a push you gated on Lint goes through once it passes:

  ```json
  { "requirements": [
      { "check": "lint/personal", "level": "Required",
        "params": { "rules": { "alignment.bloom-gap": { "push": "require" } } } } ] }
  ```

  A change saved on the program's Settings page reaches `watch` at once, and one made by hand within about 10 seconds: the hub's event feed tells it (Armature 2026-11-25 and later). Against an older hub, which tells nothing since the file makes no commit, `watch` looks again whenever the feed has been quiet.
- **When the remote requires a Lint check** of merges from your workspace into its parent, it also posts a preview under that check's name, its summary beginning "Preview of the remote's …". The remote's own service decides; the preview tells you beforehand.

`watch` runs until its standard input closes (as the desktop program's Tools list stops it) or it gets SIGINT or SIGTERM; from a terminal, Ctrl-C.

## Beside a remote: `serve`

On a remote hub, `serve` is the reporter a `CheckRequirement` names. It follows the feed and, for each branch a Lint requirement binds a merge from, checks the head as a merge under that requirement's `params` and posts the run the merge gate reads. A push arrives as several commits and is checked once, at its last.

```sh
ARMATURE_HUB_URL=http://hub:3100 ARMATURE_USER=agent:lint/service node dist/armature-lint.mjs serve   # header resolver
ARMATURE_HUB_URL=https://api.example.edu ARMATURE_TOKEN=<the service's token> node dist/armature-lint.mjs serve   # oidc
```

Setting it up, once, by an administrator or a maintainer of `main`:

1. **Register the agent** it reports as: `POST /api/v1/users` with `{ "message": "…", "user": { "displayName": "Lint", "externalId": "agent:lint/service" } }`. Under `oidc` the agent is `agent:<client id>` of the service's credential.
2. **Write the requirement** on `main`, naming that agent as `reporter`:

   ```json
   { "@type": "CheckRequirement", "check": "lint/team", "reporter": "User/<the agent's id>",
     "level": "Required", "locked": false, "status": "Active",
     "params": { "rules": { "coverage.uncovered": { "merge": "require" } } },
     "rationale": "No objective reaches main unassessed" }
   ```

`serve` answers only requirements whose check is `lint` or under `lint/` and whose `reporter` is itself; a run by anyone else counts toward nothing. It reads them again when the feed says one changed, checks every head again after the hub restarts, and waits for a hub that goes away. Under `oidc` the token is static for now, renewed by the operator.

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
pnpm test                                     # the rules, the engine, the command line, watch and serve against fake hubs
ARMATURE_HUB_URL=http://localhost:3198 pnpm test   # and against a real hub serving Armature's main seed
```

A hub over a fresh main seed, from an Armature checkout, on a database of its own so nothing else is disturbed:

```sh
export TERMINUS_DB=armature_lint
node scripts/load_schema.js --recreate && node scripts/seed_data.js
cd app && npm run build:hub && TERMINUS_DB=armature_lint PORT=3198 HOST=127.0.0.1 node dist/server.mjs
```

Lint writes nothing to the graph: a check run makes no commit. The contract test of `serve` does, as the seed's designer: it registers `agent:lint/contract` and a requirement for it, Advisory and bound to the branch `lint-contract` alone, and commits once to that branch, so a local database grows by two commits a run; the seed test reads at the seed's own last commit and is not disturbed. `@armature/client` and `@armature/types` are pinned to an Armature commit in `package.json`; CI's contract job seeds that commit's main seed.

## License

MIT
