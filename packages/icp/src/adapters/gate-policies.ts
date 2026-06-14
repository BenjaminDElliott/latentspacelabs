/**
 * Gate-level policy evaluator (LAT-166 § Policy evaluator).
 *
 * Pure function over (agent type, action, context) → approve / propose / stop.
 * Encodes the LAT-164 isolation expectations and the ADR-0008 autonomy-level
 * defaults. Known-safe actions (read, L1) → approve. Risky actions (merge,
 * deploy, delete) at L3+ → propose. Forbidden actions per agent type → stop.
 *
 * Risk classification:
 *   - low: read-only, same-repo write, no network → approve
 *   - medium: cross-repo write, L2-L3 network, deploy → propose
 *   - high: merge, delete, deploy-to-prod, send_notification → stop
 */
import type {
  AdapterAction,
  ActionScope,
  AgentType,
  GateVerdict,
  IsolationRule,
  PolicyEvaluationContext,
  PolicyGateEvaluator,
} from "../runtime/contract.js";
import { getDefaultForbiddenActions } from "../runtime/contract.js";

/* ------------------------------------------------------------------ */
/* Risk classification rules                                          */
/* ------------------------------------------------------------------ */

/**
 * Actions that are always safe (low risk) regardless of agent type.
 * These get an `approve` verdict from the policy evaluator.
 */
const LOW_RISK_ACTIONS: ReadonlySet<AdapterAction> = new Set([
  "read_issue",
  "generic",
]);

/**
 * Actions that are medium risk — safe if the scope is contained.
 * These get a `propose` verdict (human flags them but run proceeds).
 */
const MEDIUM_RISK_ACTIONS: ReadonlySet<AdapterAction> = new Set([
  "post_comment",
  "create_pr",
  "update_ticket",
  "create_issue",
  "create_comment",
  "deploy",
]);

/**
 * Actions that are high risk — always require human attention.
 * These get a `stop` verdict (execution skipped).
 */
const HIGH_RISK_ACTIONS: ReadonlySet<AdapterAction> = new Set([
  "merge_pr",
  "delete_branch",
  "run_shell_command",
  "send_notification",
]);

/**
 * Scopes that are considered safe (contained).
 */
const SAFE_SCOPES: ReadonlySet<ActionScope> = new Set([
  "same_repo",
  "linear",
  "filesystem",
  "shell",
]);

/**
 * Scopes that are considered wide (less contained).
 */
const WIDE_SCOPES: ReadonlySet<ActionScope> = new Set([
  "fork_repo",
  "any_repo",
  "external_api",
  "network",
]);

/**
 * Autonomy-level risk multipliers. Higher autonomy amplifies risk.
 * The existing LAT-23 autonomy ranking: L1=1, L2=2, L3=3, L4=4.
 */
const AUTONOMY_RANK: Record<AgentType, number> = {
  coding: 3,
  qa: 1,
  review: 1,
  sre: 3,
  pm: 2,
  research: 1,
  observability: 1,
};

/* ------------------------------------------------------------------ */
/* Default policy gate evaluator                                      */
/* ------------------------------------------------------------------ */

export interface GatePolicyOptions {
  /** Custom isolation rules (default: LAT-164 built-in rules). */
  rules?: ReadonlyArray<IsolationRule>;
  /** Custom forbidden actions map (default: LAT-164 built-in map). */
  forbiddenActions?: Record<AgentType, ReadonlyArray<AdapterAction>>;
  /** Autonomy rank override (default: built-in ranking). */
  autonomyRank?: Record<AgentType, number>;
  /**
   * Low-risk actions that always get `approve` (default: built-in set).
   * Pass an empty set to disable the low-risk shortcut.
   */
  lowRiskActions?: ReadonlySet<AdapterAction>;
  /**
   * High-risk actions that always get `stop` (default: built-in set).
   * Pass an empty set to disable the high-risk shortcut.
   */
  highRiskActions?: ReadonlySet<AdapterAction>;
}

/**
 * Create a gate-level policy evaluator that reads agent type, action, and
 * context, then returns approve / propose / stop.
 *
 * The evaluation follows this priority:
 *   1. Forbidden actions → stop (always, regardless of scope).
 *   2. High-risk actions → stop.
 *   3. Low-risk actions → approve (always).
 *   4. Medium-risk actions → check isolation rules for scope.
 *      - If scope is safe → propose.
 *      - If scope is wide AND autonomy is high → stop.
 *      - Otherwise → propose.
 *   5. Unknown → propose (conservative default).
 */
