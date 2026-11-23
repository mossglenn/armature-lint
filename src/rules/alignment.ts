/**
 * Alignment rules. The first two read the hub's alignment read, which ranks
 * Bloom's levels itself; the triangle is computed here, per module, from the
 * coverage read (the summative side), the module-content read (activities and
 * formative uses in teaching order) and the export (what each formative item
 * assesses), since no read puts the three sides together.
 */
import { idsIn, indexOf, labelOf } from '../graph.js';
import type { Hit, Rule } from '../types.js';

/** The alignment read types its lists loosely; each entry is a summary with an id and a label. */
interface Summary {
  id: string;
  label?: string;
  bloomsLevel?: string;
}

const quoted = (s: Summary) => (s.label ? `"${s.label}"` : s.id);

export const bloomGap: Rule = {
  id: 'alignment.bloom-gap',
  scope: 'graph',
  summary: "An item whose Bloom's level is below the level of an objective it assesses.",
  defaults: { commit: 'inform', push: 'warn', merge: 'warn' },
  evaluate(snapshot) {
    return snapshot.alignment.itemsBelowObjective.map(({ item, objective, levelsBelow }) => {
      const i = item as Summary;
      const o = objective as Summary;
      return {
        subject: i.id,
        related: [o.id],
        message: `${quoted(i)} is at ${i.bloomsLevel}, ${levelsBelow === 1 ? 'one level' : `${levelsBelow} levels`} below ${quoted(o)} (${o.bloomsLevel}).`,
      } satisfies Hit;
    });
  },
};

export const untargetedObjective: Rule = {
  id: 'alignment.untargeted-objective',
  scope: 'graph',
  summary: 'An objective no learning activity targets.',
  defaults: { commit: 'inform', push: 'warn', merge: 'warn' },
  evaluate(snapshot) {
    return (snapshot.alignment.objectivesWithoutActivity as Summary[]).map((o) => ({
      subject: o.id,
      message: `No activity targets ${quoted(o)}.`,
    }));
  },
};

type Side = 'activity' | 'placed item' | 'formative use';

export const triangleIncomplete: Rule = {
  id: 'alignment.triangle-incomplete',
  scope: 'graph',
  summary: 'A declared objective missing a side of its triangle in the module: an activity, a placed item, or a formative use.',
  defaults: { commit: 'off', push: 'inform', merge: 'inform' },
  evaluate(snapshot) {
    const { byId } = indexOf(snapshot);
    const hits: Hit[] = [];
    for (const module of snapshot.coverage.modules) {
      const content = snapshot.content[module.module.id];
      const targeted = new Set<string>();
      const usedFormatively = new Set<string>();
      for (const placed of content ? placementsOf(content) : []) {
        for (const objective of placed.activity.targets) targeted.add(objective);
        for (const use of placed.items) {
          for (const objective of idsIn(byId.get(use.item.id)?.assesses)) usedFormatively.add(objective);
        }
      }
      for (const declaration of module.objectives) {
        const objective = declaration.objective.id;
        const missing: Side[] = [];
        if (!targeted.has(objective)) missing.push('activity');
        if (!declaration.assessedBy.some((item) => item.placements.length > 0)) missing.push('placed item');
        if (!usedFormatively.has(objective)) missing.push('formative use');
        if (!missing.length) continue;
        hits.push({
          subject: objective,
          context: module.module.id,
          related: [declaration.id],
          message: `${labelOf(snapshot, objective)} in ${quoted(module.module)} has no ${missing.join(', no ')}.`,
        });
      }
    }
    return hits;
  },
};

type Content = NonNullable<import('../types.js').Snapshot['content'][string]>;
type Placed = Extract<Content['content'][number], { kind: 'activity' }>;

/**
 * Every placement of an activity in the module, in teaching order: a
 * standalone activity at its place, a lesson's members at the lesson's.
 */
export function* placementsOf(content: Content): Generator<Omit<Placed, 'kind'>> {
  for (const entry of content.content) {
    if (entry.kind === 'activity') yield entry;
    else yield* entry.members;
  }
}
