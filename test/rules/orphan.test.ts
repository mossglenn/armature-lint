import { describe, expect, it } from 'vitest';
import { unreferenced } from '../../src/rules/orphan.js';
import { doc, snapshot } from '../fixtures.js';

const OBJ = 'LearningObjective/explain-bias';

describe('orphan.unreferenced', () => {
  it('flags an artifact nothing references', () => {
    expect(unreferenced.evaluate(snapshot({ documents: [doc(OBJ, { label: 'Explain bias' })] }))).toEqual([
      { subject: OBJ, message: 'Nothing references "Explain bias" (LearningObjective).' },
    ]);
  });

  it('counts any reference field, a Set included, and a note about it', () => {
    expect(unreferenced.evaluate(snapshot({ documents: [doc(OBJ), doc('AssessmentItem/i1', { assesses: [OBJ] })] })).map((h) => h.subject)).toEqual(['AssessmentItem/i1']);
    expect(unreferenced.evaluate(snapshot({ documents: [doc(OBJ), doc('DesignNote/n1', { subject: [OBJ] })] }))).toEqual([]);
  });

  it('leaves out what nothing references by design: a course, notes, findings, metrics, and relationship documents', () => {
    const documents = [
      doc('Course/c1'),
      doc('DesignNote/n1', { subject: ['Course/c1'] }),
      doc('DesignFinding/f1', { subject: ['Course/c1'] }),
      doc('LearningMetric/m1', { subject: 'Course/c1' }),
      doc('ModuleObjective/mo1'),
      doc('Attestation/a1', { subject: 'Course/c1' }),
    ];
    expect(unreferenced.evaluate(snapshot({ documents }))).toEqual([]);
  });

  it('does not count a reference to itself', () => {
    expect(unreferenced.evaluate(snapshot({ documents: [doc('LearningObjective/o1', { generatedBy: 'LearningObjective/o1' })] }))).toHaveLength(1);
  });
});
