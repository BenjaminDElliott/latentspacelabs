/**
 * Action policy evaluator (LAT-185).
 *
 * Pure decision function: evaluate(agentType, action, context) → decision.
 *
 * Encodes the rule matrix from `docs/process/approval-gates-and-autonomy-rules.md`
 * so that the ICP runner can classify any action into one of three verdicts:
 *   - `approve` — the agent type is authorised; execute directly.
 *   - `propose` — the agent drafts; a human approver must confirm.
 *   - `stop`    — always halts; requires human intervention.
 *
 * Each decision carries a machine-readable `reason` and, when the verdict is
 * `propose`, the human approver's identity (the `approver` field).
 */
import type { AgentType, AutonomyLevel } from '../runtime/contract.js';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Verdict: how the ICP should act on this decision. */
export type PolicyDecision = 'approve' | 'propose' | 'stop';

/** Result of evaluating an action against the policy matrix. */
export interface ActionPolicyResult {
  /** approve / propose / stop */
  verdict: PolicyDecision;
  /** Human-readable explanation of why this verdict was chosen. */
  reason: string;
  /** Who must approve when verdict is `propose`. Null otherwise. */
  approver: string | null;
}

/** Input supplied to the action policy evaluator. */
export interface ActionPolicyInput {
  /** Which agent type is acting (coding, qa, review, sre, etc.). */
  agentType: AgentType;
  /** Machine-readable action identifier. */
  action: string;
  /** Autonomy level of the agent executing the action. */
  autonomyLevel?: AutonomyLevel;
  /** Optional context object carrying extra flags for rule overrides. */
  context?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Rule matrix — one row per action, referencing the approval-gates doc */
/* ------------------------------------------------------------------ */

/**
 * A single row in the action policy rule matrix.
 *
 * - `category` is the short verdict code used by the approval-gates doc.
 * - `approver` is the human approver when the category is propose.
 * - `notes` is a reference to the doc section / ADR that owns this rule.
 */
interface ActionPolicyRule {
  /** One of "approve", "propose", "stop". */
  category: PolicyDecision;
  /** Human approver name when verdict is propose; null otherwise. */
  approver: string | null;
  /** ADR / process doc reference for traceability. */
  notes: string;
  /** Minimum autonomy level required (null means "no minimum"). */
  minAutonomyLevel: number | null;
  /**
   * Optional override function. When present, it receives the full input
   * and can return a different verdict, reason, or approver than the
   * static category/approver fields. This allows context-sensitive rules
   * (e.g. "merge via thread approval" for coding agents).
   */
  override?: (input: ActionPolicyInput) => ActionPolicyResult | null;
}

/* ------------------------------------------------------------------ */
/* Autonomy-level ordering (L1 < L2 < L3 < L4)                        */
/* ------------------------------------------------------------------ */

const AUTONOMY_LEVEL_RANK: Record<string, number> = {
  'L1-read-only': 1,
  'L2-propose': 2,
  'L3-with-approval': 3,
  'L4-autonomous': 4,
};

function autonomyRank(level: string | undefined): number {
  if (!level) return 0;
  return AUTONOMY_LEVEL_RANK[level] ?? 0;
}

/* ------------------------------------------------------------------ */
/* Rule matrix                                                         */
/* ------------------------------------------------------------------ */

/**
 * Complete action policy rule matrix from the approval-gates doc.
 * Each entry maps an action string to a verdict, approver, and ADR reference.
 */
const ACTION_RULES: Record<string, ActionPolicyRule> = {
  // --- Linear ---
  'linear:create_issue': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Linear — Create Linear issue (P-Direct, L2)',
    minAutonomyLevel: 2,
  },
  'linear:update_description': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Linear — Update Linear issue description (P-Direct, L2)',
    minAutonomyLevel: 2,
  },
  'linear:add_comment': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Linear — Add Linear comment / agent write-back (P-Direct, L2)',
    minAutonomyLevel: 2,
  },
  'linear:create_project': {
    category: 'propose',
    approver: 'Ben',
    notes: 'approval-gates.md § Linear — Create Linear project (P-Propose, L2 → human)',
    minAutonomyLevel: 2,
  },
  'linear:read_sequencing': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Linear — Read Sequencing block for humans / triage (P-Direct, L1)',
    minAutonomyLevel: 1,
  },
  'linear:read_sequencing_dispatch': {
    category: 'approve',
    approver: null,
    notes:
      'approval-gates.md § Linear — Read Sequencing block for dispatch decision (ICP-Routed, L3)',
    minAutonomyLevel: 3,
  },
  'linear:create_relation': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Linear — Create native Linear issue relation (ICP-Routed, L2)',
    minAutonomyLevel: 2,
  },
  'linear:read_relations': {
    category: 'approve',
    approver: null,
    notes:
      'approval-gates.md § Linear — Read native Linear issue relations for dispatch (ICP-Routed, L3)',
    minAutonomyLevel: 3,
  },
  'linear:delete_relation': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Linear — Delete native Linear issue relation (ICP-Routed, L2)',
    minAutonomyLevel: 2,
  },
  'linear:add_labels': {
    category: 'approve',
    approver: null,
    notes:
      'approval-gates.md § Linear — Add / remove labels (state classification only) (P-Direct, L2)',
    minAutonomyLevel: 2,
  },
  'linear:select_next_issue': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Linear — Select next dispatchable LAT issue (ICP-Routed, L3)',
    minAutonomyLevel: 3,
  },
  'linear:reassign': {
    category: 'propose',
    approver: 'Ben',
    notes: 'approval-gates.md § Linear — Reassign or change owner (P-Propose, L2 → human)',
    minAutonomyLevel: 2,
  },
  'linear:delete_issue': {
    category: 'stop',
    approver: null,
    notes: 'approval-gates.md § Linear — Delete a Linear issue (Stop, always human)',
    minAutonomyLevel: null,
  },

  // --- GitHub / code / PRs ---
  'github:clone': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § GitHub — Clone a repo, read code (P-Direct, L0)',
    minAutonomyLevel: 0,
  },
  'github:draft_pr': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § GitHub — Draft a PR body or diff (no push) (P-Direct, L1)',
    minAutonomyLevel: 1,
  },
  'github:open_pr': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § GitHub — Open a PR (ICP-Routed, L2)',
    minAutonomyLevel: 2,
  },
  'github:add_pr_comments': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § GitHub — Add PR comments (P-Direct, L2)',
    minAutonomyLevel: 2,
  },
  'github:request_review': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § GitHub — Request review (ICP-Routed, L2)',
    minAutonomyLevel: 2,
  },
  'github:approve_pr': {
    category: 'stop',
    approver: null,
    notes: 'approval-gates.md § GitHub — Approve a PR (Stop, agents never authorised)',
    minAutonomyLevel: null,
  },
  'github:merge_pr': {
    category: 'stop',
    approver: null,
    notes: 'approval-gates.md § GitHub — Merge a PR (Stop, human only during pilot)',
    minAutonomyLevel: null,
  },
  'github:force_push': {
    category: 'stop',
    approver: null,
    notes: 'approval-gates.md § GitHub — Force-push / rewrite shared history (Stop)',
    minAutonomyLevel: null,
  },
  'github:delete_branch': {
    category: 'stop',
    approver: null,
    notes: 'approval-gates.md § GitHub — Delete a branch with unmerged work (Stop)',
    minAutonomyLevel: null,
  },
  'github:deploy': {
    category: 'stop',
    approver: null,
    notes: 'approval-gates.md § GitHub — Deploy (Stop, human only during pilot)',
    minAutonomyLevel: null,
  },

  // --- Agent runs ---
  'agent:start_coding': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Agent runs — Start coding agent (ICP-Routed, L3)',
    minAutonomyLevel: 3,
  },
  'agent:start_qa': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Agent runs — Start QA / review agent (ICP-Routed, L3)',
    minAutonomyLevel: 3,
  },
  'agent:start_review': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Agent runs — Start QA / review agent (ICP-Routed, L3)',
    minAutonomyLevel: 3,
  },
  'agent:run_evaluation': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Agent runs — Run self-contained evaluation (P-Direct, L1)',
    minAutonomyLevel: 1,
  },
  'agent:record_report': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Agent runs — Record an agent run report (ICP-Routed, L2)',
    minAutonomyLevel: 2,
  },
  'agent:write_telemetry': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Agent runs — Write high-fidelity telemetry (ICP-Routed, L2)',
    minAutonomyLevel: 2,
  },
  'agent:resume_halted': {
    category: 'stop',
    approver: null,
    notes:
      'approval-gates.md § Agent runs — Resume / re-dispatch halted ticket (Stop, requires unblock comment)',
    minAutonomyLevel: null,
  },

  // --- Docs / ADRs / templates ---
  'docs:draft_adr': {
    category: 'approve',
    approver: null,
    notes:
      'approval-gates.md § Docs — Draft an ADR, PRD, process doc, or template change (P-Direct, L1)',
    minAutonomyLevel: 1,
  },
  'docs:open_pr': {
    category: 'propose',
    approver: 'Ben',
    notes:
      'approval-gates.md § Docs — Open a PR updating docs / ADRs / templates (P-Propose → ICP-Routed, L2)',
    minAutonomyLevel: 2,
  },
  'docs:merge_pr': {
    category: 'stop',
    approver: null,
    notes: 'approval-gates.md § Docs — Merge a docs / ADR / template PR (Stop, human only)',
    minAutonomyLevel: null,
  },
  'docs:change_gates': {
    category: 'stop',
    approver: null,
    notes:
      'approval-gates.md § Docs — Change approval gates or autonomy rules (Stop, requires ADR)',
    minAutonomyLevel: null,
  },
  'docs:raise_autonomy': {
    category: 'stop',
    approver: null,
    notes: 'approval-gates.md § Docs — Raise autonomy level beyond pilot default (Stop)',
    minAutonomyLevel: null,
  },

  // --- Communication ---
  'comm:respond_thread': {
    category: 'approve',
    approver: null,
    notes:
      'approval-gates.md § Communication — Respond inside the Perplexity thread (P-Direct, L0)',
    minAutonomyLevel: 0,
  },
  'comm:post_slack': {
    category: 'stop',
    approver: null,
    notes:
      'approval-gates.md § Communication — Post to Slack, email, or any external channel (Stop)',
    minAutonomyLevel: null,
  },
  'comm:open_external_issue': {
    category: 'stop',
    approver: null,
    notes: 'approval-gates.md § Communication — Open an issue on an external GitHub repo (Stop)',
    minAutonomyLevel: null,
  },
  'comm:publish_public': {
    category: 'stop',
    approver: null,
    notes: 'approval-gates.md § Communication — Publish to a public surface (Stop, always human)',
    minAutonomyLevel: null,
  },

  // --- Cost and environment ---
  'cost:read_quotas': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Cost — Read connector status / quotas (P-Direct, L0)',
    minAutonomyLevel: 0,
  },
  'cost:spend_normal': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Cost — Spend inside budget cap, normal band (P-Direct, L2)',
    minAutonomyLevel: 2,
  },
  'cost:spend_elevated': {
    category: 'approve',
    approver: null,
    notes:
      'approval-gates.md § Cost — Spend entering elevated band (P-Direct, L2, flag and continue)',
    minAutonomyLevel: 2,
  },
  'cost:spend_runaway': {
    category: 'stop',
    approver: null,
    notes:
      'approval-gates.md § Cost — Any action crossing Budget cap (Stop, runaway-cost interrupt)',
    minAutonomyLevel: null,
  },
  'cost:dispatch_no_budget': {
    category: 'stop',
    approver: null,
    notes: 'approval-gates.md § Cost — Dispatch a ticket without a numeric Budget cap (Stop)',
    minAutonomyLevel: null,
  },
  'cost:provision_infra': {
    category: 'stop',
    approver: null,
    notes: 'approval-gates.md § Cost — Provision new infrastructure / services (Stop, human only)',
    minAutonomyLevel: null,
  },
  'cost:change_secrets': {
    category: 'stop',
    approver: null,
    notes:
      'approval-gates.md § Cost — Change secrets, tokens, connector permissions (Stop, human only)',
    minAutonomyLevel: null,
  },
  'file:write': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § GitHub — Draft a PR body or diff (no push) (P-Direct, L1)',
    minAutonomyLevel: 1,
  },
  'shell:run': {
    category: 'approve',
    approver: null,
    notes: 'approval-gates.md § Agent runs — Run a self-contained evaluation (P-Direct, L1)',
    minAutonomyLevel: 1,
  },
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Evaluate an action against the policy matrix and return a decision.
 *
 * @param agentType — which agent type is acting (e.g. "coding", "qa", "review", "sre").
 * @param action    — machine-readable action identifier (e.g. "github:merge_pr", "linear:create_issue").
 * @param context   — optional context; `autonomyLevel` provides autonomy level override,
 *                    `thread_approved_merge` signals a thread-approved merge path.
 * @returns A structured decision with verdict, reason, and approver (when applicable).
 *
 * The decision is:
 *   - `approve`  — the agent may execute directly.
 *   - `propose`  — the agent drafts; a human approver must confirm (see `approver`).
 *   - `stop`     — always halts; requires human intervention.
 *
 * If the action has no matching rule, the function returns a default `propose`
 * verdict with approver `"Ben"` (the safety-over-asking heuristic).
 *
 * If the agent's autonomy level is below the rule's minimum, the verdict is
 * downgraded to `propose` (the agent should ask before overstepping).
 * If the rule's override function returns a result, it takes precedence.
 */
