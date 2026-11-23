/**
 * `@armature/lint`: the rule engine as a library, for the command line here and
 * for any tool that wants to show what Lint would say (Quiver, the desktop
 * program's Tools list in L2, a service beside a hub).
 */
export { lint, summarize, type LintOptions } from './engine.js';
export { formatResult } from './format.js';
export { loadSnapshot, type LoadOptions } from './load.js';
export { actionFor, EMPTY_POLICY, parsePolicy, PolicyError, PolicySchema, type Policy } from './policy.js';
export { RULE_IDS, RULES, ruleById } from './rules/index.js';
export * from './types.js';
