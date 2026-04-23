import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCockpitState } from "./views.js";
import { renderCockpitSummary } from "./summary.js";
import type { CockpitRunRecord } from "./types.js";
import { RUN_REPORT_SCHEMA_VERSION } from "../runtime/contract.js";

const NOW = new Date("2026-04-23T12:00:00Z");

function run(partial: Partial<CockpitRunRecord> & { run_id: string }): CockpitRunRecord {
  return {
    schema_version: RUN_REPORT_SCHEMA_VERSION,
    agent_type: "coding",
    status: "succeeded",
    triggered_by: "user",
    linear_issue_id: "LAT-55",
    autonomy_level: "L3-with-approval",
    started_at: "2026-04-23T10:00:00Z",
    ended_at: "2026-04-23T10:05:00Z",
    summary: "did the thing",
    decisions: [],
    next_actions: ["none"],
    errors: [],
    cost: { band: "normal", budget_cap_usd: null, spent_usd: null, band_unavailable_reason: null },
    correlation: { pr_url: null, pr_branch: null, commit_sha: null, linear_comment_url: null },
    ...partial,
  };
}

test("summary: covers all seven views in PRD §6.2 order", () => {
  const state = buildCockpitState({ now: NOW, runs: [run({ run_id: "x" })] });
  const md = renderCockpitSummary(state);
  const idxActive = md.indexOf("## Active runs");
  const idxBlocked = md.indexOf("## Blocked work");
  const idxRecent = md.indexOf("## Recent completions");
  const idxFailed = md.indexOf("## Failed runs");
  const idxCost = md.indexOf("## Cost and risk flags");
  const idxPR = md.indexOf("## PR review queue");
  const idxLearn = md.indexOf("## Learning candidates");
  assert.ok(idxActive >= 0 && idxBlocked > idxActive);
  assert.ok(idxRecent > idxBlocked);
  assert.ok(idxFailed > idxRecent);
  assert.ok(idxCost > idxFailed);
  assert.ok(idxPR > idxCost);
  assert.ok(idxLearn > idxPR);
});

test("summary: surfaces sync-page events before the view sections (PRD §6.5.6)", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [
      run({
        run_id: "halt",
        status: "failed",
        cost: { band: "runaway_risk", budget_cap_usd: 5, spent_usd: 20, band_unavailable_reason: null },
        errors: ["budget exceeded"],
      }),
    ],
  });
  const md = renderCockpitSummary(state);
  const syncIdx = md.indexOf("## Synchronous-page events");
  const activeIdx = md.indexOf("## Active runs");
  assert.ok(syncIdx >= 0 && syncIdx < activeIdx);
  assert.ok(md.includes("runaway_risk"));
  assert.ok(md.includes("`halt`"));
});

test("summary: every PR review queue row cites its PR or telemetry gap", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [
      run({
        run_id: "pr1",
        status: "needs_human",
        linear_issue_id: "LAT-55",
        correlation: {
          pr_url: "https://github.com/o/r/pull/1",
          pr_branch: null,
          commit_sha: null,
          linear_comment_url: null,
        },
      }),
    ],
  });
  const md = renderCockpitSummary(state);
  assert.ok(md.includes("https://github.com/o/r/pull/1"));
  assert.ok(md.includes("findings=requires future telemetry"));
});

test("summary: retrospective candidate groups are marked explicitly", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [
      run({
        run_id: "f1",
        status: "failed",
        errors: ["boom"],
        linear_issue_id: "LAT-9",
      }),
      run({
        run_id: "f2",
        status: "failed",
        errors: ["boom"],
        linear_issue_id: "LAT-9",
      }),
    ],
  });
  const md = renderCockpitSummary(state);
  assert.ok(md.includes("retro candidate"));
  assert.ok(md.includes("LAT-9"));
});

test("summary: all telemetry-gap lines render in the telemetry-gaps section", () => {
  const state = buildCockpitState({ now: NOW, runs: [] });
  const md = renderCockpitSummary(state);
  assert.ok(md.includes("## Telemetry gaps"));
  assert.ok(md.includes("step-level"));
  assert.ok(md.includes("prompt/response traces"));
  assert.ok(md.includes("cross-run aggregates"));
});

test("summary: no uncited claims about runs — each run reference uses `run_id`", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [run({ run_id: "r_cite", status: "succeeded" })],
  });
  const md = renderCockpitSummary(state);
  // The run should appear as a cited reference, not as prose.
  assert.ok(md.includes("`r_cite`"));
});
