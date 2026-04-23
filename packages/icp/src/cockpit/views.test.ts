import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCockpitState } from "./views.js";
import type { CockpitRunRecord } from "./types.js";
import { RUN_REPORT_SCHEMA_VERSION } from "../runtime/contract.js";

const NOW = new Date("2026-04-23T12:00:00Z");

function run(partial: Partial<CockpitRunRecord> & { run_id: string }): CockpitRunRecord {
  return {
    schema_version: RUN_REPORT_SCHEMA_VERSION,
    agent_type: "coding",
    status: "succeeded",
    triggered_by: "user",
    linear_issue_id: "LAT-1",
    autonomy_level: "L3-with-approval",
    started_at: "2026-04-23T10:00:00Z",
    ended_at: "2026-04-23T10:05:00Z",
    summary: "ok",
    decisions: [],
    next_actions: ["none"],
    errors: [],
    cost: { band: "normal", budget_cap_usd: null, spent_usd: null, band_unavailable_reason: null },
    correlation: {
      pr_url: null,
      pr_branch: null,
      commit_sha: null,
      linear_comment_url: null,
    },
    ...partial,
  };
}

test("active_runs: includes status=started in window, sorted newest-first", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [
      run({
        run_id: "r1",
        status: "started",
        started_at: "2026-04-23T11:00:00Z",
        ended_at: "",
      }),
      run({
        run_id: "r2",
        status: "started",
        started_at: "2026-04-23T11:30:00Z",
        ended_at: "",
      }),
      run({ run_id: "r3", status: "succeeded" }),
    ],
  });
  assert.deepEqual(state.active_runs.map((r) => r.run_id), ["r2", "r1"]);
});

test("active_runs: flags stale started runs and emits sync-page notification", () => {
  const state = buildCockpitState({
    now: NOW,
    stale_started_hours: 1,
    runs: [
      run({
        run_id: "r_stale",
        status: "started",
        started_at: "2026-04-23T09:00:00Z",
        ended_at: "",
      }),
    ],
  });
  assert.equal(state.active_runs[0]!.stale, true);
  const syncStale = state.notifications.find(
    (n) => n.tier === "synchronous_page" && n.source_view === "active_runs",
  );
  assert.ok(syncStale, "expected stale-run sync page");
});

test("blocked_work: collects needs_human/failed/cancelled with reason and next_action", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [
      run({
        run_id: "b1",
        status: "needs_human",
        decisions: ["awaiting approve flag"],
        next_actions: ["rerun with approve=true"],
      }),
      run({
        run_id: "b2",
        status: "failed",
        errors: ["git push rejected"],
        next_actions: ["review conflicts"],
      }),
    ],
    linear_issues: [{ id: "LAT-1", status: "In Progress" }],
  });
  assert.equal(state.blocked_work.length, 2);
  const nh = state.blocked_work.find((r) => r.run_id === "b1");
  assert.equal(nh?.reason, "awaiting approve flag");
  assert.equal(nh?.linear_status, "In Progress");
});

test("recent_completions: caps at limit and sorts by ended_at desc", () => {
  const runs: CockpitRunRecord[] = [];
  for (let i = 0; i < 25; i++) {
    const m = String(i).padStart(2, "0");
    runs.push(
      run({
        run_id: `c${m}`,
        status: "succeeded",
        ended_at: `2026-04-22T${m}:00:00Z`,
      }),
    );
  }
  const state = buildCockpitState({ now: NOW, runs, recent_completions_limit: 5 });
  assert.equal(state.recent_completions.length, 5);
  assert.equal(state.recent_completions[0]!.run_id, "c24");
});

test("failed_runs: groups by agent_type and linear_issue_id with retro candidate flag", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [
      run({ run_id: "f1", status: "failed", errors: ["ENOENT"], linear_issue_id: "LAT-9" }),
      run({ run_id: "f2", status: "failed", errors: ["ENOENT"], linear_issue_id: "LAT-9" }),
      run({ run_id: "f3", status: "failed", errors: ["timeout"], linear_issue_id: "LAT-10" }),
    ],
  });
  const byIssue = state.failed_runs.by_linear_issue.find((g) => g.key === "LAT-9");
  assert.ok(byIssue);
  assert.equal(byIssue!.count, 2);
  assert.equal(byIssue!.retrospective_candidate, true);
  const byAgent = state.failed_runs.by_agent_type.find((g) => g.key === "coding");
  assert.equal(byAgent?.count, 3);
});

test("cost_and_risk_flags: surfaces elevated/runaway_risk and high/critical; sorts by severity", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [
      run({
        run_id: "c1",
        status: "succeeded",
        cost: { band: "elevated", budget_cap_usd: 5, spent_usd: 4, band_unavailable_reason: null },
      }),
      run({
        run_id: "c2",
        status: "failed",
        cost: { band: "runaway_risk", budget_cap_usd: 5, spent_usd: 12, band_unavailable_reason: null },
        errors: ["budget exceeded"],
      }),
      run({ run_id: "c3", status: "succeeded", risk_level: "critical" }),
      run({ run_id: "c4", status: "succeeded" }),
    ],
  });
  assert.equal(state.cost_and_risk_flags.length, 3);
  // runaway_risk first, then critical, then elevated.
  assert.equal(state.cost_and_risk_flags[0]!.run_id, "c2");
  assert.equal(state.cost_and_risk_flags[1]!.run_id, "c3");
  assert.equal(state.cost_and_risk_flags[2]!.run_id, "c1");
  const sync = state.notifications.filter((n) => n.tier === "synchronous_page");
  assert.equal(
    sync.some((n) => n.run_id === "c2"),
    true,
  );
  assert.equal(
    sync.some((n) => n.run_id === "c3"),
    true,
  );
  const amb = state.notifications.filter((n) => n.tier === "ambient_queue");
  assert.equal(
    amb.some((n) => n.run_id === "c1"),
    true,
    "elevated should be ambient, not sync",
  );
});

