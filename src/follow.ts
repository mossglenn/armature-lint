/**
 * The loop `watch` and `serve` share: follow a hub's event feed (Armature's
 * ADR-0070 decision 2) and check each branch head it tells of.
 *
 * - **A sweep, not a stored cursor** (decided 2026-11-25). On start, the loop
 *   takes a cursor at the present and then checks every head the mode cares
 *   about; whatever lands after the cursor is told by the feed, so nothing
 *   falls between. `hub.started` (the hub restarted and its runs, held in
 *   memory, are gone), a cursor the hub cannot read or one too far behind, and
 *   a change to a requirement all lead to the same sweep. A head that already
 *   holds this reporter's run is not checked again (`report.ts`), so a sweep
 *   costs a read per branch where nothing changed.
 * - **Settling.** A push arrives as one commit per replayed local commit, and
 *   the feed's held request answers at the first. After an answer with events
 *   the loop waits `settle` milliseconds and drains what followed before it
 *   checks, so a push is checked once, at its last commit; a commit the
 *   debounce skips is never the head a merge or push would be judged at.
 * - **The cursor moves only after its events are checked.** If checking fails
 *   (the hub went away mid-run), the same events are asked for again and the
 *   runs already posted are skipped.
 * - **What the feed cannot tell is swept for when idle** (`sweepWhenIdle`,
 *   `watch` against a workspace hub older than revision 2026-11-25). A
 *   person's own requirements live in `checks.json`, which the program's
 *   Settings writes without a commit; an older hub tells nothing of a change
 *   to them, so after each answer with no events the loop sweeps, and a head
 *   already checked under the current hash costs three reads on loopback. A
 *   hub at 2026-11-25 tells it as `requirement.changed` with `personal`,
 *   which leads to the sweep below like any other (docs/plan.md §3).
 * - **An unreachable hub is waited for**, with a delay doubling from
 *   `backoff.first` to `backoff.most`, reset by the next answer. The process
 *   never exits on its own: `watch` ends when its standard input closes, either
 *   on a signal (`bin.ts`).
 */
import { HubError, type ArmatureClient, type EventType, type FeedEvent } from '@armature/client';
import type { Mode } from './modes.js';

export interface FollowOptions {
  /** Ends the loop, and any request in flight with it. */
  signal: AbortSignal;
  /** Checks one branch's commit: in the commands, `reportOn` over the mode's jobs. */
  check: (branch: string, commit: string) => Promise<void>;
  warn: (line: string) => void;
  /** Milliseconds to let a push's commits arrive before checking; 500. */
  settle?: number;
  /** Seconds the hub may hold a request for the feed; 30, its most. */
  wait?: number;
  /** Milliseconds before the first retry and the longest wait between retries. */
  backoff?: { first: number; most: number };
  /** Sweep after every answer with no events, for what changes without a commit. */
  sweepWhenIdle?: boolean;
  /** Replaces the clock, for tests; resolves early when the signal aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** For tests: stop after this many answers of the feed. */
  rounds?: number;
}

const TYPES: EventType[] = ['commit', 'merge', 'branch.created', 'requirement.changed', 'hub.started'];

/** How many follow-up answers a settle drains at most before checking what it has. */
const DRAIN_LIMIT = 10;

export async function follow(client: ArmatureClient, mode: Mode, options: FollowOptions): Promise<void> {
  const { signal, check, warn } = options;
  const settle = options.settle ?? 500;
  const wait = options.wait ?? 30;
  const backoff = options.backoff ?? { first: 1_000, most: 30_000 };
  const sleep = options.sleep ?? sleepFor;
  let cursor: string | undefined;
  let sweep = true;
  let delay = backoff.first;
  let rounds = 0;

  while (!signal.aborted && (options.rounds === undefined || rounds < options.rounds)) {
    try {
      if (cursor === undefined) {
        cursor = (await client.events.since(undefined, { types: TYPES })).data.cursor;
        sweep = true;
      }
      if (sweep) {
        await mode.refresh();
        for (const { branch, commit } of await mode.heads()) await check(branch, commit);
        sweep = false;
      }

      let answer = (await client.events.since(cursor, { types: TYPES, wait })).data;
      rounds++;
      const events: FeedEvent[] = [...answer.events];
      if (events.length && settle > 0) {
        await sleep(settle, signal);
        for (let i = 0; i < DRAIN_LIMIT; i++) {
          answer = (await client.events.since(answer.cursor, { types: TYPES, wait: 0 })).data;
          events.push(...answer.events);
          if (!answer.events.length) break;
        }
      }
      delay = backoff.first;

      if (!events.length) {
        cursor = answer.cursor;
        if (options.sweepWhenIdle) sweep = true;
        continue;
      }
      if (events.some((e) => e.type === 'hub.started' || e.type === 'requirement.changed')) {
        // Every branch's runs are gone, or what a branch needs changed: the sweep checks every head, these included.
        cursor = answer.cursor;
        sweep = true;
        continue;
      }
      if (events.some((e) => e.type === 'branch.created')) await mode.refresh();
      const heads = new Map<string, string>();
      for (const e of events) if (e.branch && e.commit && e.type !== 'requirement.changed') heads.set(e.branch, e.commit);
      for (const [branch, commit] of heads) await check(branch, commit);
      cursor = answer.cursor;
    } catch (err) {
      if (signal.aborted) break;
      if (err instanceof HubError && (err.code === 'bad_cursor' || err.code === 'cursor_too_old')) {
        warn(`The hub could not resume from the cursor (${err.code}); starting again from the present, with a sweep.`);
        cursor = undefined;
        continue;
      }
      warn(`${describe(err)}; trying again in ${Math.round(delay / 1000)} s.`);
      await sleep(delay, signal);
      delay = Math.min(delay * 2, backoff.most);
    }
  }
}

function describe(err: unknown): string {
  if (err instanceof HubError) return `The hub answered ${err.status} ${err.code}: ${err.message}`;
  const cause = err instanceof Error ? (err as { cause?: unknown }).cause : undefined;
  const text = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ECONNREFUSED|ECONNRESET|other side closed/.test(`${text} ${String(cause ?? '')}`)) return `Could not reach the hub (${text})`;
  return text;
}

function sleepFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
