/**
 * Tests for the provider-neutral adapter interface (LAT-162, ADR-0022).
 *
 * Covers:
 *   - Type guards (isRunError, isOperationState, isTerminalState,
 *     isRunStatus, isProviderType).
 *   - Error construction (createRunError).
 *   - Retryable kind detection (isRetryableKind).
 *   - Status and result formatting (formatStatus, formatResultSummary).
 *   - State exhaustiveness (switch handles all 6 OperationState values).
 *   - Error code exhaustiveness (switch handles all 9 RunErrorCode values).
 *   - Provider type exhaustiveness (switch handles all 7 ProviderType values).
 *   - Default evidence requirements validation.
 *
 * These are unit tests for the interface module itself, not for any
 * concrete adapter implementation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRunError,
  formatStatus,
  formatResultSummary,
  isRunError,
  isOperationState,
  isTerminalState,
  isRunStatus,
  isProviderType,
  isRetryableKind,
  type OperationState,
  type RunError,
  type RunStatus,
  type ProviderType,
  DEFAULT_EVIDENCE_REQUIREMENTS,
} from "./provider-adapter-interface.js";

/* ==================================================================== */
/*  Type guard tests                                                     */
/* ==================================================================== */

test("isOperationState accepts all valid states", () => {
  assert.ok(isOperationState("unknown"));
  assert.ok(isOperationState("running"));
  assert.ok(isOperationState("succeeded"));
  assert.ok(isOperationState("failed"));
  assert.ok(isOperationState("cancelled"));
  assert.ok(isOperationState("timeout"));
});

test("isOperationState rejects invalid strings", () => {
  assert.ok(!isOperationState("pending"));
  assert.ok(!isOperationState(""));
  assert.ok(!isOperationState("unknown "));
  assert.ok(!isOperationState("SUCCEEDED"));
});

test("isOperationState rejects non-strings", () => {
  assert.ok(!isOperationState(null));
  assert.ok(!isOperationState(undefined));
  assert.ok(!isOperationState(123));
  assert.ok(!isOperationState({}));
  assert.ok(!isOperationState([]));
});

test("isTerminalState identifies terminal states", () => {
  assert.ok(isTerminalState("succeeded"));
  assert.ok(isTerminalState("failed"));
  assert.ok(isTerminalState("cancelled"));
  assert.ok(isTerminalState("timeout"));
  assert.ok(!isTerminalState("unknown"));
  assert.ok(!isTerminalState("running"));
});

test("isRunError accepts valid error objects", () => {
  const err = {
    kind: "failed" as const,
    message: "something broke",
    retryable: true,
    code: "HTTP_500",
    details: { retry_after: 30 },
  };
  assert.ok(isRunError(err));
});

test("isRunError accepts minimal error objects (no code, no details)", () => {
  const err = { kind: "timeout" as const, message: "timed out", retryable: true };
  assert.ok(isRunError(err));
});

test("isRunError rejects objects missing required fields", () => {
  assert.ok(!isRunError({ kind: "failed" as const }));
  assert.ok(!isRunError({ message: "no kind" }));
  assert.ok(!isRunError({ kind: "failed" as const, message: 123 }));
  assert.ok(
    !isRunError({
      kind: "failed" as const,
      message: "no retryable",
    }),
  );
});

test("isRunError rejects non-objects", () => {
  assert.ok(!isRunError(null));
  assert.ok(!isRunError(undefined));
  assert.ok(!isRunError("error"));
  assert.ok(!isRunError(42));
});

test("isRunStatus accepts all valid statuses", () => {
  assert.ok(isRunStatus("succeeded"));
  assert.ok(isRunStatus("failed"));
  assert.ok(isRunStatus("cancelled"));
  assert.ok(isRunStatus("timeout"));
});

test("isRunStatus rejects invalid statuses", () => {
  assert.ok(!isRunStatus("pending"));
  assert.ok(!isRunStatus("in_progress"));
  assert.ok(!isRunStatus(""));
  assert.ok(!isRunStatus(null));
});

test("isProviderType accepts all valid provider types", () => {
  assert.ok(isProviderType("coding"));
  assert.ok(isProviderType("qa"));
  assert.ok(isProviderType("review"));
  assert.ok(isProviderType("sre"));
  assert.ok(isProviderType("pm"));
  assert.ok(isProviderType("research"));
  assert.ok(isProviderType("observability"));
});

test("isProviderType rejects invalid types", () => {
  assert.ok(!isProviderType("unknown_provider"));
  assert.ok(!isProviderType(""));
  assert.ok(!isProviderType(null));
  assert.ok(!isProviderType(undefined));
});

