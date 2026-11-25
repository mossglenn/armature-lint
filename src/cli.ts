/**
 * `armature-lint`, the command line (lint plan §12):
 *
 *   armature-lint run   [--hub URL] [--branch B | --ref C] [--event commit|push|merge]
 *                       [--base B | --base-ref C] [--policy FILE] [--json] [--verbose]
 *   armature-lint rules [--json]
 *   armature-lint watch [--hub URL] [--policy FILE]          (L2)
 *   armature-lint serve [--hub URL]                          (L2)
 *
 * `run` reads the hub at one commit and prints what each rule flags; it exits
 * 0 when the conclusion is `pass`, 1 when it is `fail`, 2 when it could not
 * run. It posts nothing.
 *
 * `watch` follows a person's workspace hub and `serve` a remote hub, checking
 * each new branch head and posting the verdicts as check runs (`follow.ts`,
 * `modes.ts`, `report.ts`). Each prints one line per run posted and runs until
 * stopped: `watch` when its standard input closes, as the desktop program's
 * Tools list stops what it started, either on SIGINT or SIGTERM (`bin.ts`).
 * Either exits 2 at once when the hub is the other role or serves no feed.
 *
 * Environment, as the other Armature tools read it: `ARMATURE_HUB_URL`
 * (default http://localhost:3100; for `watch`, http://localhost:3101, the
 * workspace profile's port), `ARMATURE_USER` (sent as `Armature-User` under the
 * header resolver), `ARMATURE_TOKEN` (a bearer token under `oidc`; for
 * `serve`, the service's own, which the operator renews), and for `watch`
 * `ARMATURE_LOCAL_TOKEN` (the workspace hub's pairing key, which the Tools list
 * passes and a person otherwise pastes once).
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createClient, HubError, type ArmatureClient, type FetchLike } from '@armature/client';
import { lint } from './engine.js';
import { follow, type FollowOptions } from './follow.js';
import { formatResult } from './format.js';
import { loadSnapshot } from './load.js';
import { remoteMode, workspaceMode } from './modes.js';
import { EMPTY_POLICY, parsePolicy, PolicyError, type Policy } from './policy.js';
import { reportOn } from './report.js';
import { RULES } from './rules/index.js';
import { EVENTS, type LintEvent } from './types.js';

/**
 * The revision Lint asks for: what remote instances serve today (Armature's
 * `REMOTE_REVISION`). Every route L1 reads is older, so any hub of that
 * revision or newer answers it.
 */
export const HUB_REVISION = '2026-11-20';

/**
 * The revision from which a workspace hub's feed tells a change to `checks.json`, which makes no commit, as
 * `requirement.changed` with `personal` (Armature's ADR-0070, note of 2026-11-25). Against a hub that serves it
 * `watch` needs no sweep after a quiet answer; against an older one it keeps sweeping. Read from `GET
 * /discover`'s `versions`, never sent: Lint still asks for `HUB_REVISION`, so it works against either.
 */
export const PERSONAL_EVENTS_REVISION = '2026-11-25';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  fetch?: FetchLike;
  readFile?: (path: string) => Promise<string>;
  /** Ends `watch` and `serve`; without one they run until the process ends. */
  signal?: AbortSignal;
  /** For tests: the loop's clock, its bounds and a number of rounds after which it returns. */
  follow?: Pick<FollowOptions, 'sleep' | 'settle' | 'wait' | 'backoff' | 'rounds'>;
}

const USAGE = `Usage:
  armature-lint run   [--hub URL] [--branch NAME | --ref COMMIT] [--event commit|push|merge]
                      [--base NAME | --base-ref COMMIT] [--policy FILE] [--json] [--verbose]
  armature-lint rules [--json]
  armature-lint watch [--hub URL] [--policy FILE]    follow a workspace hub, post a run per new head
  armature-lint serve [--hub URL]                    follow a remote hub as the agent its requirements name

Environment: ARMATURE_HUB_URL (default http://localhost:3100; for watch, http://localhost:3101),
ARMATURE_USER, ARMATURE_TOKEN, and for watch ARMATURE_LOCAL_TOKEN.
Exit status of run: 0 pass, 1 fail, 2 could not run. watch and serve run until stopped (watch: when its
standard input closes); 2 if they cannot start.`;

