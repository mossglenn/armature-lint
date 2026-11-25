/**
 * `watch` and `serve` against a hub that remembers (`hub.ts`): which branches
 * each checks, under which check name, event and hash; that a push is checked
 * once, at its last commit; that a restart of the hub, a lost cursor, a change
 * of requirements and a hub that goes away miss no head; and that each refuses
 * a hub of the other role.
 */
import { describe, expect, it } from 'vitest';
import { HUB_REVISION, main, PERSONAL_EVENTS_REVISION, type Io } from '../src/cli.js';
import { fakeHub } from './hub.js';

function io(hub: ReturnType<typeof fakeHub>, rounds: number | undefined, extra: Partial<Io> = {}, files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const slept: number[] = [];
  return {
    io: {
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => err.push(t),
      env: { ARMATURE_HUB_URL: 'http://hub.test', ARMATURE_USER: 'agent:lint/service', ARMATURE_LOCAL_TOKEN: 'pairing-key' },
      fetch: hub.fetch,
      readFile: async (p: string) => {
        if (!(p in files)) throw new Error(`ENOENT: ${p}`);
        return files[p]!;
      },
      follow: { rounds, sleep: async (ms: number) => void slept.push(ms) },
      ...extra,
    } satisfies Io,
    out,
    err,
    slept,
  };
}

