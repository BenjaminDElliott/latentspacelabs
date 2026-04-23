/**
 * Policy evaluator (ADR-0012 § "Policy evaluator").
 *
 * Pure function over a dispatch input → structured verdict. Encodes the
 * ADR-0005 dispatch-readiness algorithm, the ADR-0008 autonomy-level default
 * (L3-with-approval for ICP-dispatched coding agents), and the cost-band
 * treatment from ADR-0009. Unknown cost is `caution`, never `ready`.
 */
import type {
  PolicyEvaluation,
  PolicyEvaluator,
  PolicyInput,
  PolicyVerdict,
} from "../runtime/contract.js";

const BLOCKING_STATUSES = new Set(["todo", "backlog", "in progress", "in review"]);

export function createPolicyEvaluator(): PolicyEvaluator {
  return {
    evaluate(input: PolicyInput): PolicyEvaluation {
      const reasons: string[] = [];
      let verdict: PolicyVerdict = "ready";

      const { issue, autonomy_level, approve } = input;

      // ADR-0005: missing `## Sequencing` block → caution, not ready.
      if (issue.sequencing.dispatch_status === "unknown") {
        reasons.push("sequencing block missing or unreadable (ADR-0005)");
        verdict = worse(verdict, "caution");
      }

      // Honour the ticket's explicit dispatch_status.
      if (issue.sequencing.dispatch_status === "blocked") {
        reasons.push(
          `ticket dispatch_status=blocked: ${issue.sequencing.dispatch_note || "no note"}`,
        );
        verdict = worse(verdict, "blocked");
      } else if (issue.sequencing.dispatch_status === "caution") {
        reasons.push(
          `ticket dispatch_status=caution: ${issue.sequencing.dispatch_note || "no note"}`,
        );
        verdict = worse(verdict, "caution");
      }

      // Hard blockers: dispatch is blocked until every listed blocker is Done.
      for (const blockerId of issue.sequencing.hard_blockers) {
        const status = (issue.blocker_statuses[blockerId] ?? "unknown").toLowerCase();
        if (status === "done" || status === "completed") continue;
        if (status === "cancelled") continue;
        if (BLOCKING_STATUSES.has(status) || status === "unknown") {
          reasons.push(`hard blocker ${blockerId} is ${status}`);
          verdict = worse(verdict, "blocked");
        }
      }

      // ADR-0009 cost-band treatment. The MVP cannot quantify bands yet;
      // a missing budget cap is elevated to caution per the preflight rule.
      if (issue.budget_cap_usd === null) {
        reasons.push("no numeric Budget cap on the ticket (ADR-0009 preflight)");
        verdict = worse(verdict, "caution");
      }

      // Autonomy gate: L3 with approval requires an explicit approve flag.
      const requiresApproval =
        autonomy_level === "L3-with-approval" || autonomy_level === "L4-autonomous";
      if (requiresApproval && !approve && verdict !== "blocked") {
        reasons.push(
          `autonomy ${autonomy_level} requires explicit approval; rerun with approve=true or dry_run=true`,
        );
      }

      return {
        verdict,
        reasons,
        requires_approval: requiresApproval,
      };
    },
  };
}

const RANK: Record<PolicyVerdict, number> = {
  ready: 0,
  caution: 1,
  blocked: 2,
  stop: 3,
};

function worse(a: PolicyVerdict, b: PolicyVerdict): PolicyVerdict {
  return RANK[a] >= RANK[b] ? a : b;
}
