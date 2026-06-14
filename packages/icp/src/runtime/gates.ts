/**
 * LAT-186: Pre-run invocation gate.
 *
 * Validates an `AgentInvocationRequest` against a set of isolation rules
 * *before* the control loop runs. The gate:
 *
 * 1. Checks isolation rules against invocation parameters (repo, branch,
 *    autonomy, cost band, ticket context).
 * 2. Blocks the run if a forbidden action is detected.
 * 3. Logs the gate decision with evidence (which rules fired and why).
 *
 * Design rationale
 * ----------------
 * The dispatcher (`dispatch.ts`) allocates a worktree, generates a ticket
 * pack, and invokes the control loop.  Between those two steps the control
 * loop reads its invocation parameters from the pack.  The pre-run gate
 * is a pure function that inspects the same parameters the control loop
 * would receive, so it can reject a run without ever spawning a subprocess.
 *
 * This is separate from the post-run gate (LAT-187) which validates the
 * invocation *result* against the original request (e.g. cost-band
 * escalation).
 */

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Forbidden actions the gate rejects. Each code maps to a human-readable
 * explanation and a numeric severity so callers can prioritise.
 */
export type ForbiddenAction =
  | { code: "agent_type_forbidden"; severity: 1; message: string }
  | { code: "repo_forbidden"; severity: 1; message: string }
  | { code: "branch_forbidden"; severity: 2; message: string }
  | { code: "branch_target_forbidden"; severity: 2; message: string }
  | { code: "autonomy_exceeds_cap"; severity: 1; message: string }
  | { code: "budget_cap_missing"; severity: 2; message: string }
  | { code: "cost_band_runaway_risk"; severity: 1; message: string }
  | { code: "forbidden_ticket_context"; severity: 2; message: string };

/**
 * Outcome of a pre-run gate evaluation.
 *
 * `blocked` means the run must not proceed. `allowed` means the run
 * can proceed *and* the caller may inspect `hints` for soft guidance
 * (e.g. elevated cost band warning).
 */
export type GateOutcome =
  | { kind: "allowed"; hints: ReadonlyArray<string> }
  | { kind: "blocked"; blockedBy: ReadonlyArray<ForbiddenAction> };

/**
 * Evidence the gate logs about its decision. Every gate evaluation
 * produces evidence — even `allowed` — so callers (dispatcher, cockpit,
 * run recorder) can audit why a run was accepted or rejected.
 */
export interface GateEvidence {
  /** Unique evaluation id; stable per gate invocation. */
  evaluationId: string;
  /** Issue identifier the gate is evaluating for (e.g. `LAT-186`). */
  issueIdentifier: string;
  /** Invocation parameters the gate inspected. */
  invocation: Readonly<InvocationGateInput>;
  /** Rules applied during this evaluation. */
  rules: ReadonlyArray<string>;
  /** Forbidden actions detected; empty when `kind === "allowed"`. */
  blockedBy: ReadonlyArray<ForbiddenAction>;
  /** Soft guidance surfaced to the operator; empty when `kind === "blocked"`. */
  hints: ReadonlyArray<string>;
  /** Human-readable summary suitable for logs / Linear comments. */
  decision: string;
  /** Timestamp of evaluation (ISO-8601). */
  evaluatedAt: string;
}

/**
 * Minimal snapshot of the invocation parameters the gate inspects.
 * Mirrors the relevant fields of `AgentInvocationRequest` so the
 * dispatcher can pass a subset without constructing the full type.
 */
