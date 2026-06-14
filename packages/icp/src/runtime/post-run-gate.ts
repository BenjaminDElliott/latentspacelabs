/**
 * LAT-187: Post-run result gate.
 *
 * Validates an `AgentInvocationResult` against the original
 * `AgentInvocationRequest` and a set of post-run isolation rules
 * *after* the control loop finishes. The gate:
 *
 * 1. Checks the agent's result against forbidden post-run actions
 *    (e.g. autonomous merge, cost-band escalation beyond budget,
 *    unexpected branch operations, side effects the agent was not
 *    authorised to make).
 * 2. Catches side effects the agent was not authorised to make by
 *    comparing the result with the original invocation request.
 * 3. Logs the gate decision with evidence (which rules fired, what
 *    changed, and why).
 *
 * Design rationale
 * ----------------
 * The pre-run gate (LAT-186) inspects invocation parameters *before*
 * the agent runs. The post-run gate inspects the result *after* the
 * agent runs. Together they form a complete safety envelope:
 *
 *   [pre-run gate] → agent execution → [post-run gate] → commit
 *
 * The post-run gate is a pure function that receives the original
 * request and the agent's result, so it can detect discrepancies
 * such as:
 *   - Cost-band escalation beyond the original budget cap.
 *   - Side effects (PR creation, branch deletion) the agent was
 *     not authorised to make based on its autonomy level.
 *   - Unexpected state changes in the Linear ticket.
 *   - Runaway cost (spend exceeding budget cap).
 *
 * This module mirrors the structure of the pre-run gate (gates.ts)
 * so callers can treat both as interchangeable validation stages.
 */

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

import type {
  AgentInvocationRequest,
  AgentInvocationResult,
  AutonomyLevel,
  CostBand,
  RunReport,
} from './contract.js';

/**
 * Forbidden actions the post-run gate rejects. Each code maps to a
 * human-readable explanation and a numeric severity so callers can
 * prioritise.
 */
export type PostRunForbiddenAction =
  | {
      code: 'cost_band_escalated';
      severity: 1;
      message: string;
    }
  | {
      code: 'cost_exceeds_budget';
      severity: 1;
      message: string;
    }
  | {
      code: 'unexpected_pr_url';
      severity: 2;
      message: string;
    }
  | {
      code: 'unexpected_branch_delete';
      severity: 1;
      message: string;
    }
  | {
      code: 'unexpected_force_push';
      severity: 1;
      message: string;
    }
  | {
      code: 'unexpected_merge';
      severity: 2;
      message: string;
    }
  | {
      code: 'unexpected_deploy';
      severity: 2;
      message: string;
    }
  | {
      code: 'autonomy_escalated';
      severity: 1;
      message: string;
    }
  | {
      code: 'missing_cost_band';
      severity: 1;
      message: string;
    }
  | {
      code: 'result_status_mismatch';
      severity: 1;
      message: string;
    };

/**
 * Outcome of a post-run gate evaluation.
 *
 * `blocked` means the result must be rolled back or flagged for review.
 * `allowed` means the result is valid and can be committed.
 */
export type PostRunGateOutcome =
  | { kind: 'allowed'; hints: ReadonlyArray<string> }
  | { kind: 'blocked'; blockedBy: ReadonlyArray<PostRunForbiddenAction> };

/**
 * Evidence the post-run gate logs about its decision. Every evaluation
 * produces evidence — even `allowed` — so callers (dispatcher, cockpit,
 * run recorder) can audit why a run was accepted or rejected.
 */