/* ==================================================================== */
/*  Error construction tests                                             */
/* ==================================================================== */

test("createRunError builds a complete error with all fields", () => {
  const err = createRunError("disconnected", "Server unreachable", {
    code: "NET_001",
    details: { endpoint: "https://api.example.com" },
    retryable: false,
  });
  assert.equal(err.kind, "disconnected");
  assert.equal(err.message, "Server unreachable");
  assert.equal(err.code, "NET_001");
  assert.deepStrictEqual(
    (err.details as { endpoint: string }).endpoint,
    "https://api.example.com",
  );
  assert.equal(err.retryable, false);
});

test("createRunError works without optional fields", () => {
  const err = createRunError("not_found", "Handle not found");
  assert.equal(err.kind, "not_found");
  assert.equal(err.message, "Handle not found");
  assert.equal(err.code, undefined);
  assert.equal(err.details, undefined);
  // not_found should not be retryable by default
  assert.equal(err.retryable, false);
});

test("createRunError auto-sets retryable to true for timeout", () => {
  const err = createRunError("timeout", "Timed out");
  assert.equal(err.retryable, true);
});

test("createRunError auto-sets retryable to true for internal_error", () => {
  const err = createRunError("internal_error", "Internal failure");
  assert.equal(err.retryable, true);
});

test("createRunError auto-sets retryable to false for invalid_input", () => {
  const err = createRunError("invalid_input", "Bad input");
  assert.equal(err.retryable, false);
});

/* ==================================================================== */
/*  Retryable kind detection tests                                       */
/* ==================================================================== */

test("isRetryableKind returns true for retryable kinds", () => {
  assert.ok(isRetryableKind("timeout"));
  assert.ok(isRetryableKind("disconnected"));
  assert.ok(isRetryableKind("internal_error"));
  assert.ok(isRetryableKind("unknown"));
});

test("isRetryableKind returns false for non-retryable kinds", () => {
  assert.ok(!isRetryableKind("not_found"));
  assert.ok(!isRetryableKind("cancelled"));
  assert.ok(!isRetryableKind("failed"));
  assert.ok(!isRetryableKind("permission_denied"));
  assert.ok(!isRetryableKind("invalid_input"));
});

/* ==================================================================== */
/*  Status formatting tests                                              */
/* ==================================================================== */

test("formatStatus renders a minimal status", () => {
  const status = {
    handle: "op-1",
    state: "running" as const,
    startedAt: null,
    completedAt: null,
    error: null,
  };
  const formatted = formatStatus(status);
  assert.match(formatted, /handle=op-1/);
  assert.match(formatted, /state=running/);
});

test("formatStatus includes timestamps when present", () => {
  const status = {
    handle: "op-2",
    state: "succeeded" as const,
    startedAt: "2026-06-14T00:00:00.000Z",
    completedAt: "2026-06-14T00:00:05.000Z",
    error: null,
  };
  const formatted = formatStatus(status);
  assert.match(formatted, /started=2026-06-14T00:00:00/);
  assert.match(formatted, /completed=2026-06-14T00:00:05/);
});

test("formatStatus includes error when present", () => {
  const error: RunError = {
    kind: "failed" as const,
    message: "something broke",
    code: "ERR_001",
    retryable: false,
  };
  const status: OperationStatus = {
    handle: "op-3",
    state: "failed",
    startedAt: "2026-06-14T00:00:00.000Z",
    completedAt: "2026-06-14T00:00:02.000Z",
    error,
  };
  const formatted = formatStatus(status);
  assert.match(formatted, /error=failed: something broke/);
});

test("formatResultSummary renders a minimal result summary", () => {
  const result: RunResult = {
    handle: "op-1",
    status: "succeeded",
    evidence: {
      acceptanceCriteria: [],
      build: null,
      tests: null,
      lint: null,
      coverage: null,
      risks: [],
      regressions: [],
      securityConcerns: [],
      recommendation: "approve",
    },
    artifacts: {},
    timing: { startedAt: null, completedAt: null, durationMs: 42 },
    costBand: null,
    costBandUnavailableReason: null,
    spentUsd: null,
    error: null,
    notes: ["test note"],
  };
  const formatted = formatResultSummary(result);
  assert.match(formatted, /handle=op-1/);
  assert.match(formatted, /status=succeeded/);
  assert.match(formatted, /durationMs=42/);
});