describe('armature-lint serve', () => {
  it('checks each branch a Lint requirement of its own binds, as a merge under the hash, and nothing else', async () => {
    const hub = fakeHub({ role: 'remote' });
    hub.requirement({ check: 'lint/team' });
    hub.requirement({ check: 'structure/spof' });
    hub.requirement({ check: 'lint/theirs', reporter: 'User/another-lint' });
    hub.requirement({ check: 'lint/coqui', fromPrefix: 'coqui-' });
    hub.branch('amos_unit-3', 'c-unit-1');
    hub.script(() => hub.commit('amos_unit-3', 'c-unit-2'));
    const t = io(hub, 1);

    expect(await main(['serve'], t.io)).toBe(0);
    const runs = hub.runsOn('amos_unit-3');
    expect(runs.map((r) => [r.check, r.commit, r.paramsHash])).toEqual([
      ['lint/team', 'c-unit-1', 'sha256:lint/team'],
      ['lint/team', 'c-unit-2', 'sha256:lint/team'],
    ]);
    expect(runs[1]).toMatchObject({ conclusion: 'pass', counts: { require: 0, warn: 1 } });
    expect(hub.runsOn('main')).toEqual([]);
    expect(t.out[0]).toBe('armature-lint serve: following http://hub.test, reporting as User/lint-service.');
    expect(t.out).toContain('lint/team: amos_unit-3 at c-unit-2, as a merge: pass, ' + runs[1]!.summary);
  });

  it('checks a source its fromPrefix admits, and one a locked requirement on the same branch binds', async () => {
    const hub = fakeHub({ role: 'remote' });
    hub.requirement({ check: 'lint/coqui', fromPrefix: 'coqui-' });
    hub.requirement({ check: 'lint/floor', branch: 'unit-3', locked: true });
    hub.branch('coqui-round-2', 'c-coqui');
    hub.branch('unit-3', 'c-unit');
    await main(['serve'], io(hub, 1).io);
    expect(hub.runsOn('coqui-round-2').map((r) => r.check).sort()).toEqual(['lint/coqui', 'lint/floor']);
    expect(hub.runsOn('unit-3').map((r) => r.check)).toEqual(['lint/floor']);
  });

  it("fails where the requirement's params require a hit, and says so with an error run where they are no policy", async () => {
    const hub = fakeHub({ role: 'remote' });
    hub.requirement({ check: 'lint/strict', params: { rules: { 'coverage.uncovered': 'require' } } });
    hub.requirement({ check: 'lint/broken', params: { rules: { 'coverage.uncovered': 'loudly' } } });
    hub.branch('amos_unit-3', 'c-unit-1');
    await main(['serve'], io(hub, 1).io);
    const byCheck = Object.fromEntries(hub.runsOn('amos_unit-3').map((r) => [r.check, r]));
    expect(byCheck['lint/strict']).toMatchObject({ conclusion: 'fail', counts: { require: 1 } });
    expect(byCheck['lint/broken']!.conclusion).toBe('error');
    expect(byCheck['lint/broken']!.summary).toMatch(/^The requirement's params are not a Lint policy\./);
  });

  it('checks a push once, at its last commit, after letting it settle', async () => {
    const hub = fakeHub({ role: 'remote' });
    hub.requirement({ check: 'lint/team' });
    hub.branch('amos_unit-3', 'c-unit-1');
    hub.script(() => {
      for (const n of [2, 3, 4]) hub.commit('amos_unit-3', `c-unit-${n}`, { workspaceCommit: `w${n}` });
    });
    const t = io(hub, 1);
    await main(['serve'], t.io);
    expect(hub.runsOn('amos_unit-3').map((r) => r.commit)).toEqual(['c-unit-1', 'c-unit-4']);
    expect(t.slept).toEqual([500]);
  });

  it('checks every head again after the hub restarts, a commit made meanwhile included', async () => {
    const hub = fakeHub({ role: 'remote' });
    hub.requirement({ check: 'lint/team' });
    hub.branch('amos_unit-3', 'c-unit-1');
    hub.branch('amos_unit-4', 'c-four-1');
    hub.script(() => {
      hub.restart();
      hub.branch('amos_unit-4', 'c-four-2');
    });
    await main(['serve'], io(hub, 2).io);
    expect(hub.state.runs.map((r) => `${r.branch} ${r.commit}`).sort()).toEqual(['amos_unit-3 c-unit-1', 'amos_unit-4 c-four-2']);
  });

  it('starts again with a sweep when the hub cannot resume from its cursor', async () => {
    const hub = fakeHub({ role: 'remote' });
    hub.requirement({ check: 'lint/team' });
    hub.branch('amos_unit-3', 'c-unit-1');
    hub.script(() => hub.branch('amos_unit-3', 'c-unit-2')); // a head the feed will not tell, as one lost past the cursor
    // The fake answers a cursor it cannot parse as the real hub does; make the next one unreadable.
    const fetch = hub.fetch;
    let poisoned = false;
    const t = io(hub, 2, {
      fetch: async (input, init) => {
        const url = new URL(String(input instanceof Request ? input.url : input));
        if (url.pathname.endsWith('/events') && url.searchParams.get('since') && hub.state.script.length === 0 && !poisoned) {
          poisoned = true;
          url.searchParams.set('since', 'lost');
          return fetch(url, init);
        }
        return fetch(input, init);
      },
    });
    await main(['serve'], t.io);
    expect(t.err.some((e) => e.includes('bad_cursor'))).toBe(true);
    expect(hub.runsOn('amos_unit-3').map((r) => r.commit)).toEqual(['c-unit-1', 'c-unit-2']);
  });

  it('checks what a changed requirement now binds', async () => {
    const hub = fakeHub({ role: 'remote' });
    hub.branch('amos_unit-3', 'c-unit-1');
    hub.script(() => hub.requirementChanged(hub.requirement({ check: 'lint/team' }), 'c-main-2'));
    // The sweep a change asks for opens the next round.
    await main(['serve'], io(hub, 2).io);
    expect(hub.runsOn('amos_unit-3').map((r) => [r.check, r.commit])).toEqual([['lint/team', 'c-unit-1']]);
  });

  it('waits for a hub that went away, doubling the wait, and checks the commit it was told of', async () => {
    const hub = fakeHub({ role: 'remote' });
    hub.requirement({ check: 'lint/team' });
    hub.branch('amos_unit-3', 'c-unit-1');
    hub.script(() => {
      hub.commit('amos_unit-3', 'c-unit-2');
      hub.state.down = 3;
    });
    const t = io(hub, 2);
    expect(await main(['serve'], t.io)).toBe(0);
    expect(t.slept.filter((ms) => ms !== 500)).toEqual([1000, 2000, 4000]);
    expect(t.err[0]).toMatch(/^Could not reach the hub \(fetch failed\); trying again in 1 s\.$/);
    expect(hub.runsOn('amos_unit-3').map((r) => r.commit)).toEqual(['c-unit-1', 'c-unit-2']);
  });

  it('posts no run while the hub fails a read, and checks the commit again once it answers', async () => {
    const hub = fakeHub({ role: 'remote' });
    hub.requirement({ check: 'lint/team' });
    hub.branch('amos_unit-3', 'c-unit-1');
    hub.state.failing.push(
      { path: '/export', status: 503, error: 'store_unavailable' },
      // The merge target's coverage, read by branch (the snapshot's own reads name the commit).
      { path: '/intelligence/coverage', status: 503, error: 'store_unavailable', query: { branch: 'main' } }
    );
    const t = io(hub, 1);
    await main(['serve'], t.io);
    // Each failure retried: never an error run, and never a run made without the target's coverage.
    expect(t.err.filter((e) => e.includes('503 store_unavailable'))).toHaveLength(2);
    expect(hub.runsOn('amos_unit-3').map((r) => [r.commit, r.conclusion])).toEqual([['c-unit-1', 'pass']]);
    expect(hub.state.failing).toEqual([]);
  });

  it('posts an error run where the hub refuses the reads, which a retry would not change', async () => {
    const hub = fakeHub({ role: 'remote' });
    hub.requirement({ check: 'lint/team' });
    hub.branch('amos_unit-3', 'c-unit-1');
    hub.state.failing.push({ path: '/export', status: 403, error: 'forbidden' });
    await main(['serve'], io(hub, 1).io);
    expect(hub.runsOn('amos_unit-3')).toMatchObject([{ conclusion: 'error', summary: "The hub refused Lint's reads at this commit (403 forbidden: forbidden)" }]);
  });

  it('does not check again a head that holds its own run, but does one that holds only somebody else’s', async () => {
    const hub = fakeHub({ role: 'remote' });
    hub.requirement({ check: 'lint/team' });
    hub.branch('mine', 'c-mine');
    hub.branch('theirs', 'c-theirs');
    const held = { check: 'lint/team', conclusion: 'pass' as const, paramsHash: 'sha256:lint/team', reportedAt: '2026-11-25T11:00:00Z' };
    hub.state.runs.push({ ...held, id: 'old-1', commit: 'c-mine', branch: 'mine', reporter: 'User/lint-service' });
    hub.state.runs.push({ ...held, id: 'old-2', commit: 'c-theirs', branch: 'theirs', reporter: 'User/demo-designer' });
    await main(['serve'], io(hub, 1).io);
    expect(hub.runsOn('mine').map((r) => r.id)).toEqual(['old-1']);
    expect(hub.runsOn('theirs').map((r) => r.reporter)).toEqual(['User/demo-designer', 'User/lint-service']);
  });

  it('refuses a workspace hub, and a hub without the feed', async () => {
    const t = io(fakeHub({ role: 'workspace' }), 1);
    expect(await main(['serve'], t.io)).toBe(2);
    expect(t.err[0]).toMatch(/is a workspace hub; serve follows a remote hub/);
    const old = io(fakeHub({ role: 'remote', noChecks: true }), 1);
    expect(await main(['serve'], old.io)).toBe(2);
    expect(old.err[0]).toMatch(/armature\/checks/);
  });
});

describe('armature-lint watch', () => {
  const owner = { role: 'workspace' as const, me: 'User/demo-designer' };

  it('with no personal Lint requirement, posts `lint` as a commit on each workspace head, and leaves the mirror of main alone', async () => {
    const hub = fakeHub(owner);
    hub.workspace('amos_unit-3');
    hub.branch('amos_unit-3', 'c-unit-1');
    hub.script(() => {
      hub.commit('main', 'c-main-2');
      hub.commit('amos_unit-3', 'c-unit-2');
    });
    const t = io(hub, 1);
    expect(await main(['watch'], t.io)).toBe(0);
    expect(hub.runsOn('amos_unit-3').map((r) => [r.check, r.commit, r.paramsHash])).toEqual([
      ['lint', 'c-unit-1', undefined],
      ['lint', 'c-unit-2', undefined],
    ]);
    expect(hub.runsOn('amos_unit-3')[0]!.counts).toMatchObject({ require: 0, warn: 0 });
    expect(hub.runsOn('main')).toEqual([]);
    const posts = hub.state.asked.filter((a) => a.method === 'POST');
    expect(posts.every((p) => p.headers['armature-local-token'] === 'pairing-key')).toBe(true);
  });

  it('runs a personal Lint requirement as a push under its hash instead, and ignores another plugin’s', async () => {
    const hub = fakeHub(owner);
    hub.workspace('amos_unit-3');
    hub.branch('amos_unit-3', 'c-unit-1');
    hub.state.personal.push(
      { check: 'lint/personal', level: 'Required', params: { rules: { 'coverage.uncovered': { push: 'require' } } }, status: 'Active', paramsHash: 'sha256:p' },
      { check: 'structure/spof', level: 'Required', params: {}, status: 'Active', paramsHash: 'sha256:s' }
    );
    await main(['watch'], io(hub, 1).io);
    expect(hub.runsOn('amos_unit-3').map((r) => [r.check, r.conclusion, r.paramsHash])).toEqual([['lint/personal', 'fail', 'sha256:p']]);
  });

  it("previews the remote's Lint requirement on the workspace's merge into its parent, unless a personal one has its name", async () => {
    const hub = fakeHub(owner);
    hub.workspace('amos_unit-3');
    hub.branch('amos_unit-3', 'c-unit-1');
    hub.workspace('amos_unit-4');
    hub.branch('amos_unit-4', 'c-four-1');
    hub.requirement({ check: 'lint/team', reporter: 'User/lint-service' });
    hub.state.personal.push({ check: 'lint/team', branch: 'amos_unit-4', level: 'Required', params: {}, status: 'Active', paramsHash: 'sha256:mine' });
    // The fake hands every workspace the personal list; the real hub filters by branch. Keep it to unit-4 here.
    const fetch = hub.fetch;
    const t = io(hub, 1, {
      fetch: async (input, init) => {
        const url = new URL(String(input instanceof Request ? input.url : input));
        if (url.pathname.endsWith('/checks/requirements') && url.searchParams.get('target') === 'amos_unit-3') {
          const saved = hub.state.personal;
          hub.state.personal = [];
          try {
            return await fetch(input, init);
          } finally {
            hub.state.personal = saved;
          }
        }
        return fetch(input, init);
      },
    });
    await main(['watch'], t.io);
    expect(hub.runsOn('amos_unit-3').map((r) => [r.check, r.paramsHash])).toEqual([
      ['lint', undefined],
      ['lint/team', 'sha256:lint/team'],
    ]);
    expect(hub.runsOn('amos_unit-3')[1]!.summary).toMatch(/^Preview of the remote's lint\/team: /);
    expect(hub.runsOn('amos_unit-4').map((r) => [r.check, r.paramsHash])).toEqual([['lint/team', 'sha256:mine']]);
  });

  it('looks again after a quiet answer, so a personal requirement changed without a commit gets its run', async () => {
    const hub = fakeHub(owner);
    hub.workspace('amos_unit-3');
    hub.branch('amos_unit-3', 'c-unit-1');
    const personal = { check: 'lint/personal', level: 'Required' as const, status: 'Active' as const };
    hub.state.personal.push({ ...personal, params: { rules: {} }, paramsHash: 'sha256:before' });
    // checks.json edited in Settings: no commit, no event.
    hub.script(() => (hub.state.personal = [{ ...personal, params: { rules: { 'coverage.uncovered': 'require' } }, paramsHash: 'sha256:after' }]));
    const t = io(hub, 2);
    await main(['watch'], t.io);
    expect(hub.runsOn('amos_unit-3').map((r) => [r.paramsHash, r.conclusion])).toEqual([
      ['sha256:before', 'pass'],
      ['sha256:after', 'fail'],
    ]);
    expect(hub.state.asked.filter((a) => a.path.endsWith('/events') && a.query.since).map((a) => a.query.wait)).toEqual(['10', '10']);
  });

  it('against a hub that tells a change to checks.json (2026-11-25), sweeps when told and not after a quiet answer', async () => {
    const hub = fakeHub({ ...owner, versions: [PERSONAL_EVENTS_REVISION, HUB_REVISION] });
    hub.workspace('amos_unit-3');
    hub.branch('amos_unit-3', 'c-unit-1');
    const personal = { check: 'lint/personal', level: 'Required' as const, status: 'Active' as const };
    hub.state.personal.push({ ...personal, params: { rules: {} }, paramsHash: 'sha256:before' });
    let afterQuietAnswer = -1;
    hub.script(
      // The file changes; this hub would tell it, but the event is held back a round to show no sweep fills the gap.
      () => (hub.state.personal = [{ ...personal, params: { rules: { 'coverage.uncovered': 'require' } }, paramsHash: 'sha256:after' }]),
      () => {
        afterQuietAnswer = hub.runsOn('amos_unit-3').length;
        hub.personalChanged(['checks.json#lint/personal']);
      }
    );
    await main(['watch'], io(hub, 3).io);
    expect(afterQuietAnswer).toBe(1);
    expect(hub.runsOn('amos_unit-3').map((r) => [r.paramsHash, r.conclusion])).toEqual([
      ['sha256:before', 'pass'],
      ['sha256:after', 'fail'],
    ]);
  });

  it('takes the local policy for its `lint` run', async () => {
    const hub = fakeHub(owner);
    hub.workspace('amos_unit-3');
    hub.branch('amos_unit-3', 'c-unit-1');
    const t = io(hub, 1, {}, { 'policy.json': JSON.stringify({ rules: { 'coverage.uncovered': 'require' } }) });
    await main(['watch', '--policy', 'policy.json'], t.io);
    expect(hub.runsOn('amos_unit-3')[0]).toMatchObject({ check: 'lint', conclusion: 'fail' });
  });

  it('stops when its signal aborts, a held request included', async () => {
    const hub = fakeHub(owner);
    hub.workspace('amos_unit-3');
    hub.branch('amos_unit-3', 'c-unit-1');
    const controller = new AbortController();
    hub.script(() => controller.abort());
    const t = io(hub, undefined, { signal: controller.signal });
    expect(await main(['watch'], t.io)).toBe(0);
    expect(hub.runsOn('amos_unit-3')).toHaveLength(1);
  });

  it('refuses a remote hub', async () => {
    const t = io(fakeHub({ role: 'remote' }), 1);
    expect(await main(['watch'], t.io)).toBe(2);
    expect(t.err[0]).toMatch(/is a remote hub; watch follows a workspace hub/);
  });
});
