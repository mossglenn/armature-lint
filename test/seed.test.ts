/**
 * Lint against a real hub serving Armature's main seed (`scripts/seed_data.js`,
 * 71 documents at its fifth commit), when `ARMATURE_HUB_URL` names one; skipped
 * otherwise. The snapshot under `__snapshots__` is the reviewed answer to the
 * plan's L1 exit question, whether the defaults are quiet on the seed: every
 * line in it is a gap the seed holds on purpose (docs/plan.md §5). A change to
 * a rule or to the seed that moves it is reviewed again, not just updated.
 *
 * Every read is at the seed's last commit, the newest on `main` whose message
 * starts as every seed commit's does, not at `main`'s head: the contract test
 * of `serve` writes to `main` (an agent and a requirement), and may run beside
 * this one. Read-only itself.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@armature/client';
import { HUB_REVISION } from '../src/cli.js';
import { lint } from '../src/engine.js';
import { loadSnapshot } from '../src/load.js';

const hubUrl = process.env.ARMATURE_HUB_URL;
const SEED_MESSAGE = 'Seed demo data:';

describe.skipIf(!hubUrl)('the main seed', () => {
  const client = createClient({ baseUrl: hubUrl ?? '', version: HUB_REVISION, user: process.env.ARMATURE_USER ?? 'demo-designer@example.edu' });
  /** main's commits, newest first, from the seed's last commit on. */
  let seed: string[] = [];

  beforeAll(async () => {
    const log = await client.branches.log('main', { count: 100 });
    const commits = (log.data as unknown as { commits: Array<{ commit: string; message: string }> }).commits;
    const at = commits.findIndex((c) => c.message.startsWith(SEED_MESSAGE));
    if (at < 0) throw new Error(`No commit on main's latest 100 starts "${SEED_MESSAGE}": is this hub serving Armature's main seed?`);
    seed = commits.slice(at).map((c) => c.commit);
  });

  it('loads 71 documents and every module at one commit', async () => {
    const snapshot = await loadSnapshot(client, { ref: seed[0]! });
    expect(snapshot.documents).toHaveLength(71);
    expect(Object.keys(snapshot.content).sort()).toEqual(['Module/ai-in-learning-design', 'Module/how-ai-works', 'Module/risks-and-ethics']);
    expect(snapshot.coverage.modules).toHaveLength(3);
  });

  it.each(['commit', 'push', 'merge'] as const)('says, as a %s, only what the seed leaves open on purpose', async (event) => {
    const result = lint(await loadSnapshot(client, { ref: seed[0]! }), { event });
    expect(result.conclusion).toBe('pass');
    expect({ summary: result.summary, hits: result.hits.map((h) => `${h.action} ${h.rule} ${h.subject}${h.context ? ` in ${h.context}` : ''}`) }).toMatchSnapshot();
  });

  it("finds the bias objective regressed at the commit before its second item, against the seed's last", async () => {
    const result = lint(await loadSnapshot(client, { ref: seed[1]!, base: { ref: seed[0]! } }), { event: 'merge' });
    expect(result.hits.filter((h) => h.rule === 'coverage.regressed').map((h) => h.subject)).toEqual(['LearningObjective/distinguish-bias-types']);
  });
});