export interface InvocationGateInput {
  /** Agent type (currently only `"coding"` is supported). */
  agent_type: string;
  /** Linear issue identifier (e.g. `LAT-186`). */
  linear_issue_id: string;
  /** Autonomy level requested (L1–L4). */
  autonomy_level: string;
  /** Whether the caller explicitly approved side effects. */
  approve: boolean;
  /** Whether this is a dry-run (no side effects). */
  dry_run: boolean;
  /** `owner/name` repository the agent should act on. */
  repo?: string | null;
  /** Base branch the agent should branch from. */
  branch_target?: string | null;
  /** Branch naming convention (e.g. `lat-<n>-<slug>`). */
  branch_naming?: string | null;
  /** Numeric budget cap in USD; null when unknown. */
  budget_cap_usd?: number | null;
  /** Cost band observed before invocation. */
  cost_band_observed?: string | null;
  /** Guardrails extracted from the ticket context. */
  guardrails?: ReadonlyArray<string> | null;
  /** Skill name and version that originated this invocation. */
  skill_name_and_version?: string | null;
  /** Stable per-run correlation id. */
  run_id?: string | null;
}

/* ------------------------------------------------------------------ */
/* Gate rules (isolation matrix)                                      */
/* ------------------------------------------------------------------ */

/**
 * Isolation rules applied by the pre-run gate. The dispatcher builds
 * this once from configuration and passes it to the gate for every
 * invocation.
 */
export interface IsolationRules {
  /**
   * Forbidden action codes. The gate blocks when an invocation triggers
   * any of these (after rule-specific filtering).
   */
  forbidden_actions: ReadonlyArray<ForbiddenAction>;

  /**
   * Approved repositories (exact match or wildcard `*`).
   * If empty, no repo restriction applies.
   */
  approved_repos: ReadonlyArray<string>;

  /**
   * Forbidden branch targets (e.g. `main`, `master`). If empty, no
   * branch target restriction applies.
   */
  forbidden_branch_targets: ReadonlyArray<string>;

  /**
   * Max autonomy rank the gate allows. L1=1, L2=2, L3=3, L4=4.
   * A dry run (dry_run=true) bypasses all autonomy checks.
   */
  max_autonomy_rank: number;

  /**
   * When true, runs with `budget_cap_usd === null` are blocked for
   * non-dry runs (LAT-180 forbidden-actions rule).
   */
  require_budget_cap: boolean;

  /**
   * When true, runs with `cost_band_observed === "runaway_risk"` are
   * blocked unless dry_run=true (LAT-180 forbidden-actions rule).
   */
  block_runaway_cost: boolean;

  /**
   * Forbidden guardrail strings in ticket context. If any guardrail
   * contains one of these substrings, the gate blocks (LAT-180).
   */
  forbidden_guardrails: ReadonlyArray<string>;
}

/* ------------------------------------------------------------------ */
/* Autonomy rank mapping (LAT-186 internal helper)                    */
/* ------------------------------------------------------------------ */

/** Numeric autonomy rank for gate comparison. Higher = more dangerous. */
const AUTONOMY_RANK: Record<string, number> = {
  "L1-read-only": 1,
  "L2-propose": 2,
  "L3-with-approval": 3,
  "L4-autonomous": 4,
};

/**
 * Default forbidden-actions list for the ICP coding agent.
 * These are the canonical forbidden actions per LAT-180.
 */