export function evaluate(
  agentType: AgentType,
  action: string,
  context?: { autonomyLevel?: AutonomyLevel; [key: string]: unknown },
): ActionPolicyResult {
  const autonomyLevel = context?.autonomyLevel;
  const agentContext = context ?? {};

  // Look up the rule for this action.
  const rule = ACTION_RULES[action];

  // Unknown action → propose with Ben as approver (safety-first).
  if (!rule) {
    return {
      verdict: 'propose',
      reason: `Action "${action}" is not in the policy matrix; defaulting to propose.`,
      approver: 'Ben',
    };
  }

  // Check autonomy level gate.
  if (rule.minAutonomyLevel !== null) {
    const agentRank = autonomyRank(autonomyLevel);
    if (agentRank < rule.minAutonomyLevel) {
      return {
        verdict: 'propose',
        reason: `Agent autonomy level (${autonomyLevel ?? 'none'}, rank ${agentRank}) is below the minimum required (${rule.minAutonomyLevel}) for "${action}". ${rule.notes}`,
        approver: rule.approver ?? 'Ben',
      };
    }
  }

  // Apply optional override (context-sensitive rules).
  if (rule.override) {
    const overrideInput: ActionPolicyInput = { agentType, action };
    if (autonomyLevel !== undefined) overrideInput.autonomyLevel = autonomyLevel;
    overrideInput.context = agentContext as Record<string, unknown>;
    const overrideResult = rule.override(overrideInput);
    if (overrideResult) return overrideResult;
  }

  return {
    verdict: rule.category,
    reason: `${rule.category.toUpperCase()} — ${rule.notes}`,
    approver: rule.approver,
  };
}

/* ------------------------------------------------------------------ */
/* Convenience: full-input version that mirrors the legacy signature   */
/* ------------------------------------------------------------------ */

/**
 * Evaluate using an ActionPolicyInput object. Convenience wrapper around
 * the positional `evaluate` function.
 *
 * @deprecated Use the positional `evaluate(agentType, action, context)` instead.
 */
export function evaluateWithInput(input: ActionPolicyInput): ActionPolicyResult {
  return evaluate(input.agentType, input.action, input.context);
}
