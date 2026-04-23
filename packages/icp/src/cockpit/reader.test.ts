import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunJson, readRunsDir } from "./reader.js";
import { RUN_REPORT_SCHEMA_VERSION } from "../runtime/contract.js";

function baseEnvelope(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: RUN_REPORT_SCHEMA_VERSION,
    run_id: "run_abc",
    agent_type: "coding",
    status: "succeeded",
    triggered_by: "user",
    linear_issue_id: "LAT-55",
    autonomy_level: "L3-with-approval",
    started_at: "2026-04-23T00:00:00Z",
    ended_at: "2026-04-23T00:05:00Z",
    summary: "ok",
    decisions: [],
    next_actions: ["merge"],
    errors: [],
    cost: { band: "normal", budget_cap_usd: null, spent_usd: null, band_unavailable_reason: null },
    correlation: {
      pr_url: "https://example.com/pr/1",
      pr_branch: null,
      commit_sha: null,
      linear_comment_url: null,
    },
    ...partial,
  };
}

test("reader: parses a well-formed envelope", () => {
  const res = parseRunJson(JSON.stringify(baseEnvelope()), "x.json");
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.record.run_id, "run_abc");
  assert.equal(res.record.agent_type, "coding");
  assert.equal(res.record.cost.band, "normal");
});

test("reader: rejects envelopes missing required core fields", () => {
  const bad = parseRunJson(JSON.stringify({ foo: "bar" }), "x.json");
  assert.equal(bad.ok, false);
});

test("reader: tolerates invalid triggered_by by defaulting to 'user'", () => {
  const env = baseEnvelope({ triggered_by: "garbage" });
  const res = parseRunJson(JSON.stringify(env), "x.json");
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.record.triggered_by, "user");
});

test("reader: reads a directory of run JSONs and skips malformed files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cockpit-reader-"));
  await writeFile(
    join(dir, "good.json"),
    JSON.stringify(baseEnvelope({ run_id: "run_good" })),
  );
  await writeFile(join(dir, "broken.json"), "{not json}");
  await writeFile(join(dir, "readme.md"), "# noise");
  const result = await readRunsDir(dir);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0]!.run_id, "run_good");
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0]!.reason, /invalid JSON/);
});

test("reader: missing runs dir returns empty result, does not throw", async () => {
  const result = await readRunsDir(join(tmpdir(), "does-not-exist-lat55"));
  assert.equal(result.runs.length, 0);
  assert.equal(result.rejected.length, 0);
});

test("reader: picks up optional risk_level and agent_metadata.model", () => {
  const env = baseEnvelope({
    risk_level: "critical",
    agent_metadata: { model: "claude-opus-4-7", extra: "ignored" },
  });
  const res = parseRunJson(JSON.stringify(env), "x.json");
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.record.risk_level, "critical");
  assert.equal(res.record.agent_metadata?.model, "claude-opus-4-7");
});