export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'run') return await run(rest, io);
    if (command === 'rules') return rules(rest, io);
    if (command === 'watch' || command === 'serve') return await keepChecking(command, rest, io);
    if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
      io.stdout(USAGE);
      return command === undefined ? 2 : 0;
    }
    io.stderr(`Unknown command "${command}".\n\n${USAGE}`);
    return 2;
  } catch (err) {
    io.stderr(describe(err));
    return 2;
  }
}

async function run(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      hub: { type: 'string' },
      branch: { type: 'string' },
      ref: { type: 'string' },
      event: { type: 'string', default: 'commit' },
      base: { type: 'string' },
      'base-ref': { type: 'string' },
      policy: { type: 'string' },
      json: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
    },
  });
  if (values.branch && values.ref) throw new UsageError('Name a branch or a commit, not both.');
  if (values.base && values['base-ref']) throw new UsageError('Name the base as a branch or a commit, not both.');
  if (!EVENTS.includes(values.event as LintEvent)) throw new UsageError(`--event is one of ${EVENTS.join(', ')}.`);
  const event = values.event as LintEvent;

  const policy = await readPolicy(values.policy, io);
  const client = clientFor(values.hub ?? io.env.ARMATURE_HUB_URL ?? 'http://localhost:3100', io);
  const base = values.base ? { branch: values.base } : values['base-ref'] ? { ref: values['base-ref'] } : undefined;
  const snapshot = await loadSnapshot(client, {
    ...(values.ref ? { ref: values.ref } : { branch: values.branch ?? 'main' }),
    ...(base ? { base } : {}),
  });
  const result = lint(snapshot, { event, policy });
  io.stdout(values.json ? JSON.stringify(result, null, 2) : formatResult(result, { verbose: values.verbose }));
  return result.conclusion === 'fail' ? 1 : 0;
}

/**
 * `watch` and `serve`: say who and where, refuse a hub of the other role or one
 * without the feed, then follow it until the signal ends the loop.
 */
async function keepChecking(command: 'watch' | 'serve', args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { hub: { type: 'string' }, ...(command === 'watch' ? { policy: { type: 'string' } } : {}) },
  });
  const policy = await readPolicy(values.policy as string | undefined, io);
  const hubUrl = (values.hub as string | undefined) ?? io.env.ARMATURE_HUB_URL ?? (command === 'watch' ? 'http://localhost:3101' : 'http://localhost:3100');
  // A held request for the feed lasts up to `wait` seconds, every call may take that and a margin. watch holds
  // for 10: a checks.json edited by hand wakes no request and is told (or, on an older hub, swept for) at the
  // next answer, so the wait bounds how long that takes. serve holds for the hub's most.
  const wait = io.follow?.wait ?? (command === 'watch' ? 10 : 30);
  const client = clientFor(hubUrl, io, { timeout: (wait + 30) * 1000, ...(io.signal ? { signal: io.signal } : {}) });

  const discovery = (await client.discover()).data;
  const role = command === 'watch' ? 'workspace' : 'remote';
  if (discovery.role !== role) {
    io.stderr(
      command === 'watch'
        ? `${hubUrl} is a remote hub; watch follows a workspace hub on this computer. Beside a remote, run armature-lint serve.`
        : `${hubUrl} is a workspace hub; serve follows a remote hub. On a person's computer, run armature-lint watch.`
    );
    return 2;
  }
  if (!discovery.capabilities['armature/checks']) {
    io.stderr(`${hubUrl} serves no event feed or check runs (armature/checks, Armature's revision 2026-11-15); update the hub.`);
    return 2;
  }
  const me = await whoAmI(client, io);
  io.stdout(`armature-lint ${command}: following ${hubUrl}${me ? `, reporting as ${me}` : ''}.`);
  // A personal requirement changes without a commit. A hub at PERSONAL_EVENTS_REVISION tells it, as
  // requirement.changed, which the loop answers with a sweep; an older one tells nothing, and watch sweeps after
  // every quiet answer instead.
  const sweepWhenIdle = command === 'watch' && !discovery.versions.includes(PERSONAL_EVENTS_REVISION);

  const mode = command === 'watch' ? workspaceMode(client, policy) : remoteMode(client, me);
  const signal = io.signal ?? new AbortController().signal;
  await follow(client, mode, {
    signal,
    wait,
    sweepWhenIdle,
    warn: io.stderr,
    check: async (branch, commit) => {
      await reportOn(client, { branch, commit }, await mode.jobs(branch), { ...(me ? { me } : {}), log: io.stdout, warn: io.stderr });
    },
    ...io.follow,
  });
  return 0;
}

