/**
 * `orphan.unreferenced`: an artifact nothing references, as the impact read
 * would answer it (every reference field of every document counts, a note's
 * `subject` included), computed here over the snapshot in one pass rather than
 * one impact read per record.
 *
 * Some artifacts are referenced by nothing by design, and are left out: a
 * `Course` is the root; a `DesignNote`, a `DesignFinding` and a
 * `LearningMetric` point at what they are about and are pointed at by nothing.
 * Relationship documents (junctions, attestations) are never referenced either,
 * and are not artifacts.
 */
import { categoryOf, indexOf, labelOf } from '../graph.js';
import type { Hit, Rule } from '../types.js';

export const UNREFERENCED_BY_DESIGN = new Set(['Course', 'DesignNote', 'DesignFinding', 'LearningMetric']);

export const unreferenced: Rule = {
  id: 'orphan.unreferenced',
  scope: 'graph',
  summary: 'An artifact no other record references: an objective no one declares, an item placed nowhere, an activity in no module.',
  defaults: { commit: 'off', push: 'inform', merge: 'inform' },
  evaluate(snapshot) {
    const { referrers } = indexOf(snapshot);
    const hits: Hit[] = [];
    for (const doc of snapshot.documents) {
      const type = doc['@type'];
      if (categoryOf(type) !== 'artifact' || UNREFERENCED_BY_DESIGN.has(type)) continue;
      const others = (referrers.get(doc['@id']) ?? []).filter((r) => r.from !== doc['@id']);
      if (others.length) continue;
      hits.push({ subject: doc['@id'], message: `Nothing references ${labelOf(snapshot, doc['@id'])} (${type}).` });
    }
    return hits;
  },
};
