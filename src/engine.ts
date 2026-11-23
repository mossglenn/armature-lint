/**
 * The engine: every rule in the catalog over one snapshot, under a policy, for
 * one event. Pure: no I/O, no clock, the same result for the same snapshot.
 */
import { actionFor, EMPTY_POLICY, type Policy } from './policy.js';
import { RULES } from './rules/index.js';
import type { Counts, LintEvent, LintResult, ResolvedHit, Rule, RuleOutcome, Snapshot } from './types.js';

export interface LintOptions {
  event?: LintEvent;
  policy?: Policy;
  /** The rules to run; the whole catalog by default. Tests pass one. */
  rules?: readonly Rule[];
}

export function lint(snapshot: Snapshot, options: LintOptions = {}): LintResult {
  const event = options.event ?? 'commit';
  const policy = options.policy ?? EMPTY_POLICY;
  const outcomes: RuleOutcome[] = [];
  const hits: ResolvedHit[] = [];
  for (const rule of options.rules ?? RULES) {
    const action = actionFor(policy, rule, event);
    if (action === 'off') {
      outcomes.push({ rule: rule.id, action, ran: false, skipped: 'off', hits: 0 });
      continue;
    }
    if (rule.needs === 'base' && !snapshot.base) {
      outcomes.push({ rule: rule.id, action, ran: false, skipped: 'no merge target named (--base)', hits: 0 });
      continue;
    }
    const found = rule.evaluate(snapshot);
    outcomes.push({ rule: rule.id, action, ran: true, hits: found.length });
    for (const hit of found) hits.push({ rule: rule.id, action, ...hit });
  }
  const counts: Counts = { require: 0, warn: 0, inform: 0 };
  for (const hit of hits) counts[hit.action]++;
  const conclusion = counts.require ? 'fail' : 'pass';
  return {
    commit: snapshot.commit,
    ...(snapshot.branch ? { branch: snapshot.branch } : {}),
    event,
    conclusion,
    counts,
    summary: summarize(counts),
    rules: outcomes,
    hits,
  };
}

/** "2 required, 5 warnings, 11 for information", or "Nothing flagged". */
export function summarize(counts: Counts): string {
  const parts = [
    counts.require && `${counts.require} required`,
    counts.warn && `${counts.warn} ${counts.warn === 1 ? 'warning' : 'warnings'}`,
    counts.inform && `${counts.inform} for information`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Nothing flagged';
}
