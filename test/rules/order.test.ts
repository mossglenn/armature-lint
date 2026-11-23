import { describe, expect, it } from 'vitest';
import { assessedBeforePracticed } from '../../src/rules/order.js';
import { content, doc, snapshot } from '../fixtures.js';

const OBJ = 'LearningObjective/explain-bias';
const MOD = 'Module/ethics';
const ITEM = 'AssessmentItem/check';

const graph = (entries: Parameters<typeof content>[1]) =>
  snapshot({ documents: [doc(MOD, { label: 'Ethics' }), doc(OBJ, { label: 'Explain bias' }), doc(ITEM, { label: 'Quick check', assesses: [OBJ] })], content: { [MOD]: content(MOD, entries) } });

describe('order.assessed-before-practiced', () => {
  it('flags an item used formatively before the first activity that targets its objective', () => {
    const hits = assessedBeforePracticed.evaluate(graph([{ id: 'LearningActivity/intro', items: [ITEM] }, { id: 'LearningActivity/practice', targets: [OBJ] }]));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ subject: ITEM, context: MOD, related: [OBJ, 'ActivityItemLink/check', 'LearningActivity/practice'] });
    expect(hits[0]!.message).toBe('"Quick check" is used in LearningActivity/intro before LearningActivity/practice, the first activity in "Ethics" that targets "Explain bias".');
  });

  it('follows teaching order into a lesson', () => {
    const hits = assessedBeforePracticed.evaluate(graph([[{ id: 'LearningActivity/intro', items: [ITEM] }, { id: 'LearningActivity/practice', targets: [OBJ] }]]));
    expect(hits).toHaveLength(1);
  });

  it('is quiet when the activity using the item targets the objective, or one before it does', () => {
    expect(assessedBeforePracticed.evaluate(graph([{ id: 'LearningActivity/practice', targets: [OBJ], items: [ITEM] }]))).toEqual([]);
    expect(assessedBeforePracticed.evaluate(graph([{ id: 'LearningActivity/practice', targets: [OBJ] }, { id: 'LearningActivity/review', items: [ITEM] }]))).toEqual([]);
  });

  it('leaves an objective no activity in the module targets to the triangle rule', () => {
    expect(assessedBeforePracticed.evaluate(graph([{ id: 'LearningActivity/intro', items: [ITEM] }]))).toEqual([]);
  });
});
