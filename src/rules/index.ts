/**
 * The catalog: the ten rules of the lint plan's §13 that need no path read.
 * The three prerequisite rules (`prereq.cycle`, `prereq.assessed-before-taught`,
 * `prereq.bloom-descends`) wait for the hub's path read (Armature's SESSION.md
 * item 18; decided 2026-11-22), so that Lint stays a client that read is
 * tested against.
 */
import type { Rule } from '../types.js';
import { bloomGap, triangleIncomplete, untargetedObjective } from './alignment.js';
import { overAssessed, regressed, uncovered } from './coverage.js';
import { assessedBeforePracticed } from './order.js';
import { unreferenced } from './orphan.js';
import { agentUnattested, selfAttestedOnly } from './review.js';

export const RULES: readonly Rule[] = [
  uncovered,
  overAssessed,
  regressed,
  bloomGap,
  untargetedObjective,
  triangleIncomplete,
  assessedBeforePracticed,
  selfAttestedOnly,
  agentUnattested,
  unreferenced,
];

export const RULE_IDS = RULES.map((r) => r.id);

export function ruleById(id: string): Rule | undefined {
  return RULES.find((r) => r.id === id);
}
