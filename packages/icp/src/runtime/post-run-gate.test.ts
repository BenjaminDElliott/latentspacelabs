import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runPostRunGate,
  buildDefaultPostRunRules,
  buildPermissivePostRunRules,
  type PostRunRules,
  type AgentInvocationRequest,
  type AgentInvocationResult,
  type PostRunGateOutcome,
} from "./post-run-gate.js";

/* ------------------------------------------------------------------ */
/* Helpers: build minimal invocation and result for testing            */
/* ------------------------------------------------------------------ */

function makeRequest(
  partial: Partial<AgentInvocationRequest> = {},
): AgentInvocationRequest {
  return {
    agent_type: "coding",
    linear_issue_id: "LAT-187",
    autonomy_level: "L3-with-approval",
    approve: true,
    dry_run: false,
    budget_cap_usd: 5,
    cost_band_observed: "normal",
    ...partial,
  };
}

function makeResult(
  partial: Partial<AgentInvocationResult> = {},
): AgentInvocationResult {
  return {
    exit_signal: "succeeded",
    pr_url: "https://github.com/example/repo/pull/42",
    pr_branch: "lat-187-fix",
    commit_sha: "abc123def456",
    cost_band: "normal",
    spent_usd: 2.5,
    cost_band_unavailable_reason: null,
    notes: [],
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Default rules sanity check                                         */
/* ------------------------------------------------------------------ */

test("buildDefaultPostRunRules: returns expected defaults", () => {
  const rules = buildDefaultPostRunRules();
  assert.equal(rules.max_spend_usd, 10);
  assert.equal(rules.enforce_side_effect_contract, true);
  assert.equal(rules.block_cost_band_escalation, true);
  assert.equal(rules.block_budget_overrun, true);
  assert.equal(rules.block_autonomy_escalation, true);
  assert.equal(rules.require_cost_band, true);
  assert.ok(rules.check_unexpected_merge);
  assert.ok(rules.check_unexpected_force_push);
  assert.ok(rules.check_unexpected_deploy);
});

test("buildPermissivePostRunRules: returns permissive defaults", () => {
  const rules = buildPermissivePostRunRules();
  assert.equal(rules.max_spend_usd, null);
  assert.equal(rules.enforce_side_effect_contract, false);
  assert.equal(rules.block_cost_band_escalation, false);
  assert.equal(rules.block_budget_overrun, false);
  assert.equal(rules.block_autonomy_escalation, false);
  assert.equal(rules.require_cost_band, false);
  assert.ok(!rules.check_unexpected_merge);
  assert.ok(!rules.check_unexpected_force_push);
  assert.ok(!rules.check_unexpected_deploy);
});

/* ------------------------------------------------------------------ */
/* Gate: allowed — happy path                                         */
/* ------------------------------------------------------------------ */

test("post-run gate allowed: minimal side-effecting run with permissive rules", () => {
  const request = makeRequest({ dry_run: true, budget_cap_usd: null });
  const result = makeResult({ cost_band: "normal", spent_usd: 0.5 });
  const rules = buildPermissivePostRunRules();
  const [outcome, evidence] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
  assert.ok(Array.isArray((outcome as { kind: "allowed"; hints: string[] }).hints));
  assert.equal(evidence.blockedBy.length, 0);
  assert.ok(evidence.rules.length > 0);
  assert.ok(evidence.evaluationId.length > 0);
  assert.ok(evidence.evaluatedAt.length > 0);
  assert.equal(evidence.issueIdentifier, "LAT-187");
  assert.ok(evidence.decision.startsWith("ALLOWED"));
});

test("post-run gate allowed: side-effecting run within budget", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    spent_usd: 2.5,
    cost_band: "normal",
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate allowed: dry run with no PR URL", () => {
  const request = makeRequest({ dry_run: true, budget_cap_usd: null });
  const result = makeResult({ pr_url: null, pr_branch: null });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate allowed: cost band stays same", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: "elevated",
  });
  const result = makeResult({
    cost_band: "elevated",
    spent_usd: 3,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

/* ------------------------------------------------------------------ */
/* Gate: cost-band escalation                                        */
/* ------------------------------------------------------------------ */

test("post-run gate blocked: cost_band escalated normal → elevated", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    cost_band: "elevated",
    spent_usd: 3,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "cost_band_escalated",
    ),
  );
});

