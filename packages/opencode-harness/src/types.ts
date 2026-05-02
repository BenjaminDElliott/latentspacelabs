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

/**
 * How a check plan item is enforced.
 *
 * `shell`  — an executable shell command (e.g. `npm run check`). The
 *            runtime adapter executes this via `/bin/sh -c` and reports
 *            pass/fail from the exit code.
 * `policy` — a structural guardrail the runtime can verify without
 *            spawning a shell (e.g. forbidden-path restrictions). The
 *            adapter records pass/fail/manual in evidence; it never
 *            tries to execute the bullet text as shell.
 * `manual` — an English assertion that needs human review (e.g. a
 *            free-form acceptance bullet that slipped into the checks
 *            section). Recorded as `manual` in evidence; never executed.
 *
 * The split was introduced for LAT-135 after a live LAT-127 dispatch
 * passed eligibility but failed when the loop tried to run the bullet
 * `No edits under forbidden paths.` as a shell command and got
 * `/bin/sh: No: command not found`.
 */
export type CheckKind = "shell" | "policy" | "manual";

/**
 * Stable identifier for a structural policy validation. Keeps the
 * adapter from having to pattern-match free text. The only policy we
 * recognise today is the forbidden-path guardrail; new kinds extend
 * this union.
 */
export type PolicyId = "forbidden_paths";

export interface CheckPlanItem {
  name: string;
  /**
   * For `shell` items, this is the literal shell command. For `policy`
   * and `manual` items it is the bullet text as it appeared in the
   * pack, preserved for evidence/debugging only — never executed.
   */
  command: string;
  source: "ticket-pack" | "repo-gate";
  /** What the runtime is allowed to do with this item. Defaults to `shell`. */
  kind: CheckKind;
  /** Set on `policy` items; identifies the structural rule. */
  policyId?: PolicyId;
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
