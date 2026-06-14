import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ISOLATION_MATRIX,
  getBoundary,
  canWrite,
  canRead,
  hasNetworkAccess,
  type IsolationBoundary,
} from "./isolation-matrix.js";
import type { AgentType } from "../runtime/contract.js";

/* ------------------------------------------------------------------ */
/* Known agent types (must match the enum in runtime/contract.ts)     */
/* ------------------------------------------------------------------ */

const KNOWN_AGENT_TYPES: AgentType[] = [
  "coding",
  "qa",
  "review",
  "sre",
  "pm",
  "research",
  "observability",
];

/* ------------------------------------------------------------------ */
/* Test suite                                                         */
/* ------------------------------------------------------------------ */

test("ISOLATION_MATRIX has a boundary for every known agent type", () => {
  for (const type of KNOWN_AGENT_TYPES) {
    assert.ok(
      ISOLATION_MATRIX.has(type),
      `Missing boundary for agent type: ${type}`,
    );
  }
});

test("ISOLATION_MATRIX does not have boundaries for unknown types", () => {
  for (const key of ISOLATION_MATRIX.keys()) {
    assert.ok(
      KNOWN_AGENT_TYPES.includes(key as AgentType),
      `Unknown agent type in matrix: ${key}`,
    );
  }
});

test("ISOLATION_MATRIX has exactly 7 entries", () => {
  assert.equal(ISOLATION_MATRIX.size, 7);
});

test("getBoundary returns the boundary for a known agent type", () => {
  const boundary = getBoundary("coding");
  assert.equal(boundary.agentType, "coding");
});

test("getBoundary throws for an unknown agent type", () => {
  const unknownType = "nonexistent" as AgentType;
  assert.throws(
    () => getBoundary(unknownType),
    /Agent type "nonexistent" is not defined in the isolation matrix/,
  );
});

/* ------------------------------------------------------------------ */
/* Per-type boundary validation                                       */
/* ------------------------------------------------------------------ */

function assertBoundary(
  name: string,
  boundary: IsolationBoundary,
  opts: {
    secretsCount: number;
    canWrite: boolean;
    canDeploy: boolean;
    canWriteLinear: boolean;
    networkCount: number;
    filesystemCount: number;
  },
) {
  test(`boundary: ${name}`, () => {
    assert.equal(boundary.agentType, name);
    assert.equal(boundary.secrets.length, opts.secretsCount);
    assert.equal(boundary.canModifyBranch, opts.canWrite);
    assert.equal(boundary.canDeploy, opts.canDeploy);
    assert.equal(boundary.canWriteLinear, opts.canWriteLinear);
    assert.equal(boundary.network.length, opts.networkCount);
    assert.equal(boundary.filesystem.length, opts.filesystemCount);
    assert.ok(typeof boundary.summary === "string");
    assert.ok(boundary.summary.length > 0);
    assert.ok(boundary.autonomyLevel);
  });
}

assertBoundary("coding", getBoundary("coding"), {
  secretsCount: 2, // S1 (Linear), S2 (GitHub)
  canWrite: true,
  canRead: true,
  canDeploy: false,
  canWriteLinear: true,
  networkCount: 3, // GitHub, Linear, MCP
  filesystemCount: 3, // read root, read .env, write files-in-scope
});

assertBoundary("qa", getBoundary("qa"), {
  secretsCount: 2, // S1 (Linear), S5 (deploy URL)
  canWrite: false,
  canDeploy: false,
  canWriteLinear: true,
  networkCount: 2, // deploy URL, Linear
  filesystemCount: 4, // read root, read runs/, read test-results/, write test-results/
});

assertBoundary("review", getBoundary("review"), {
  secretsCount: 2, // S1 (Linear), S2 (GitHub read-only)
  canWrite: false,
  canDeploy: false,
  canWriteLinear: true,
  networkCount: 2, // GitHub, Linear
  filesystemCount: 2, // read root, write pr-review-report.md
});

assertBoundary("sre", getBoundary("sre"), {
  secretsCount: 3, // S1 (Linear), S2 (GitHub), S5 (cloud provider)
  canWrite: false,
  canDeploy: true,
  canWriteLinear: true,
  networkCount: 4, // cloud provider, deploy pipeline, monitoring, database
  filesystemCount: 3, // read root, read infra-config/, write infra-status/
});

