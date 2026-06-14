import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_CONTRACT_SCHEMA_VERSION,
  CODING_AGENT_SCHEMA_VERSION,
  QA_AGENT_SCHEMA_VERSION,
  PR_REVIEW_AGENT_SCHEMA_VERSION,
  SRE_AGENT_SCHEMA_VERSION,
  CODING_AGENT_EVIDENCE_CONTRACT,
  QA_AGENT_EVIDENCE_CONTRACT,
  PR_REVIEW_AGENT_EVIDENCE_CONTRACT,
  SRE_AGENT_EVIDENCE_CONTRACT,
  getEvidenceContract,
  validateCodingAgentInput,
  validateQAAgentInput,
  validatePRReviewAgentInput,
  validateSREAgentInput,
  checkEvidence,
  buildDefaultOutput,
  type AgentType,
} from "./agent-contracts.js";
import type { CodingAgentOutput } from "./agent-contracts.js";

/* ================================================================== */
/* Schema version tests                                                */
/* ================================================================== */

test("contract: schema versions are non-empty SemVer strings", () => {
  assert.match(AGENT_CONTRACT_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(CODING_AGENT_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(QA_AGENT_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(PR_REVIEW_AGENT_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(SRE_AGENT_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
});

/* ================================================================== */
/* Evidence contract constants                                         */
/* ================================================================== */

test("contract: coding agent evidence contract includes all LAT-8 fields", () => {
  assert.equal(CODING_AGENT_EVIDENCE_CONTRACT.summary, true);
  assert.equal(CODING_AGENT_EVIDENCE_CONTRACT.risks, true);
  assert.equal(CODING_AGENT_EVIDENCE_CONTRACT.recommendation, true);
  assert.equal(CODING_AGENT_EVIDENCE_CONTRACT.acceptanceCriteriaVerified, true);
  assert.equal(CODING_AGENT_EVIDENCE_CONTRACT.regressions, true);
  assert.equal(CODING_AGENT_EVIDENCE_CONTRACT.securityOrArchitectureConcerns, true);
  assert.equal(CODING_AGENT_EVIDENCE_CONTRACT.prCorrelation, true);
});

test("contract: qa agent evidence contract includes all LAT-8 fields", () => {
  assert.equal(QA_AGENT_EVIDENCE_CONTRACT.summary, true);
  assert.equal(QA_AGENT_EVIDENCE_CONTRACT.risks, true);
  assert.equal(QA_AGENT_EVIDENCE_CONTRACT.recommendation, true);
  assert.equal(QA_AGENT_EVIDENCE_CONTRACT.regressions, true);
  assert.equal(QA_AGENT_EVIDENCE_CONTRACT.securityOrArchitectureConcerns, true);
  assert.equal(QA_AGENT_EVIDENCE_CONTRACT.prCorrelation, true);
});

test("contract: pr-review agent evidence contract includes all LAT-8 fields", () => {
  assert.equal(PR_REVIEW_AGENT_EVIDENCE_CONTRACT.summary, true);
  assert.equal(PR_REVIEW_AGENT_EVIDENCE_CONTRACT.risks, true);
  assert.equal(PR_REVIEW_AGENT_EVIDENCE_CONTRACT.recommendation, true);
  assert.equal(PR_REVIEW_AGENT_EVIDENCE_CONTRACT.acceptanceCriteriaVerified, true);
  assert.equal(PR_REVIEW_AGENT_EVIDENCE_CONTRACT.regressions, true);
  assert.equal(PR_REVIEW_AGENT_EVIDENCE_CONTRACT.securityOrArchitectureConcerns, true);
  assert.equal(PR_REVIEW_AGENT_EVIDENCE_CONTRACT.prCorrelation, true);
});

test("contract: sre agent evidence contract includes LAT-8 fields", () => {
  assert.equal(SRE_AGENT_EVIDENCE_CONTRACT.summary, true);
  assert.equal(SRE_AGENT_EVIDENCE_CONTRACT.risks, true);
  assert.equal(SRE_AGENT_EVIDENCE_CONTRACT.recommendation, true);
  assert.equal(SRE_AGENT_EVIDENCE_CONTRACT.securityOrArchitectureConcerns, true);
  assert.equal(SRE_AGENT_EVIDENCE_CONTRACT.prCorrelation, true);
  // SRE does not require acceptanceCriteriaVerified or regressions
  assert.equal(SRE_AGENT_EVIDENCE_CONTRACT.acceptanceCriteriaVerified, undefined);
  assert.equal(SRE_AGENT_EVIDENCE_CONTRACT.regressions, undefined);
});

/* ================================================================== */
/* getEvidenceContract                                                 */
/* ================================================================== */

test("contract: getEvidenceContract returns contracts for known agent types", () => {
  assert.ok(getEvidenceContract("coding"));
  assert.ok(getEvidenceContract("qa"));
  assert.ok(getEvidenceContract("review"));
  assert.ok(getEvidenceContract("sre"));
});

test("contract: getEvidenceContract returns null for non-contract agent types", () => {
  assert.equal(getEvidenceContract("pm"), null);
  assert.equal(getEvidenceContract("research"), null);
  assert.equal(getEvidenceContract("observability"), null);
});

/* ================================================================== */
/* Coding agent input validation                                       */
/* ================================================================== */

test("coding: validates all required fields", () => {
  const result = validateCodingAgentInput({
    repo: "owner/repo",
    branch: "lat-123-feature",
    targetBranch: "main",
    buildCommand: "npm run build",
    testCommand: "npm test",
  });
  assert.equal(result.errors.length, 0);
});

test("coding: rejects empty repo", () => {
  const result = validateCodingAgentInput({
    repo: "",
    branch: "lat-123",
    targetBranch: "main",
    buildCommand: "npm run build",
    testCommand: "npm test",
  });
  assert.ok(result.errors.some((e) => e.field === "repo"));
});

test("coding: rejects malformed repo (not owner/name)", () => {
  const result = validateCodingAgentInput({
    repo: "owner",
    branch: "lat-123",
    targetBranch: "main",
    buildCommand: "npm run build",
    testCommand: "npm test",
  });
  assert.ok(result.errors.some((e) => e.field === "repo"));
});

test("coding: rejects empty branch", () => {
  const result = validateCodingAgentInput({
    repo: "owner/repo",
    branch: "",
    targetBranch: "main",
    buildCommand: "npm run build",
    testCommand: "npm test",
  });
  assert.ok(result.errors.some((e) => e.field === "branch"));
});

test("coding: rejects empty targetBranch", () => {
  const result = validateCodingAgentInput({
    repo: "owner/repo",
    branch: "lat-123",
    targetBranch: "",
    buildCommand: "npm run build",
    testCommand: "npm test",
  });
  assert.ok(result.errors.some((e) => e.field === "targetBranch"));
});

test("coding: rejects empty buildCommand", () => {
  const result = validateCodingAgentInput({
    repo: "owner/repo",
    branch: "lat-123",
    targetBranch: "main",
    buildCommand: "",
    testCommand: "npm test",
  });
  assert.ok(result.errors.some((e) => e.field === "buildCommand"));
});

test("coding: rejects empty testCommand", () => {
  const result = validateCodingAgentInput({
    repo: "owner/repo",
    branch: "lat-123",
    targetBranch: "main",
    buildCommand: "npm run build",
    testCommand: "",
  });
  assert.ok(result.errors.some((e) => e.field === "testCommand"));
});

test("coding: accepts valid autonomy levels", () => {
  for (const level of ["L1-read-only", "L2-propose", "L3-with-approval", "L4-autonomous"]) {
    const result = validateCodingAgentInput({
      repo: "owner/repo",
      branch: "lat-123",
      targetBranch: "main",
      buildCommand: "npm run build",
      testCommand: "npm test",
      autonomyLevel: level,
    });
    assert.equal(result.errors.length, 0, `autonomyLevel=${level} should be valid`);
  }
});

test("coding: rejects invalid autonomy level", () => {
  const result = validateCodingAgentInput({
    repo: "owner/repo",
    branch: "lat-123",
    targetBranch: "main",
    buildCommand: "npm run build",
    testCommand: "npm test",
    autonomyLevel: "L9-infinite" as any,
  });
  assert.ok(result.errors.some((e) => e.field === "autonomyLevel"));
});

test("coding: rejects negative budget cap", () => {
  const result = validateCodingAgentInput({
    repo: "owner/repo",
    branch: "lat-123",
    targetBranch: "main",
    buildCommand: "npm run build",
    testCommand: "npm test",
    budgetCapUsd: -1,
  });
  assert.ok(result.errors.some((e) => e.field === "budgetCapUsd"));
});

test("coding: accepts null budget cap", () => {
  const result = validateCodingAgentInput({
    repo: "owner/repo",
    branch: "lat-123",
    targetBranch: "main",
    buildCommand: "npm run build",
    testCommand: "npm test",
    budgetCapUsd: null,
  });
  assert.equal(result.errors.length, 0);
});

test("coding: accepts valid acceptance criteria", () => {
  const result = validateCodingAgentInput({
    repo: "owner/repo",
    branch: "lat-123",
    targetBranch: "main",
    buildCommand: "npm run build",
    testCommand: "npm test",
    acceptanceCriteria: ["Test 1", "Test 2"],
  });
  assert.equal(result.errors.length, 0);
});

test("coding: rejects empty acceptance criteria", () => {
  const result = validateCodingAgentInput({
    repo: "owner/repo",
    branch: "lat-123",
    targetBranch: "main",
    buildCommand: "npm run build",
    testCommand: "npm test",
    acceptanceCriteria: ["Test 1", "", "Test 3"],
  });
  assert.ok(result.errors.some((e) => e.field === "acceptanceCriteria[1]"));
});

test("coding: applies defaults for missing optional fields", () => {
  const result = validateCodingAgentInput({
    repo: "owner/repo",
    branch: "lat-123",
    targetBranch: "main",
    buildCommand: "npm run build",
    testCommand: "npm test",
  });
  assert.equal(result.errors.length, 0);
  assert.deepStrictEqual(result.value.acceptanceCriteria, []);
  assert.deepStrictEqual(result.value.filesInScope, []);
  assert.deepStrictEqual(result.value.filesForbidden, []);
  assert.deepStrictEqual(result.value.nonGoals, []);
  assert.deepStrictEqual(result.value.guardrails, []);
  assert.equal(result.value.budgetCapUsd, null);
  assert.equal(result.value.autonomyLevel, "L2-propose");
  assert.equal(result.value.codeDiff, "");
});

test("coding: accepts repo with dots and hyphens", () => {
  const result = validateCodingAgentInput({
    repo: "my-org.my-domain/my-repo-name",
    branch: "lat-123",
    targetBranch: "main",
    buildCommand: "npm run build",
    testCommand: "npm test",
  });
  assert.equal(result.errors.length, 0);
});

/* ================================================================== */
/* QA agent input validation                                           */
/* ================================================================== */

test("qa: validates required codingOutput", () => {
  const validOutput = {
    schemaVersion: CODING_AGENT_SCHEMA_VERSION,
    diff: "",
    buildStatus: { status: "passed", exitCode: 0, stdout: "", stderr: "", durationMs: 0 },
    testResults: { outcome: "passed", totalTests: 0, passed: 0, failed: 0, skipped: 0, errors: 0, durationMs: 0, tests: [] },
    lintResults: { status: "not_run", totalViolations: 0, errors: 0, warnings: 0, infos: 0, durationMs: 0, violations: [] },
    coverage: null,
    acceptanceCriteriaVerified: [],
    risks: [],
    regressions: [],
    securityOrArchitectureConcerns: [],
    recommendation: "approve" as const,
    summary: "ok",
  };
  const result = validateQAAgentInput({ codingOutput: validOutput });
  assert.equal(result.errors.length, 0);
});

test("qa: rejects missing codingOutput", () => {
  const result = validateQAAgentInput({});
  assert.ok(result.errors.some((e) => e.field === "codingOutput"));
});

test("qa: rejects wrong schema version in codingOutput", () => {
  const badOutput = {
    schemaVersion: "0.0.0",
    buildStatus: { status: "passed", exitCode: 0, stdout: "", stderr: "", durationMs: 0 },
    testResults: { outcome: "passed", totalTests: 0, passed: 0, failed: 0, skipped: 0, errors: 0, durationMs: 0, tests: [] },
  } as unknown as CodingAgentOutput;
  const result = validateQAAgentInput({ codingOutput: badOutput });
  assert.ok(result.errors.some((e) => e.field === "codingOutput.schemaVersion"));
});

test("qa: applies defaults for missing optional fields", () => {
  const validOutput = {
    schemaVersion: CODING_AGENT_SCHEMA_VERSION,
    diff: "",
    buildStatus: { status: "passed", exitCode: 0, stdout: "", stderr: "", durationMs: 0 },
    testResults: { outcome: "passed", totalTests: 0, passed: 0, failed: 0, skipped: 0, errors: 0, durationMs: 0, tests: [] },
    lintResults: { status: "not_run", totalViolations: 0, errors: 0, warnings: 0, infos: 0, durationMs: 0, violations: [] },
    coverage: null,
    acceptanceCriteriaVerified: [],
    risks: [],
    regressions: [],
    securityOrArchitectureConcerns: [],
    recommendation: "approve" as const,
    summary: "ok",
  };
  const result = validateQAAgentInput({ codingOutput: validOutput });
  assert.equal(result.errors.length, 0);
  assert.deepStrictEqual(result.value.acceptanceCriteria, []);
  assert.deepStrictEqual(result.value.knownFailingTests, []);
  assert.deepStrictEqual(result.value.guardrails, []);
  assert.equal(result.value.autonomyLevel, "L2-propose");
});

/* ================================================================== */
/* PR review agent input validation                                    */
/* ================================================================== */

test("review: accepts input with diff", () => {
  const result = validatePRReviewAgentInput({ diff: "--- a/file\n+++ b/file" });
  assert.equal(result.errors.length, 0);
});

test("review: accepts input with codingOutput", () => {
  const validOutput = {
    schemaVersion: CODING_AGENT_SCHEMA_VERSION,
    diff: "",
    buildStatus: { status: "passed", exitCode: 0, stdout: "", stderr: "", durationMs: 0 },
    testResults: { outcome: "passed", totalTests: 0, passed: 0, failed: 0, skipped: 0, errors: 0, durationMs: 0, tests: [] },
    lintResults: { status: "not_run", totalViolations: 0, errors: 0, warnings: 0, infos: 0, durationMs: 0, violations: [] },
    coverage: null,
    acceptanceCriteriaVerified: [],
    risks: [],
    regressions: [],
    securityOrArchitectureConcerns: [],
    recommendation: "approve" as const,
    summary: "ok",
  };
  const result = validatePRReviewAgentInput({ codingOutput: validOutput });
  assert.equal(result.errors.length, 0);
});

test("review: rejects input with neither diff nor codingOutput", () => {
  const result = validatePRReviewAgentInput({});
  assert.ok(result.errors.some((e) => e.field === "diff"));
});

test("review: applies defaults for missing optional fields", () => {
  const result = validatePRReviewAgentInput({ diff: "--- a/file\n+++ b/file" });
  assert.equal(result.errors.length, 0);
  assert.deepStrictEqual(result.value.acceptanceCriteria, []);
  assert.deepStrictEqual(result.value.changedFiles, []);
  assert.deepStrictEqual(result.value.guardrails, []);
  assert.deepStrictEqual(result.value.nonGoals, []);
  assert.equal(result.value.autonomyLevel, "L2-propose");
});

/* ================================================================== */
/* SRE agent input validation                                          */
/* ================================================================== */

test("sre: validates required fields", () => {
  const result = validateSREAgentInput({
    environment: "production",
    deployTarget: "v1.2.3",
  });
  assert.equal(result.errors.length, 0);
});

test("sre: rejects missing environment", () => {
  const result = validateSREAgentInput({ deployTarget: "v1.2.3" });
  assert.ok(result.errors.some((e) => e.field === "environment"));
});

test("sre: rejects invalid environment", () => {
  const result = validateSREAgentInput({
    environment: "beta",
    deployTarget: "v1.2.3",
  });
  assert.ok(result.errors.some((e) => e.field === "environment"));
});

test("sre: accepts all valid environments", () => {
  for (const env of ["production", "staging", "dev"]) {
    const result = validateSREAgentInput({
      environment: env,
      deployTarget: "v1.2.3",
    });
    assert.equal(result.errors.length, 0, `environment=${env} should be valid`);
  }
});

test("sre: rejects empty deployTarget", () => {
  const result = validateSREAgentInput({
    environment: "production",
    deployTarget: "",
  });
  assert.ok(result.errors.some((e) => e.field === "deployTarget"));
});

test("sre: rejects invalid strategy", () => {
  const result = validateSREAgentInput({
    environment: "production",
    deployTarget: "v1.2.3",
    strategy: "random" as any,
  });
  assert.ok(result.errors.some((e) => e.field === "strategy"));
});

test("sre: accepts all valid strategies", () => {
  for (const strat of ["rolling", "blue-green", "canary", "recreate"]) {
    const result = validateSREAgentInput({
      environment: "production",
      deployTarget: "v1.2.3",
      strategy: strat,
    });
    assert.equal(result.errors.length, 0, `strategy=${strat} should be valid`);
  }
});

test("sre: validates health checks", () => {
  const result = validateSREAgentInput({
    environment: "production",
    deployTarget: "v1.2.3",
    preHealthChecks: [
      { name: "http-health", type: "http", target: "https://example.com/health" },
      { name: "tcp-check", type: "tcp", target: "localhost:5432" },
      { name: "cmd-check", type: "command", target: "pg_isready" },
    ],
  });
  assert.equal(result.errors.length, 0);
});

test("sre: rejects health check with missing name", () => {
  const result = validateSREAgentInput({
    environment: "production",
    deployTarget: "v1.2.3",
    preHealthChecks: [
      { type: "http", target: "https://example.com/health" },
    ],
  });
  assert.ok(result.errors.some((e) => e.field === "preHealthChecks[0].name"));
});

test("sre: rejects health check with missing target", () => {
  const result = validateSREAgentInput({
    environment: "production",
    deployTarget: "v1.2.3",
    preHealthChecks: [
      { name: "check", type: "http", target: "" },
    ],
  });
  assert.ok(result.errors.some((e) => e.field === "preHealthChecks[0].target"));
});

test("sre: validates rollback config", () => {
  const result = validateSREAgentInput({
    environment: "production",
    deployTarget: "v1.2.3",
    rollbackConfig: {
      autoRollback: true,
      failureThreshold: 3,
      retryWaitSec: 30,
    },
  });
  assert.equal(result.errors.length, 0);
});

test("sre: rejects rollback with missing autoRollback", () => {
  const result = validateSREAgentInput({
    environment: "production",
    deployTarget: "v1.2.3",
    rollbackConfig: {
      autoRollback: "yes" as unknown as boolean,
    },
  });
  assert.ok(result.errors.some((e) => e.field === "rollbackConfig.autoRollback"));
});

test("sre: rejects rollback with negative failureThreshold", () => {
  const result = validateSREAgentInput({
    environment: "production",
    deployTarget: "v1.2.3",
    rollbackConfig: {
      autoRollback: true,
      failureThreshold: -1,
    },
  });
  assert.ok(result.errors.some((e) => e.field === "rollbackConfig.failureThreshold"));
});

test("sre: applies defaults for missing optional fields", () => {
  const result = validateSREAgentInput({
    environment: "production",
    deployTarget: "v1.2.3",
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.value.strategy, "rolling");
  assert.deepStrictEqual(result.value.preHealthChecks, []);
  assert.deepStrictEqual(result.value.postHealthChecks, []);
  assert.equal(result.value.rollbackConfig!.autoRollback, false);
  assert.equal(result.value.rollbackConfig!.failureThreshold, 3);
  assert.equal(result.value.rollbackConfig!.retryWaitSec, 30);
  assert.deepStrictEqual(result.value.guardrails, []);
  assert.deepStrictEqual(result.value.nonGoals, []);
  assert.equal(result.value.autonomyLevel, "L2-propose");
  assert.equal(result.value.skipSmokeTests, false);
});

/* ================================================================== */
/* checkEvidence                                                       */
/* ================================================================== */

test("evidence: coding agent output with all fields passes", () => {
  const output = buildDefaultOutput("coding");
  assert.ok(output && output.agentType === "coding");
  // Default output has all evidence fields present
  const missing = checkEvidence("coding", output);
  assert.equal(missing.length, 0, `Expected no missing evidence, got: ${missing.join(", ")}`);
});

test("evidence: qa agent output with all fields passes", () => {
  const output = buildDefaultOutput("qa");
  assert.ok(output && output.agentType === "qa");
  const missing = checkEvidence("qa", output);
  assert.equal(missing.length, 0, `Expected no missing evidence, got: ${missing.join(", ")}`);
});

test("evidence: review agent output with all fields passes", () => {
  const output = buildDefaultOutput("review");
  assert.ok(output && output.agentType === "review");
  const missing = checkEvidence("review", output);
  assert.equal(missing.length, 0, `Expected no missing evidence, got: ${missing.join(", ")}`);
});

test("evidence: sre agent output with all fields passes", () => {
  const output = buildDefaultOutput("sre");
  assert.ok(output && output.agentType === "sre");
  const missing = checkEvidence("sre", output);
  assert.equal(missing.length, 0, `Expected no missing evidence, got: ${missing.join(", ")}`);
});

test("evidence: non-contract agent types return empty missing list", () => {
  const missing = checkEvidence("pm", {
    agentType: "coding",
    output: {} as any,
  });
  assert.equal(missing.length, 0);
});

/* ================================================================== */
/* buildDefaultOutput                                                  */
/* ================================================================== */

test("default: builds coding agent output", () => {
  const output = buildDefaultOutput("coding");
  assert.ok(output);
  assert.equal(output.agentType, "coding");
  assert.equal(output.output.schemaVersion, CODING_AGENT_SCHEMA_VERSION);
  assert.equal(output.output.diff, "");
  assert.equal(output.output.buildStatus.status, "not_run");
  assert.equal(output.output.testResults.outcome, "not_run");
  assert.equal(output.output.lintResults.status, "not_run");
  assert.equal(output.output.coverage, null);
  assert.deepStrictEqual(output.output.acceptanceCriteriaVerified, []);
  assert.deepStrictEqual(output.output.risks, []);
  assert.deepStrictEqual(output.output.regressions, []);
  assert.deepStrictEqual(output.output.securityOrArchitectureConcerns, []);
  assert.equal(output.output.recommendation, "needs-human");
  assert.equal(output.output.summary, "default (empty)");
});

test("default: builds qa agent output", () => {
  const output = buildDefaultOutput("qa");
  assert.ok(output);
  assert.equal(output.agentType, "qa");
  assert.equal(output.output.schemaVersion, QA_AGENT_SCHEMA_VERSION);
  assert.deepStrictEqual(output.output.acceptanceCriteriaVerification, []);
  assert.deepStrictEqual(output.output.regressions, []);
  assert.equal(output.output.severityClassification.overall, "nit");
  assert.deepStrictEqual(output.output.risks, []);
  assert.deepStrictEqual(output.output.securityOrArchitectureConcerns, []);
  assert.equal(output.output.recommendation, "needs-human");
  assert.equal(output.output.summary, "default (empty)");
});

test("default: builds pr-review agent output", () => {
  const output = buildDefaultOutput("review");
  assert.ok(output);
  assert.equal(output.agentType, "review");
  assert.equal(output.output.schemaVersion, PR_REVIEW_AGENT_SCHEMA_VERSION);
  assert.deepStrictEqual(output.output.findings, []);
  assert.deepStrictEqual(output.output.acceptanceCriteriaVerified, []);
  assert.deepStrictEqual(output.output.regressions, []);
  assert.ok(output.output.approvalStatus);
  assert.deepStrictEqual(output.output.changeSummary, {
    description: "default (empty)",
    filesChanged: 0,
    changedFiles: [],
    additions: 0,
    deletions: 0,
    isBreaking: false,
    hasTests: false,
  });
  assert.deepStrictEqual(output.output.risks, []);
  assert.deepStrictEqual(output.output.securityOrArchitectureConcerns, []);
  assert.equal(output.output.recommendation, "needs-human");
  assert.equal(output.output.summary, "default (empty)");
});

test("default: builds sre agent output", () => {
  const output = buildDefaultOutput("sre");
  assert.ok(output);
  assert.equal(output.agentType, "sre");
  assert.equal(output.output.schemaVersion, SRE_AGENT_SCHEMA_VERSION);
  assert.equal(output.output.deployStatus, "in_progress");
  assert.deepStrictEqual(output.output.preHealthChecks, []);
  assert.deepStrictEqual(output.output.postHealthChecks, []);
  assert.equal(output.output.cost.costBand, "unknown");
  assert.equal(output.output.cost.spentUsd, null);
  assert.equal(output.output.cost.budgetCapUsd, null);
  assert.deepStrictEqual(output.output.risks, []);
  assert.deepStrictEqual(output.output.securityOrArchitectureConcerns, []);
  assert.equal(output.output.recommendation, "needs-human");
  assert.equal(output.output.summary, "default (empty)");
});

test("default: returns null for non-contract agent types", () => {
  assert.equal(buildDefaultOutput("pm"), null);
  assert.equal(buildDefaultOutput("research"), null);
  assert.equal(buildDefaultOutput("observability"), null);
});
