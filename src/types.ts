/**
 * The engine's vocabulary. A rule examines a snapshot of the graph at one
 * commit and returns hits; the policy says, per rule and per event, what a hit
 * means (an action); the result's conclusion is `fail` when any hit resolves
 * to `require`.
 *
 * Words, held to Armature's naming vocabulary (docs/naming-vocabulary.md):
 * "rule" here is Lint's own, an advisory condition a check examines, not the
 * hub's invariants (decided 2026-11-22: the collision is accepted and noted on
 * the vocabulary's row); a "hit" is what a rule flags, and becomes a
 * `DesignFinding` only when a person keeps it (lint plan §12); "check" and
 * "report" are the hub's words for what Lint posts (L2).
 */
import type {
  AlignmentReport,
  AttestationsReport,
  CourseCoverageReport,
  ModuleContentReport,
} from '@armature/client';

/** When a rule runs: a local write, a push from a workspace, a merge (lint plan §5). */
export type LintEvent = 'commit' | 'push' | 'merge';
export const EVENTS: readonly LintEvent[] = ['commit', 'push', 'merge'];

/** What a hit means under a policy, weakest first. `off` skips the rule. */
export type Action = 'off' | 'inform' | 'warn' | 'require';
export const ACTIONS: readonly Action[] = ['off', 'inform', 'warn', 'require'];

/** A rule's action at each event. */
export type EventActions = Record<LintEvent, Action>;

/**
 * Whether a rule looks at one record at a time (`document`) or at how records
 * connect (`graph`). Under ADR-0070 neither can refuse a single write; the
 * scope is said so that a person reading the catalog knows which a rule is.
 */
export type RuleScope = 'document' | 'graph';

/** A document as the export carries it: `@id`, `@type` and the class's fields. */
export type Doc = Record<string, unknown> & { '@id': string; '@type': string };

/**
 * The graph at one commit, as the rules see it: the export's documents and the
 * hub's reads, all at `commit`. Built by `load.ts` (the only module that talks
 * to a hub) or by hand in a test.
 */
export interface Snapshot {
  /** The commit every part was read at. */
  commit: string;
  /** The branch asked for, when a branch was asked for rather than a commit. */
  branch?: string;
  /** Every document of the export's `full` slice. */
  documents: Doc[];
  /** `GET /intelligence/coverage`: every module. */
  coverage: CourseCoverageReport;
  /** `GET /intelligence/alignment` over everything. */
  alignment: AlignmentReport;
  /** `GET /intelligence/module-content/:id` for every module, by `Module/<id>`. */
  content: Record<string, ModuleContentReport>;
  /**
   * `GET /intelligence/attestations/:type/:id` for each record an agent
   * created, by its id: the reads that carry an attestation's staleness.
   */
  attestations: Record<string, AttestationsReport>;
  /** The merge target's coverage, for `coverage.regressed`; absent when no base was named. */
  base?: { ref: string; commit?: string; coverage: CourseCoverageReport };
}

/** What a rule flags: one record (or one part of one), and why. */
export interface Hit {
  /** The record a person would change, or keep a finding about: `Class/id`. */
  subject: string;
  /** The part of an item, when the hit is about one part. */
  fragmentId?: string;
  /** Where the hit applies, when the subject alone is not enough (a module, for a declaration). */
  context?: string;
  /** Other records the hit names. */
  related?: string[];
  /** One sentence a designer can read, naming records by their labels. */
  message: string;
}

export interface Rule {
  id: string;
  scope: RuleScope;
  /** What the rule flags, in one sentence. */
  summary: string;
  /** The action with no policy at all: quiet by design (lint plan §13). */
  defaults: EventActions;
  /** Which part of the snapshot the rule cannot run without, when it needs more than the defaults load. */
  needs?: 'base';
  evaluate(snapshot: Snapshot): Hit[];
}

/** A hit with its rule and the action the policy gave it. */
export interface ResolvedHit extends Hit {
  rule: string;
  action: Exclude<Action, 'off'>;
}

export interface RuleOutcome {
  rule: string;
  action: Action;
  /** `skipped` when the rule is `off`, or lacked what it `needs`, with the reason. */
  ran: boolean;
  skipped?: string;
  hits: number;
}

/** The counts a check run carries (ADR-0070's `counts`), by action. */
export type Counts = Record<Exclude<Action, 'off'>, number>;

export interface LintResult {
  commit: string;
  branch?: string;
  event: LintEvent;
  /** `fail` when any hit resolves to `require` (lint plan §12). */
  conclusion: 'pass' | 'fail';
  counts: Counts;
  /** One line, as a check run's `summary` will carry it. */
  summary: string;
  rules: RuleOutcome[];
  hits: ResolvedHit[];
}
