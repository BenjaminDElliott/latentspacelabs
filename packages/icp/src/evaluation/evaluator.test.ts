import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCodingRun } from "./evaluator.js";
import type { AgentInvocationResult } from "../runtime/contract.js";
import type { EvaluationRunInput, Severity } from "./contract.js";

function successResult(
  overrides: Partial<AgentInvocationResult> = {},
): AgentInvocationResult {
  return {
    exit_signal: "succeeded",
    pr_url: "https://github.com/owner/repo/pull/1",
    pr_branch: "lat-999-feature",
    commit_sha: "abc1234",
    cost_band: "normal",
    spent_usd: 1.25,
    cost_band_unavailable_reason: null,
    notes: ["coding provider command:agent ran for LAT-999"],
    ...overrides,
  };
}

function successInput(
  overrides: Partial<EvaluationRunInput> = {},
): EvaluationRunInput {
  return {
    run_id: "run_test",
    linear_issue_id: "LAT-999",
    agent_result: successResult(),
    claimed_recommendation: "approve-with-nits",
    has_run_report: true,
    has_linear_write_back: true,
    finding_severities: ["nit"],
    pr_url: "https://github.com/owner/repo/pull/1",
    run_report_path: "runs/run_test.md",
    linear_comment_url: "https://linear.app/.../comment/x",
    ...overrides,
  };
}

test("evaluator: clean success passes through the claimed recommendation", () => {
  const report = evaluateCodingRun(successInput());
  assert.equal(report.recommendation, "approve-with-nits");
  assert.equal(report.failure_category, "none");
  assert.equal(report.findings.length, 0);
  assert.equal(report.risks.length, 0);
  assert.equal(
    report.next_action,
    "author fixes nits then asks Ben for merge approval",
  );
});

test("evaluator: LAT-61 adapter refusal surfaces as a high-severity finding", () => {
  const result = successResult({
    exit_signal: "needs_human",
    pr_url: null,
    pr_branch: null,
    cost_band: "unknown",
    notes: [
      "coding-agent adapter refused (provider=command:x, reason=missing_budget_cap)",
      "Invocation for LAT-999 refused: no numeric Budget cap on the ticket.",
    ],
  });
  const report = evaluateCodingRun(
    successInput({
      agent_result: result,
      claimed_recommendation: null,
      has_linear_write_back: false,
    }),
  );
  assert.equal(report.failure_category, "missing_budget_cap");
  // High severity with null claim (no review artefact) defaults to needs-human.
  assert.equal(report.recommendation, "needs-human");
  assert.ok(report.findings.some((f) => f.category === "missing_budget_cap"));
});

test("evaluator: cost_band=runaway_risk escalates to needs-human", () => {
  const result = successResult({ cost_band: "runaway_risk" });
  const report = evaluateCodingRun(successInput({ agent_result: result }));
  assert.equal(report.recommendation, "needs-human");
  assert.equal(report.failure_category, "cost_runaway_risk");
  assert.ok(report.risks.includes("cost_band=runaway_risk"));
});

test("evaluator: below-floor succeeded run defaults to needs-human", () => {
  const report = evaluateCodingRun(
    successInput({
      has_run_report: false,
      has_linear_write_back: false,
      claimed_recommendation: "approve",
    }),
  );
  assert.equal(report.recommendation, "request-changes");
  assert.equal(report.failure_category, "missing_evidence_floor");
  assert.ok(
    report.findings.some((f) => f.category === "missing_evidence_floor"),
  );
});

test("evaluator: claim=approve with a high finding triggers ladder violation", () => {
  const highSeverities: ReadonlyArray<Severity> = ["high"];
  const report = evaluateCodingRun(
    successInput({
      claimed_recommendation: "approve",
      finding_severities: highSeverities,
    }),
  );
  assert.equal(
    report.failure_category,
    "recommendation_ladder_violation",
  );
  assert.equal(report.recommendation, "request-changes");
});

test("evaluator: claim=approve with a critical finding routes to needs-human", () => {
  const criticalSeverities: ReadonlyArray<Severity> = ["critical"];
  const report = evaluateCodingRun(
    successInput({
      claimed_recommendation: "approve",
      finding_severities: criticalSeverities,
    }),
  );
  assert.equal(report.recommendation, "needs-human");
  assert.ok(
    report.findings.some((f) => f.category === "recommendation_ladder_violation"),
  );
});

test("evaluator: failed exit with no structured refusal records provider_error", () => {
  const result = successResult({
    exit_signal: "failed",
    pr_url: null,
    pr_branch: null,
    cost_band: "unknown",
    notes: ["some opaque provider error trail"],
  });
  const report = evaluateCodingRun(
    successInput({
      agent_result: result,
      claimed_recommendation: null,
      has_linear_write_back: false,
    }),
  );
  assert.equal(report.failure_category, "provider_error");
  assert.equal(report.recommendation, "needs-human");
});

test("evaluator: evidence pointers passed through onto the report", () => {
  const report = evaluateCodingRun(successInput());
  assert.equal(
    report.evidence.pr_url,
    "https://github.com/owner/repo/pull/1",
  );
  assert.equal(report.evidence.run_report_path, "runs/run_test.md");
  assert.ok(report.evidence.linear_comment_url);
});

test("evaluator: null claim on succeeded run yields needs-human", () => {
  const report = evaluateCodingRun(
    successInput({ claimed_recommendation: null, finding_severities: [] }),
  );
  assert.equal(report.recommendation, "needs-human");
});