test("post-run gate blocked: cost_band escalated normal → runaway_risk", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    cost_band: "runaway_risk",
    spent_usd: 4.5,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "cost_band_escalated",
    ),
  );
});

test("post-run gate blocked: cost_band escalated elevated → runaway_risk", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: "elevated",
  });
  const result = makeResult({
    cost_band: "runaway_risk",
    spent_usd: 4.8,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "cost_band_escalated",
    ),
  );
});

test("post-run gate allowed: cost_band escalation bypassed by permissive rules", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    cost_band: "runaway_risk",
    spent_usd: 4.5,
  });
  const rules = buildPermissivePostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

/* ------------------------------------------------------------------ */
/* Gate: cost exceeds budget                                         */
/* ------------------------------------------------------------------ */

test("post-run gate blocked: spent_usd exceeds budget_cap_usd", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    cost_band: "normal",
    spent_usd: 6,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "cost_exceeds_budget",
    ),
  );
});

test("post-run gate blocked: spent_usd equals budget_cap_usd", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    cost_band: "normal",
    spent_usd: 5,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
});

test("post-run gate allowed: spent_usd equals budget_cap_usd on budget cap boundary", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    cost_band: "normal",
    spent_usd: 4.99,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate allowed: no budget cap set", () => {
  const request = makeRequest({
    budget_cap_usd: null,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    cost_band: "normal",
    spent_usd: 100,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate allowed: budget overrun bypassed by permissive rules", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    cost_band: "normal",
    spent_usd: 100,
  });
  const rules = buildPermissivePostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

/* ------------------------------------------------------------------ */
/* Gate: side-effect contract                                        */
/* ------------------------------------------------------------------ */

test("post-run gate blocked: dry run produced a PR URL", () => {
  const request = makeRequest({
    dry_run: true,
    budget_cap_usd: null,
  });
  const result = makeResult({
    pr_url: "https://github.com/example/repo/pull/42",
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "unexpected_pr_url",
    ),
  );
});

test("post-run gate blocked: side-effecting run succeeded without PR URL", () => {
  const request = makeRequest({
    dry_run: false,
    budget_cap_usd: 5,
  });
  const result = makeResult({
    pr_url: null,
    pr_branch: null,
    exit_signal: "succeeded",
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "unexpected_pr_url",
    ),
  );
});

test("post-run gate allowed: side-effecting run with PR URL", () => {
  const request = makeRequest({
    dry_run: false,
    budget_cap_usd: 5,
  });
  const result = makeResult({
    pr_url: "https://github.com/example/repo/pull/42",
    pr_branch: "lat-187-fix",
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate allowed: side-effect contract bypassed by permissive rules", () => {
  const request = makeRequest({
    dry_run: true,
  });
  const result = makeResult({
    pr_url: "https://github.com/example/repo/pull/42",
  });
  const rules = buildPermissivePostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

/* ------------------------------------------------------------------ */
/* Gate: autonomy escalation                                         */
/* ------------------------------------------------------------------ */

test("post-run gate blocked: agent force-pushed at L3", () => {
  const request = makeRequest({
    autonomy_level: "L3-with-approval",
  });
  const result = makeResult({
    notes: ["force-push to feature/LAT-187-fix"],
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "autonomy_escalated",
    ),
  );
});

test("post-run gate blocked: agent merged PR at L2", () => {
  const request = makeRequest({ autonomy_level: "L2-propose" });
  const result = makeResult({
    notes: ["merged PR #42"],
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "autonomy_escalated",
    ),
  );
});

test("post-run gate blocked: agent deployed at L3", () => {
  const request = makeRequest({ autonomy_level: "L3-with-approval" });
  const result = makeResult({
    notes: ["deployed to staging"],
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "autonomy_escalated",
    ),
  );
});

test("post-run gate allowed: L4 agent merged PR (no escalation)", () => {
  const request = makeRequest({ autonomy_level: "L4-autonomous" });
  const result = makeResult({
    notes: ["merged PR #42"],
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate allowed: autonomy escalation bypassed by permissive rules", () => {
  const request = makeRequest({ autonomy_level: "L2-propose" });
  const result = makeResult({
    notes: ["merged PR #42"],
  });
  const rules = buildPermissivePostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

/* ------------------------------------------------------------------ */
/* Gate: missing cost band                                           */
/* ------------------------------------------------------------------ */

test("post-run gate blocked: missing cost band on side-effecting run", () => {
  const request = makeRequest({
    dry_run: false,
    budget_cap_usd: 5,
  });
  const result = makeResult({
    cost_band: "unknown",
    cost_band_unavailable_reason: null,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "missing_cost_band",
    ),
  );
});

test("post-run gate allowed: unknown cost band with reason", () => {
  const request = makeRequest({
    dry_run: false,
    budget_cap_usd: 5,
  });
  const result = makeResult({
    cost_band: "unknown",
    cost_band_unavailable_reason: "command provider returned no spend data",
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate allowed: missing cost band check bypassed for dry runs", () => {
  const request = makeRequest({
    dry_run: true,
    budget_cap_usd: null,
  });
  const result = makeResult({
    cost_band: "unknown",
    cost_band_unavailable_reason: null,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

/* ------------------------------------------------------------------ */
/* Gate: result status mismatch                                      */
/* ------------------------------------------------------------------ */

test("post-run gate blocked: needs_human with error notes on side-effecting run", () => {
  const request = makeRequest({
    dry_run: false,
    budget_cap_usd: 5,
  });
  const result = makeResult({
    exit_signal: "needs_human",
    notes: ["Error: provider refused to merge PR"],
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "result_status_mismatch",
    ),
  );
});

test("post-run gate allowed: needs_human without error notes", () => {
  const request = makeRequest({
    dry_run: false,
    budget_cap_usd: 5,
  });
  const result = makeResult({
    exit_signal: "needs_human",
    notes: ["Awaiting human review"],
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

/* ------------------------------------------------------------------ */
/* Gate: hints                                                       */
/* ------------------------------------------------------------------ */

test("post-run gate allowed: hints include budget proximity warning", () => {
  const request = makeRequest({
    budget_cap_usd: 10,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    cost_band: "normal",
    spent_usd: 8.5, // > 90% of cap, < 70% remaining
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
  const allowed = outcome as { kind: "allowed"; hints: string[] };
  assert.ok(
    allowed.hints.some((h) => h.includes("remaining")),
    "expected a budget proximity hint",
  );
});

test("post-run gate allowed: no hints when spend is well below cap", () => {
  const request = makeRequest({
    budget_cap_usd: 10,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    cost_band: "normal",
    spent_usd: 1,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
  const allowed = outcome as { kind: "allowed"; hints: string[] };
  assert.equal(allowed.hints.length, 0);
});

/* ------------------------------------------------------------------ */
/* Gate: evidence logging                                            */
/* ------------------------------------------------------------------ */

test("post-run gate evidence: contains all required fields", () => {
  const request = makeRequest();
  const result = makeResult();
  const rules = buildPermissivePostRunRules();
  const [, evidence] = runPostRunGate(request, result, rules);

  assert.ok(typeof evidence.evaluationId === "string");
  assert.ok(evidence.evaluationId.length > 0);
  assert.equal(evidence.issueIdentifier, "LAT-187");
  assert.equal(evidence.originalRequest.agent_type, "coding");
  assert.ok(Array.isArray(evidence.rules));
  assert.ok(evidence.rules.length > 0);
  assert.ok(Array.isArray(evidence.blockedBy));
  assert.ok(Array.isArray(evidence.hints));
  assert.ok(typeof evidence.decision === "string");
  assert.ok(typeof evidence.evaluatedAt === "string");
  assert.ok(evidence.evaluatedAt.endsWith("Z")); // ISO-8601 UTC
});

test("post-run gate evidence: rules list is populated", () => {
  const request = makeRequest();
  const result = makeResult();
  const rules = buildPermissivePostRunRules();
  const [, evidence] = runPostRunGate(request, result, rules);

  assert.ok(evidence.rules.includes("cost_band_check"));
  assert.ok(evidence.rules.includes("cost_exceeds_budget_check"));
  assert.ok(evidence.rules.includes("side_effect_contract_check"));
  assert.ok(evidence.rules.includes("autonomy_escalation_check"));
  assert.ok(evidence.rules.includes("missing_cost_band_check"));
  assert.ok(evidence.rules.includes("result_status_check"));
});

test("post-run gate evidence: allowed outcome has no blockedBy entries", () => {
  const request = makeRequest({ dry_run: true });
  const result = makeResult();
  const rules = buildPermissivePostRunRules();
  const [, evidence] = runPostRunGate(request, result, rules);

  assert.equal(evidence.blockedBy.length, 0);
  assert.ok(evidence.decision.startsWith("ALLOWED"));
});

test("post-run gate evidence: blocked outcome has no hints", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    cost_band: "runaway_risk",
    spent_usd: 100,
  });
  const rules = buildDefaultPostRunRules();
  const [, evidence] = runPostRunGate(request, result, rules);

  assert.ok(evidence.blockedBy.length > 0);
  assert.equal(evidence.hints.length, 0);
  assert.ok(evidence.decision.startsWith("BLOCKED"));
});

test("post-run gate evidence: decision message is descriptive", () => {
  const request = makeRequest({ linear_issue_id: "LAT-187" });
  const result = makeResult({ cost_band: "runaway_risk" });
  const rules = buildDefaultPostRunRules();
  const [, evidence] = runPostRunGate(request, result, rules);

  assert.ok(evidence.decision.includes("LAT-187"));
  assert.ok(evidence.decision.includes("cost_band_escalated"));
});

/* ------------------------------------------------------------------ */
/* Gate: multiple forbidden actions simultaneously                    */
/* ------------------------------------------------------------------ */

test("post-run gate blocked: multiple violations simultaneously", () => {
  const request = makeRequest({
    autonomy_level: "L2-propose",
    budget_cap_usd: 5,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    cost_band: "runaway_risk",
    spent_usd: 10,
    pr_url: "https://github.com/example/repo/pull/42",
    notes: ["force-push to main", "merged PR #42", "deployed to prod"],
  });
  const rules = buildDefaultPostRunRules();
  const [outcome, evidence] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(blocked.blockedBy.length > 0);
  // Should detect: cost_band_escalated, cost_exceeds_budget, autonomy_escalated
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "cost_band_escalated",
    ),
  );
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "cost_exceeds_budget",
    ),
  );
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "autonomy_escalated",
    ),
  );
  assert.ok(evidence.decision.startsWith("BLOCKED:"));
});

/* ------------------------------------------------------------------ */
/* Gate: dry-run behaviour                                           */
/* ------------------------------------------------------------------ */

test("post-run gate: dry_run bypasses budget, cost band, autonomy, cost band check", () => {
  const request = makeRequest({
    dry_run: true,
    budget_cap_usd: null,
    cost_band_observed: "normal",
    autonomy_level: "L2-propose",
  });
  const result = makeResult({
    pr_url: null,
    pr_branch: null,
    cost_band: "runaway_risk",
    spent_usd: 100,
    notes: ["force-push to main"],
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  // Should allow: dry runs don't need PR URL, cost band escalation
  // doesn't matter, autonomy escalation is fine for dry runs
  // (no side effects produced).
  assert.equal(outcome.kind, "allowed");
});

test("post-run gate: dry_run with PR URL is blocked (side-effect contract)", () => {
  const request = makeRequest({
    dry_run: true,
    budget_cap_usd: null,
  });
  const result = makeResult({
    pr_url: "https://github.com/example/repo/pull/42",
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
});

/* ------------------------------------------------------------------ */
/* Gate: edge cases                                                  */
/* ------------------------------------------------------------------ */

test("post-run gate: null budget cap and null spent is allowed", () => {
  const request = makeRequest({
    budget_cap_usd: null,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    spent_usd: null,
    cost_band: "normal",
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate: undefined budget cap and undefined spent is allowed", () => {
  const request = makeRequest({
    budget_cap_usd: undefined as unknown as number | null,
    cost_band_observed: "normal",
  });
  const result = makeResult({
    spent_usd: undefined as unknown as number | null,
    cost_band: "normal",
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate: null cost_band_observed doesn't trigger escalation", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: null as unknown as "normal" | "elevated" | "runaway_risk" | "unknown",
  });
  const result = makeResult({
    cost_band: "runaway_risk",
    spent_usd: 1,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate: empty notes array is harmless", () => {
  const request = makeRequest();
  const result = makeResult({ notes: [] });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate: notes with mixed case match", () => {
  const request = makeRequest({ autonomy_level: "L2-propose" });
  const result = makeResult({
    notes: ["PR merged via auto-merge"],
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some(
      (a: { code: string }) => a.code === "autonomy_escalated",
    ),
  );
});

test("post-run gate: unknown cost band at invocation doesn't trigger escalation", () => {
  const request = makeRequest({
    budget_cap_usd: 5,
    cost_band_observed: "unknown",
  });
  const result = makeResult({
    cost_band: "runaway_risk",
    spent_usd: 4,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate: failed exit signal doesn't trigger side-effect checks", () => {
  const request = makeRequest({
    dry_run: false,
    budget_cap_usd: 5,
  });
  const result = makeResult({
    exit_signal: "failed",
    pr_url: null,
    pr_branch: null,
    cost_band: "normal",
    spent_usd: 1,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate: cancelled exit signal doesn't trigger side-effect checks", () => {
  const request = makeRequest({
    dry_run: false,
    budget_cap_usd: 5,
  });
  const result = makeResult({
    exit_signal: "cancelled",
    pr_url: null,
    cost_band: "normal",
    spent_usd: 0,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

/* ------------------------------------------------------------------ */
/* Gate: originalRequest and result immutability                     */
/* ------------------------------------------------------------------ */

test("post-run gate: evidence.originalRequest is a copy, not shared reference", () => {
  const request = makeRequest();
  const result = makeResult();
  const rules = buildPermissivePostRunRules();
  const [, evidence] = runPostRunGate(request, result, rules);

  request.linear_issue_id = "MODIFIED";
  assert.equal(
    evidence.originalRequest.linear_issue_id,
    "LAT-187",
    "evidence should contain the original request value",
  );
});

test("post-run gate: evidence.result is a copy, not shared reference", () => {
  const request = makeRequest();
  const result = makeResult();
  const rules = buildPermissivePostRunRules();
  const [, evidence] = runPostRunGate(request, result, rules);

  result.cost_band = "runaway_risk" as "runaway_risk";
  assert.equal(
    evidence.result.cost_band,
    "normal",
    "evidence should contain the original result value",
  );
});

test("post-run gate: blockedBy and hints are frozen", () => {
  const request = makeRequest();
  const result = makeResult();
  const rules = buildPermissivePostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(evidence.blockedBy));
  assert.ok(Object.isFrozen(evidence.hints));
});

/* ------------------------------------------------------------------ */
/* Gate: L1 agent behaviour                                          */
/* ------------------------------------------------------------------ */

test("post-run gate allowed: L1 read-only agent succeeds", () => {
  const request = makeRequest({ autonomy_level: "L1-read-only" });
  const result = makeResult({
    cost_band: "normal",
    spent_usd: 0.5,
    pr_url: null,
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});

test("post-run gate allowed: L1 agent with L2 autonomy check still passes", () => {
  const request = makeRequest({ autonomy_level: "L1-read-only" });
  const result = makeResult({
    cost_band: "normal",
    spent_usd: 0.5,
    pr_url: "https://github.com/example/repo/pull/42",
  });
  const rules = buildDefaultPostRunRules();
  const [outcome] = runPostRunGate(request, result, rules);

  assert.equal(outcome.kind, "allowed");
});
