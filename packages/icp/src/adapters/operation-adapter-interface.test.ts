/**
 * Tests for the adapter interface specification (ADR-0022, LAT-170).
 *
 * Covers:
 *  - Type guards (isOperationError, isOperationState, isTerminalState).
 *  - Error construction (createOperationError).
 *  - Status formatting (formatStatus).
 *  - OperationState exhaustiveness (switch handles all 6 values).
 *
 * These are unit tests for the interface module itself, not for any
 * concrete adapter implementation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOperationError,
  isOperationState,
  isTerminalState,
  createOperationError,
  formatStatus,
  type OperationState,
  type OperationError,
  type OperationStatus,
} from "./operation-adapter-interface.js";

/* ------------------------------------------------------------------ */
/* Type guard tests                                                    */
/* ------------------------------------------------------------------ */

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

test("isOperationError accepts valid error objects", () => {
  const err = {
    kind: "failed" as const,
    message: "something broke",
    code: "HTTP_500",
    details: { retry_after: 30 },
  };
  assert.ok(isOperationError(err));
});

test("isOperationError accepts minimal error objects (no code, no details)", () => {
  const err = { kind: "timeout" as const, message: "timed out" };
  assert.ok(isOperationError(err));
});

test("isOperationError rejects objects missing required fields", () => {
  assert.ok(!isOperationError({ kind: "failed" as const }));
  assert.ok(!isOperationError({ message: "no kind" }));
  assert.ok(!isOperationError({ kind: "failed" as const, message: 123 }));
});

test("isOperationError rejects non-objects", () => {
  assert.ok(!isOperationError(null));
  assert.ok(!isOperationError(undefined));
  assert.ok(!isOperationError("error"));
  assert.ok(!isOperationError(42));
});

/* ------------------------------------------------------------------ */
/* Error construction tests                                            */
/* ------------------------------------------------------------------ */

test("createOperationError builds a complete error", () => {
  const err = createOperationError("disconnected", "Server unreachable", {
    code: "NET_001",
    details: { endpoint: "https://api.example.com" },
  });
  assert.equal(err.kind, "disconnected");
  assert.equal(err.message, "Server unreachable");
  assert.equal(err.code, "NET_001");
  assert.deepStrictEqual((err.details as { endpoint: string }).endpoint, "https://api.example.com");
});

test("createOperationError works without optional fields", () => {
  const err = createOperationError("not_found", "Handle not found");
  assert.equal(err.kind, "not_found");
  assert.equal(err.message, "Handle not found");
  assert.equal(err.code, undefined);
  assert.equal(err.details, undefined);
});

/* ------------------------------------------------------------------ */
/* Status formatting tests                                             */
/* ------------------------------------------------------------------ */

test("formatStatus renders a minimal status", () => {
  const status: OperationStatus = {
    handle: "op-1",
    state: "running",
    started_at: null,
    completed_at: null,
  };
  const formatted = formatStatus(status);
  assert.match(formatted, /handle=op-1/);
  assert.match(formatted, /state=running/);
});

test("formatStatus includes timestamps when present", () => {
  const status: OperationStatus = {
    handle: "op-2",
    state: "succeeded",
    started_at: "2026-06-14T00:00:00.000Z",
    completed_at: "2026-06-14T00:00:05.000Z",
  };
  const formatted = formatStatus(status);
  assert.match(formatted, /started=2026-06-14T00:00:00/);
  assert.match(formatted, /completed=2026-06-14T00:00:05/);
});

test("formatStatus includes error when present", () => {
  const status: OperationStatus = {
    handle: "op-3",
    state: "failed",
    started_at: "2026-06-14T00:00:00.000Z",
    completed_at: "2026-06-14T00:00:02.000Z",
    error: { kind: "failed", message: "something broke", code: "ERR_001" },
  };
  const formatted = formatStatus(status);
  assert.match(formatted, /error=failed: something broke/);
});

/* ------------------------------------------------------------------ */
/* OperationState exhaustiveness test                                  */
/* ------------------------------------------------------------------ */

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
        // Exhaustive check: `val` should be of type never
        const _exhaustive: never = state;
        void _exhaustive;
      }
    }
  }

  assert.deepStrictEqual(handled.sort(), states.sort());
});

/* ------------------------------------------------------------------ */
/* OperationError exhaustiveness test                                  */
/* ------------------------------------------------------------------ */

test("switch over OperationErrorCode handles all 6 values", () => {
  const codes: OperationError["kind"][] = [
    "not_found",
    "timeout",
    "cancelled",
    "failed",
    "disconnected",
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
