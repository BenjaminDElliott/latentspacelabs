/**
 * Adapter runner gates (LAT-166 § "Gates").
 *
 * Pre-run gate: validate invocation against isolation rules before execution.
 * Post-run gate: validate result against forbidden actions before commit.
 *
 * Both gates produce approve/propose/stop verdicts. The combined runner gate
 * orchestrates the full pipeline and documents bypasses with evidence.
 */
import type {
  ActionScope,
  AdapterAction,
  AdapterGateOutcome,
  AgentType,
  ForbiddenActions,
  GateVerdict,
  IsolationRule,
  PostRunGateInput,
  PostRunGateResult,
  PreRunGateInput,
  PreRunGateResult,
} from "../runtime/contract.js";
import {
  getDefaultForbiddenActions,
  getDefaultIsolationRules,
} from "../runtime/contract.js";

/* ------------------------------------------------------------------ */
/* Pre-run gate                                                       */
/* ------------------------------------------------------------------ */

/**
 * Create the default pre-run gate that validates invocations against
 * isolation rules before the adapter executes.
 */
export function createPreRunGate(): {
  validate(input: PreRunGateInput): PreRunGateResult;
} {
  const rules = getDefaultIsolationRules();
  const forbidden = getDefaultForbiddenActions();

  return {
    /**
     * Validate an invocation against isolation rules.
     *
     * Verdict logic:
     *   1. Forbidden actions → stop
     *   2. Isolation rule violation → stop
     *   3. Medium-risk action in safe scope → propose
     *   4. Low-risk action → approve
     */
    validate(input: PreRunGateInput): PreRunGateResult {
      const { agent_type, action, scope, context } = input;
      const reasons: string[] = [];

      // Step 1: Check forbidden actions
      const agentForbiddens = forbidden[agent_type];
      if (agentForbiddens?.includes(action)) {
        return {
          verdict: "stop",
          reasons: [
            `forbidden action: ${agent_type} agent cannot perform "${action}" (LAT-164)`,
          ],
          suggestion: suggestActionAlternative(action),
        };
      }

      // Step 2: Check isolation rules
      const applicableRules = rules.filter(
        (r) =>
          r.action === action &&
          (r.agent_type === null || r.agent_type === agent_type),
      );

      if (applicableRules.length > 0) {
        for (const rule of applicableRules) {
          if (!rule.allowed_scopes.includes(scope)) {
            reasons.push(
              `isolation rule violation: ${action} scope "${scope}" not in [${rule.allowed_scopes.join(", ")}] — ${rule.description}`,
            );
          }
        }

        if (reasons.length > 0) {
          return {
            verdict: "stop",
            reasons,
            suggestion: suggestActionAlternative(action),
          };
        }
      }

      // Step 3: Medium-risk actions in allowed scope → propose
      const MEDIUM_RISK = new Set<AdapterAction>([
        "post_comment",
        "create_pr",
        "update_ticket",
        "create_issue",
        "create_comment",
        "deploy",
      ]);

      if (MEDIUM_RISK.has(action)) {
        reasons.push(
          `medium-risk action "${action}" in scope "${scope}"; proposing for review (LAT-166)`,
        );
        return { verdict: "propose", reasons, suggestion: null };
      }

      // Step 4: Low-risk actions → approve
      const LOW_RISK = new Set<AdapterAction>([
        "read_issue",
        "generic",
      ]);

      if (LOW_RISK.has(action)) {
        reasons.push(`low-risk action "${action}" in scope "${scope}"; approved (LAT-166)`);
        return { verdict: "approve", reasons, suggestion: null };
      }

      // Step 5: Unknown/high-risk in allowed scope → propose
      reasons.push(
        `action "${action}" in scope "${scope}"; no explicit rule matched; proposing conservatively`,
      );
      return { verdict: "propose", reasons, suggestion: null };
    },
  };
}

/**
 * Suggest a safer alternative when a forbidden action is detected.
 */
