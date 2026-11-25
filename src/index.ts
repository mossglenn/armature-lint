/**
 * `@armature/lint`: the rule engine as a library, for the command line here and
 * for any tool that wants to show what Lint would say (Quiver, a service beside
 * a hub). Since L2 also the pieces `watch` and `serve` are built from: the feed
 * loop, the two modes and the reporting of check runs.
 */
export { lint, summarize, type LintOptions } from './engine.js';
export { follow, type FollowOptions } from './follow.js';
export { formatResult } from './format.js';
export { loadBase, loadSnapshot, type LoadOptions } from './load.js';
export { bindsMergeFrom, remoteMode, workspaceMode, type Mode } from './modes.js';
export { actionFor, EMPTY_POLICY, parsePolicy, PolicyError, PolicySchema, type Policy } from './policy.js';
export { isLintCheck, reportOn, type Job, type ReportOptions } from './report.js';
export { RULE_IDS, RULES, ruleById } from './rules/index.js';
export * from './types.js';
