import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runQualityGate, buildAcChangeMapping } from "./output-quality-gate.js";

const BASE_INPUT = {
  ticketId: "LAT-136",
  acceptanceCriteria: [
    "- [ ] Update the ticket-pack generator to v2 format.",
    "- [ ] Add concrete scope section with target files.",
  ],
  changedFiles: ["packages/icp/src/dispatcher/ticket-pack.ts"],
  hasImplementationPlan: true,
  hasAcToChangeMapping: true,
  asksForCrossDocChanges: true,
  asksForCrossFileChanges: true,
  reportedState: "ready_for_review",
  declaredTargetFiles: ["packages/icp/src/dispatcher/ticket-pack.ts"],
};

describe("runQualityGate — happy path", () => {
  it("passes when all gates are satisfied", () => {
    const result = runQualityGate(BASE_INPUT);
    assert.equal(result.passed, true);
    assert.equal(result.code, "pass");
    assert.match(result.message, /All quality gates passed/);
  });

  it("passes on a planned run", () => {
    const result = runQualityGate({ ...BASE_INPUT, reportedState: "planned" });
    assert.equal(result.passed, true);
  });
});

describe("runQualityGate — insufficient_change", () => {
  it("flags README-only changes when ticket asks for cross-doc", () => {
    const result = runQualityGate({
      ...BASE_INPUT,
      changedFiles: ["README.md"],
      asksForCrossFileChanges: false,
    });
    assert.equal(result.passed, false);
    assert.equal(result.code, "insufficient_change");
    assert.match(result.message, /trivial_readme_only|Only README/);
  });

  it("flags insufficient non-README files for cross-doc dedup", () => {
    const result = runQualityGate({
      ...BASE_INPUT,
      changedFiles: ["README.md", "docs/guide.md"],
      asksForCrossFileChanges: false,
      asksForCrossDocChanges: true,
    });
    assert.equal(result.passed, false);
    assert.equal(result.code, "insufficient_change");
    assert.match(result.message, /cross_doc_dedup_trivial|≥2 non-README/);
  });

  it("flags no declared target files touched", () => {
    const result = runQualityGate({
      ...BASE_INPUT,
      changedFiles: ["packages/other/src/foo.ts"],
    });
    assert.equal(result.passed, false);
    assert.equal(result.code, "insufficient_change");
    assert.match(result.message, /no_declared_target_files_touched|None of the declared/);
  });

  it("flags empty diff with acceptance criteria", () => {
    const result = runQualityGate({
      ...BASE_INPUT,
      changedFiles: [],
      hasAcToChangeMapping: true,
    });
    assert.equal(result.passed, false);
    assert.equal(result.code, "insufficient_change");
    assert.match(result.message, /empty_diff_with_criteria/);
  });
});

describe("runQualityGate — needs_better_pack", () => {
  it("flags missing implementation plan", () => {
    const result = runQualityGate({
      ...BASE_INPUT,
      hasImplementationPlan: false,
      hasAcToChangeMapping: true,
    });
    assert.equal(result.passed, false);
    assert.equal(result.code, "needs_better_pack");
    assert.match(result.message, /implementation_plan_missing/);
  });

  it("flags missing AC-to-change mapping", () => {
    const result = runQualityGate({
      ...BASE_INPUT,
      hasImplementationPlan: true,
      hasAcToChangeMapping: false,
    });
    assert.equal(result.passed, false);
    assert.equal(result.code, "needs_better_pack");
    assert.match(result.message, /ac_mapping_missing/);
  });

  it("flags both missing plan and mapping as needs_better_pack", () => {
    const result = runQualityGate({
      ...BASE_INPUT,
      hasImplementationPlan: false,
      hasAcToChangeMapping: false,
    });
    assert.equal(result.passed, false);
    assert.equal(result.code, "needs_better_pack");
    assert.match(result.message, /implementation_plan_missing/);
    assert.match(result.message, /ac_mapping_missing/);
  });
});

describe("runQualityGate — gate skips non-ready states", () => {
  it("passes for checks_failed", () => {
    const result = runQualityGate({ ...BASE_INPUT, reportedState: "checks_failed" });
    assert.equal(result.passed, true);
    assert.equal(result.code, "skipped");
  });

  it("passes for refused", () => {
    const result = runQualityGate({ ...BASE_INPUT, reportedState: "refused" });
    assert.equal(result.passed, true);
  });
});

describe("runQualityGate — mixed findings", () => {
  it("prefers insufficient_change over needs_better_pack when both present", () => {
    const result = runQualityGate({
      ...BASE_INPUT,
      hasImplementationPlan: false,
      changedFiles: ["README.md"],
    });
    assert.equal(result.passed, false);
    // Both findings present, but trivial_readme_only is worst → insufficient_change
    assert.equal(result.code, "insufficient_change");
  });
});

describe("buildAcChangeMapping", () => {
  it("produces one entry per acceptance criterion", () => {
    const criteria = ["- [ ] do A", "- [ ] do B", "- [ ] do C"];
    const mapping = buildAcChangeMapping(criteria, ["file1.ts"]);
    assert.equal(mapping.length, 3);
    assert.equal(mapping[0].acIndex, 0);
    assert.equal(mapping[2].acIndex, 2);
  });

  it("truncates long criterion text", () => {
    const longAc = "- [ ] " + "x".repeat(200);
    const mapping = buildAcChangeMapping([longAc], ["file.ts"]);
    assert.ok(mapping[0].acText.length < longAc.length);
    assert.ok(mapping[0].acText.endsWith("…"));
  });

  it("marks all entries as satisfied when there are changed files", () => {
    const mapping = buildAcChangeMapping(["- [ ] a"], ["file.ts"]);
    assert.equal(mapping[0].satisfied, true);
  });

  it("marks entries with empty diff as not satisfied", () => {
    const mapping = buildAcChangeMapping(["- [ ] a"], []);
    assert.equal(mapping[0].satisfied, false);
  });
});
