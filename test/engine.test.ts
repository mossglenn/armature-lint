import { describe, expect, it } from 'vitest';
import { lint, summarize } from '../src/engine.js';
import { actionFor, parsePolicy, PolicyError } from '../src/policy.js';
import { RULES } from '../src/rules/index.js';
import { regressed, uncovered } from '../src/rules/coverage.js';
import { coverageOf, declaration, moduleCoverage, snapshot } from './fixtures.js';

const gap = snapshot({ coverage: coverageOf(moduleCoverage('Module/m', [declaration('LearningObjective/o', 'Uncovered')])) });

describe('the engine', () => {
  it("gives each hit its rule's action at the event, and passes without a require", () => {
    const result = lint(gap, { event: 'merge', rules: [uncovered] });
    expect(result).toMatchObject({ event: 'merge', conclusion: 'pass', counts: { require: 0, warn: 1, inform: 0 }, summary: '1 warning' });
    expect(result.hits[0]).toMatchObject({ rule: 'coverage.uncovered', action: 'warn', subject: 'LearningObjective/o' });
  });

  it('fails when a policy makes a hit required', () => {
    const { policy } = parsePolicy({ rules: { 'coverage.uncovered': { merge: 'require' } } });
    expect(lint(gap, { event: 'merge', policy, rules: [uncovered] })).toMatchObject({ conclusion: 'fail', counts: { require: 1 } });
    expect(lint(gap, { event: 'commit', policy, rules: [uncovered] })).toMatchObject({ conclusion: 'pass', counts: { inform: 1 } });
  });

  it('does not run a rule that is off, or one that needs a base it lacks, and says why', () => {
    const { policy } = parsePolicy({ rules: { 'coverage.uncovered': 'off' } });
    const result = lint(gap, { event: 'merge', policy, rules: [uncovered, regressed] });
    expect(result.rules).toEqual([
      { rule: 'coverage.uncovered', action: 'off', ran: false, skipped: 'off', hits: 0 },
      { rule: 'coverage.regressed', action: 'warn', ran: false, skipped: 'no merge target named (--base)', hits: 0 },
    ]);
    expect(result.hits).toEqual([]);
  });

  it('is quiet by default at commit: no rule requires anything without a policy', () => {
    for (const rule of RULES) for (const event of ['commit', 'push', 'merge'] as const) expect(rule.defaults[event]).not.toBe('require');
  });

  it('runs the whole catalog over an empty graph without a hit', () => {
    expect(lint(snapshot(), { event: 'merge' })).toMatchObject({ conclusion: 'pass', summary: 'Nothing flagged', hits: [] });
  });

  it('summarizes counts as a check run would carry them', () => {
    expect(summarize({ require: 2, warn: 5, inform: 11 })).toBe('2 required, 5 warnings, 11 for information');
    expect(summarize({ require: 0, warn: 1, inform: 0 })).toBe('1 warning');
  });
});

describe('a policy', () => {
  it('takes one action for every event, or some events with defaults for the rest', () => {
    const { policy } = parsePolicy({ rules: { 'coverage.uncovered': 'require', 'coverage.regressed': { commit: 'warn' } } });
    expect(['commit', 'push', 'merge'].map((e) => actionFor(policy, uncovered, e as 'commit'))).toEqual(['require', 'require', 'require']);
    expect(['commit', 'push', 'merge'].map((e) => actionFor(policy, regressed, e as 'commit'))).toEqual(['warn', 'warn', 'warn']);
  });

  it('warns about a rule this Lint does not know, and runs', () => {
    expect(parsePolicy({ rules: { 'prereq.cycle': 'warn' } }).warnings).toEqual(['The policy names "prereq.cycle", which this version of Lint does not know; it is ignored.']);
  });

  it('refuses an action or an event it does not know, and anything beside rules', () => {
    expect(() => parsePolicy({ rules: { 'coverage.uncovered': 'error' } })).toThrow(PolicyError);
    expect(() => parsePolicy({ rules: { 'coverage.uncovered': { deliver: 'warn' } } })).toThrow(PolicyError);
    expect(() => parsePolicy({ rule: {} })).toThrow(PolicyError);
  });

  it('reads an empty object, or nothing, as no policy', () => {
    expect(parsePolicy({}).policy).toEqual({ rules: {} });
    expect(parsePolicy(undefined).policy).toEqual({ rules: {} });
  });
});