function defaultForbiddenActions(): ReadonlyArray<ForbiddenAction> {
  return [
    {
      code: "agent_type_forbidden",
      severity: 1,
      message: `agent type is not in the approved set (expected "coding")`,
    },
    {
      code: "repo_forbidden",
      severity: 1,
      message: `repository is not in the approved list`,
    },
    {
      code: "branch_target_forbidden",
      severity: 2,
      message: `branch target is in the forbidden set`,
    },
    {
      code: "autonomy_exceeds_cap",
      severity: 1,
      message: `requested autonomy exceeds runtime cap`,
    },
    {
      code: "budget_cap_missing",
      severity: 2,
      message: `budget cap is required for side-effecting runs`,
    },
    {
      code: "cost_band_runaway_risk",
      severity: 1,
      message: `pre-invocation cost band is runaway_risk`,
    },
    {
      code: "forbidden_ticket_context",
      severity: 2,
      message: `ticket context contains a forbidden directive`,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Branch pattern matching helper                                     */
/* ------------------------------------------------------------------ */

/**
 * Check whether a branch target matches any of the approved patterns.
 * Supports:
 * - exact match: `"main"` matches `"main"`
 * - prefix wildcard: `"lat-*"` matches `"lat-186-anything"`
 * - regex: `"/^release-.*$/"` matches `"release-1.0.0"`
 */
export function branchMatches(
  target: string,
  patterns: ReadonlyArray<string>,
): boolean {
  if (patterns.length === 0) return true;
  for (const pattern of patterns) {
    if (pattern === "*") return true;
    if (pattern.startsWith("/") && pattern.endsWith("/")) {
      // Regex pattern
      try {
        const re = new RegExp(pattern.slice(1, -1));
        if (re.test(target)) return true;
      } catch {
        // Invalid regex — fall through to next pattern
      }
    } else if (pattern.endsWith("*")) {
      // Prefix wildcard
      const prefix = pattern.slice(0, -1);
      if (target.startsWith(prefix)) return true;
    } else {
      // Exact match
      if (target === pattern) return true;
    }
  }
  return false;
}

/**
 * Check whether a repo string is approved by the list.
 * Supports:
 * - exact match: `"owner/repo"` matches `"owner/repo"`
 * - wildcard: `"*"` matches everything
 * - owner wildcard: `"owner/*"` matches any repo under that owner
 */
export function repoApproved(repo: string, approved: ReadonlyArray<string>): boolean {
  if (approved.length === 0) return true;
  for (const a of approved) {
    if (a === "*") return true;
    if (a.endsWith("/*")) {
      const owner = a.slice(0, -2);
      if (repo.startsWith(owner + "/")) return true;
    }
    if (repo === a) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Main gate function                                                 */
/* ------------------------------------------------------------------ */

/**
 * Run the pre-run invocation gate.
 *
 * Checks isolation rules against the invocation parameters and returns
 * a `GateOutcome` (allowed/blocked) plus `GateEvidence` describing what
 * was checked and why.
 *
 * @param input  Invocation parameters to validate.
 * @param rules  Isolation rules to apply.
 * @returns      A tuple of `[outcome, evidence]` — the gate decision
 *               and the evidence log.
 */
export function runPreRunGate(
  input: InvocationGateInput,
  rules: IsolationRules,
): [GateOutcome, GateEvidence] {
  const blockedBy: ForbiddenAction[] = [];
  const hints: string[] = [];
  const rulesApplied: string[] = [];
  const { agent_type, linear_issue_id } = input;

  // Always run these rules regardless of dry_run.
  rulesApplied.push("agent_type_check");
  rulesApplied.push("repo_check");
  rulesApplied.push("branch_target_check");
  rulesApplied.push("autonomy_check");
  rulesApplied.push("budget_cap_check");
  rulesApplied.push("cost_band_check");
  rulesApplied.push("guardrail_check");

  // 1. Agent type check — always enforced.
  if (agent_type !== "coding") {
    const action = rules.forbidden_actions.find(
      (a) => a.code === "agent_type_forbidden",
    );
    if (action) {
      blockedBy.push({
        ...action,
        message: `agent type is "${agent_type}" — ${action.message}`,
      });
    }
  }

  // 2. Repository check.
  if (input.repo) {
    if (!repoApproved(input.repo, rules.approved_repos)) {
      const action = rules.forbidden_actions.find(
        (a) => a.code === "repo_forbidden",
      );
      if (action) {
        blockedBy.push({
          ...action,
          message: `repo is "${input.repo}" — ${action.message}`,
        });
      }
    }
  }

  // 3. Branch target check (always enforced).
  if (input.branch_target) {
    const targetForbidden = rules.forbidden_branch_targets.includes(
      input.branch_target,
    );
    if (targetForbidden) {
      const action = rules.forbidden_actions.find(
        (a) => a.code === "branch_target_forbidden",
      );
      if (action) {
        blockedBy.push({
          ...action,
          message: `branch target is "${input.branch_target}" — ${action.message}`,
        });
      }
    }
  }

  // 4. Autonomy check (skipped for dry runs — no side effects).
  if (!input.dry_run) {
    const requestedRank = AUTONOMY_RANK[input.autonomy_level] ?? 0;
    if (requestedRank > rules.max_autonomy_rank) {
      const action = rules.forbidden_actions.find(
        (a) => a.code === "autonomy_exceeds_cap",
      );
      if (action) {
        blockedBy.push({
          ...action,
          message: `requested autonomy ${input.autonomy_level} (rank ${requestedRank}) exceeds cap ${rules.max_autonomy_rank} — ${action.message}`,
        });
      }
    }
  } else {
    // Dry run: record autonomy but don't enforce.
    hints.push(`dry_run=true — autonomy check bypassed for ${input.autonomy_level}`);
  }

  // 5. Budget cap check (skipped for dry runs).
  if (rules.require_budget_cap && !input.dry_run) {
    if (input.budget_cap_usd === null || input.budget_cap_usd === undefined) {
      const action = rules.forbidden_actions.find(
        (a) => a.code === "budget_cap_missing",
      );
      if (action) {
        blockedBy.push({
          ...action,
          message: `budget_cap_usd is null — ${action.message}`,
        });
      }
    }
  }

  // 6. Cost band check (skipped for dry runs).
  if (rules.block_runaway_cost && !input.dry_run) {
    if (input.cost_band_observed === "runaway_risk") {
      const action = rules.forbidden_actions.find(
        (a) => a.code === "cost_band_runaway_risk",
      );
      if (action) {
        blockedBy.push({
          ...action,
          message: `cost_band_observed is "runaway_risk" — ${action.message}`,
        });
      }
    }
  }

  // 7. Guardrail check.
  if (input.guardrails && rules.forbidden_guardrails.length > 0) {
    for (const guardrail of input.guardrails) {
      for (const forbidden of rules.forbidden_guardrails) {
        if (guardrail.toLowerCase().includes(forbidden.toLowerCase())) {
          const action = rules.forbidden_actions.find(
            (a) => a.code === "forbidden_ticket_context",
          );
          if (action) {
            blockedBy.push({
              ...action,
              message: `guardrail "${guardrail}" contains forbidden "${forbidden}" — ${action.message}`,
            });
          }
          break;
        }
      }
    }
  }

  // Build the outcome and evidence.
  const decision =
    blockedBy.length > 0
      ? `BLOCKED: ${blockedBy.length} forbidden action(s) detected for ${linear_issue_id}`
      : `ALLOWED: all isolation rules passed for ${linear_issue_id}`;

  const outcome: GateOutcome =
    blockedBy.length > 0
      ? { kind: "blocked", blockedBy: Object.freeze([...blockedBy]) }
      : { kind: "allowed", hints: Object.freeze([...hints]) };

  const evidence: GateEvidence = {
    evaluationId: `eval_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    issueIdentifier: linear_issue_id,
    invocation: { ...input },
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
 * Build a default `IsolationRules` configuration suitable for the ICP
 * coding agent. This is what the dispatcher would construct from
 * environment/config before calling `runPreRunGate`.
 */
export function buildDefaultRules(): IsolationRules {
  return {
    forbidden_actions: defaultForbiddenActions(),
    approved_repos: ["BenjaminDElliott/latentspacelabs"],
    forbidden_branch_targets: ["main", "master"],
    max_autonomy_rank: 3, // L3-with-approval cap by default
    require_budget_cap: true,
    block_runaway_cost: true,
    forbidden_guardrails: [
      "do not touch production secrets",
      "no auto-merge",
    ],
  };
}

/**
 * Build a permissive default ruleset (no repo restriction, L4 autonomy,
 * no budget cap required). Useful for tests.
 */
export function buildPermissiveRules(): IsolationRules {
  return {
    forbidden_actions: defaultForbiddenActions(),
    approved_repos: [],
    forbidden_branch_targets: [],
    max_autonomy_rank: 4,
    require_budget_cap: false,
    block_runaway_cost: false,
    forbidden_guardrails: [],
  };
}
