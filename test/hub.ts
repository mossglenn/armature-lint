/**
 * A hub that remembers: branches with heads, an event feed with a cursor, the
 * check runs posted, requirements, and for a workspace hub its workspaces and
 * personal requirements. Enough of `/api/v1` for `watch` and `serve` to run
 * against, as `@armature/client` types each answer, with every graph read
 * answering one small canned design (one module, one Uncovered objective) at
 * any commit the hub has told of.
 *
 * The feed's held request runs the next step of `script` before it answers, so
 * a test says what happens between two rounds of the loop. A cursor is
 * `<life>:<index>`; after `restart()` an old life's cursor gets `hub.started`
 * first, as the real hub's does, and the runs are gone.
 */
import type { CheckRequirement } from '@armature/types';
import type { CheckRun, FeedEvent, PersonalRequirement, WorkspaceRecord } from '@armature/client';
import { HUB_REVISION } from '../src/cli.js';
import { content, coverageOf, declaration, doc, moduleCoverage } from './fixtures.js';

export const OBJ = 'LearningObjective/explain-bias';
export const MOD = 'Module/ethics';

type Requirement = CheckRequirement & { '@id': string; paramsHash: string };

export interface FakeHubOptions {
  role: 'remote' | 'workspace';
  /** The `User` the caller resolves to; `users/me` answers 404 when null. */
  me?: string | null;
  /** Leave `armature/checks` out of discovery. */
  noChecks?: boolean;
}

