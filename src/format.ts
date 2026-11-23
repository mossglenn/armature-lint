/**
 * A result as text for a terminal. Hits are grouped by rule, in catalog order,
 * strongest action first within the result; never by author (ADR-0021).
 */
import type { LintResult, ResolvedHit } from './types.js';

const MARK: Record<ResolvedHit['action'], string> = { require: 'REQUIRE', warn: 'warn   ', inform: 'inform ' };
const ORDER: ResolvedHit['action'][] = ['require', 'warn', 'inform'];

export function formatResult(result: LintResult, options: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  const where = result.branch ? `${result.branch} at ${result.commit}` : result.commit;
  lines.push(`armature-lint: ${where}, as a ${result.event}`);
  lines.push('');
  const sorted = [...result.hits].sort((a, b) => ORDER.indexOf(a.action) - ORDER.indexOf(b.action));
  let rule = '';
  for (const hit of sorted) {
    if (hit.rule !== rule) {
      if (rule) lines.push('');
      rule = hit.rule;
      lines.push(`${MARK[hit.action]} ${hit.rule}`);
    }
    lines.push(`          ${hit.message}`);
    if (options.verbose) lines.push(`          ${[hit.subject, hit.fragmentId && `#${hit.fragmentId}`, hit.context && `in ${hit.context}`].filter(Boolean).join(' ')}`);
  }
  if (sorted.length) lines.push('');
  const skipped = result.rules.filter((r) => r.skipped && r.skipped !== 'off');
  for (const r of skipped) lines.push(`Not run: ${r.rule} (${r.skipped}).`);
  if (skipped.length) lines.push('');
  lines.push(`${result.conclusion === 'fail' ? 'FAIL' : 'pass'}: ${result.summary}.`);
  return lines.join('\n');
}
