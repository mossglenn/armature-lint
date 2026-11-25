/**
 * Check runs (L2): Lint's verdicts about one commit, posted to the hub that
 * holds it (Armature's ADR-0070 decisions 3 and 4). A run is not a write to the
 * graph: it makes no commit, and the hub keeps it in memory beside the graph.
 *
 * A *job* is one run to post: under which check name, as which event, with
 * which policy, and the `paramsHash` the hub gave for that policy. `modes.ts`
 * says which jobs a branch has; this module reads the commit once, lints it for
 * each job and posts the runs.
 *
 * Choices, each in docs/plan.md §3:
 *
 * - One snapshot per commit, however many jobs: the export is read once and
 *   only each distinct merge target's coverage is read again.
 * - One run per check name and `paramsHash` at a commit. Two requirements with
 *   the same check and the same params but different targets would differ only
 *   in `coverage.regressed`; the hub's gate takes the newest run under the
 *   hash, so the first target's run stands for both.
 * - A commit that already holds a run by this reporter under the same check
 *   and hash is not linted again, so a sweep after a restart repeats nothing.
 *   A run by anyone else does not count (the hub's trust rule) and is not a
 *   reason to skip.
 * - A requirement whose `params` are not a Lint policy gets an `error` run
 *   saying so, which a gate reads as not satisfied, rather than a silent skip.
 * - A commit the hub no longer holds (its branch deleted between the event and
 *   the read) is skipped. A refusal that would be the same next time (another
 *   4xx, such as 403 for a branch this identity may not read) gets an `error`
 *   run on each job. A hub that is down or failing (no answer, or a 5xx) gets
 *   no run at all: the error goes up to the loop, which tries the same commit
 *   again once the hub answers. An `error` run posted for a passing failure
 *   would stand at that head as a failed check, and the sweep would skip it.
 * - The same for the merge target's coverage: a target the hub does not hold
 *   leaves `coverage.regressed` not run, which the run's rules say; a failing
 *   hub is retried, never taken as "nothing regressed".
 */
import { HubError, type ArmatureClient, type CheckRun } from '@armature/client';
import { lint } from './engine.js';
import { loadBase, loadSnapshot } from './load.js';
import { parsePolicy } from './policy.js';
import type { LintEvent, Snapshot } from './types.js';

export interface Job {
  /** The check name the run is posted under: a requirement's, or `lint` when none applies. */
  check: string;
  /** Which of each rule's actions applies. */
  event: LintEvent;
  /** The policy, unparsed: a requirement's opaque `params`, or the local policy file's contents. */
  params: unknown;
  /** The hub's hash of the requirement's `params`, copied into the run; absent for a run no requirement asked for. */
  paramsHash?: string;
  /** The merge target, for `coverage.regressed`. */
  base?: string;
  /** A local run that previews a requirement the remote enforces (`watch`); its summary says so. */
  preview?: boolean;
  /** The `CheckRequirement` this job answers, for the log. */
  requirement?: string;
}

export interface ReportOptions {
  /** This client's identity as the hub resolves it (`User/<id>`); without it no run is taken as already posted. */
  me?: string;
  log: (line: string) => void;
  warn: (line: string) => void;
}

/** A check name Lint answers: `lint` itself, or one under `lint/`. */
export const isLintCheck = (check: string): boolean => check === 'lint' || check.startsWith('lint/');

const keyOf = (check: string, paramsHash: string | undefined) => `${check}\u0000${paramsHash ?? ''}`;

/** Lints `commit` for each job and posts the runs; returns the runs the hub recorded. */
export async function reportOn(
  client: ArmatureClient,
  at: { branch: string; commit: string },
  jobs: readonly Job[],
  options: ReportOptions
): Promise<CheckRun[]> {
  const unique = new Map<string, Job>();
  for (const job of jobs) if (!unique.has(keyOf(job.check, job.paramsHash))) unique.set(keyOf(job.check, job.paramsHash), job);
  if (options.me && unique.size) {
    const held = (await client.checks.runs({ commit: at.commit, branch: at.branch })).data;
    for (const run of held) if (run.reporter === options.me && run.commit === at.commit) unique.delete(keyOf(run.check, run.paramsHash));
  }
  const todo = [...unique.values()];
  if (!todo.length) return [];

  let snapshot: Snapshot;
  try {
    snapshot = { ...(await loadSnapshot(client, { ref: at.commit })), branch: at.branch };
  } catch (err) {
    if (!refused(err)) throw err;
    if ((err as HubError).status === 404) {
      options.warn(`${at.branch} at ${at.commit}: the hub no longer holds it (${(err as HubError).code}); nothing to check.`);
      return [];
    }
    const reason = `${(err as HubError).status} ${(err as HubError).code}: ${(err as HubError).message}`;
    const runs: CheckRun[] = [];
    for (const job of todo) runs.push(await post(client, at, job, { conclusion: 'error', summary: `The hub refused Lint's reads at this commit (${reason})` }, options));
    return runs;
  }

  const bases = new Map<string, Snapshot['base']>();
  for (const base of new Set(todo.map((j) => j.base).filter((b): b is string => b !== undefined))) {
    try {
      bases.set(base, await loadBase(client, { branch: base }));
    } catch (err) {
      if (!refused(err)) throw err;
      // Without the target's coverage, coverage.regressed says it was not run; the other rules still do.
      options.warn(`The coverage of ${base}, the merge target, could not be read (${(err as HubError).code}); coverage.regressed is not run.`);
    }
  }

  const runs: CheckRun[] = [];
  for (const job of todo) {
    let policy;
    try {
      const parsed = parsePolicy(job.params);
      policy = parsed.policy;
      for (const warning of parsed.warnings) options.warn(`${job.check}: ${warning}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      runs.push(await post(client, at, job, { conclusion: 'error', summary: `The requirement's params are not a Lint policy. ${reason}` }, options));
      continue;
    }
    const base = job.base === undefined ? undefined : bases.get(job.base);
    const { base: _none, ...withoutBase } = snapshot;
    const result = lint(base ? { ...withoutBase, base } : withoutBase, { event: job.event, policy });
    runs.push(
      await post(
        client,
        at,
        job,
        {
          conclusion: result.conclusion,
          summary: job.preview ? `Preview of the remote's ${job.check}: ${result.summary}` : result.summary,
          counts: result.counts,
        },
        options
      )
    );
  }
  return runs;
}

/** An answer the hub would give again: a 4xx. A network failure or a 5xx is the hub down or failing, worth trying again. */
const refused = (err: unknown): err is HubError => err instanceof HubError && err.status >= 400 && err.status < 500;

async function post(
  client: ArmatureClient,
  at: { branch: string; commit: string },
  job: Job,
  verdict: { conclusion: CheckRun['conclusion']; summary: string; counts?: CheckRun['counts'] },
  options: ReportOptions
): Promise<CheckRun> {
  const run = (
    await client.checks.report({
      check: job.check,
      commit: at.commit,
      branch: at.branch,
      conclusion: verdict.conclusion,
      summary: verdict.summary,
      ...(verdict.counts ? { counts: verdict.counts } : {}),
      ...(job.paramsHash ? { paramsHash: job.paramsHash } : {}),
    })
  ).data;
  options.log(`${job.check}: ${at.branch} at ${at.commit}, as a ${job.event}: ${verdict.conclusion}, ${verdict.summary}`);
  return run;
}
