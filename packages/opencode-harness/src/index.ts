/**
 * Public surface of `@latentspacelabs/opencode-harness`.
 *
 * Importers should depend only on these exports. Internal helpers are not
 * re-exported.
 */

export type {
  TicketPack,
  TicketPackHeader,
  TicketPackBranchRules,
  ReadinessStatus,
  CostBand,
  RiskLevel,
  ValidationFinding,
  ValidationResult,
  ValidationSeverity,
  HarnessStatus,
  DryRunSummary,
  CheckPlanItem,
  BranchPlan,
  RefusalReason,
  SizeLimits,
} from "./types.js";

export { DEFAULT_SIZE_LIMITS } from "./types.js";
export { parseTicketPack } from "./parser.js";
export { validateTicketPack } from "./validate.js";
export { dryRun } from "./dry-run.js";
export type { DryRunOptions, DryRunResult } from "./dry-run.js";
export { formatSummaryJson, formatSummaryMarkdown } from "./format.js";