test("pr_review_queue: joins GitHub PR list to runs by LAT key, uses QA severity for sort", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [
      run({
        run_id: "pr_r1",
        status: "needs_human",
        linear_issue_id: "LAT-55",
        correlation: {
          pr_url: "https://github.com/o/r/pull/100",
          pr_branch: "lat-55",
          commit_sha: null,
          linear_comment_url: null,
        },
        risk_level: "high",
      }),
    ],
    open_prs: [
      {
        number: 100,
        url: "https://github.com/o/r/pull/100",
        title: "LAT-55: cockpit",
        author: "coding-agent",
        state: "open",
      },
      {
        number: 101,
        url: "https://github.com/o/r/pull/101",
        title: "chore: no LAT key",
        author: "human",
        state: "open",
      },
    ],
    qa_reports: [
      {
        pr_number: 100,
        findings_by_severity: { critical: 1, high: 2 },
        finding_classes: ["policy-scan:missing-owner"],
      },
    ],
  });
  assert.equal(state.pr_review_queue.length, 1, "non-LAT PR is excluded");
  assert.equal(state.pr_review_queue[0]!.pr_number, 100);
  assert.equal(state.pr_review_queue[0]!.qa_findings_by_severity?.["critical"], 1);
  const sync = state.notifications.find(
    (n) =>
      n.tier === "synchronous_page" && n.source_view === "pr_review_queue",
  );
  assert.ok(sync, "critical QA finding must emit sync page");
});

test("pr_review_queue: falls back to run-report PR URLs when GitHub snapshot missing", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [
      run({
        run_id: "pr_r2",
        status: "needs_human",
        linear_issue_id: "LAT-56",
        correlation: {
          pr_url: "https://github.com/o/r/pull/200",
          pr_branch: "lat-56",
          commit_sha: null,
          linear_comment_url: null,
        },
      }),
    ],
  });
  assert.equal(state.pr_review_queue.length, 1);
  assert.equal(state.pr_review_queue[0]!.lat_key, "LAT-56");
  assert.equal(state.pr_review_queue[0]!.pr_number, null);
  assert.ok(
    state.telemetry_gaps.some((g) => g.includes("GitHub PR state not supplied")),
  );
});

test("learning_candidates: surfaces repeated errors[0] class across >=2 runs", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [
      run({
        run_id: "lc1",
        status: "failed",
        errors: ["npm run check failed"],
        ended_at: "2026-04-22T10:00:00Z",
      }),
      run({
        run_id: "lc2",
        status: "failed",
        errors: ["npm run check failed"],
        ended_at: "2026-04-22T12:00:00Z",
      }),
    ],
  });
  const repeat = state.learning_candidates.find(
    (c) => c.kind === "repeated_error_class",
  );
  assert.ok(repeat, "expected repeated_error_class cluster");
  assert.equal(repeat!.count, 2);
  assert.equal(repeat!.cluster_key, "npm run check failed");
});

test("learning_candidates: detects >=2 consecutive agent failures", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [
      run({
        run_id: "cf1",
        agent_type: "qa",
        status: "failed",
        ended_at: "2026-04-22T10:00:00Z",
      }),
      run({
        run_id: "cf2",
        agent_type: "qa",
        status: "failed",
        ended_at: "2026-04-22T11:00:00Z",
      }),
      run({
        run_id: "cf3",
        agent_type: "qa",
        status: "succeeded",
        ended_at: "2026-04-22T12:00:00Z",
      }),
    ],
  });
  const cluster = state.learning_candidates.find(
    (c) => c.kind === "consecutive_failed_agent" && c.cluster_key === "qa",
  );
  assert.ok(cluster);
  assert.equal(cluster!.count, 2);
});

test("learning_candidates: clusters recurring PR review finding classes", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [],
    qa_reports: [
      {
        pr_number: 1,
        findings_by_severity: { medium: 1 },
        finding_classes: ["cockpit:uncited-claim"],
      },
      {
        pr_number: 2,
        findings_by_severity: { medium: 1 },
        finding_classes: ["cockpit:uncited-claim"],
      },
    ],
  });
  const cluster = state.learning_candidates.find(
    (c) => c.kind === "recurring_pr_finding",
  );
  assert.ok(cluster);
  assert.equal(cluster!.count, 2);
});

test("notifications: every event cites a run_id and linear_issue_id (PRD §6.4)", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [
      run({
        run_id: "n1",
        status: "needs_human",
        decisions: ["approve missing"],
        linear_issue_id: "LAT-10",
      }),
    ],
  });
  for (const n of state.notifications) {
    assert.ok(n.run_id, "notification missing run_id");
    assert.ok(n.linear_issue_id, "notification missing linear_issue_id");
    assert.ok(n.source_view, "notification missing source_view");
  }
});

test("notifications: normal-band succeeded runs do not page (PRD §6.4.3)", () => {
  const state = buildCockpitState({
    now: NOW,
    runs: [run({ run_id: "quiet", status: "succeeded" })],
  });
  assert.equal(state.notifications.length, 0);
});

test("telemetry_gaps: always cites the three core telemetry gaps", () => {
  const state = buildCockpitState({ now: NOW, runs: [] });
  assert.ok(state.telemetry_gaps.some((g) => g.includes("step-level")));
  assert.ok(state.telemetry_gaps.some((g) => g.includes("prompt/response traces")));
  assert.ok(state.telemetry_gaps.some((g) => g.includes("cross-run aggregates")));
});
