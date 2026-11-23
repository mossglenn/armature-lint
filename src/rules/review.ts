/**
 * Review rules, over attestations (ADR-0028). Both report records, never
 * people: no rule here counts, ranks or names anyone's habits, and nothing that
 * prints a result groups hits by author (ADR-0021; lint plan §12,
 * "Non-aggregation").
 *
 * An attestation on one part of a record counts as an attestation of the
 * record: these rules ask whether anyone else looked, not whether every part
 * was affirmed.
 */
import { idsIn, indexOf, isA, labelOf } from '../graph.js';
import type { Doc, Hit, Rule, Snapshot } from '../types.js';

/** Whether a `User/<id>` is an agent: a registered non-person, its external identifier under `agent:` (ADR-0067 decision 3). */
export function isAgent(snapshot: Snapshot, userId: unknown): boolean {
  if (typeof userId !== 'string') return false;
  const externalId = indexOf(snapshot).byId.get(userId)?.externalId;
  return typeof externalId === 'string' && externalId.startsWith('agent:');
}

/** The export's attestations, by subject. */
function attestationsBySubject(snapshot: Snapshot): Map<string, Doc[]> {
  const bySubject = new Map<string, Doc[]>();
  for (const attestation of indexOf(snapshot).byType.get('Attestation') ?? []) {
    for (const subject of idsIn(attestation.subject)) {
      const list = bySubject.get(subject);
      if (list) list.push(attestation);
      else bySubject.set(subject, [attestation]);
    }
  }
  return bySubject;
}

export const selfAttestedOnly: Rule = {
  id: 'review.self-attested-only',
  scope: 'document',
  summary: 'An item whose only attestations are by the person who created it.',
  defaults: { commit: 'off', push: 'inform', merge: 'inform' },
  evaluate(snapshot) {
    const bySubject = attestationsBySubject(snapshot);
    const hits: Hit[] = [];
    for (const item of indexOf(snapshot).byType.get('AssessmentItem') ?? []) {
      const author = item.createdBy;
      const attestations = bySubject.get(item['@id']) ?? [];
      if (typeof author !== 'string' || !attestations.length) continue;
      if (!attestations.every((a) => a.attestedBy === author)) continue;
      hits.push({
        subject: item['@id'],
        related: attestations.map((a) => a['@id']),
        message: `${labelOf(snapshot, item['@id'])} is attested only by its own author; no one else has reviewed it.`,
      });
    }
    return hits;
  },
};

export const agentUnattested: Rule = {
  id: 'review.agent-unattested',
  scope: 'document',
  summary: 'A record an agent created with no current Affirmed attestation by a person.',
  defaults: { commit: 'inform', push: 'warn', merge: 'warn' },
  evaluate(snapshot) {
    const bySubject = attestationsBySubject(snapshot);
    const hits: Hit[] = [];
    for (const doc of snapshot.documents) {
      if (!isA(doc['@type'], 'ArmatureDocument') || !isAgent(snapshot, doc.createdBy)) continue;
      const id = doc['@id'];
      const byPerson = (a: Record<string, unknown>) => a.verdict === 'Affirmed' && typeof a.attestedBy === 'string' && !isAgent(snapshot, a.attestedBy);
      // The attestations read says whether each is still current; without it, the export's attestations stand, staleness unknown.
      const read = snapshot.attestations[id];
      const affirmed = read ? read.attestations.filter(byPerson) : (bySubject.get(id) ?? []).filter(byPerson);
      const current = read ? affirmed.filter((a) => a.state === 'Current') : affirmed;
      if (current.length) continue;
      const agent = indexOf(snapshot).byId.get(String(doc.createdBy));
      const who = typeof agent?.displayName === 'string' ? agent.displayName : String(doc.createdBy);
      hits.push({
        subject: id,
        related: affirmed.map((a) => String(a['@id'] ?? a.id)),
        message: affirmed.length
          ? `${labelOf(snapshot, id)}, created by ${who}, was affirmed by a person only before its latest change.`
          : `${labelOf(snapshot, id)}, created by ${who}, has no Affirmed attestation by a person.`,
      });
    }
    return hits;
  },
};
