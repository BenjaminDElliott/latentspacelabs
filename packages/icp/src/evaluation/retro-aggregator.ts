/**
 * Retro aggregator (PRD LAT-26 §6.4, ADR-0010).
 *
 * Reads a set of `AggregatableRun` records and surfaces the failure
 * categories that crossed the PRD's recurrence threshold (default ≥ 2 in
 * window per PRD §6.4). The aggregator never promotes on its own — it
 * emits candidate improvement work suggestions in ADR-0010's four-paths
 * vocabulary so the retro itself can decide promote-vs-archive.
 *
 * Post-LAT-61 scope guard (LAT-56 ticket): the aggregator does not infer
 * long-term patterns; it only counts what is in the current window. The
 * caller (retro skill, CLI harness) widens the window as it sees fit.
 */
import type {
  AggregatableRun,
  FailureCategory,
  RetroAggregationOptions,
  RetroAggregationResult,
  RetroCandidate,
} from "./contract.js";

/**
 * Suggest a promotion path per ADR-0010 for each failure category. The
 * paths are: prompt/template update, backlog item, ADR candidate, or
 * archive-with-rationale. The mapping below is conservative — harness
 * categories route to the narrowest path that still captures the root
 * cause so the retro surface stays small.
 */
const PROMOTION_BY_CATEGORY: Record<FailureCategory, string> = {
  none: "archive-with-rationale: clean run; no promotion needed.",

  // LAT-61 adapter-refusal categories — mostly prompt/template updates or
  // ADR candidates, because the recurrence usually means the dispatcher
  // doc or the ticket template is missing guidance the adapter now
  // enforces structurally.
  missing_approval:
    "prompt/template update: dispatcher skill must surface the approval-required rule more clearly.",
  unsupported_ticket_shape:
    "backlog item: widen adapter coverage or refuse earlier at readiness check.",
  missing_minimum_context:
    "prompt/template update: agent-ready ticket template must carry ticket title / summary / skill name.",
  missing_repo:
    "prompt/template update: dispatcher must require repo=owner/name on every invocation.",
  missing_budget_cap:
    "prompt/template update: agent-ready pre-flight must refuse tickets without numeric budget caps.",
  cost_runaway_risk:
    "ADR candidate: recurring runaway-cost observations warrant revisiting ADR-0009 cost bands.",
  provider_refused:
    "backlog item: investigate why the provider refused and whether the refusal is load-bearing.",
  provider_error:
    "backlog item: triage provider error class; possible provider adapter bug.",
  provider_timeout:
    "backlog item: extend timeout budget, split ticket scope, or switch provider.",
  provider_not_configured:
    "prompt/template update: runtime bootstrap docs must name the required provider config.",

  // Harness-added categories.
  missing_evidence_floor:
    "prompt/template update: code-producing agent prompt must include the ADR-0006 / ADR-0003 evidence requirements.",
  recommendation_ladder_violation:
    "prompt/template update: QA / PR-review agent prompt must reinforce the ADR-0007 severity ladder.",
  preflight_ticket_not_agent_ready:
    "prompt/template update: intake / refinement prompt must enforce agent-ready pre-flight before labelling.",
};

/**
 * Aggregate a window of runs into retro candidates. The algorithm is
 * deliberately simple: one pass, O(n), no ranking beyond occurrence count.
 * Tie-breaking is lexicographic on category name so output is stable under
 * test and across retro calls.
 */
export function aggregateRunsForRetro(
  runs: ReadonlyArray<AggregatableRun>,
  options: RetroAggregationOptions,
): RetroAggregationResult {
  const threshold =
    Number.isFinite(options.threshold) && options.threshold >= 1
      ? Math.floor(options.threshold)
      : 2;

  const byCategory = new Map<
    FailureCategory,
    { runIds: string[]; linearIds: string[]; seenLinear: Set<string> }
  >();

  for (const run of runs) {
    const cat = run.failure_category;
    if (cat === "none") continue; // never a pattern
    let bucket = byCategory.get(cat);
    if (!bucket) {
      bucket = { runIds: [], linearIds: [], seenLinear: new Set() };
      byCategory.set(cat, bucket);
    }
    bucket.runIds.push(run.run_id);
    if (!bucket.seenLinear.has(run.linear_issue_id)) {
      bucket.seenLinear.add(run.linear_issue_id);
      bucket.linearIds.push(run.linear_issue_id);
    }
  }

  const candidates: RetroCandidate[] = [];
  const archived: Array<{ category: FailureCategory; occurrences: number }> = [];

  const sortedCategories = [...byCategory.keys()].sort();
  for (const cat of sortedCategories) {
    const bucket = byCategory.get(cat);
    if (!bucket) continue;
    const occurrences = bucket.runIds.length;
    if (occurrences >= threshold) {
      candidates.push({
        category: cat,
        occurrences,
        run_ids: bucket.runIds,
        linear_issue_ids: bucket.linearIds,
        suggested_promotion: PROMOTION_BY_CATEGORY[cat],
      });
    } else {
      archived.push({ category: cat, occurrences });
    }
  }

  return {
    candidates,
    archived,
    total_runs: runs.length,
  };
}
