/**
 * A policy: what each rule's hits mean at each event. In L1 it comes from a
 * local file; from L3 the same object arrives as a `CheckRequirement`'s opaque
 * `params` (ADR-0070 decision 4), so the file and the requirement share this
 * one parser.
 *
 *   { "rules": { "alignment.bloom-gap": "require",
 *                "coverage.uncovered": { "merge": "require" } } }
 *
 * A rule given one action takes it at every event; given an object, the events
 * it names, and its defaults for the rest. A rule the policy does not name
 * keeps its defaults. A rule id this version of Lint does not know is a
 * warning, not an error, so a policy written for a newer Lint still runs.
 */
import { z } from 'zod';
import { ruleById } from './rules/index.js';
import { ACTIONS, EVENTS, type Action, type LintEvent, type Rule } from './types.js';

const ActionSchema = z.enum(ACTIONS as [Action, ...Action[]]);
const EventActionsSchema = z.strictObject({ commit: ActionSchema.optional(), push: ActionSchema.optional(), merge: ActionSchema.optional() });

export const PolicySchema = z.strictObject({
  rules: z.record(z.string(), z.union([ActionSchema, EventActionsSchema])).default({}),
});

export type Policy = z.infer<typeof PolicySchema>;

export const EMPTY_POLICY: Policy = { rules: {} };

export class PolicyError extends Error {}

/** A policy from parsed JSON, with a warning for each rule id this Lint does not know; a malformed one throws `PolicyError`. */
export function parsePolicy(value: unknown): { policy: Policy; warnings: string[] } {
  const parsed = PolicySchema.safeParse(value ?? {});
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(top)'}: ${i.message}`);
    throw new PolicyError(`The policy is not valid: ${problems.join('; ')}. Actions are ${ACTIONS.join(', ')}; events are ${EVENTS.join(', ')}.`);
  }
  const warnings = Object.keys(parsed.data.rules)
    .filter((id) => !ruleById(id))
    .map((id) => `The policy names "${id}", which this version of Lint does not know; it is ignored.`);
  return { policy: parsed.data, warnings };
}

/** The action a policy gives a rule at an event. */
export function actionFor(policy: Policy, rule: Rule, event: LintEvent): Action {
  const entry = policy.rules[rule.id];
  if (entry === undefined) return rule.defaults[event];
  if (typeof entry === 'string') return entry;
  return entry[event] ?? rule.defaults[event];
}
