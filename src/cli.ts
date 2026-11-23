/**
 * `armature-lint`, the command line (lint plan §12). L1 has two commands:
 *
 *   armature-lint run   [--hub URL] [--branch B | --ref C] [--event commit|push|merge]
 *                       [--base B | --base-ref C] [--policy FILE] [--json] [--verbose]
 *   armature-lint rules [--json]
 *
 * `run` reads the hub at one commit and prints what each rule flags; it exits
 * 0 when the conclusion is `pass`, 1 when it is `fail`, 2 when it could not
 * run. It posts nothing: reporting a check run is L2.
 *
 * Environment, as the other Armature tools read it: `ARMATURE_HUB_URL`
 * (default http://localhost:3100), `ARMATURE_USER` (sent as `Armature-User`
 * under the header resolver), `ARMATURE_TOKEN` (a bearer token under `oidc`).
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createClient, HubError, type FetchLike } from '@armature/client';
import { lint } from './engine.js';
import { formatResult } from './format.js';
import { loadSnapshot } from './load.js';
import { EMPTY_POLICY, parsePolicy, PolicyError, type Policy } from './policy.js';
import { RULES } from './rules/index.js';
import { EVENTS, type LintEvent } from './types.js';

/**
 * The revision Lint asks for: what remote instances serve today (Armature's
 * `REMOTE_REVISION`). Every route L1 reads is older, so any hub of that
 * revision or newer answers it.
 */
export const HUB_REVISION = '2026-11-20';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  fetch?: FetchLike;
  readFile?: (path: string) => Promise<string>;
}

const USAGE = `Usage:
  armature-lint run   [--hub URL] [--branch NAME | --ref COMMIT] [--event commit|push|merge]
                      [--base NAME | --base-ref COMMIT] [--policy FILE] [--json] [--verbose]
  armature-lint rules [--json]

Environment: ARMATURE_HUB_URL (default http://localhost:3100), ARMATURE_USER, ARMATURE_TOKEN.
Exit status: 0 pass, 1 fail, 2 could not run.`;

export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'run') return await run(rest, io);
    if (command === 'rules') return rules(rest, io);
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

  let policy: Policy = EMPTY_POLICY;
  if (values.policy) {
    const text = await (io.readFile ?? ((p) => readFile(p, 'utf8')))(values.policy);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new PolicyError(`${values.policy} is not JSON.`);
    }
    const parsed = parsePolicy(json);
    policy = parsed.policy;
    for (const warning of parsed.warnings) io.stderr(warning);
  }

  const token = io.env.ARMATURE_TOKEN;
  const client = createClient({
    baseUrl: values.hub ?? io.env.ARMATURE_HUB_URL ?? 'http://localhost:3100',
    version: HUB_REVISION,
    ...(io.env.ARMATURE_USER ? { user: io.env.ARMATURE_USER } : {}),
    ...(token ? { token } : {}),
    ...(io.fetch ? { fetch: io.fetch } : {}),
  });
  const base = values.base ? { branch: values.base } : values['base-ref'] ? { ref: values['base-ref'] } : undefined;
  const snapshot = await loadSnapshot(client, {
    ...(values.ref ? { ref: values.ref } : { branch: values.branch ?? 'main' }),
    ...(base ? { base } : {}),
  });
  const result = lint(snapshot, { event, policy });
  io.stdout(values.json ? JSON.stringify(result, null, 2) : formatResult(result, { verbose: values.verbose }));
  return result.conclusion === 'fail' ? 1 : 0;
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
