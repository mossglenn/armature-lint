/**
 * Order rules, over a module's teaching order (the module-content read,
 * ADR-0005: standalone activities and lessons in one sequence, a lesson's
 * members in its own).
 *
 * `order.assessed-before-practiced` reads "placed before" as a formative use
 * (ADR-0061) earlier in teaching order than every activity that targets the
 * item's objective. Assessments carry no place in that order (an `Assessment`
 * names its module and nothing more), so a summative placement cannot come
 * before anything; when assessments join the module-content read (SESSION.md
 * item 11, carried), this rule can follow them.
 */
import { idsIn, indexOf, labelOf } from '../graph.js';
import type { Hit, Rule } from '../types.js';
import { placementsOf } from './alignment.js';

export const assessedBeforePracticed: Rule = {
  id: 'order.assessed-before-practiced',
  scope: 'graph',
  summary: "An item used formatively earlier in a module's teaching order than any activity that targets its objective.",
  defaults: { commit: 'inform', push: 'warn', merge: 'warn' },
  evaluate(snapshot) {
    const { byId } = indexOf(snapshot);
    const hits: Hit[] = [];
    for (const [moduleId, content] of Object.entries(snapshot.content)) {
      const placements = [...placementsOf(content)];
      // The first place each objective is targeted.
      const firstTargeted = new Map<string, number>();
      placements.forEach((placed, at) => {
        for (const objective of placed.activity.targets) if (!firstTargeted.has(objective)) firstTargeted.set(objective, at);
      });
      placements.forEach((placed, at) => {
        for (const use of placed.items) {
          for (const objective of idsIn(byId.get(use.item.id)?.assesses)) {
            const practiced = firstTargeted.get(objective);
            // Never targeted in the module: alignment.triangle-incomplete's to say, not this rule's.
            if (practiced === undefined || practiced <= at) continue;
            const by = placements[practiced]!.activity;
            hits.push({
              subject: use.item.id,
              context: moduleId,
              related: [objective, use.link, by.id],
              message: `${labelOf(snapshot, use.item.id)} is used in ${labelOf(snapshot, placed.activity.id)} before ${labelOf(snapshot, by.id)}, the first activity in ${labelOf(snapshot, moduleId)} that targets ${labelOf(snapshot, objective)}.`,
            });
          }
        }
      });
    }
    return hits;
  },
};
