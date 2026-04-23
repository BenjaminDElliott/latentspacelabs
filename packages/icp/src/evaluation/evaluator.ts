/**
 * Post-run evaluator (PRD LAT-26 §6.1, §6.2).
 *
 * Consumes a completed coding-agent run and produces an `EvaluationReport`
 * with a recommendation, a primary failure category, and the compact risk /
 * next-action summary the retro aggregator reads.
 *
 * The evaluator does not decide merge authority (PRD §2 goal 6, ADR-0007);
 * its recommendation is advisory. The `needs-human` recommendation is the
 * first-class "route to Ben" value, used whenever evidence floor is missing,
 * the ladder rules are violated, or the invocation adapter already returned
 * a refusal the skill could not resolve.
 */
import type {
  AgentInvocationResult,
} from "../runtime/contract.js";
import type {
  EvaluationFinding,
  EvaluationReport,
  EvaluationRunInput,
  FailureCategory,
  Recommendation,
  Severity,
} from "./contract.js";

/** ADR-0007 severity rank; `critical` is worst. */
const SEVERITY_RANK: Record<Severity, number> = {
  nit: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function worstSeverity(
  findings: ReadonlyArray<EvaluationFinding>,
): Severity | null {
  let worst: Severity | null = null;
  for (const f of findings) {
    if (worst === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst]) {
      worst = f.severity;
    }
  }
  return worst;
}

/**
 * Evaluate a completed coding-agent run and produce the harness envelope.
 *
 * The evaluator is deliberately structural: it reads the agent result, the
 * claimed recommendation, and the evidence flags, and never parses free-text
 * report bodies. That keeps it deterministic under test and gives retro
 * aggregation a stable category vocabulary.
 */
export function evaluateCodingRun(
  input: EvaluationRunInput,
): EvaluationReport {
  const findings: EvaluationFinding[] = [];
  const risks: string[] = [];

  // 1) Invocation-time refusals map straight onto the harness vocabulary.
  //    The adapter emitted a `notes[0]` that starts with
  //    "coding-agent adapter refused (provider=..., reason=X)"; we match the
  //    reason token so the evaluation category matches what LAT-61 recorded.
  const refusalCategory = extractAdapterRefusalCategory(input.agent_result);
  if (refusalCategory) {
    findings.push({
      severity: refusalCategory === "cost_runaway_risk" ? "critical" : "high",
      category: refusalCategory,
      message: `Invocation adapter refused: ${refusalCategory}.`,
    });
  }

  // 2) Exit-signal-driven findings when no structured refusal was surfaced.
  if (!refusalCategory) {
    switch (input.agent_result.exit_signal) {
      case "failed":
        findings.push({
          severity: "high",
          category: "provider_error",
          message: "Coding agent exit_signal=failed with no structured refusal category.",
        });
        break;
      case "needs_human":
        findings.push({
          severity: "medium",
          category: "provider_refused",
          message: "Coding agent exit_signal=needs_human; human decision required.",
        });
        break;
      case "cancelled":
        findings.push({
          severity: "low",
          category: "provider_refused",
          message: "Coding agent exit_signal=cancelled; no further action required.",
        });
        break;
      case "succeeded":
        // No finding; fall through to the evidence-floor checks below.
        break;
    }
  }

  // 3) Cost-band risks surface regardless of exit signal.
  const band = input.agent_result.cost_band;
  if (band === "elevated" || band === "runaway_risk") {
    risks.push(`cost_band=${band}`);
    if (band === "runaway_risk") {
      findings.push({
        severity: "critical",
        category: "cost_runaway_risk",
        message: "Cost band observed as runaway_risk; ADR-0009 requires Ben approval.",
      });
    }
  }

  // 4) Evidence floor (PRD §6.2). A succeeded run that did not produce the
  //    ADR-0006 run report or ADR-0003 write-back is below the floor and
  //    defaults to `needs-human` regardless of what recommendation the QA
  //    / review agent claimed.
  if (input.agent_result.exit_signal === "succeeded") {
    if (!input.has_run_report) {
      findings.push({
        severity: "high",
        category: "missing_evidence_floor",
        message:
          "ADR-0006 run report not produced; evidence floor (PRD LAT-26 §6.2) not met.",
      });
    }
    if (!input.has_linear_write_back) {
      findings.push({
        severity: "high",
        category: "missing_evidence_floor",
        message:
          "ADR-0003 Linear write-back not posted; evidence floor (PRD LAT-26 §6.2) not met.",
      });
    }
  }

  // 5) Recommendation-ladder rules (ADR-0007 / PRD §6.2). A claimed
  //    recommendation that contradicts the severity ladder is itself a
  //    harness finding; the harness downgrades to `needs-human` rather than
  //    silently rubber-stamping.
  const claimed = input.claimed_recommendation;
  const worstFinding = worstClaimedFindingSeverity(input.finding_severities);
  const ladderViolation = detectLadderViolation(claimed, worstFinding);
  if (ladderViolation) {
    findings.push({
      // A ladder violation that originates in a `critical` finding carries
      // the `critical` severity itself, so ADR-0007's "critical → needs-human"
      // rule is enforced even when the harness-side finding is the violation
      // rather than the underlying critical.
      severity: worstFinding === "critical" ? "critical" : "high",
      category: "recommendation_ladder_violation",
      message: ladderViolation,
    });
  }

  // 6) Derive the final recommendation. Priority:
  //    a) Any `critical` harness finding → `needs-human`.
  //    b) Any `high` harness finding → `request-changes` (or `needs-human`
  //       when the claim was null, meaning no review artefact exists).
  //    c) Claimed recommendation consistent with the ladder → pass-through.
  //    d) Null claim on a succeeded run → `needs-human` (evidence missing).
  const worstHarness = worstSeverity(findings);
  let finalRec: Recommendation;
  if (worstHarness === "critical") {
    finalRec = "needs-human";
  } else if (worstHarness === "high") {
    finalRec = claimed === null ? "needs-human" : "request-changes";
  } else if (input.agent_result.exit_signal !== "succeeded") {
    finalRec = "needs-human";
  } else if (claimed === null) {
    finalRec = "needs-human";
  } else {
    finalRec = claimed;
  }

  // 7) Primary failure category for retro aggregation. On a clean run with
  //    no findings and no refusal, the category is `none`. Otherwise pick
  //    the category of the worst-severity finding, ties broken by order of
  //    appearance so adapter refusals beat evidence-floor issues (adapter
  //    refusals are usually the root cause).
  const primary: FailureCategory = primaryCategory(findings);

  // 8) Next action. The harness emits a short ADR-0003-shaped string.
  const nextAction = nextActionFor(finalRec, primary);

  return {
    run_id: input.run_id,
    linear_issue_id: input.linear_issue_id,
    recommendation: finalRec,
    failure_category: primary,
    findings,
    risks,
    evidence: {
      pr_url: input.pr_url,
      run_report_path: input.run_report_path,
      linear_comment_url: input.linear_comment_url,
    },
    next_action: nextAction,
  };
}