assertBoundary("pm", getBoundary("pm"), {
  secretsCount: 1, // S1 (Linear)
  canWrite: false,
  canDeploy: false,
  canWriteLinear: true,
  networkCount: 1, // Linear
  filesystemCount: 2, // read root, write pm/
});

assertBoundary("research", getBoundary("research"), {
  secretsCount: 3, // S1 (Linear), S4 (Perplexity), S4 (Anthropic)
  canWrite: false,
  canDeploy: false,
  canWriteLinear: true,
  networkCount: 3, // Perplexity, Anthropic, external URLs (*)
  filesystemCount: 2, // read root, write research/
});

assertBoundary("observability", getBoundary("observability"), {
  secretsCount: 2, // S1 (Linear), S5 (telemetry)
  canWrite: false,
  canDeploy: false,
  canWriteLinear: true,
  networkCount: 2, // telemetry backend, Linear
  filesystemCount: 3, // read root, read runs/, write observability/
});

/* ------------------------------------------------------------------ */
/* Query helper tests                                                 */
/* ------------------------------------------------------------------ */

test("canWrite: coding can write to any path (files-in-scope resolves to root)", () => {
  const boundary = getBoundary("coding");
  assert.equal(canWrite(boundary, "any/path/file.ts"), true);
});

test("canWrite: qa can write to test-results/", () => {
  const boundary = getBoundary("qa");
  assert.equal(canWrite(boundary, "test-results/report.json"), true);
});

test("canWrite: qa cannot write to src/", () => {
  const boundary = getBoundary("qa");
  assert.equal(canWrite(boundary, "src/main.ts"), false);
});

test("canWrite: review can write to pr-review-report.md", () => {
  const boundary = getBoundary("review");
  assert.equal(canWrite(boundary, "pr-review-report.md"), true);
});

test("canWrite: review cannot write to src/", () => {
  const boundary = getBoundary("review");
  assert.equal(canWrite(boundary, "src/main.ts"), false);
});

test("canWrite: sre can write to infra-status/", () => {
  const boundary = getBoundary("sre");
  assert.equal(canWrite(boundary, "infra-status/deploy-status.json"), true);
});

test("canWrite: sre cannot write to src/", () => {
  const boundary = getBoundary("sre");
  assert.equal(canWrite(boundary, "src/main.ts"), false);
});

test("canRead: all agents can read root", () => {
  for (const type of KNOWN_AGENT_TYPES) {
    const boundary = getBoundary(type);
    assert.equal(canRead(boundary, "src/main.ts"), true);
  }
});

test("hasNetworkAccess: coding can reach GitHub, Linear, and MCP", () => {
  const boundary = getBoundary("coding");
  assert.equal(hasNetworkAccess(boundary, "api.github.com"), true);
  assert.equal(hasNetworkAccess(boundary, "api.linear.app"), true);
  assert.equal(hasNetworkAccess(boundary, "perplexity.mcp"), true);
});

test("hasNetworkAccess: coding cannot reach cloud provider APIs", () => {
  const boundary = getBoundary("coding");
  assert.equal(hasNetworkAccess(boundary, "cloud-provider-api"), false);
});

test("hasNetworkAccess: sre can reach cloud provider APIs", () => {
  const boundary = getBoundary("sre");
  assert.equal(hasNetworkAccess(boundary, "cloud-provider-api"), true);
  assert.equal(hasNetworkAccess(boundary, "api.github.com"), false);
});

test("hasNetworkAccess: pm can only reach Linear", () => {
  const boundary = getBoundary("pm");
  assert.equal(hasNetworkAccess(boundary, "api.linear.app"), true);
  assert.equal(hasNetworkAccess(boundary, "api.github.com"), false);
});

test("hasNetworkAccess: research can reach external URLs", () => {
  const boundary = getBoundary("research");
  assert.equal(hasNetworkAccess(boundary, "example.com"), true);
});

test("hasNetworkAccess: review can reach GitHub and Linear", () => {
  const boundary = getBoundary("review");
  assert.equal(hasNetworkAccess(boundary, "api.github.com"), true);
  assert.equal(hasNetworkAccess(boundary, "api.linear.app"), true);
});
