/**
 * What each command checks, on the hub it follows (Armature's lint plan §9 and
 * §12). The loop (`follow.ts`) is the same for both; a mode answers three
 * questions for it: which branches to check in a sweep, what to run on a
 * branch's commit, and what to read again when requirements or branches change.
 *
 * `serve`, beside a remote hub, as the agent a `CheckRequirement` names:
 *
 * - The requirements are the `Active` ones on `main` whose check is Lint's
 *   (`lint` or `lint/…`) and whose `reporter` is this service, since a run by
 *   anyone else counts toward nothing. Each comes with the `paramsHash` the hub
 *   computed, read from `GET /checks/requirements` once per distinct target.
 * - A branch is checked for every requirement that binds a merge from it: one
 *   into another branch than itself (any, when the requirement is `locked`),
 *   from a source its `fromPrefix` admits. `main` is never checked as a source,
 *   since a merge from `main` is how a branch brings it in and no gate stops it
 *   (ADR-0070, note of 2026-11-15). The event is `merge`, and the target is the
 *   base for `coverage.regressed`.
 *
 * `watch`, beside a person's workspace hub, as its owner:
 *
 * - Only the workspaces the hub holds are checked; `main` there is the
 *   remote's mirror, not the person's work.
 * - Each personal requirement in `checks.json` naming a Lint check, as a
 *   `push`, under its `paramsHash`, so that a push the person gated on Lint
 *   can go through.
 * - With no personal Lint requirement, one run under `lint` as a `commit`,
 *   with the local policy file or the defaults: Lint installed and no rules set
 *   up still says what it sees (decided 2026-11-25).
 * - A preview of each remote requirement mirrored for the workspace's merge
 *   into its parent, as a `merge`, under the remote's check name and hash and
 *   labelled a preview, unless a personal requirement has the same check name.
 *   The workspace hub never enforces these; the remote alone does.
 */
import type { ArmatureClient, RequirementsResult } from '@armature/client';
import type { Policy } from './policy.js';
import { isLintCheck, type Job } from './report.js';

export interface Mode {
  /** Read again what the mode keeps: the requirements, or the workspaces. */
  refresh(): Promise<void>;
  /** The branches a sweep checks, each at its head. */
  heads(): Promise<Array<{ branch: string; commit: string }>>;
  /** The runs a commit on `branch` needs; none when nothing applies. */
  jobs(branch: string): Promise<Job[]>;
}

type Requirement = RequirementsResult['requirements'][number];

/** Whether a requirement binds a merge from `branch` (ADR-0070 decision 5). */
export function bindsMergeFrom(r: Pick<Requirement, 'branch' | 'fromPrefix' | 'locked'>, branch: string): boolean {
  if (branch === 'main') return false;
  if (!r.locked && (r.branch ?? 'main') === branch) return false;
  return !r.fromPrefix || branch.startsWith(r.fromPrefix);
}

export function remoteMode(client: ArmatureClient, me: string | undefined): Mode {
  let requirements: Requirement[] = [];
  return {
    async refresh() {
      const records = (await client.documents.list('CheckRequirement', { branch: 'main', filter: { status: 'Active' } })).data;
      const ours = new Set(records.filter((r) => isLintCheck(r.check) && (!me || r.reporter === me)).map((r) => r['@id']));
      const targets = new Set(records.filter((r) => ours.has(r['@id'])).map((r) => r.branch ?? 'main'));
      const found = new Map<string, Requirement>();
      for (const target of targets) {
        for (const r of (await client.checks.requirements({ target })).data.requirements) if (ours.has(r['@id'])) found.set(r['@id'], r);
      }
      requirements = [...found.values()];
    },
    async heads() {
      return (await client.branches.list()).data.filter((b) => b.name !== 'main').map((b) => ({ branch: b.name, commit: b.head.commit }));
    },
    async jobs(branch) {
      return requirements
        .filter((r) => bindsMergeFrom(r, branch))
        .map((r) => ({ check: r.check, event: 'merge' as const, params: r.params, paramsHash: r.paramsHash, base: r.branch ?? 'main', requirement: r['@id'] }));
    },
  };
}

export function workspaceMode(client: ArmatureClient, localPolicy: Policy): Mode {
  /** Each workspace this hub holds, by branch, with its parent. */
  let parents = new Map<string, string>();
  return {
    async refresh() {
      parents = new Map((await client.workspace.list()).data.map((w) => [w.branch, w.from ?? 'main']));
    },
    async heads() {
      return (await client.branches.list()).data.filter((b) => parents.has(b.name)).map((b) => ({ branch: b.name, commit: b.head.commit }));
    },
    async jobs(branch) {
      const parent = parents.get(branch);
      if (parent === undefined) return [];
      const personal = ((await client.checks.requirements({ target: branch })).data.personal ?? []).filter((r) => isLintCheck(r.check) && r.status === 'Active');
      const jobs: Job[] = personal.map((r) => ({ check: r.check, event: 'push' as const, params: r.params, paramsHash: r.paramsHash }));
      if (!jobs.length) jobs.push({ check: 'lint', event: 'commit', params: localPolicy });
      const mirrored = (await client.checks.requirements({ target: parent, from: branch })).data.requirements;
      for (const r of mirrored) {
        if (!isLintCheck(r.check) || r.status !== 'Active' || personal.some((p) => p.check === r.check)) continue;
        jobs.push({ check: r.check, event: 'merge', params: r.params, paramsHash: r.paramsHash, base: parent, preview: true, requirement: r['@id'] });
      }
      return jobs;
    },
  };
}