test("formatResultSummary includes error when present", () => {
  const result: RunResult = {
    handle: "op-2",
    status: "failed",
    evidence: {
      acceptanceCriteria: [],
      build: null,
      tests: null,
      lint: null,
      coverage: null,
      risks: [],
      regressions: [],
      securityConcerns: [],
      recommendation: "needs-human",
    },
    artifacts: {},
    timing: { startedAt: null, completedAt: null, durationMs: 100 },
    costBand: "normal" as const,
    costBandUnavailableReason: null,
    spentUsd: 0.05,
    error: { kind: "timeout" as const, message: "Timed out after 30s", retryable: true },
    notes: [],
  };
  const formatted = formatResultSummary(result);
  assert.match(formatted, /error=timeout: Timed out after 30s/);
  assert.match(formatted, /costBand=normal/);
});

/* ==================================================================== */
/*  Exhaustiveness tests                                                 */
/* ==================================================================== */

test("switch over OperationState handles all 6 values", () => {
  const states: OperationState[] = [
    "unknown",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "timeout",
  ];

  const handled: OperationState[] = [];

  for (const state of states) {
    switch (state) {
      case "unknown":
      case "running":
      case "succeeded":
      case "failed":
      case "cancelled":
      case "timeout":
        handled.push(state);
        break;
      default: {
        const _exhaustive: never = state;
        void _exhaustive;
      }
    }
  }

  assert.deepStrictEqual(handled.sort(), states.sort());
});

test("switch over RunErrorCode handles all 9 values", () => {
  const codes: RunError["kind"][] = [
    "not_found",
    "timeout",
    "cancelled",
    "failed",
    "disconnected",
    "permission_denied",
    "invalid_input",
    "internal_error",
    "unknown",
  ];

  const handled: string[] = [];

  for (const code of codes) {
    switch (code) {
      case "not_found":
      case "timeout":
      case "cancelled":
      case "failed":
      case "disconnected":
      case "permission_denied":
      case "invalid_input":
      case "internal_error":
      case "unknown":
        handled.push(code);
        break;
      default: {
        const _exhaustive: never = code;
        void _exhaustive;
      }
    }
  }

  assert.deepStrictEqual(handled.sort(), codes.sort());
});

test("switch over ProviderType handles all 7 values", () => {
  const types: ProviderType[] = [
    "coding",
    "qa",
    "review",
    "sre",
    "pm",
    "research",
    "observability",
  ];

  const handled: string[] = [];

  for (const t of types) {
    switch (t) {
      case "coding":
      case "qa":
      case "review":
      case "sre":
      case "pm":
      case "research":
      case "observability":
        handled.push(t);
        break;
      default: {
        const _exhaustive: never = t;
        void _exhaustive;
      }
    }
  }

  assert.deepStrictEqual(handled.sort(), types.sort());
});

test("switch over RunStatus handles all 4 values", () => {
  const statuses: RunStatus[] = ["succeeded", "failed", "cancelled", "timeout"];

  const handled: RunStatus[] = [];

  for (const status of statuses) {
    switch (status) {
      case "succeeded":
      case "failed":
      case "cancelled":
      case "timeout":
        handled.push(status);
        break;
      default: {
        const _exhaustive: never = status;
        void _exhaustive;
      }
    }
  }

  assert.deepStrictEqual(handled.sort(), statuses.sort());
});

/* ==================================================================== */
/*  Default evidence requirements validation                             */
/* ==================================================================== */

test("DEFAULT_EVIDENCE_REQUIREMENTS has the expected shape", () => {
  assert.strictEqual(DEFAULT_EVIDENCE_REQUIREMENTS.acceptanceCriteria, true);
  assert.strictEqual(DEFAULT_EVIDENCE_REQUIREMENTS.build, true);
  assert.strictEqual(DEFAULT_EVIDENCE_REQUIREMENTS.tests, true);
  assert.strictEqual(DEFAULT_EVIDENCE_REQUIREMENTS.lint, false);
  assert.strictEqual(DEFAULT_EVIDENCE_REQUIREMENTS.coverage, false);
  assert.strictEqual(DEFAULT_EVIDENCE_REQUIREMENTS.risks, true);
  assert.strictEqual(DEFAULT_EVIDENCE_REQUIREMENTS.regressions, true);
  assert.strictEqual(DEFAULT_EVIDENCE_REQUIREMENTS.securityConcerns, true);
  assert.strictEqual(DEFAULT_EVIDENCE_REQUIREMENTS.recommendation, true);
});

/* ==================================================================== */
/*  Type guard edge cases                                                */
/* ==================================================================== */

test("isRunError rejects object with retryable as string", () => {
  const obj = {
    kind: "failed",
    message: "test",
    retryable: "true" as unknown as boolean,
  };
  assert.ok(!isRunError(obj));
});

test("isRunError rejects object with retryable as number", () => {
  const obj = {
    kind: "failed",
    message: "test",
    retryable: 1 as unknown as boolean,
  };
  assert.ok(!isRunError(obj));
});