export function fakeHub(options: FakeHubOptions) {
  const me = options.me === undefined ? 'User/lint-service' : options.me;
  const state = {
    life: 1,
    branches: new Map<string, string>([['main', 'c-main-1']]),
    known: new Set<string>(['c-main-1']),
    events: [] as FeedEvent[],
    runs: [] as CheckRun[],
    requirements: [] as Requirement[],
    personal: [] as Array<PersonalRequirement & { paramsHash: string }>,
    workspaces: [] as WorkspaceRecord[],
    /** Requests that fail as if the hub were down, before any is answered. */
    down: 0,
    /** Answers to give instead, once each, to the next request for a path (`/export`, ...) whose query holds `query`. */
    failing: [] as Array<{ path: string; status: number; error: string; query?: Record<string, string> }>,
    script: [] as Array<() => void>,
    asked: [] as Array<{ method: string; path: string; query: Record<string, string>; headers: Record<string, string> }>,
    nextRun: 1,
  };

  const hub = {
    state,
    /** A commit on a branch, told by the feed; a new branch is told as created first. */
    commit(branch: string, commit: string, extra: Partial<FeedEvent> = {}) {
      if (!state.branches.has(branch)) {
        state.events.push({ type: 'branch.created', branch, commit: state.branches.get('main')! });
      }
      state.branches.set(branch, commit);
      state.known.add(commit);
      state.events.push({ type: 'commit', branch, commit, author: 'User/demo-designer', ...extra });
    },
    /** A branch that exists before the loop starts, told by no event. */
    branch(name: string, head: string) {
      state.branches.set(name, head);
      state.known.add(head);
    },
    requirement(fields: Partial<CheckRequirement> & { check: string }, paramsHash = `sha256:${fields.check}`): Requirement {
      const r = {
        '@id': `CheckRequirement/${fields.check.replace('/', '-')}-${fields.branch ?? 'main'}`,
        '@type': 'CheckRequirement',
        reporter: 'User/lint-service',
        level: 'Required',
        locked: false,
        params: {},
        status: 'Active',
        paramsHash,
        ...fields,
      } as Requirement;
      state.requirements.push(r);
      return r;
    },
    /** A requirement written on main: a commit there, then `requirement.changed`. */
    requirementChanged(r: Requirement, commit: string) {
      state.branches.set('main', commit);
      state.known.add(commit);
      state.events.push({ type: 'commit', branch: 'main', commit });
      state.events.push({ type: 'requirement.changed', branch: 'main', commit, requirements: [r['@id']] });
    },
    restart() {
      state.life++;
      state.runs = [];
    },
    workspace(branch: string, from = 'main') {
      state.workspaces.push({ branch, from, remote: 'http://remote.test', owner: 'User/demo-designer', ownerExternalId: 'demo-designer@example.edu', base: 'c-main-1', local: 'l1', clonedAt: '2026-11-25T00:00:00Z' } as WorkspaceRecord);
    },
    script(...steps: Array<() => void>) {
      state.script.push(...steps);
    },
    runsOn(branch: string) {
      return state.runs.filter((r) => r.branch === branch);
    },
    fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const method = init?.method ?? 'GET';
      const query = Object.fromEntries(url.searchParams);
      state.asked.push({ method, path: url.pathname, query, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      if (state.down > 0) {
        state.down--;
        throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:3100') });
      }
      const path = url.pathname.replace(/^\/api\/v1/, '');
      const ok = (body: unknown, status = 200, etag?: string) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Armature-Version': HUB_REVISION, ...(etag ? { ETag: `"${etag}"` } : {}) } });
      const fail = (status: number, error: string, message = error) => ok({ error, message }, status);
      const scripted = state.failing.findIndex((f) => f.path === path && Object.entries(f.query ?? {}).every(([k, v]) => query[k] === v));
      if (scripted >= 0) {
        const [f] = state.failing.splice(scripted, 1);
        return fail(f!.status, f!.error);
      }

      if (path === '/discover') {
        return ok({
          role: options.role,
          versions: [HUB_REVISION],
          identity: { resolver: 'header', headers: {} },
          capabilities: options.noChecks ? {} : { 'armature/checks': { fallback: 'reject' } },
          schema: { route: '/api/v1/schema' },
        });
      }
      if (path === '/users/me') return me ? ok({ '@id': me, '@type': 'User', displayName: 'Lint', externalId: 'agent:lint/service', grants: [] }) : fail(404, 'not_registered');
      if (path === '/events') {
        const since = query.since;
        const types = query.types ? query.types.split(',') : undefined;
        if (since === undefined) return ok({ events: [], cursor: `${state.life}:${state.events.length}` });
        const m = /^(\d+):(\d+)$/.exec(since);
        if (!m) return fail(400, 'bad_cursor');
        if (Number(query.wait ?? 30) > 0) state.script.shift()?.();
        const from = Number(m[2]);
        const told: FeedEvent[] = Number(m[1]) !== state.life ? [{ type: 'hub.started', startedAt: '2026-11-25T12:00:00Z' }] : [];
        told.push(...state.events.slice(from));
        return ok({ events: told.filter((e) => !types || types.includes(e.type)), cursor: `${state.life}:${state.events.length}` });
      }
      if (path === '/branches') return ok([...state.branches].map(([name, commit]) => ({ name, head: { commit, author: 'User/demo-designer', message: '', timestamp: 0 } })));
      if (path === '/workspace') return options.role === 'workspace' ? ok(state.workspaces) : fail(400, 'workspace_only');
      if (path === '/documents/CheckRequirement') {
        return ok(state.requirements.filter((r) => !query.status || r.status === query.status).map(({ paramsHash: _h, ...r }) => r), 200, state.branches.get('main'));
      }
      if (path === '/checks/requirements') {
        const target = query.target ?? 'main';
        const from = query.from;
        const requirements = state.requirements.filter(
          (r) => r.status === 'Active' && ((r.branch ?? 'main') === target || r.locked) && (!from || !r.fromPrefix || from.startsWith(r.fromPrefix))
        );
        return ok({ target, ...(from ? { from } : {}), requirements, ...(options.role === 'workspace' ? { personal: state.personal } : {}) }, 200, state.branches.get('main'));
      }
      if (path === '/checks' && method === 'GET') {
        return ok(state.runs.filter((r) => (!query.commit || r.commit === query.commit) && (!query.branch || r.branch === query.branch) && (!query.check || r.check === query.check)).reverse());
      }
      if (path === '/checks/runs' && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        if (!state.known.has(body.commit)) return fail(404, 'unknown_ref');
        const run: CheckRun = { ...body, id: `run-${state.nextRun++}`, reporter: me ?? 'User/anonymous', reportedAt: '2026-11-25T12:00:00Z' };
        state.runs.push(run);
        return ok(run, 201);
      }

      // The graph reads, the same design at any commit the hub holds.
      const ref = query.ref ?? state.branches.get(query.branch ?? 'main');
      if (!ref || !state.known.has(ref)) return fail(404, 'unknown_ref');
      if (path === '/export') {
        return ok(
          {
            '@context': {},
            armature: { ref, profile: 'full', slice: 'full', counts: { documents: 2, byType: {} }, unresolved: [] },
            schema: [],
            documents: [doc(MOD, { label: 'Ethics' }), doc(OBJ, { label: 'Explain bias' })],
          },
          200,
          ref
        );
      }
      if (path === '/intelligence/coverage') return ok(coverageOf(moduleCoverage(MOD, [declaration(OBJ, 'Uncovered')])), 200, ref);
      if (path === '/intelligence/alignment') {
        return ok({ scope: {}, itemsBelowObjective: [], objectivesWithoutItemAtLevel: [], objectivesWithoutActivity: [], itemsWithoutObjective: [], unleveled: { objectives: [], items: [] } }, 200, ref);
      }
      if (path === '/intelligence/module-content/ethics') return ok(content(MOD, []), 200, ref);
      return fail(404, 'not_found', `No route ${method} ${url.pathname}`);
    },
  };
  return hub;
}
