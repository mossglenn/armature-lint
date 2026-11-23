/**
 * Coverage rules, over the hub's coverage read (ADR-0029, ADR-0056). The hub
 * computes every verdict at the ref with its thresholds; these rules only say
 * which verdicts deserve attention, so Lint never disagrees with the viewer
 * about what "Uncovered" means.
 */
import type { CoverageReport, CourseCoverageReport } from '@armature/client';
import type { Hit, Rule, Snapshot } from '../types.js';

type Verdict = CoverageReport['objectives'][number]['coverage']['status'];

function* declarations(coverage: CourseCoverageReport) {
  for (const module of coverage.modules) {
    for (const declaration of module.objectives) yield { module, declaration };
  }
}

const quoted = (summary: { id: string; label?: string }) => (summary.label ? `"${summary.label}"` : summary.id);

function itemsPhrase(n: number) {
  return n === 1 ? '1 item' : `${n} items`;
}

export const uncovered: Rule = {
  id: 'coverage.uncovered',
  scope: 'graph',
  summary: 'A declared objective no delivered item assesses at the ref (Uncovered).',
  defaults: { commit: 'inform', push: 'warn', merge: 'warn' },
  evaluate(snapshot) {
    const hits: Hit[] = [];
    for (const { module, declaration } of declarations(snapshot.coverage)) {
      if (declaration.coverage.status !== 'Uncovered') continue;
      const projected =
        declaration.projected.status === 'Uncovered'
          ? 'and none in review either'
          : `though ${itemsPhrase(declaration.projected.items)} in review would make it ${declaration.projected.status}`;
      hits.push({
        subject: declaration.objective.id,
        context: module.module.id,
        related: [declaration.id],
        message: `${quoted(declaration.objective)} is Uncovered in ${quoted(module.module)}: no delivered item assesses it, ${projected}.`,
      });
    }
    return hits;
  },
};

export const overAssessed: Rule = {
  id: 'coverage.over-assessed',
  scope: 'graph',
  summary: 'A declared objective assessed by more items than the over-assessed threshold allows (OverAssessed).',
  defaults: { commit: 'inform', push: 'inform', merge: 'inform' },
  evaluate(snapshot) {
    const hits: Hit[] = [];
    const above = snapshot.coverage.thresholds.overAssessedAbove;
    for (const { module, declaration } of declarations(snapshot.coverage)) {
      if (declaration.coverage.status !== 'OverAssessed') continue;
      hits.push({
        subject: declaration.objective.id,
        context: module.module.id,
        related: [declaration.id, ...declaration.assessedBy.map((i) => i.id)],
        message: `${quoted(declaration.objective)} is OverAssessed in ${quoted(module.module)}: ${itemsPhrase(declaration.coverage.items)}, more than ${above}.`,
      });
    }
    return hits;
  },
};

/** How much assessment a verdict means; OverAssessed is not less than FullyAssessed, so a move between them is no regression. */
const RANK: Record<Verdict, number> = { Uncovered: 0, PartiallyAssessed: 1, FullyAssessed: 2, OverAssessed: 2 };

export const regressed: Rule = {
  id: 'coverage.regressed',
  scope: 'graph',
  summary: 'A declared objective whose verdict is lower than on the merge target.',
  defaults: { commit: 'off', push: 'warn', merge: 'warn' },
  needs: 'base',
  evaluate(snapshot: Snapshot) {
    if (!snapshot.base) return [];
    const before = new Map<string, Verdict>();
    for (const { module, declaration } of declarations(snapshot.base.coverage)) {
      before.set(`${module.module.id} ${declaration.objective.id}`, declaration.coverage.status);
    }
    const hits: Hit[] = [];
    for (const { module, declaration } of declarations(snapshot.coverage)) {
      const was = before.get(`${module.module.id} ${declaration.objective.id}`);
      const now = declaration.coverage.status;
      if (was === undefined || RANK[now] >= RANK[was]) continue;
      hits.push({
        subject: declaration.objective.id,
        context: module.module.id,
        related: [declaration.id],
        message: `${quoted(declaration.objective)} drops from ${was} on ${snapshot.base.ref} to ${now} in ${quoted(module.module)}.`,
      });
    }
    return hits;
  },
};