export function createGatePolicyEvaluator(
  opts: GatePolicyOptions = {},
): PolicyGateEvaluator {
  const rules = opts.rules ?? getDefaultIsolationRules();
  const forbidden = opts.forbiddenActions ?? getDefaultForbiddenActions();
  const autonomyRank = opts.autonomyRank ?? AUTONOMY_RANK;
  const lowRisk = opts.lowRiskActions ?? LOW_RISK_ACTIONS;
  const highRisk = opts.highRiskActions ?? HIGH_RISK_ACTIONS;

  return {
    evaluate(ctx: PolicyEvaluationContext): {
      verdict: GateVerdict;
      reasons: string[];
    } {
      const { agent_type, action, scope, context } = ctx;
      const reasons: string[] = [];
      const agentRank = autonomyRank[agent_type] ?? 2;

      // 1. Forbidden actions → stop
      const agentForbiddens = forbidden[agent_type];
      if (agentForbiddens?.includes(action)) {
        return {
          verdict: "stop",
          reasons: [
            `${agent_type} agent is forbidden from action "${action}" (LAT-164)`,
          ],
        };
      }

      // 2. High-risk actions → stop
      if (highRisk.has(action)) {
        reasons.push(`high-risk action "${action}" (LAT-166)`);
        if (scope && WIDE_SCOPES.has(scope)) {
          reasons.push(`wide scope "${scope}" amplifies risk`);
        }
        if (agentRank >= 3) {
          reasons.push(`autonomy rank ${agentRank} exceeds safe threshold for ${action}`);
        }
        return { verdict: "stop", reasons };
      }

      // 3. Low-risk actions → approve
      if (lowRisk.has(action)) {
        return {
          verdict: "approve",
          reasons: [`low-risk action "${action}" (LAT-166)`],
        };
      }

      // 4. Medium-risk actions → check isolation rules
      if (MEDIUM_RISK_ACTIONS.has(action)) {
        // Find applicable isolation rule
        const applicableRules = rules.filter(
          (r) =>
            r.action === action &&
            (r.agent_type === null || r.agent_type === agent_type),
        );

        if (applicableRules.length > 0) {
          const rule = applicableRules[0];
          if (rule.allowed_scopes.includes(scope)) {
            reasons.push(
              `action "${action}" within allowed scope "${scope}" per rule: ${rule.description}`,
            );
            // Propose for medium risk, stop for wide scope + high autonomy
            if (WIDE_SCOPES.has(scope) && agentRank >= 3) {
              reasons.push(`wide scope "${scope}" at rank ${agentRank} → stop`);
              return { verdict: "stop", reasons };
            }
            reasons.push(`autonomy rank ${agentRank} → propose`);
            return { verdict: "propose", reasons };
          } else {
            reasons.push(
              `action "${action}" scope "${scope}" not in allowed list [${rule.allowed_scopes.join(", ")}]`,
            );
            return { verdict: "stop", reasons };
          }
        }

        // No matching rule → propose conservatively
        reasons.push(`no isolation rule matched for "${action}"; proposing conservatively`);
        return { verdict: "propose", reasons };
      }

      // 5. Unknown action → propose
      reasons.push(`unknown action "${action}"; proposing conservatively`);
      return { verdict: "propose", reasons };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Pre-run gate                                                       */
/* ------------------------------------------------------------------ */

export interface PreRunGateOptions {
  /** The policy evaluator that produces approve/propose/stop. */
  policyEvaluator: PolicyGateEvaluator;
  /** Whether to bypass the gate for low-risk actions. */
  bypassLowRisk: boolean;
  /** Whether to log bypass decisions. */
  logBypass: boolean;
}

/**
 * Pre-run gate: validates an invocation against isolation rules BEFORE
 * the adapter executes.
 *
 * Returns approve/propose/stop based on the policy evaluator's verdict.
 * When bypassLowRisk is true, low-risk actions skip the gate entirely.
 */
export function createPreRunGate(opts: PreRunGateOptions): NonNullable<PreRunGateOptions["policyEvaluator"]>["evaluate"] & {
  bypassLowRisk: boolean;
  logBypass: boolean;
} {
  return {
    bypassLowRisk: opts.bypassLowRisk ?? true,
    logBypass: opts.logBypass ?? true,

    /**
     * Validate the invocation. Returns verdict, reasons, and optional suggestion.
     */
    validate(input: import("../runtime/contract.js").PreRunGateInput): import("../runtime/contract.js").PreRunGateResult {
      const { agent_type, action, scope, context } = input;
      const policyCtx: PolicyEvaluationContext = {
        agent_type,
        action,
        scope,
        context,
      };

      const policy = opts.policyEvaluator.evaluate(policyCtx);

      // Map policy verdict to gate verdict
      let gateVerdict: GateVerdict;
      let suggestion: string | null = null;

      switch (policy.verdict) {
        case "approve":
          gateVerdict = "approve";
          suggestion = null;
          break;
        case "stop":
          gateVerdict = "stop";
          suggestion = suggestSaferAlternative(action, scope);
          break;
        case "propose":
          gateVerdict = "propose";
          suggestion = null;
          break;
      }

      return {
        verdict: gateVerdict,
        reasons: policy.reasons,
        suggestion,
      };
    },
  };
}

/**
 * Suggest a safer alternative action based on the current action and scope.
 */
function suggestSaferAlternative(
  action: AdapterAction,
  scope: ActionScope,
): string | null {
  switch (action) {
    case "delete_branch":
      return `Consider creating a PR to merge the branch instead of deleting it directly.`;
    case "merge_pr":
      return `Consider creating a PR and letting the reviewer merge it.`;
    case "deploy":
      if (scope === "any_repo") {
        return `Consider deploying to same_repo or linear scope instead.`;
      }
      return `Consider deploying in a staging environment first.`;
    case "run_shell_command":
      return `Consider using a restricted command whitelist.`;
    case "send_notification":
      return `Consider posting to Linear instead of sending external notifications.`;
    default:
      return null;
  }
}