function suggestActionAlternative(action: AdapterAction): string | null {
  switch (action) {
    case "delete_branch":
      return "Create a PR instead of deleting the branch directly.";
    case "merge_pr":
      return "Create a PR and let the reviewer handle the merge.";
    case "deploy":
      return "Deploy to a staging environment first.";
    case "run_shell_command":
      return "Use a restricted command whitelist.";
    case "send_notification":
      return "Post to Linear instead of external notifications.";
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Post-run gate                                                      */
/* ------------------------------------------------------------------ */

/**
 * Create the default post-run gate that validates adapter results AFTER
 * execution to catch forbidden actions before commit.
 */
export function createPostRunGate(): {
  validate(input: PostRunGateInput): PostRunGateResult;
} {
  const forbidden = getDefaultForbiddenActions();

  return {
    /**
     * Validate a result against forbidden actions.
     *
     * Checks:
     *   1. The action itself is not forbidden for the agent type.
     *   2. Side-effects (PR, branch, commit, etc.) are within scope.
     *   3. Protected branches are not touched by non-SRE agents.
     *   4. Cost evidence is present if required.
     */
    validate(input: PostRunGateInput): PostRunGateResult {
      const { agent_type, action, scope, result } = input;
      const reasons: string[] = [];
      let violatedValue: unknown = null;

      // Step 1: Check if the action is forbidden
      const agentForbiddens = forbidden[agent_type];
      if (agentForbiddens?.includes(action)) {
        return {
          verdict: "stop",
          reasons: [
            `forbidden action in result: ${agent_type} agent performed "${action}" (LAT-164)`,
          ],
          violated_value: action,
        };
      }

      // Step 2: Check for protected branch targets
      const branchTarget = result["branch_target"] ?? result["target_branch"] ?? null;
      const PROTECTED_BRANCHES = ["main", "master", "production"];

      if (
        branchTarget &&
        typeof branchTarget === "string" &&
        PROTECTED_BRANCHES.includes(branchTarget.toLowerCase())
      ) {
        // Only SRE agents can write to protected branches
        if (agent_type !== "sre") {
          reasons.push(
            `protected branch "${branchTarget}" written by ${agent_type} agent (LAT-164)`,
          );
          return {
            verdict: "propose",
            reasons,
            violated_value: branchTarget,
          };
        }
      }

      // Step 3: Check scope consistency
      const actualScope = result["actual_scope"] ?? result["scope"] ?? null;
      if (actualScope && actualScope !== scope) {
        if (
          (actualScope === "any_repo" && scope === "same_repo") ||
          (actualScope === "external_api" && scope === "linear")
        ) {
          reasons.push(
            `scope expansion: expected "${scope}" but got "${actualScope}" (LAT-166)`,
          );
          return {
            verdict: "propose",
            reasons,
            violated_value: actualScope,
          };
        }
      }

      // Step 4: Check cost evidence on side-effecting actions
      const costBand = result["cost_band"] ?? null;
      if (
        action !== "read_issue" &&
        action !== "generic" &&
        costBand === null
      ) {
        reasons.push(
          `no cost evidence for action "${action}" (LAT-66 / ADR-0009)`,
        );
        return {
          verdict: "propose",
          reasons,
          violated_value: costBand,
        };
      }

      // Step 5: All checks passed → approve
      reasons.push(
        `post-run validation passed for ${agent_type} agent performing "${action}" (LAT-166)`,
      );
      return {
        verdict: "approve",
        reasons,
        violated_value: null,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Combined runner gate                                               */
/* ------------------------------------------------------------------ */

/**
 * Options for the combined adapter runner gate.
 */
export interface AdapterRunnerGateOptions {
  /** Pre-run gate instance. */
  preRun?: { validate: (input: PreRunGateInput) => PreRunGateResult };
  /** Post-run gate instance. */
  postRun?: { validate: (input: PostRunGateInput) => PostRunGateResult };
  /** Whether to bypass the gate for low-risk actions. */
  bypassLowRisk?: boolean;
  /** Actions that bypass the gate entirely. */
  bypassActions?: ReadonlySet<AdapterAction>;
}

/**
 * Create the combined adapter runner gate.
 *
 * Pipeline:
 *   preRun.validate(invocation)
 *     → verdict === "stop" → skip execution, return pre-run result
 *     → verdict === "propose" → log, continue
 *     → verdict === "approve" → continue
 *     → bypassLowRisk → skip pre-run, execute, post-run with evidence
 *
 *   execute(invocation) → result
 *     → postRun.validate(result)
 *       → verdict === "stop" → revert/abort
 *       → verdict === "propose" → log, commit
 *       → verdict === "approve" → commit
 *
 * The final verdict is the worst of pre-run and post-run verdicts:
 *   stop > propose > approve
 */
export function createAdapterRunnerGate(
  opts: AdapterRunnerGateOptions = {},
): {
  preRun: { validate: (input: PreRunGateInput) => PreRunGateResult };
  postRun: { validate: (input: PostRunGateInput) => PostRunGateResult };
  run<AdapterResult extends Record<string, unknown>>(
    invocation: PreRunGateInput,
    execute: (invocation: PreRunGateInput) => Promise<AdapterResult>,
  ): Promise<AdapterGateOutcome<AdapterResult>>;
} {
  const preRunGate =
    opts.preRun ?? createPreRunGate();
  const postRunGate =
    opts.postRun ?? createPostRunGate();
  const bypassLowRisk = opts.bypassLowRisk ?? true;
  const bypassActions =
    opts.bypassActions ??
    new Set<AdapterAction>(["read_issue", "generic"]);

  return {
    preRun: preRunGate,
    postRun: postRunGate,

    /**
     * Run the full gate pipeline.
     */
    async run<AdapterResult extends Record<string, unknown>>(
      invocation: PreRunGateInput,
      execute: (invocation: PreRunGateInput) => Promise<AdapterResult>,
    ): Promise<AdapterGateOutcome<AdapterResult>> {
      const { agent_type, action, scope, context } = invocation;

      // Check for bypass
      const isBypassAction = bypassActions.has(action);
      if (isBypassAction || (bypassLowRisk && isLowRiskAction(action))) {
        const bypassEvidence = `bypassed: action="${action}" is low-risk (LAT-166)`;
        const result = await execute(invocation);
        const postResult = postRunGate.validate({
          agent_type,
          action,
          scope,
          result,
        });

        return {
          verdict: postResult.verdict,
          reasons: [...postResult.reasons, bypassEvidence],
          result,
          preRunResult: {
            verdict: "approve",
            reasons: [bypassEvidence],
            suggestion: null,
          },
          postRunResult: postResult,
          bypassed: true,
          bypassEvidence,
        };
      }

      // Pre-run validation
      const preResult = preRunGate.validate(invocation);

      // Pre-run stop → skip execution
      if (preResult.verdict === "stop") {
        const result = (await execute(invocation)) as AdapterResult;
        return {
          verdict: "stop",
          reasons: preResult.reasons,
          result,
          preRunResult: preResult,
          postRunResult: null,
          bypassed: false,
          bypassEvidence: null,
        };
      }

      // Pre-run approve/propose → execute
      const result = await execute(invocation);

      // Post-run validation
      const postResult = postRunGate.validate({
        agent_type,
        action,
        scope,
        result,
      });

      // Determine overall verdict (stop > propose > approve)
      const overallVerdict = worstVerdict(preResult.verdict, postResult.verdict);

      return {
        verdict: overallVerdict,
        reasons: [...preResult.reasons, ...postResult.reasons],
        result,
        preRunResult: preResult,
        postRunResult: postResult,
        bypassed: false,
        bypassEvidence: null,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Determine if an action is low-risk (bypass-eligible).
 */
function isLowRiskAction(action: AdapterAction): boolean {
  return action === "read_issue" || action === "generic";
}

/**
 * Return the worst verdict from two gate verdicts.
 * Priority: stop > propose > approve.
 */
function worstVerdict(a: GateVerdict, b: GateVerdict): GateVerdict {
  const rank: Record<GateVerdict, number> = {
    approve: 0,
    propose: 1,
    stop: 2,
  };
  return rank[a] >= rank[b] ? a : b;
}
