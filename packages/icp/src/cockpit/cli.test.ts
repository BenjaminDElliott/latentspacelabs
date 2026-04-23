import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { main } from "./cli.js";
import { RUN_REPORT_SCHEMA_VERSION } from "../runtime/contract.js";

class Collector extends Writable {
  chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  text(): string {
    return this.chunks.join("");
  }
}

test("cli: prints markdown briefing from an empty runs dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cockpit-cli-"));
  const out = new Collector();
  const err = new Collector();
  const code = await main(["--runs-dir", dir], out, err);
  assert.equal(code, 0);
  assert.ok(out.text().includes("# ICP observability cockpit"));
  assert.ok(out.text().includes("## Telemetry gaps"));
});

test("cli: --json prints structured state that includes all seven view keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cockpit-cli-json-"));
  await writeFile(
    join(dir, "r1.json"),
    JSON.stringify({
      schema_version: RUN_REPORT_SCHEMA_VERSION,
      run_id: "r1",
      agent_type: "coding",
      status: "succeeded",
      triggered_by: "user",
      linear_issue_id: "LAT-1",
      autonomy_level: "L3-with-approval",
      started_at: "2026-04-23T10:00:00Z",
      ended_at: "2026-04-23T10:05:00Z",
      summary: "ok",
      decisions: [],
      next_actions: [],
      errors: [],
      cost: { band: "normal", budget_cap_usd: null, spent_usd: null },
      correlation: {
        pr_url: null,
        pr_branch: null,
        commit_sha: null,
        linear_comment_url: null,
      },
    }),
  );
  const out = new Collector();
  const err = new Collector();
  const code = await main(["--runs-dir", dir, "--json"], out, err);
  assert.equal(code, 0);
  const parsed = JSON.parse(out.text()) as Record<string, unknown>;
  for (const k of [
    "active_runs",
    "blocked_work",
    "recent_completions",
    "failed_runs",
    "cost_and_risk_flags",
    "pr_review_queue",
    "learning_candidates",
    "notifications",
    "telemetry_gaps",
    "totals",
  ]) {
    assert.ok(k in parsed, `missing key ${k}`);
  }
});

test("cli: rejects unknown flags with exit 64 and prints help", async () => {
  const out = new Collector();
  const err = new Collector();
  const code = await main(["--nope"], out, err);
  assert.equal(code, 64);
  assert.ok(err.text().includes("icp-cockpit"));
});
