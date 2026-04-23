/**
 * Readiness check (PRD LAT-26 §6.3).
 *
 * Pure function over a ticket-input envelope → a three-valued verdict
 * (`ready` | `caution` | `refuse`) with structured reasons. Refusals carry
 * the LAT-61-seeded `FailureCategory` vocabulary so the retro aggregator
 * can count readiness refusals and invocation-time refusals uniformly.
 *
 * The readiness check is advisory (PRD §6.3 last paragraph): it refuses
 * dispatch when the ticket is not agent-ready, but does not raise autonomy
 * or override a Ben-level approval gate. The caller (dispatch skill or
 * harness) decides how to act on a `caution` verdict.
 */
import type {
  FailureCategory,
  ReadinessReason,
  ReadinessReport,
  ReadinessTicketInput,
  ReadinessVerdict,
} from "./contract.js";

/** Verdict precedence: `refuse` > `caution` > `ready`. */
const RANK: Record<ReadinessVerdict, number> = {
  ready: 0,
  caution: 1,
  refuse: 2,
};

function worse(a: ReadinessVerdict, b: ReadinessVerdict): ReadinessVerdict {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Evaluate an agent-ready pre-flight against a ticket-input envelope.
 *
 * A ticket fails to `refuse` when any of the LAT-61 structural
 * preconditions for invocation would fail (missing repo, missing budget
 * cap, sequencing-block unknown or blocked). It falls to `caution` when
 * the ticket is dispatchable but a quality signal is weak (e.g. an empty
 * `Out of scope` list is a refusal; a very short one is a caution).
 */
export function evaluateReadiness(
  input: ReadinessTicketInput,
): ReadinessReport {
  const reasons: ReadinessReason[] = [];
  const state: { verdict: ReadinessVerdict } = { verdict: "ready" };

  const push = (
    level: ReadinessVerdict,
    category: FailureCategory,
    message: string,
  ): void => {
    reasons.push({ category, message });
    state.verdict = worse(state.verdict, level);
  };

  // Goal check (agent-ready pre-flight item 1).
  if (typeof input.goal !== "string" || input.goal.trim().length === 0) {
    push(
      "refuse",
      "preflight_ticket_not_agent_ready",
      "Goal is missing; a one-sentence concrete outcome is required (agent-ready pre-flight §1).",
    );
  }

  // Scope bounded (pre-flight §2).
  if (input.scope_in.length === 0) {
    push(
      "refuse",
      "preflight_ticket_not_agent_ready",
      "Scope `In scope` is empty; populate at least one concrete item (agent-ready pre-flight §2).",
    );
  }
  if (input.scope_out.length === 0) {
    push(
      "refuse",
      "preflight_ticket_not_agent_ready",
      "Scope `Out of scope` is empty; an empty out-of-scope means the boundary was not thought about (agent-ready pre-flight §2).",
    );
  }

  // Acceptance criteria populated (pre-flight §3). Testability is a
  // judgement the readiness check cannot decide structurally; we check the
  // presence rule only and let the evaluator flag ladder violations later.
  if (input.acceptance_criteria.length === 0) {
    push(
      "refuse",
      "preflight_ticket_not_agent_ready",
      "Acceptance criteria list is empty (agent-ready pre-flight §3).",
    );
  }

  // Tests section populated (pre-flight §4).
  if (!input.has_tests_section) {
    push(
      "refuse",
      "preflight_ticket_not_agent_ready",
      "Tests section is missing; name the verification path for each acceptance criterion (agent-ready pre-flight §4).",
    );
  }

  // Sequencing block present and resolvable (pre-flight §5, ADR-0005).
  if (input.sequencing_status === "unknown") {
    push(
      "caution",
      "preflight_ticket_not_agent_ready",
      "`## Sequencing` block missing or unreadable; ADR-0005 fails safely to caution.",
    );
  } else if (input.sequencing_status === "blocked") {
    push(
      "refuse",
      "preflight_ticket_not_agent_ready",
      "Sequencing declares an unresolved hard blocker; return to refinement (ADR-0005).",
    );
  } else if (input.sequencing_status === "caution") {
    push(
      "caution",
      "preflight_ticket_not_agent_ready",
      "Sequencing declares dispatch_status=caution; surface the note to Ben before dispatch.",
    );
  }

  // Risk level classified (pre-flight §6).
  if (input.risk_level === null) {
    push(
      "refuse",
      "preflight_ticket_not_agent_ready",
      "Risk level not classified (agent-ready pre-flight §6); triage before dispatch.",
    );
  }

  // Budget cap set (pre-flight §7). Mirrors LAT-61 `missing_budget_cap`.
  if (
    typeof input.budget_cap_usd !== "number" ||
    !Number.isFinite(input.budget_cap_usd) ||
    input.budget_cap_usd <= 0
  ) {
    push(
      "refuse",
      "missing_budget_cap",
      "Budget cap missing or non-numeric (agent-ready pre-flight §7, ADR-0009).",
    );
  }

  // Repo target known (LAT-61 `missing_repo`). The readiness check catches
  // this early so the dispatcher does not hit the invocation-time refusal.
  if (
    typeof input.repo !== "string" ||
    !/^[\w.-]+\/[\w.-]+$/.test(input.repo)
  ) {
    push(
      "refuse",
      "missing_repo",
      'Target repo is missing or malformed (expected "owner/name" per ADR-0013).',
    );
  }

  const refusalMarkdown =
    state.verdict === "refuse" ? renderRefusalMarkdown(reasons) : null;

  return {
    verdict: state.verdict,
    reasons,
    refusal_markdown: refusalMarkdown,
  };
}

/**
 * Render the ticket-facing refusal block. Matches the
 * `## Pre-flight: REFUSED` template in `docs/templates/agent-ready-ticket.md`
 * so a dispatcher can post it verbatim into the Linear comment.
 */
function renderRefusalMarkdown(reasons: ReadonlyArray<ReadinessReason>): string {
  const lines: string[] = [];
  lines.push("## Pre-flight: REFUSED");
  lines.push("");
  lines.push("Failed checks:");
  for (const r of reasons) {
    lines.push(`- (${r.category}) ${r.message}`);
  }
  lines.push("");
  lines.push(
    "Action: return to `needs-refinement`. Do not mark `agent-ready` until all failed checks pass.",
  );
  return lines.join("\n");
}
