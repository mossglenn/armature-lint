/**
 * Small snapshots built by hand: a graph of a few records and the reads the hub
 * would answer for it, each shaped as `@armature/client` types them. A rule's
 * test builds the least graph that makes it fire, and the least change that
 * makes it quiet.
 */
import type { AttestationsReport, CoverageDeclaration, CoverageReport, ModuleContentReport } from '@armature/client';
import type { Doc, Snapshot } from '../src/types.js';

type Verdict = CoverageDeclaration['coverage']['status'];

export function snapshot(parts: Partial<Snapshot> = {}): Snapshot {
  return {
    commit: 'c0000000000000000000000000000001',
    branch: 'main',
    documents: [],
    coverage: { thresholds: { fullyAssessedAt: 2, overAssessedAbove: 4 }, modules: [] },
    alignment: {
      scope: {},
      itemsBelowObjective: [],
      objectivesWithoutItemAtLevel: [],
      objectivesWithoutActivity: [],
      itemsWithoutObjective: [],
      unleveled: { objectives: [], items: [] },
    },
    content: {},
    attestations: {},
    ...parts,
  };
}

export const doc = (id: string, fields: Record<string, unknown> = {}): Doc => ({ '@id': id, '@type': id.split('/')[0]!, ...fields });

/** A declaration in a module's coverage report. */
export function declaration(objective: string, status: Verdict, options: { items?: string[]; placed?: boolean; projected?: Verdict } = {}): CoverageDeclaration {
  const items = options.items ?? [];
  return {
    id: `ModuleObjective/${objective.split('/')[1]}`,
    role: 'Primary',
    objective: { id: objective, type: 'LearningObjective', label: objective.split('/')[1] },
    coverage: { status, items: items.length },
    projected: { status: options.projected ?? status, items: items.length },
    assessedBy: items.map((id) => ({
      id,
      eligibility: 'delivered',
      placements: options.placed === false ? [] : [{ id: `ItemInstance/${id.split('/')[1]}`, assessment: 'Assessment/a1' }],
    })),
  };
}

export function moduleCoverage(module: string, objectives: CoverageDeclaration[]): CoverageReport {
  const count = (s: Verdict) => objectives.filter((o) => o.coverage.status === s).length;
  const coverage = { Uncovered: count('Uncovered'), PartiallyAssessed: count('PartiallyAssessed'), FullyAssessed: count('FullyAssessed'), OverAssessed: count('OverAssessed') };
  return {
    module: { id: module, type: 'Module', label: module.split('/')[1] },
    thresholds: { fullyAssessedAt: 2, overAssessedAbove: 4 },
    summary: { declared: objectives.length, coverage, projected: coverage, undeclared: 0 },
    objectives,
    undeclared: [],
  };
}

export function coverageOf(...modules: CoverageReport[]): Snapshot['coverage'] {
  return { thresholds: { fullyAssessedAt: 2, overAssessedAbove: 4 }, modules };
}

/** A placed activity: its id, the objectives it targets, the items it uses formatively. */
export interface ActivitySpec {
  id: string;
  targets?: string[];
  items?: string[];
}

/** A module's content in teaching order; an array entry is a lesson's members. */
export function content(module: string, entries: Array<ActivitySpec | ActivitySpec[]>): ModuleContentReport {
  const placed = (a: ActivitySpec, sequence: number) => ({
    sequence,
    link: `ModuleActivityLink/${a.id.split('/')[1]}`,
    activity: { id: a.id, type: 'LearningActivity', label: a.id.split('/')[1], targets: a.targets ?? [] },
    items: (a.items ?? []).map((item, i) => ({ sequence: i + 1, link: `ActivityItemLink/${item.split('/')[1]}`, item: { id: item, type: 'AssessmentItem' } })),
  });
  return {
    module: { id: module, type: 'Module' },
    summary: { entries: entries.length, lessons: 0, activities: 0, placements: 0, formativeUses: 0, unsequenced: 0 },
    content: entries.map((entry, i) =>
      Array.isArray(entry)
        ? { kind: 'lesson' as const, sequence: i + 1, link: `ModuleLessonLink/l${i}`, lesson: { id: `Lesson/l${i}`, type: 'Lesson' }, members: entry.map((a, j) => placed(a, j + 1)) }
        : { kind: 'activity' as const, ...placed(entry, i + 1) }
    ),
    repeated: [],
  };
}

export function attestationsRead(subject: string, attestations: Array<{ id: string; attestedBy: string; verdict?: string; state?: 'Current' | 'Stale' }>): AttestationsReport {
  return {
    subject: { id: subject, type: subject.split('/')[0]! },
    summary: { attestations: attestations.length, byState: { Current: 0, Stale: 0, FragmentRemoved: 0, Unanchored: 0 } },
    attestations: attestations.map((a) => ({ verdict: 'Affirmed', state: 'Current', ...a })),
  };
}