/** The `User` this client resolves to, or undefined (with a warning) when the hub will not say. */
async function whoAmI(client: ArmatureClient, io: Io): Promise<string | undefined> {
  try {
    return (await client.users.me()).data['@id'];
  } catch (err) {
    io.stderr(`The hub did not say who this is (${err instanceof HubError ? `${err.status} ${err.code}` : String(err)}); every head is checked again after a restart.`);
    return undefined;
  }
}

async function readPolicy(path: string | undefined, io: Io): Promise<Policy> {
  if (!path) return EMPTY_POLICY;
  const text = await (io.readFile ?? ((p) => readFile(p, 'utf8')))(path);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PolicyError(`${path} is not JSON.`);
  }
  const parsed = parsePolicy(json);
  for (const warning of parsed.warnings) io.stderr(warning);
  return parsed.policy;
}

function clientFor(baseUrl: string, io: Io, extra: { timeout?: number; signal?: AbortSignal } = {}): ArmatureClient {
  const token = io.env.ARMATURE_TOKEN;
  const localToken = io.env.ARMATURE_LOCAL_TOKEN;
  return createClient({
    baseUrl,
    version: HUB_REVISION,
    ...(io.env.ARMATURE_USER ? { user: io.env.ARMATURE_USER } : {}),
    ...(token ? { token } : {}),
    ...(localToken ? { localToken } : {}),
    ...(io.fetch ? { fetch: io.fetch } : {}),
    ...extra,
  });
}

function rules(args: string[], io: Io): number {
  const { values } = parseArgs({ args, strict: true, options: { json: { type: 'boolean', default: false } } });
  if (values.json) {
    io.stdout(JSON.stringify(RULES.map(({ id, scope, summary, defaults, needs }) => ({ id, scope, summary, defaults, ...(needs ? { needs } : {}) })), null, 2));
    return 0;
  }
  const lines = ['Rule                               commit   push     merge    What it flags'];
  for (const r of RULES) {
    lines.push(`${r.id.padEnd(35)}${r.defaults.commit.padEnd(9)}${r.defaults.push.padEnd(9)}${r.defaults.merge.padEnd(9)}${r.summary}`);
  }
  lines.push('', 'Defaults apply where a policy names no action. Actions: off, inform, warn, require.');
  io.stdout(lines.join('\n'));
  return 0;
}

class UsageError extends Error {}

function describe(err: unknown): string {
  if (err instanceof UsageError) return `${err.message}\n\n${USAGE}`;
  if (err instanceof PolicyError) return err.message;
  if (err instanceof HubError) return `The hub answered ${err.status} ${err.code}: ${err.message}`;
  if (err instanceof Error && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS')) return `${err.message}\n\n${USAGE}`;
  if (err instanceof Error && /fetch failed|ECONNREFUSED/.test(`${err.message} ${String((err as { cause?: unknown }).cause ?? '')}`)) {
    return `Could not reach the hub: ${err.message}. Is a hub running, and is ARMATURE_HUB_URL (or --hub) its origin?`;
  }
  return err instanceof Error ? err.message : String(err);
}
