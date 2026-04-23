import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateRunsForRetro } from "./retro-aggregator.js";
import type { AggregatableRun } from "./contract.js";

function run(
  run_id: string,
  linear_issue_id: string,
  failure_category: AggregatableRun["failure_category"],
): AggregatableRun {
  return { run_id, linear_issue_id, failure_category };
}

test("retro: empty input produces no candidates", () => {
  const res = aggregateRunsForRetro([], { threshold: 2 });
  assert.equal(res.candidates.length, 0);
  assert.equal(res.archived.length, 0);
  assert.equal(res.total_runs, 0);
});

test("retro: clean runs (`none`) are never candidates", () => {
  const runs = [
    run("r1", "LAT-1", "none"),
    run("r2", "LAT-2", "none"),
    run("r3", "LAT-3", "none"),
  ];
  const res = aggregateRunsForRetro(runs, { threshold: 2 });
  assert.equal(res.candidates.length, 0);
  assert.equal(res.archived.length, 0);
  assert.equal(res.total_runs, 3);
});

test("retro: single occurrence below threshold is archived, not promoted", () => {
  const runs = [run("r1", "LAT-1", "missing_budget_cap")];
  const res = aggregateRunsForRetro(runs, { threshold: 2 });
  assert.equal(res.candidates.length, 0);
  assert.equal(res.archived.length, 1);
  assert.equal(res.archived[0]?.category, "missing_budget_cap");
  assert.equal(res.archived[0]?.occurrences, 1);
});

test("retro: threshold=2 promotes a recurring pattern to a candidate", () => {
  const runs = [
    run("r1", "LAT-1", "missing_budget_cap"),
    run("r2", "LAT-2", "missing_budget_cap"),
    run("r3", "LAT-3", "provider_error"),
  ];
  const res = aggregateRunsForRetro(runs, { threshold: 2 });
  assert.equal(res.candidates.length, 1);
  const c = res.candidates[0]!;
  assert.equal(c.category, "missing_budget_cap");
  assert.equal(c.occurrences, 2);
  assert.deepEqual([...c.run_ids], ["r1", "r2"]);
  assert.deepEqual([...c.linear_issue_ids], ["LAT-1", "LAT-2"]);
  assert.match(c.suggested_promotion, /prompt\/template update/);

  assert.equal(res.archived.length, 1);
  assert.equal(res.archived[0]?.category, "provider_error");
});

test("retro: suggestion vocabulary matches ADR-0010 promotion paths", () => {
  const runs = [
    run("r1", "LAT-1", "cost_runaway_risk"),
    run("r2", "LAT-2", "cost_runaway_risk"),
  ];
  const res = aggregateRunsForRetro(runs, { threshold: 2 });
  assert.equal(res.candidates.length, 1);
  assert.match(res.candidates[0]!.suggested_promotion, /ADR candidate/);
});

test("retro: duplicate linear_issue_ids are deduped in the candidate view", () => {
  const runs = [
    run("r1", "LAT-1", "missing_evidence_floor"),
    run("r2", "LAT-1", "missing_evidence_floor"),
    run("r3", "LAT-2", "missing_evidence_floor"),
  ];
  const res = aggregateRunsForRetro(runs, { threshold: 2 });
  assert.equal(res.candidates.length, 1);
  const c = res.candidates[0]!;
  assert.equal(c.occurrences, 3);
  assert.deepEqual([...c.run_ids], ["r1", "r2", "r3"]);
  assert.deepEqual([...c.linear_issue_ids], ["LAT-1", "LAT-2"]);
});

test("retro: candidates are sorted by category name for stable output", () => {
  const runs = [
    run("r1", "LAT-1", "provider_timeout"),
    run("r2", "LAT-2", "provider_timeout"),
    run("r3", "LAT-3", "missing_repo"),
    run("r4", "LAT-4", "missing_repo"),
  ];
  const res = aggregateRunsForRetro(runs, { threshold: 2 });
  assert.equal(res.candidates.length, 2);
  assert.equal(res.candidates[0]?.category, "missing_repo");
  assert.equal(res.candidates[1]?.category, "provider_timeout");
});

test("retro: invalid threshold falls back to 2", () => {
  const runs = [
    run("r1", "LAT-1", "missing_approval"),
    run("r2", "LAT-2", "missing_approval"),
  ];
  const res = aggregateRunsForRetro(runs, { threshold: 0 });
  assert.equal(res.candidates.length, 1);
  assert.equal(res.candidates[0]?.category, "missing_approval");
});
