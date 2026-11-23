import { describe, expect, it } from 'vitest';
import { bloomGap, triangleIncomplete, untargetedObjective } from '../../src/rules/alignment.js';
import { content, coverageOf, declaration, doc, moduleCoverage, snapshot } from '../fixtures.js';

const OBJ = 'LearningObjective/explain-bias';
const MOD = 'Module/ethics';
const ITEM = 'AssessmentItem/bias-mc';

describe('alignment.bloom-gap', () => {
  it("flags each item the alignment read lists below its objective's level", () => {
    const s = snapshot();
    s.alignment.itemsBelowObjective = [
      { item: { id: ITEM, label: 'Bias MC', bloomsLevel: 'Remember' }, objective: { id: OBJ, label: 'Explain bias', bloomsLevel: 'Analyze' }, levelsBelow: 3 },
    ];
    expect(bloomGap.evaluate(s)).toEqual([{ subject: ITEM, related: [OBJ], message: '"Bias MC" is at Remember, 3 levels below "Explain bias" (Analyze).' }]);
  });

  it('is quiet when the read lists none', () => {
    expect(bloomGap.evaluate(snapshot())).toEqual([]);
  });
});

describe('alignment.untargeted-objective', () => {
  it('flags each objective the alignment read lists without an activity', () => {
    const s = snapshot();
    s.alignment.objectivesWithoutActivity = [{ id: OBJ, label: 'Explain bias' }];
    expect(untargetedObjective.evaluate(s)).toEqual([{ subject: OBJ, message: 'No activity targets "Explain bias".' }]);
  });

  it('is quiet when every objective has one', () => {
    expect(untargetedObjective.evaluate(snapshot())).toEqual([]);
  });
});

describe('alignment.triangle-incomplete', () => {
  const graph = (entries: Parameters<typeof content>[1], placed = true) =>
    snapshot({
      documents: [doc(OBJ, { label: 'Explain bias' }), doc(ITEM, { assesses: [OBJ] }), doc('AssessmentItem/check', { assesses: [OBJ] })],
      coverage: coverageOf(moduleCoverage(MOD, [declaration(OBJ, 'PartiallyAssessed', { items: [ITEM], placed })])),
      content: { [MOD]: content(MOD, entries) },
    });

  it('names every missing side', () => {
    const [hit] = triangleIncomplete.evaluate(graph([], false));
    expect(hit).toMatchObject({ subject: OBJ, context: MOD });
    expect(hit!.message).toBe('"Explain bias" in "ethics" has no activity, no placed item, no formative use.');
  });

  it('names only the formative use when an activity and a placed item are there', () => {
    const [hit] = triangleIncomplete.evaluate(graph([{ id: 'LearningActivity/discuss', targets: [OBJ] }]));
    expect(hit!.message).toBe('"Explain bias" in "ethics" has no formative use.');
  });

  it('is quiet with all three sides, a lesson member counting as placed in the module', () => {
    expect(triangleIncomplete.evaluate(graph([[{ id: 'LearningActivity/discuss', targets: [OBJ], items: ['AssessmentItem/check'] }]]))).toEqual([]);
  });
});
