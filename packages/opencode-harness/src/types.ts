/**
 * Types for the opencode + Qwen dry-run ticket-pack harness (LAT-105).
 *
 * Mirrors the contract owned by LAT-104 (`docs/templates/opencode-ticket-pack.md`)
 * and the runtime constraints fixed by ADR-0019. Pure types — no I/O.
 */

export type ReadinessStatus =
  | "ready"
  | "blocked"
  | "needs_clarification"
  | "too_large";

export type CostBand = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high";

export interface TicketPackHeader {
  linearId: string;
  packVersion: string;
  plannerSource: string;
  costBand: CostBand;
  riskLevel: RiskLevel;
  readinessStatus: ReadinessStatus;
}

export interface TicketPackBranchRules {
  branch: string;
  prTitlePrefix: string;
  prBase: string;
}

export interface TicketPack {
  header: TicketPackHeader;
  goal: string;
  acceptanceCriteria: string[];
  filesInScope: string[];
  filesForbidden: string[];
  dependencyPolicy: string;
  expectedChecks: string[];
  branchRules: TicketPackBranchRules;
  raw: string;
  rawPath: string;
}

export type ValidationSeverity = "error" | "warning";

export interface ValidationFinding {
  severity: ValidationSeverity;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  findings: ValidationFinding[];
  pack?: TicketPack;
}

/**
 * Final harness verdict. Mirrors the LAT-104 readiness statuses with one
 * extra terminal value, `harness_error`, reserved for harness-internal
 * failures (e.g. could not read the pack file). The harness never reports
 * `succeeded` — only the real opencode runtime can do that, and this
 * harness deliberately does not invoke it.
 */
export type HarnessStatus =
  | "ready"
  | "blocked"
  | "needs_clarification"
  | "too_large"
  | "harness_error";

export interface CheckPlanItem {
  name: string;
  command: string;
  source: "ticket-pack" | "repo-gate";
}

export interface BranchPlan {
  branch: string;
  prTitlePrefix: string;
  prBase: string;
  prTitleExample: string;
}

export interface RefusalReason {
  code: string;
  message: string;
}

export interface DryRunSummary {
  schemaVersion: "1.0.0";
  ticket: string;
  packPath: string;
  status: HarnessStatus;
  generatedAt: string;
  packReadinessStatus: ReadinessStatus | "unknown";
  costBand: CostBand | "unknown";
  riskLevel: RiskLevel | "unknown";
  filesInScope: string[];
  filesForbidden: string[];
  acceptanceCriteria: string[];
  branchPlan: BranchPlan | null;
  checkPlan: CheckPlanItem[];
  refusals: RefusalReason[];
  notes: string[];
  endpointInvoked: false;
  prOpened: false;
  linearWriteBack: false;
}

/**
 * Bounds checked by the dry-run harness when deciding whether to refuse a
 * pack as too-large. These are deliberately small — the small-model surface
 * per ADR-0019 is bounded, and the harness errs on the side of refusing
 * before invoking the runtime.
 */
export interface SizeLimits {
  maxFilesInScope: number;
  maxAcceptanceCriteria: number;
  maxRawBytes: number;
}

export const DEFAULT_SIZE_LIMITS: SizeLimits = {
  maxFilesInScope: 12,
  maxAcceptanceCriteria: 10,
  maxRawBytes: 64 * 1024,
};
