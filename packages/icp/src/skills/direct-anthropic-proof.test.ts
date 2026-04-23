/**
 * Tests for the LAT-67 Direct-Path Anthropic proof harness.
 *
 * No test hits the live endpoint. All tests inject a canned
 * DirectAnthropicClient and a temp-dir repo root. A real API key is
 * never written to `process.env` or disk; the synthetic value below
 * does not match any real Anthropic token shape.
 *
 * Acceptance-contract coverage:
 *   - given ANTHROPIC_API_KEY is set → ok ping writes E1 evidence with
 *     cost_band_check.outcome=pass and no secret content.
 *   - given ANTHROPIC_API_KEY is absent → throws exactly
 *     'ANTHROPIC_API_KEY not set' and writes no artefact.
 *   - failed ping writes evidence with cost_band=unknown and
 *     cost_band_check.outcome=fail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cliMain,
  E1_EVIDENCE_ID,
  E1_EVIDENCE_SCHEMA_VERSION,
  runDirectAnthropicProof,
  type DirectProviderE1Evidence,
} from "./direct-anthropic-proof.js";
import {
  LAT67_PROOF_MAX_TOKENS,
  LAT67_PROOF_MODEL,
  LAT67_PROOF_PROMPT,
  type DirectAnthropicClient,
  type DirectProviderPingResult,
} from "../adapters/direct-provider-client.js";

const SYNTHETIC_KEY = "sk-ant-TEST-NOT-A-REAL-KEY-0123456789ABCDEF";

function okClient(overrides: Partial<DirectProviderPingResult> = {}): {
  client: DirectAnthropicClient;
  calls: Array<{ run_id: string; secret_source: string }>;
} {
  const calls: Array<{ run_id: string; secret_source: string }> = [];
  const client: DirectAnthropicClient = {
    async ping({ run_id, secret_source }) {
      calls.push({ run_id, secret_source });
      return {
        provider: "anthropic",
        model: LAT67_PROOF_MODEL,
        endpoint: "https://api.anthropic.com/v1/messages",
        anthropic_version: "2023-06-01",
        run_id,
        ok: true,
        status: 200,
        latency_ms: 42,
        tokens: { input: 3, output: 2 },
        cost_band: "normal",
        cost_band_unavailable_reason: null,
        cost_band_check: {
          outcome: "pass",
          reason: `HTTP 200 with max_tokens=${LAT67_PROOF_MAX_TOKENS}; within ADR-0009 normal band.`,
        },
        secret_source,
        notes: [`direct:anthropic ping ok model=${LAT67_PROOF_MODEL} status=200 latency_ms=42`],
        ...overrides,
      };
    },
  };
  return { client, calls };
}

function failingClient(status = 401): DirectAnthropicClient {
  return {
    async ping({ run_id, secret_source }) {
      return {
        provider: "anthropic",
        model: LAT67_PROOF_MODEL,
        endpoint: "https://api.anthropic.com/v1/messages",
        anthropic_version: "2023-06-01",
        run_id,
        ok: false,
        status,
        latency_ms: 12,
        tokens: { input: null, output: null },
        cost_band: "unknown",
        cost_band_unavailable_reason:
          "direct:anthropic ping did not return HTTP 200; no usage surfaced",
        cost_band_check: {
          outcome: "fail",
          reason: `HTTP ${status} from Anthropic /v1/messages: <empty body>`,
        },
        secret_source,
        notes: [`direct:anthropic ping failed model=${LAT67_PROOF_MODEL} status=${status} latency_ms=12`],
      };
    },
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* runDirectAnthropicProof                                             */
/* ------------------------------------------------------------------ */

test("runDirectAnthropicProof: throws exact 'ANTHROPIC_API_KEY not set' when absent; writes no artefact", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "lat67-proof-"));
  await assert.rejects(
    () =>
      runDirectAnthropicProof({
        env: {},
        repo_root: repoRoot,
        clientFactory: () => ({
          async ping() {
            throw new Error("client should never be called when key is missing");
          },
        }),
      }),
    /^Error: ANTHROPIC_API_KEY not set$/,
  );
  const expectedPath = join(
    repoRoot,
    "runs",
    "evidence",
    "LAT-67",
    `${E1_EVIDENCE_ID}.json`,
  );
  assert.equal(await pathExists(expectedPath), false);
});