/**
 * Inspect the adapter notes for the LAT-61 refusal prefix. The adapter
 * emits `coding-agent adapter refused (provider=<id>, reason=<kind>)` as
 * the first note on every refusal, so a simple prefix match is enough; we
 * do not parse free-text bodies.
 */
function extractAdapterRefusalCategory(
  result: AgentInvocationResult,
): FailureCategory | null {
  const first = result.notes[0];
  if (typeof first !== "string") return null;
  const match = /reason=([a-z_]+)\)/i.exec(first);
  if (!match) return null;
  const reason = match[1];
  if (typeof reason !== "string") return null;
  if (!isKnownFailureCategory(reason)) return null;
  return reason;
}

function isKnownFailureCategory(v: string): v is FailureCategory {
  return (
    v === "none" ||
    v === "missing_approval" ||
    v === "unsupported_ticket_shape" ||
    v === "missing_minimum_context" ||
    v === "missing_repo" ||
    v === "missing_budget_cap" ||
    v === "cost_runaway_risk" ||
    v === "provider_refused" ||
    v === "provider_error" ||
    v === "provider_timeout" ||
    v === "provider_not_configured" ||
    v === "missing_evidence_floor" ||
    v === "recommendation_ladder_violation" ||
    v === "preflight_ticket_not_agent_ready"
  );
}

function worstClaimedFindingSeverity(
  severities: ReadonlyArray<Severity>,
): Severity | null {
  let worst: Severity | null = null;
  for (const s of severities) {
    if (worst === null || SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  }
  return worst;
}

/**
 * ADR-0007 ladder rules expressed as a predicate. Returns a message when
 * the claimed recommendation contradicts the findings, `null` when
 * consistent or when the claim is `null` (no review artefact).
 */
function detectLadderViolation(
  claimed: Recommendation | null,
  worstFinding: Severity | null,
): string | null {
  if (claimed === null) return null;
  if (worstFinding === null) return null;
  // Rule: any high/critical finding forbids approve variants.
  if (worstFinding === "high" || worstFinding === "critical") {
    if (claimed === "approve" || claimed === "approve-with-nits") {
      return `Findings include ${worstFinding} severity but recommendation is ${claimed}; ADR-0007 requires request-changes/block-merge/needs-human.`;
    }
  }
  // Rule: any critical finding routes to needs-human regardless.
  if (worstFinding === "critical" && claimed !== "needs-human") {
    return `Critical finding present; ADR-0007 requires recommendation=needs-human (was ${claimed}).`;
  }
  return null;
}

function primaryCategory(
  findings: ReadonlyArray<EvaluationFinding>,
): FailureCategory {
  if (findings.length === 0) return "none";
  let worst: EvaluationFinding | null = null;
  for (const f of findings) {
    if (worst === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst.severity]) {
      worst = f;
    }
  }
  return worst ? worst.category : "none";
}

function nextActionFor(rec: Recommendation, cat: FailureCategory): string {
  switch (rec) {
    case "approve":
      return "ask Ben for merge approval";
    case "approve-with-nits":
      return "author fixes nits then asks Ben for merge approval";
    case "request-changes":
      return `address findings (${cat}) and resubmit`;
    case "block-merge":
      return `resolve blocking finding (${cat}) before merge`;
    case "needs-human":
      return `route to Ben: ${cat}`;
  }
}
