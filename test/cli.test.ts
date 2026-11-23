/**
 * The command line against a fake hub: a table of canned answers, each served
 * with the commit as its ETag, that records what it was asked, so a test
 * checks both what Lint prints and that every read named the export's commit.
 */
import { describe, expect, it } from 'vitest';
import { HUB_REVISION, main, type Io } from '../src/cli.js';
import { content, coverageOf, declaration, doc, moduleCoverage } from './fixtures.js';

const COMMIT = 'c0000000000000000000000000000042';
const OBJ = 'LearningObjective/explain-bias';
const MOD = 'Module/ethics';

interface Asked {
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
}

function fakeHub(overrides: Record<string, unknown> = {}) {
  const asked: Asked[] = [];
  const routes: Record<string, unknown> = {
    '/api/v1/export': {
      '@context': {},
      armature: { ref: COMMIT, profile: 'full', slice: 'full', counts: { documents: 2, byType: {} }, unresolved: [] },
      schema: [],
      documents: [doc(MOD, { label: 'Ethics' }), doc(OBJ, { label: 'Explain bias' })],
    },
    '/api/v1/intelligence/coverage': coverageOf(moduleCoverage(MOD, [declaration(OBJ, 'Uncovered')])),
    '/api/v1/intelligence/alignment': { scope: {}, itemsBelowObjective: [], objectivesWithoutItemAtLevel: [], objectivesWithoutActivity: [], itemsWithoutObjective: [], unleveled: { objectives: [], items: [] } },
    '/api/v1/intelligence/module-content/ethics': content(MOD, []),
    ...overrides,
  };
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    asked.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const body = routes[url.pathname];
    const headers = { 'Content-Type': 'application/json', 'Armature-Version': HUB_REVISION };
    if (body === undefined) return new Response(JSON.stringify({ error: 'not_found', message: `No route ${url.pathname}` }), { status: 404, headers });
    return new Response(JSON.stringify(body), { status: 200, headers: { ...headers, ETag: `"${COMMIT}"` } });
  };
  return { fetch, asked };
}

function io(fetch?: Io['fetch'], files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => err.push(t),
      env: { ARMATURE_HUB_URL: 'http://hub.test', ARMATURE_USER: 'designer@example.edu' },
      ...(fetch ? { fetch } : {}),
      readFile: async (p: string) => {
        if (!(p in files)) throw new Error(`ENOENT: ${p}`);
        return files[p]!;
      },
    } satisfies Io,
    out,
    err,
  };
}

describe('armature-lint run', () => {
  it('reads the branch, pins every later read to the commit the export named, and prints the hits', async () => {
    const hub = fakeHub();
    const t = io(hub.fetch);
    expect(await main(['run', '--branch', 'amos_unit-3', '--event', 'merge'], t.io)).toBe(0);
    expect(hub.asked[0]).toMatchObject({ path: '/api/v1/export', query: { branch: 'amos_unit-3', profile: 'full' } });
    for (const later of hub.asked.slice(1)) expect(later.query).toMatchObject({ ref: COMMIT });
    expect(hub.asked.every((a) => a.headers['armature-user'] === 'designer@example.edu' && a.headers['armature-version'] === HUB_REVISION)).toBe(true);
    const text = t.out.join('\n');
    expect(text).toContain(`armature-lint: amos_unit-3 at ${COMMIT}, as a merge`);
    expect(text).toContain('warn    coverage.uncovered');
    expect(text).toContain('"explain-bias" is Uncovered in "ethics"');
    expect(text).toContain('Not run: coverage.regressed (no merge target named (--base)).');
    expect(text).toMatch(/pass: .*1 warning/);
  });

  it('exits 1 when a policy makes a hit required', async () => {
    const t = io(fakeHub().fetch, { 'policy.json': JSON.stringify({ rules: { 'coverage.uncovered': 'require' } }) });
    expect(await main(['run', '--policy', 'policy.json'], t.io)).toBe(1);
    expect(t.out.join('\n')).toMatch(/FAIL: 1 required/);
  });

  it('prints the result as JSON', async () => {
    const t = io(fakeHub().fetch);
    expect(await main(['run', '--json'], t.io)).toBe(0);
    const result = JSON.parse(t.out[0]!);
    expect(result).toMatchObject({ commit: COMMIT, branch: 'main', event: 'commit', conclusion: 'pass', counts: { inform: 1 } });
  });

  it('reads the base for coverage.regressed', async () => {
    const hub = fakeHub();
    const t = io(hub.fetch);
    await main(['run', '--ref', COMMIT, '--base', 'main', '--event', 'push'], t.io);
    expect(hub.asked.filter((a) => a.path === '/api/v1/intelligence/coverage').map((a) => a.query)).toContainEqual({ branch: 'main' });
    expect(t.out.join('\n')).not.toContain('Not run: coverage.regressed');
  });

  it('exits 2, saying why, on a usage error, a bad policy, or a hub refusal', async () => {
    let t = io(fakeHub().fetch);
    expect(await main(['run', '--branch', 'a', '--ref', 'b'], t.io)).toBe(2);
    expect(t.err[0]).toContain('not both');

    t = io(fakeHub().fetch);
    expect(await main(['run', '--event', 'deliver'], t.io)).toBe(2);

    t = io(fakeHub().fetch, { 'p.json': '{"rules":{"coverage.uncovered":"error"}}' });
    expect(await main(['run', '--policy', 'p.json'], t.io)).toBe(2);
    expect(t.err[0]).toContain('The policy is not valid');

    t = io(fakeHub({ '/api/v1/export': undefined }).fetch);
    expect(await main(['run'], t.io)).toBe(2);
    expect(t.err[0]).toContain('The hub answered 404 not_found');

    t = io(fakeHub().fetch);
    expect(await main(['run', '--colour'], t.io)).toBe(2);
    expect(t.err[0]).toContain('Usage:');
  });
});

describe('armature-lint rules', () => {
  it('lists the ten rules with their defaults', async () => {
    const t = io();
    expect(await main(['rules', '--json'], t.io)).toBe(0);
    const rules = JSON.parse(t.out[0]!);
    expect(rules).toHaveLength(10);
    expect(rules.find((r: { id: string }) => r.id === 'coverage.regressed')).toMatchObject({ needs: 'base', defaults: { commit: 'off', push: 'warn', merge: 'warn' } });
  });
});
