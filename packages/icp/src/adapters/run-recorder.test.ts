import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunRecorder } from "./run-recorder.js";
import { RUN_REPORT_SCHEMA_VERSION } from "../runtime/contract.js";

test("run-recorder: stamps schema_version on every envelope (LAT-36)", async () => {
  const recorder = createRunRecorder();
  const out = await recorder.record({
    run_id: "",
    linear_issue_id: "LAT-36",
    autonomy_level: "L3-with-approval",
    started_at: new Date("2026-04-23T00:00:00Z"),
    ended_at: new Date("2026-04-23T00:00:01Z"),
    verdict: "ready",
    reasons: [],
    agent_result: null,
    dry_run: true,
    summary: "dry-run",
    next_action: "rerun with approve=true",
    open_questions: [],
    budget_cap_usd: 5,
  });

  assert.equal(out.report.schema_version, RUN_REPORT_SCHEMA_VERSION);
  const parsed = JSON.parse(out.json) as { schema_version?: string };
  assert.equal(parsed.schema_version, RUN_REPORT_SCHEMA_VERSION);
});

test("run-recorder: dry-run records as succeeded (happy) envelope", async () => {
  const recorder = createRunRecorder();
  const out = await recorder.record({
    run_id: "",
    linear_issue_id: "LAT-36",
    autonomy_level: "L3-with-approval",
    started_at: new Date("2026-04-23T00:00:00Z"),
    ended_at: new Date("2026-04-23T00:00:01Z"),
    verdict: "ready",
    reasons: [],
    agent_result: null,
    dry_run: true,
    summary: "dry-run",
    next_action: "rerun with approve=true",
    open_questions: [],
    budget_cap_usd: 5,
  });

  assert.equal(out.report.status, "succeeded");
  assert.equal(out.report.agent_type, "coding");
  assert.equal(out.report.triggered_by, "user");
});