export interface PostRunGateEvidence {
  /** Unique evaluation id; stable per gate invocation. */
  evaluationId: string;
  /** Issue identifier the gate is evaluating for (e.g. `LAT-187`). */
  issueIdentifier: string;
  /** Original invocation request the gate validates against. */
  originalRequest: Readonly<AgentInvocationRequest>;
  /** Agent result the gate validates. */
  result: Readonly<AgentInvocationResult>;
  /** Post-run rules applied during this evaluation. */
  rules: ReadonlyArray<string>;
  /** Forbidden actions detected; empty when `kind === "allowed"`. */
  blockedBy: ReadonlyArray<PostRunForbiddenAction>;
  /** Soft guidance surfaced to the operator; empty when `kind === "blocked"`. */
  hints: ReadonlyArray<string>;
  /** Human-readable summary suitable for logs / Linear comments. */
  decision: string;
  /** Timestamp of evaluation (ISO-8601). */
  evaluatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Autonomy rank mapping (L1 < L2 < L3 < L4)                         */
/* ------------------------------------------------------------------ */

/** Numeric rank for autonomy levels: higher = more autonomous. */
const AUTONOMY_RANK: Record<AutonomyLevel, number> = {
  'L1-read-only': 1,
  'L2-propose': 2,
  'L3-with-approval': 3,
  'L4-autonomous': 4,
};

/* ------------------------------------------------------------------ */
/* Cost band escalation detection                                      */
/* ------------------------------------------------------------------ */

/**
 * Numeric rank for cost bands: higher = more expensive.
 * Used to detect cost-band escalation between invocation and result.
 */
const COST_BAND_RANK: Record<CostBand, number> = {
  normal: 1,
  elevated: 2,
  runaway_risk: 3,
  unknown: 0,
};

/**
 * Check whether the result cost band escalated compared to the observed
 * cost band at invocation time.
 */
function costBandEscalated(observed: CostBand | undefined | null, resultBand: CostBand): boolean {
  if (observed === undefined || observed === null) return false;
  if (observed === 'unknown' || resultBand === 'unknown') return false;
  return COST_BAND_RANK[resultBand] > COST_BAND_RANK[observed];
}

/* ------------------------------------------------------------------ */
/* Post-run rules (isolation matrix for result validation)            */
/* ------------------------------------------------------------------ */

/**
 * Post-run rules applied by the post-run gate. The dispatcher builds
 * this once from configuration and passes it to the gate for every
 * run result.
 */
export interface PostRunRules {
  /**
   * Max spend in USD. Runs that spent beyond this cap are flagged.
   * Set to `null` to disable budget enforcement.
   */
  max_spend_usd: number | null;

  /**
   * When true, unexpected side effects (PR URL on a dry run, no PR URL
   * on a side-effecting run) are blocked.
   */
  enforce_side_effect_contract: boolean;

  /**
   * When true, cost-band escalation (e.g. normal → elevated → runaway)
   * is flagged and, if severe enough, blocks the result.
   */
  block_cost_band_escalation: boolean;

  /**
   * When true, spending beyond the invocation budget cap is blocked.
   */
  block_budget_overrun: boolean;

  /**
   * When true, autonomy escalation (result implies higher autonomy than
   * requested) is flagged and blocked.
   */
  block_autonomy_escalation: boolean;

  /**
   * When true, a missing cost band in the result is blocked on
   * non-dry runs.
   */
  require_cost_band: boolean;

  /**
   * When true, the gate checks for unexpected merges (e.g. agent
   * merged the PR it created when it should only have opened it).
   */
  check_unexpected_merge: boolean;

  /**
   * When true, the gate checks for unexpected force-pushes.
   */
  check_unexpected_force_push: boolean;

