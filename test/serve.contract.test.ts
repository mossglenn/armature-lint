/**
 * `serve` against a real hub serving Armature's main seed, when
 * `ARMATURE_HUB_URL` names one; skipped otherwise. L2's exit for the service
 * (Armature's lint plan §15 step 4): a commit gets its run within 5 s, posted
 * as the agent the requirement names, under the hash the hub computed. What a
 * restart of the hub does is the fake hub's test (`follow.test.ts`), since this
 * test cannot restart the hub it is given.
 *
 * Unlike the seed test this one writes, as the seed's designer: it registers
 * the agent `agent:lint/contract` and a requirement for it, Advisory and bound
 * by `fromPrefix` to the branch `lint-contract` alone, so it gates no other
 * merge; and each run adds one commit to that branch. All three are reused on
 * the next run, so a local database grows by a commit on `main` and one on the
 * branch per run, and CI's is fresh each time.
 */
import { describe, expect, it } from 'vitest';
import { createClient, type CheckRun } from '@armature/client';
import { HUB_REVISION, main } from '../src/cli.js';

const hubUrl = process.env.ARMATURE_HUB_URL;
const SERVICE = 'agent:lint/contract';
const BRANCH = 'lint-contract';
const CHECK = 'lint/contract';

async function until<T>(what: string, probe: () => Promise<T | undefined>, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await probe();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`Not within ${ms} ms: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!hubUrl)('serve against a hub', () => {
  const designer = createClient({ baseUrl: hubUrl ?? '', version: HUB_REVISION, user: 'demo-designer@example.edu' });

  it('posts a run within 5 s of a commit, as the agent the requirement names, under its hash', { timeout: 60_000 }, async () => {
    const agents = (await designer.users.list({ kind: 'agent' })).data;
    const agent =
      agents.find((u) => u.externalId === SERVICE)?.['@id'] ??
      (await designer.users.register({ message: "Lint's contract test: its service", user: { displayName: 'Lint (contract test)', externalId: SERVICE } })).data.id;
    const requirement = { '@type': 'CheckRequirement', check: CHECK, fromPrefix: BRANCH, reporter: agent, level: 'Advisory', locked: false, params: { rules: {} }, status: 'Active', rationale: "Lint's contract test" };
    await designer.documents.batch({ message: "Lint's contract test: what its service checks", documents: [requirement as never] });
    if (!(await designer.branches.list()).data.some((b) => b.name === BRANCH)) await designer.branches.create(BRANCH);
    const expected = (await designer.checks.requirements({ target: 'main', from: BRANCH })).data.requirements.find((r) => r.check === CHECK)!;

    const runAt = (commit: string) => async () =>
      (await designer.checks.runs({ commit, branch: BRANCH, check: CHECK })).data.find((r: CheckRun) => r.reporter === agent);

    const controller = new AbortController();
    const out: string[] = [];
    const err: string[] = [];
    const serving = main(['serve'], {
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      env: { ARMATURE_HUB_URL: hubUrl, ARMATURE_USER: SERVICE },
      signal: controller.signal,
    });
    try {
      // The sweep at start checks the branch's head as it is.
      const head = (await designer.branches.list()).data.find((b) => b.name === BRANCH)!.head.commit;
      await until('the sweep checks the head', runAt(head), 15_000);

      const written = await designer.documents.put('LearningNeed', 'lint-contract-need', {
        branch: BRANCH,
        message: 'A commit for Lint to check',
        document: { label: 'Lint contract test', rationale: `Written at ${new Date().toISOString()}` } as never,
      });
      const started = Date.now();
      const run = await until('a run at the new commit', runAt(written.data.commit), 5_000);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(run).toMatchObject({ check: CHECK, branch: BRANCH, paramsHash: expected.paramsHash, reporter: agent });
      expect(['pass', 'fail']).toContain(run.conclusion);
    } finally {
      controller.abort();
    }
    expect(await serving).toBe(0);
    expect(out[0]).toBe(`armature-lint serve: following ${hubUrl}, reporting as ${agent}.`);
    expect(err).toEqual([]);
  });
});
