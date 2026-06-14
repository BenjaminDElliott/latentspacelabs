import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runPreRunGate,
  buildDefaultRules,
  buildPermissiveRules,
  branchMatches,
  repoApproved,
  type IsolationRules,
  type InvocationGateInput,
  type GateOutcome,
} from "./gates.js";

/* ------------------------------------------------------------------ */
/* Helper: build a minimal invocation for testing                     */
/* ------------------------------------------------------------------ */

function makeInput(
  partial: Partial<InvocationGateInput> = {},
): InvocationGateInput {
  return {
    agent_type: "coding",
    linear_issue_id: "LAT-186",
    autonomy_level: "L3-with-approval",
    approve: true,
    dry_run: false,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* branchMatches tests                                                */
/* ------------------------------------------------------------------ */

test("branchMatches: exact match", () => {
  assert.equal(branchMatches("main", ["main"]), true);
  assert.equal(branchMatches("main", ["main", "develop"]), true);
  assert.equal(branchMatches("develop", ["main"]), false);
});

test("branchMatches: prefix wildcard", () => {
  assert.equal(branchMatches("lat-186-fix", ["lat-*"]), true);
  assert.equal(branchMatches("lat-186-fix", ["feat-*"]), false);
  assert.equal(branchMatches("feature/abc", ["feature/*"]), true);
});

test("branchMatches: regex pattern", () => {
  assert.equal(branchMatches("release-1.0.0", ["/^release-.*$/"]), true);
  assert.equal(branchMatches("hotfix-001", ["/^release-.*$/"]), false);
});

test("branchMatches: wildcard matches everything", () => {
  assert.equal(branchMatches("anything", ["*"]), true);
  assert.equal(branchMatches("anything", ["*", "main"]), true);
});

test("branchMatches: empty patterns matches anything", () => {
  assert.equal(branchMatches("anything", []), true);
});

test("branchMatches: multiple patterns", () => {
  assert.equal(branchMatches("main", ["main", "develop", "staging"]), true);
  assert.equal(branchMatches("feature/x", ["main", "develop"]), false);
  assert.equal(branchMatches("feature/x", ["main", "develop", "feature/*"]), true);
});

test("branchMatches: invalid regex falls through", () => {
  // Malformed regex should not crash; falls through to next pattern.
  assert.equal(branchMatches("foo", ["[/invalid/", "bar"]), false);
  assert.equal(branchMatches("bar", ["[/invalid/", "bar"]), true);
});

/* ------------------------------------------------------------------ */
/* repoApproved tests                                                 */
/* ------------------------------------------------------------------ */

test("repoApproved: exact match", () => {
  assert.equal(repoApproved("owner/repo", ["owner/repo"]), true);
  assert.equal(repoApproved("owner/repo", ["other/repo"]), false);
});

test("repoApproved: wildcard", () => {
  assert.equal(repoApproved("any/thing", ["*"]), true);
});

test("repoApproved: owner wildcard", () => {
  assert.equal(repoApproved("owner/sub-repo", ["owner/*"]), true);
  assert.equal(repoApproved("owner/sub-repo", ["other/*"]), false);
});

test("repoApproved: empty list matches anything", () => {
  assert.equal(repoApproved("any/thing", []), true);
});

test("repoApproved: multiple patterns", () => {
  assert.equal(repoApproved("a/b", ["a/b", "c/d"]), true);
  assert.equal(repoApproved("c/d", ["a/b", "c/d"]), true);
  assert.equal(repoApproved("e/f", ["a/b", "c/d"]), false);
});

/* ------------------------------------------------------------------ */
/* Default rules sanity check                                         */
/* ------------------------------------------------------------------ */

test("buildDefaultRules: returns expected defaults", () => {
  const rules = buildDefaultRules();
  assert.equal(rules.max_autonomy_rank, 3);
  assert.equal(rules.require_budget_cap, true);
  assert.equal(rules.block_runaway_cost, true);
  assert.ok(rules.forbidden_actions.length > 0);
  assert.ok(rules.approved_repos.length > 0);
});

test("buildPermissiveRules: returns permissive defaults", () => {
  const rules = buildPermissiveRules();
  assert.equal(rules.max_autonomy_rank, 4);
  assert.equal(rules.require_budget_cap, false);
  assert.equal(rules.block_runaway_cost, false);
  assert.equal(rules.approved_repos.length, 0);
  assert.equal(rules.forbidden_branch_targets.length, 0);
  assert.equal(rules.forbidden_guardrails.length, 0);
});

/* ------------------------------------------------------------------ */
/* Gate: allowed — happy path                                         */
/* ------------------------------------------------------------------ */

test("gate allowed: minimal invocation with permissive rules", () => {
  const input = makeInput({ dry_run: true });
  const rules = buildPermissiveRules();
  const [outcome, evidence] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
  assert.ok(Array.isArray((outcome as { kind: "allowed"; hints: string[] }).hints));
  assert.equal(evidence.blockedBy.length, 0);
  assert.ok(evidence.rules.length > 0);
  assert.ok(evidence.evaluationId.length > 0);
  assert.ok(evidence.evaluatedAt.length > 0);
  assert.equal(evidence.issueIdentifier, "LAT-186");
  assert.ok(evidence.decision.startsWith("ALLOWED"));
});

test("gate allowed: L3 with approval and budget cap", () => {
  const input = makeInput({
    approve: true,
    budget_cap_usd: 5,
    dry_run: false,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate allowed: dry run bypasses autonomy and budget", () => {
  const input = makeInput({
    autonomy_level: "L4-autonomous",
    budget_cap_usd: null,
    dry_run: true,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate allowed: approved repo", () => {
  const input = makeInput({
    repo: "BenjaminDElliott/latentspacelabs",
    budget_cap_usd: 5,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate allowed: branch_target not in forbidden list", () => {
  const input = makeInput({
    branch_target: "feature/LAT-186-gate",
    budget_cap_usd: 5,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

/* ------------------------------------------------------------------ */
/* Gate: blocked — forbidden actions                                  */
/* ------------------------------------------------------------------ */

test("gate blocked: agent_type_forbidden", () => {
  const input = makeInput({ agent_type: "qa" });
  const rules = buildPermissiveRules();
  const [outcome, evidence] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.equal(blocked.blockedBy.length, 1);
  assert.equal(blocked.blockedBy[0].code, "agent_type_forbidden");
  assert.ok(evidence.decision.startsWith("BLOCKED"));
});

test("gate blocked: repo_forbidden", () => {
  const input = makeInput({ repo: "evil-org/evil-repo" });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some((a: { code: string }) => a.code === "repo_forbidden"),
  );
});

test("gate blocked: branch_target_forbidden", () => {
  const input = makeInput({ branch_target: "main" });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some((a: { code: string }) => a.code === "branch_target_forbidden"),
  );
});

test("gate blocked: branch_target_forbidden master", () => {
  const input = makeInput({ branch_target: "master" });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "blocked");
});

test("gate blocked: autonomy_exceeds_cap", () => {
  const input = makeInput({ autonomy_level: "L4-autonomous" });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some((a: { code: string }) => a.code === "autonomy_exceeds_cap"),
  );
});

test("gate allowed: autonomy_exceeds_cap bypassed for dry_run", () => {
  const input = makeInput({
    autonomy_level: "L4-autonomous",
    dry_run: true,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate blocked: budget_cap_missing", () => {
  const input = makeInput({ budget_cap_usd: null });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some((a: { code: string }) => a.code === "budget_cap_missing"),
  );
});

test("gate allowed: budget_cap_missing bypassed for dry_run", () => {
  const input = makeInput({ budget_cap_usd: null, dry_run: true });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate blocked: cost_band_runaway_risk", () => {
  const input = makeInput({ cost_band_observed: "runaway_risk" });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some((a: { code: string }) => a.code === "cost_band_runaway_risk"),
  );
});

test("gate allowed: cost_band_runaway_risk bypassed for dry_run", () => {
  const input = makeInput({
    cost_band_observed: "runaway_risk",
    dry_run: true,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate blocked: forbidden_ticket_context (guardrail match)", () => {
  const input = makeInput({
    guardrails: ["do not touch production secrets in /etc"],
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  assert.ok(
    blocked.blockedBy.some((a: { code: string }) => a.code === "forbidden_ticket_context"),
  );
});

test("gate allowed: guardrail with no forbidden substring", () => {
  const input = makeInput({
    guardrails: ["keep the code clean"],
    budget_cap_usd: 5,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate blocked: multiple forbidden actions simultaneously", () => {
  const input = makeInput({
    agent_type: "qa",
    repo: "evil/repo",
    branch_target: "main",
    autonomy_level: "L4-autonomous",
    budget_cap_usd: null,
    cost_band_observed: "runaway_risk",
    guardrails: ["do not touch production secrets"],
  });
  const rules = buildDefaultRules();
  const [outcome, evidence] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  // All seven forbidden actions should fire.
  assert.equal(blocked.blockedBy.length, 7);
  assert.ok(evidence.decision.startsWith("BLOCKED: 7"));
});

/* ------------------------------------------------------------------ */
/* Gate: evidence logging                                             */
/* ------------------------------------------------------------------ */

test("gate evidence: contains all required fields", () => {
  const input = makeInput();
  const rules = buildPermissiveRules();
  const [, evidence] = runPreRunGate(input, rules);

  assert.ok(typeof evidence.evaluationId === "string");
  assert.ok(evidence.evaluationId.length > 0);
  assert.equal(evidence.issueIdentifier, "LAT-186");
  assert.equal(evidence.invocation.agent_type, "coding");
  assert.ok(Array.isArray(evidence.rules));
  assert.ok(evidence.rules.length > 0);
  assert.ok(Array.isArray(evidence.blockedBy));
  assert.ok(Array.isArray(evidence.hints));
  assert.ok(typeof evidence.decision === "string");
  assert.ok(typeof evidence.evaluatedAt === "string");
  assert.ok(evidence.evaluatedAt.endsWith("Z")); // ISO-8601 UTC
});

test("gate evidence: rules list is populated", () => {
  const input = makeInput();
  const rules = buildPermissiveRules();
  const [, evidence] = runPreRunGate(input, rules);

  assert.equal(evidence.rules.length, 7); // agent_type, repo, branch_target, autonomy, budget, cost_band, guardrail
  assert.ok(evidence.rules.includes("agent_type_check"));
  assert.ok(evidence.rules.includes("repo_check"));
  assert.ok(evidence.rules.includes("branch_target_check"));
  assert.ok(evidence.rules.includes("autonomy_check"));
  assert.ok(evidence.rules.includes("budget_cap_check"));
  assert.ok(evidence.rules.includes("cost_band_check"));
  assert.ok(evidence.rules.includes("guardrail_check"));
});

test("gate evidence: allowed outcome has no blockedBy entries", () => {
  const input = makeInput({ dry_run: true });
  const rules = buildPermissiveRules();
  const [, evidence] = runPreRunGate(input, rules);

  assert.equal(evidence.blockedBy.length, 0);
  assert.ok(evidence.decision.startsWith("ALLOWED"));
});

test("gate evidence: blocked outcome has no hints", () => {
  const input = makeInput({ agent_type: "qa" });
  const rules = buildPermissiveRules();
  const [, evidence] = runPreRunGate(input, rules);

  assert.ok(evidence.blockedBy.length > 0);
  assert.equal(evidence.hints.length, 0);
  assert.ok(evidence.decision.startsWith("BLOCKED"));
});

/* ------------------------------------------------------------------ */
/* Gate: autonomy rank comparison                                     */
/* ------------------------------------------------------------------ */

test("gate allowed: L1 within L3 cap", () => {
  const input = makeInput({
    autonomy_level: "L1-read-only",
    budget_cap_usd: 5,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate allowed: L2 within L3 cap", () => {
  const input = makeInput({
    autonomy_level: "L2-propose",
    budget_cap_usd: 5,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate allowed: L3 within L3 cap", () => {
  const input = makeInput({
    autonomy_level: "L3-with-approval",
    budget_cap_usd: 5,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate blocked: L4 exceeds L3 cap", () => {
  const input = makeInput({ autonomy_level: "L4-autonomous" });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "blocked");
});

/* ------------------------------------------------------------------ */
/* Gate: dry-run behaviour                                            */
/* ------------------------------------------------------------------ */

test("gate: dry_run bypasses autonomy, budget, and cost band", () => {
  const input = makeInput({
    autonomy_level: "L4-autonomous",
    budget_cap_usd: null,
    cost_band_observed: "runaway_risk",
    dry_run: true,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate: dry_run still checks agent_type, repo, branch_target, guardrails", () => {
  const input = makeInput({
    agent_type: "qa",
    repo: "evil/repo",
    branch_target: "main",
    guardrails: ["do not touch production secrets"],
    dry_run: true,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "blocked");
  const blocked = outcome as { kind: "blocked"; blockedBy: unknown[] };
  // agent_type, repo, branch_target, and guardrail should all fire even for dry runs.
  assert.ok(
    blocked.blockedBy.some((a: { code: string }) => a.code === "agent_type_forbidden"),
  );
  assert.ok(
    blocked.blockedBy.some((a: { code: string }) => a.code === "repo_forbidden"),
  );
  assert.ok(
    blocked.blockedBy.some((a: { code: string }) => a.code === "branch_target_forbidden"),
  );
  assert.ok(
    blocked.blockedBy.some((a: { code: string }) => a.code === "forbidden_ticket_context"),
  );
});

/* ------------------------------------------------------------------ */
/* Gate: hints                                                        */
/* ------------------------------------------------------------------ */

test("gate allowed: hints include dry-run autonomy bypass note", () => {
  const input = makeInput({
    autonomy_level: "L4-autonomous",
    dry_run: true,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
  const allowed = outcome as { kind: "allowed"; hints: string[] };
  assert.ok(
    allowed.hints.some((h) => h.includes("dry_run=true")),
    "expected a hint about dry-run autonomy bypass",
  );
});

/* ------------------------------------------------------------------ */
/* Gate: edge cases                                                   */
/* ------------------------------------------------------------------ */

test("gate: optional fields can be undefined", () => {
  const input: InvocationGateInput = {
    agent_type: "coding",
    linear_issue_id: "LAT-186",
    autonomy_level: "L1-read-only",
    approve: false,
    dry_run: false,
    // repo, branch_target, branch_naming, budget_cap_usd,
    // cost_band_observed, guardrails, skill_name_and_version, run_id all omitted.
  };
  const rules = buildPermissiveRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate: null branch_naming is harmless", () => {
  const input = makeInput({ branch_naming: null });
  const rules = buildPermissiveRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate: null guardrails array is harmless", () => {
  const input = makeInput({
    guardrails: null,
    budget_cap_usd: 5,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate: empty guardrails array is harmless", () => {
  const input = makeInput({
    guardrails: [],
    budget_cap_usd: 5,
  });
  const rules = buildDefaultRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});

test("gate: branch_naming is not checked (only branch_target)", () => {
  // branch_naming is metadata; it should not trigger any gate rules.
  const input = makeInput({ branch_naming: "lat-<n>-<slug>" });
  const rules = buildPermissiveRules();
  const [outcome] = runPreRunGate(input, rules);

  assert.equal(outcome.kind, "allowed");
});