  /**
   * When true, the gate checks for unexpected deployments.
   */
  check_unexpected_deploy: boolean;
}

/* ------------------------------------------------------------------ */
/* Forbidden actions factory                                           */
/* ------------------------------------------------------------------ */

/**
 * Build the full set of post-run forbidden actions. These are the
 * base actions that the gate can raise; specific invocations will
 * only report the actions that actually apply.
 */
function defaultPostRunForbiddenActions(): ReadonlyArray<PostRunForbiddenAction> {
  return [
    {
      code: 'cost_band_escalated',
      severity: 1,
      message: `result cost band escalated above the invocation band`,
    },
    {
      code: 'cost_exceeds_budget',
      severity: 1,
      message: `result spend exceeded the invocation budget cap`,
    },
    {
      code: 'unexpected_pr_url',
      severity: 2,
      message: `agent produced a PR URL when none was expected`,
    },
    {
      code: 'unexpected_branch_delete',
      severity: 1,
      message: `agent deleted a branch (force-push or delete operation)`,
    },
    {
      code: 'unexpected_force_push',
      severity: 1,
      message: `agent performed a force-push`,
    },
    {
      code: 'unexpected_merge',
      severity: 2,
      message: `agent merged the PR autonomously`,
    },
    {
      code: 'unexpected_deploy',
      severity: 2,
      message: `agent deployed the result`,
    },
    {
      code: 'autonomy_escalated',
      severity: 1,
      message: `result implies a higher autonomy than requested`,
    },
    {
      code: 'missing_cost_band',
      severity: 1,
      message: `result is missing cost-band evidence`,
    },
    {
      code: 'result_status_mismatch',
      severity: 1,
      message: `result status does not match the expected outcome`,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Main gate function                                                 */
/* ------------------------------------------------------------------ */

/**
 * Run the post-run result gate.
 *
 * Validates the agent invocation result against the original request
 * and the post-run rules. Returns a `[outcome, evidence]` tuple — the
 * gate decision and the evidence log.
 *
 * @param originalRequest — the invocation request that was sent before
 *   the agent run.
 * @param result          — the agent's result after running.
 * @param rules           — post-run isolation rules to apply.
 * @returns               A tuple of `[outcome, evidence]` — the gate
 *   decision and the evidence log.
 */
export function runPostRunGate(
  originalRequest: AgentInvocationRequest,
  result: AgentInvocationResult,
  rules: PostRunRules,
): [PostRunGateOutcome, PostRunGateEvidence] {
  const blockedBy: PostRunForbiddenAction[] = [];
  const hints: string[] = [];
  const rulesApplied: string[] = [];
  const { linear_issue_id, dry_run } = originalRequest;

  // Always run these rules regardless of dry_run.
  rulesApplied.push('cost_band_check');
  rulesApplied.push('cost_exceeds_budget_check');
  rulesApplied.push('side_effect_contract_check');
  rulesApplied.push('autonomy_escalation_check');
  rulesApplied.push('missing_cost_band_check');
  rulesApplied.push('result_status_check');

  // 1. Cost-band escalation check.
  if (rules.block_cost_band_escalation) {
    if (costBandEscalated(originalRequest.cost_band_observed ?? null, result.cost_band)) {
      blockedBy.push({
        code: 'cost_band_escalated',
        severity: 1,
        message: `cost band escalated from "${originalRequest.cost_band_observed ?? 'unknown'}" to "${result.cost_band}" — escalation detected`,
      });
    }
  }

  // 2. Cost exceeds budget check.
  if (rules.block_budget_overrun) {
    const budgetCap = originalRequest.budget_cap_usd;
    if (
      budgetCap !== null &&
      budgetCap !== undefined &&
      result.spent_usd !== null &&
      result.spent_usd !== undefined &&
      result.spent_usd > budgetCap
    ) {
      blockedBy.push({
        code: 'cost_exceeds_budget',
        severity: 1,
        message: `spent $${result.spent_usd} exceeds budget cap of $${budgetCap} — budget overrun detected`,
      });
    }
  }

  // 3. Side-effect contract check.
  if (rules.enforce_side_effect_contract) {
    // Dry-run should not produce a PR URL (no side effects).
    if (dry_run && result.pr_url !== null) {
      blockedBy.push({
        code: 'unexpected_pr_url',
        severity: 2,
        message: `dry_run=true but agent produced PR URL "${result.pr_url}" — unexpected side effect`,
      });
    }
    // Side-effecting run should produce a PR URL (at minimum a draft).
    if (!dry_run && result.pr_url === null && result.exit_signal === 'succeeded') {
      blockedBy.push({
        code: 'unexpected_pr_url',
        severity: 2,
        message: `side-effecting run succeeded but no PR URL was produced`,
      });
    }
    // L2+ agents on a side-effecting run should have a PR branch.
    if (
      !dry_run &&
      result.pr_branch === null &&
      result.exit_signal === 'succeeded' &&
      result.pr_url === null
    ) {
      const autonomyRank = AUTONOMY_RANK[originalRequest.autonomy_level];
      if (autonomyRank >= 2) {
        blockedBy.push({
          code: 'unexpected_branch_delete',
          severity: 1,
          message: `L2+ agent succeeded without creating a PR branch — possible branch delete`,
        });
      }
    }
  }

  // 4. Autonomy escalation check.
  if (rules.block_autonomy_escalation) {
    const requestedRank = AUTONOMY_RANK[originalRequest.autonomy_level] ?? 0;
    // If the agent force-pushed or merged, it behaved as L4 even if
    // it was invoked at L3. Flag the escalation.
    const didForcePush = result.notes.some(
      (n) => n.toLowerCase().includes('force-push') || n.toLowerCase().includes('force push'),
    );
    const didMerge = result.notes.some(
      (n) => n.toLowerCase().includes('merged') || n.toLowerCase().includes('auto-merge'),
    );
    const didDeploy = result.notes.some(
      (n) => n.toLowerCase().includes('deploy') || n.toLowerCase().includes('deployed'),
    );

    if (didForcePush && requestedRank < 4) {
      blockedBy.push({
        code: 'autonomy_escalated',
        severity: 1,
        message: `agent force-pushed but was invoked at ${originalRequest.autonomy_level} (rank ${requestedRank}) — escalated to L4 behavior`,
      });
    }
    if (didMerge && requestedRank < 4) {
      blockedBy.push({
        code: 'autonomy_escalated',
        severity: 1,
        message: `agent merged PR but was invoked at ${originalRequest.autonomy_level} (rank ${requestedRank}) — escalated to L4 behavior`,
      });
    }
    if (didDeploy && requestedRank < 4) {
      blockedBy.push({
        code: 'autonomy_escalated',
        severity: 1,
        message: `agent deployed but was invoked at ${originalRequest.autonomy_level} (rank ${requestedRank}) — escalated to L4 behavior`,
      });
    }
  }

  // 5. Missing cost-band check.
  if (rules.require_cost_band && !dry_run) {
    if (result.cost_band === 'unknown' && !result.cost_band_unavailable_reason) {
      blockedBy.push({
        code: 'missing_cost_band',
        severity: 1,
        message: `cost_band is "unknown" with no unavailable_reason on a side-effecting run`,
      });
    }
  }

  // 6. Result status check.
  if (result.exit_signal === 'needs_human') {
    // If the agent refused but the dry_run was false, flag it.
    if (!dry_run) {
      const hasErrorNotes = result.notes.some(
        (n) =>
          n.toLowerCase().includes('error') ||
          n.toLowerCase().includes('failed') ||
          n.toLowerCase().includes('refused'),
      );
      if (hasErrorNotes) {
        blockedBy.push({
          code: 'result_status_mismatch',
          severity: 1,
          message: `agent returned needs_human with error notes on a side-effecting run`,
        });
      }
    }
  }

  // 7. Max spend check (soft cap, non-blocking).
  if (rules.max_spend_usd !== null && result.spent_usd !== null) {
    if (result.spent_usd > rules.max_spend_usd * 0.9) {
      const remaining = rules.max_spend_usd - result.spent_usd;
      if (remaining < rules.max_spend_usd * 0.3) {
        hints.push(
          `spent $${result.spent_usd} of $${rules.max_spend_usd} budget cap — only $${remaining.toFixed(2)} remaining`,
        );
      }
    }
  }

  // Build the outcome and evidence.
  const decision =
    blockedBy.length > 0
      ? `BLOCKED: ${blockedBy.length} forbidden action(s) detected in result for ${linear_issue_id}`
      : `ALLOWED: post-run gate passed for ${linear_issue_id}`;

  const outcome: PostRunGateOutcome =
    blockedBy.length > 0
      ? { kind: 'blocked', blockedBy: Object.freeze([...blockedBy]) }
      : { kind: 'allowed', hints: Object.freeze([...hints]) };

  const evidence: PostRunGateEvidence = {
    evaluationId: `postrun_eval_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    issueIdentifier: linear_issue_id,
    originalRequest: { ...originalRequest },
    result: { ...result },
    rules: [...rulesApplied],
    blockedBy: Object.freeze([...blockedBy]),
    hints: Object.freeze([...hints]),
    decision,
    evaluatedAt: new Date().toISOString(),
  };

  return [outcome, evidence];
}

/* ------------------------------------------------------------------ */
/* Convenience: default gate setup                                     */
/* ------------------------------------------------------------------ */

/**
 * Build a default `PostRunRules` configuration suitable for the ICP
 * coding agent. This is what the dispatcher would construct from
 * environment/config after a run completes.
 */
export function buildDefaultPostRunRules(): PostRunRules {
  return {
    max_spend_usd: 10, // $10 soft cap for post-run warning
    enforce_side_effect_contract: true,
    block_cost_band_escalation: true,
    block_budget_overrun: true,
    block_autonomy_escalation: true,
    require_cost_band: true,
    check_unexpected_merge: true,
    check_unexpected_force_push: true,
    check_unexpected_deploy: true,
  };
}

/**
 * Build a permissive `PostRunRules` configuration. Useful for tests
 * where most checks should pass.
 */
export function buildPermissivePostRunRules(): PostRunRules {
  return {
    max_spend_usd: null,
    enforce_side_effect_contract: false,
    block_cost_band_escalation: false,
    block_budget_overrun: false,
    block_autonomy_escalation: false,
    require_cost_band: false,
    check_unexpected_merge: false,
    check_unexpected_force_push: false,
    check_unexpected_deploy: false,
  };
}
