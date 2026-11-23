import { describe, expect, it } from 'vitest';
import { overAssessed, regressed, uncovered } from '../../src/rules/coverage.js';
import { coverageOf, declaration, moduleCoverage, snapshot } from '../fixtures.js';

const OBJ = 'LearningObjective/explain-bias';
const MOD = 'Module/ethics';

describe('coverage.uncovered', () => {
  it('flags a declared objective the coverage read calls Uncovered, naming the module and what is in review', () => {
    const s = snapshot({ coverage: coverageOf(moduleCoverage(MOD, [declaration(OBJ, 'Uncovered', { projected: 'PartiallyAssessed' })])) });
    const hits = uncovered.evaluate(s);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ subject: OBJ, context: MOD, related: ['ModuleObjective/explain-bias'] });
    expect(hits[0]!.message).toContain('would make it PartiallyAssessed');
  });

  it('is quiet once an item assesses it', () => {
    const s = snapshot({ coverage: coverageOf(moduleCoverage(MOD, [declaration(OBJ, 'PartiallyAssessed', { items: ['AssessmentItem/i1'] })])) });
    expect(uncovered.evaluate(s)).toEqual([]);
  });
});

describe('coverage.over-assessed', () => {
  it('flags an OverAssessed declaration with its items', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((x) => `AssessmentItem/${x}`);
    const s = snapshot({ coverage: coverageOf(moduleCoverage(MOD, [declaration(OBJ, 'OverAssessed', { items })])) });
    const [hit] = over(s);
    expect(hit).toMatchObject({ subject: OBJ, context: MOD });
    expect(hit!.related).toEqual(['ModuleObjective/explain-bias', ...items]);
    expect(hit!.message).toContain('5 items, more than 4');
  });

  it('is quiet at FullyAssessed', () => {
    const s = snapshot({ coverage: coverageOf(moduleCoverage(MOD, [declaration(OBJ, 'FullyAssessed', { items: ['AssessmentItem/a', 'AssessmentItem/b'] })])) });
    expect(over(s)).toEqual([]);
  });

  const over = (s: ReturnType<typeof snapshot>) => overAssessed.evaluate(s);
});

describe('coverage.regressed', () => {
  const base = (status: 'FullyAssessed' | 'OverAssessed' | 'PartiallyAssessed') => ({ ref: 'main', coverage: coverageOf(moduleCoverage(MOD, [declaration(OBJ, status)])) });

  it('flags a verdict lower than on the merge target', () => {
    const s = snapshot({ coverage: coverageOf(moduleCoverage(MOD, [declaration(OBJ, 'PartiallyAssessed')])), base: base('FullyAssessed') });
    const hits = regressed.evaluate(s);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('drops from FullyAssessed on main to PartiallyAssessed');
  });

  it('counts OverAssessed to FullyAssessed as no regression, and a rise as none', () => {
    expect(regressed.evaluate(snapshot({ coverage: coverageOf(moduleCoverage(MOD, [declaration(OBJ, 'FullyAssessed')])), base: base('OverAssessed') }))).toEqual([]);
    expect(regressed.evaluate(snapshot({ coverage: coverageOf(moduleCoverage(MOD, [declaration(OBJ, 'FullyAssessed')])), base: base('PartiallyAssessed') }))).toEqual([]);
  });

  it('ignores a declaration the target does not have, and says nothing without a base', () => {
    const s = snapshot({ coverage: coverageOf(moduleCoverage(MOD, [declaration(OBJ, 'Uncovered')])) });
    expect(regressed.evaluate(s)).toEqual([]);
    expect(regressed.evaluate({ ...s, base: { ref: 'main', coverage: coverageOf(moduleCoverage(MOD, [])) } })).toEqual([]);
  });
});