test("runDirectAnthropicProof: writes E1 evidence with cost_band_check=pass on ok ping", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "lat67-proof-"));
  const { client, calls } = okClient();
  const frozen = new Date("2026-04-23T12:00:00.000Z");

  const result = await runDirectAnthropicProof({
    env: { ANTHROPIC_API_KEY: SYNTHETIC_KEY },
    repo_root: repoRoot,
    run_id: "run-123",
    clientFactory: () => client,
    now: () => frozen,
  });

  // Client was invoked exactly once with the secret_source label
  // and the run_id we passed in.
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.run_id, "run-123");
  assert.equal(calls[0]?.secret_source, "env:ANTHROPIC_API_KEY");

  // Evidence written to the canonical path.
  const expectedPath = join(
    repoRoot,
    "runs",
    "evidence",
    "LAT-67",
    `${E1_EVIDENCE_ID}.json`,
  );
  assert.equal(result.evidence_path, expectedPath);

  const raw = await readFile(expectedPath, "utf8");
  const parsed = JSON.parse(raw) as DirectProviderE1Evidence;

  assert.equal(parsed.schema_version, E1_EVIDENCE_SCHEMA_VERSION);
  assert.equal(parsed.evidence_id, E1_EVIDENCE_ID);
  assert.equal(parsed.linear_issue_id, "LAT-67");
  assert.equal(parsed.run_id, "run-123");
  assert.equal(parsed.provider, "anthropic");
  assert.equal(parsed.model, LAT67_PROOF_MODEL);
  assert.equal(parsed.status, 200);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tokens.input, 3);
  assert.equal(parsed.tokens.output, 2);
  assert.equal(parsed.latency_ms, 42);
  assert.equal(parsed.cost_band, "normal");
  assert.equal(parsed.cost_band_unavailable_reason, null);
  assert.equal(parsed.cost_band_check.outcome, "pass");
  assert.equal(parsed.secret_source, "env:ANTHROPIC_API_KEY");
  assert.equal(parsed.request.max_tokens, LAT67_PROOF_MAX_TOKENS);
  assert.equal(parsed.request.prompt, LAT67_PROOF_PROMPT);
  assert.equal(parsed.generated_at, frozen.toISOString());

  // No secret content in the serialised artefact.
  assert.ok(!raw.includes(SYNTHETIC_KEY));
  // secret_source label is a tag, not a value.
  assert.equal(parsed.secret_source, "env:ANTHROPIC_API_KEY");
});

test("runDirectAnthropicProof: failing ping still writes evidence with cost_band_check=fail", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "lat67-proof-"));
  const result = await runDirectAnthropicProof({
    env: { ANTHROPIC_API_KEY: SYNTHETIC_KEY },
    repo_root: repoRoot,
    run_id: "run-fail",
    clientFactory: () => failingClient(401),
  });
  const raw = await readFile(result.evidence_path, "utf8");
  const parsed = JSON.parse(raw) as DirectProviderE1Evidence;
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, 401);
  assert.equal(parsed.cost_band, "unknown");
  assert.equal(parsed.cost_band_check.outcome, "fail");
  assert.ok(parsed.cost_band_unavailable_reason);
  // Secret never in evidence even on failure.
  assert.ok(!raw.includes(SYNTHETIC_KEY));
});

test("runDirectAnthropicProof: custom linear_issue_id routes the evidence under that ticket dir", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "lat67-proof-"));
  const { client } = okClient();
  const result = await runDirectAnthropicProof({
    env: { ANTHROPIC_API_KEY: SYNTHETIC_KEY },
    repo_root: repoRoot,
    linear_issue_id: "LAT-999",
    clientFactory: () => client,
  });
  assert.ok(result.evidence_path.includes(join("runs", "evidence", "LAT-999")));
  assert.equal(result.evidence.linear_issue_id, "LAT-999");
});

/* ------------------------------------------------------------------ */
/* LAT-66 cost-band gate parity                                        */
/* ------------------------------------------------------------------ */

test("runDirectAnthropicProof: ok ping with cost_band_check=pass satisfies the LAT-66 gate shape", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "lat67-proof-"));
  const { client } = okClient();
  const { evidence } = await runDirectAnthropicProof({
    env: { ANTHROPIC_API_KEY: SYNTHETIC_KEY },
    repo_root: repoRoot,
    clientFactory: () => client,
  });

  // Shape the ICP runner's LAT-66 gate would see if this harness were
  // a registered skill: a concrete non-'unknown' band with no required
  // unavailable reason. The gate is implemented in
  // `packages/icp/src/runtime/runner.ts#checkCostBandEvidence`; this
  // test asserts the E1 artefact would pass that gate by construction.
  assert.notEqual(evidence.cost_band, "unknown");
  assert.equal(evidence.cost_band_unavailable_reason, null);
  assert.equal(evidence.cost_band_check.outcome, "pass");
});

/* ------------------------------------------------------------------ */
/* cliMain                                                              */
/* ------------------------------------------------------------------ */

test("cliMain: exits 2 with exact missing-key message when ANTHROPIC_API_KEY absent", async () => {
  const stderr: string[] = [];
  const stdout: string[] = [];
  const repoRoot = await mkdtemp(join(tmpdir(), "lat67-proof-"));
  const code = await cliMain([`--evidence-dir=runs/evidence/LAT-67`], {
    stdout: { write: (s) => stdout.push(s) },
    stderr: { write: (s) => stderr.push(s) },
    cwd: () => repoRoot,
    env: {},
  });
  assert.equal(code, 2);
  assert.equal(stderr.join(""), "ANTHROPIC_API_KEY not set\n");
});

test("cliMain: prints help without touching env", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await cliMain(["--help"], {
    stdout: { write: (s) => stdout.push(s) },
    stderr: { write: (s) => stderr.push(s) },
    cwd: () => "/tmp",
    env: {},
  });
  assert.equal(code, 0);
  assert.match(stdout.join(""), /direct-anthropic-proof/);
  assert.equal(stderr.join(""), "");
});
