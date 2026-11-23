import { describe, expect, it } from 'vitest';
import { agentUnattested, selfAttestedOnly } from '../../src/rules/review.js';
import { attestationsRead, doc, snapshot } from '../fixtures.js';

const ITEM = 'AssessmentItem/bias-mc';
const people = [
  doc('User/designer', { displayName: 'Designer', externalId: 'designer@example.edu' }),
  doc('User/reviewer', { displayName: 'Reviewer', externalId: 'reviewer@example.edu' }),
  doc('User/drafter', { displayName: 'Quiver drafter', externalId: 'agent:quiver/drafter' }),
];
const attestation = (by: string, n = 1) => doc(`Attestation/a${n}`, { subject: ITEM, attestedBy: by, verdict: 'Affirmed' });

describe('review.self-attested-only', () => {
  it("flags an item whose every attestation is its author's", () => {
    const s = snapshot({ documents: [...people, doc(ITEM, { label: 'Bias MC', createdBy: 'User/designer' }), attestation('User/designer')] });
    const hits = selfAttestedOnly.evaluate(s);
    expect(hits).toEqual([{ subject: ITEM, related: ['Attestation/a1'], message: '"Bias MC" is attested only by its own author; no one else has reviewed it.' }]);
  });

  it('is quiet once someone else attests it, with no attestations, or with no recorded author', () => {
    expect(selfAttestedOnly.evaluate(snapshot({ documents: [...people, doc(ITEM, { createdBy: 'User/designer' }), attestation('User/designer'), attestation('User/reviewer', 2)] }))).toEqual([]);
    expect(selfAttestedOnly.evaluate(snapshot({ documents: [...people, doc(ITEM, { createdBy: 'User/designer' })] }))).toEqual([]);
    expect(selfAttestedOnly.evaluate(snapshot({ documents: [...people, doc(ITEM), attestation('User/designer')] }))).toEqual([]);
  });

  it('names no person in what it reports (ADR-0021)', () => {
    const s = snapshot({ documents: [...people, doc(ITEM, { label: 'Bias MC', createdBy: 'User/designer' }), attestation('User/designer')] });
    const text = JSON.stringify(selfAttestedOnly.evaluate(s));
    expect(text).not.toMatch(/designer@|Designer|User\/designer/);
  });
});

describe('review.agent-unattested', () => {
  const drafted = doc(ITEM, { label: 'Bias MC', createdBy: 'User/drafter' });

  it('flags a record an agent created that no person has affirmed', () => {
    const hits = agentUnattested.evaluate(snapshot({ documents: [...people, drafted], attestations: { [ITEM]: attestationsRead(ITEM, []) } }));
    expect(hits).toEqual([{ subject: ITEM, related: [], message: '"Bias MC", created by Quiver drafter, has no Affirmed attestation by a person.' }]);
  });

  it('flags one whose only affirmation by a person is stale, saying so', () => {
    const read = attestationsRead(ITEM, [{ id: 'Attestation/a1', attestedBy: 'User/reviewer', state: 'Stale' }]);
    const [hit] = agentUnattested.evaluate(snapshot({ documents: [...people, drafted], attestations: { [ITEM]: read } }));
    expect(hit!.message).toContain('only before its latest change');
  });

  it("does not count an agent's affirmation, or a Declined verdict", () => {
    const read = attestationsRead(ITEM, [
      { id: 'Attestation/a1', attestedBy: 'User/drafter' },
      { id: 'Attestation/a2', attestedBy: 'User/reviewer', verdict: 'Declined' },
    ]);
    expect(agentUnattested.evaluate(snapshot({ documents: [...people, drafted], attestations: { [ITEM]: read } }))).toHaveLength(1);
  });

  it('is quiet with a current affirmation by a person, and for records people created', () => {
    const read = attestationsRead(ITEM, [{ id: 'Attestation/a1', attestedBy: 'User/reviewer' }]);
    expect(agentUnattested.evaluate(snapshot({ documents: [...people, drafted], attestations: { [ITEM]: read } }))).toEqual([]);
    expect(agentUnattested.evaluate(snapshot({ documents: [...people, doc(ITEM, { createdBy: 'User/designer' })] }))).toEqual([]);
  });

  it("falls back to the export's attestations when the read was not loaded", () => {
    expect(agentUnattested.evaluate(snapshot({ documents: [...people, drafted, attestation('User/reviewer')] }))).toEqual([]);
  });
});
