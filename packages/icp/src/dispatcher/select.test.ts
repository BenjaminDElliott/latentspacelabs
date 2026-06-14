import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateEligibility } from "./select.js";
import type { DispatchIssue } from "./types.js";

function issue(overrides: Partial<DispatchIssue> = {}): DispatchIssue {
  return {
    identifier: "LAT-126",
    uuid: "uuid-126",
    title: "Add support for foo bar baz quux",
    description: [
      "## Summary",
      "Implement a small focused change.",
      "",
      "## Acceptance Criteria",
      "- [ ] code compiles",
      "- [ ] tests pass",
      "",
      "Body is long enough to clear the minimum threshold for safe dispatch and includes acceptance criteria.",
    ].join("\n"),
    stateName: "Backlog",
    stateId: "state-backlog",
    labels: [],
    complexityTag: "unknown",
    reasoningTag: "unknown",
    ...overrides,
  };
}

test("evaluateEligibility: refuses without explicit override", () => {
  const r = evaluateEligibility(issue(), { explicitOverride: false });
  assert.equal(r.eligible, false);
  assert.match(r.reason, /no explicit dispatch target/);
});

test("evaluateEligibility: allows valid issue with explicit override", () => {
  const r = evaluateEligibility(issue(), { explicitOverride: true });
  assert.equal(r.eligible, true);
});

test("evaluateEligibility: refuses risky deploy scope", () => {
  const r = evaluateEligibility(
    issue({
      title: "Deploy the inference router to production",
    }),
    { explicitOverride: true },
  );
  assert.equal(r.eligible, false);
  assert.match(r.reason, /deploy|release|publish/i);
});

test("evaluateEligibility: refuses vague title verbs", () => {
  const r = evaluateEligibility(
    issue({ title: "Investigate auth", description: issue().description }),
    { explicitOverride: true },
  );
  assert.equal(r.eligible, false);
  assert.match(r.reason, /vague planning task/i);
});

test("evaluateEligibility: refuses missing acceptance section", () => {
  const r = evaluateEligibility(
    issue({
      description:
        "Just a paragraph with no acceptance heading and reasonable length to pass the minimum size check easily.",
    }),
    { explicitOverride: true },
  );
  assert.equal(r.eligible, false);
  assert.match(r.reason, /Acceptance Criteria/);
});

test("evaluateEligibility: refuses too-short description", () => {
  const r = evaluateEligibility(
    issue({ description: "## Acceptance Criteria\n- [ ] do" }),
    { explicitOverride: true },
  );
  assert.equal(r.eligible, false);
  assert.match(r.reason, /too short/);
});

test("evaluateEligibility: refuses empty title", () => {
  const r = evaluateEligibility(issue({ title: "   " }), {
    explicitOverride: true,
  });
  assert.equal(r.eligible, false);
});

test("evaluateEligibility: refuses missing UUID", () => {
  const r = evaluateEligibility(issue({ uuid: "" }), { explicitOverride: true });
  assert.equal(r.eligible, false);
});

test("evaluateEligibility: refuses scope that rotates a credential", () => {
  const r = evaluateEligibility(
    issue({
      description: [
        "## Summary",
        "We rotate the production credential while the service runs.",
        "",
        "## Acceptance Criteria",
        "- [ ] credential rotated",
        "Long body to satisfy minimum description length threshold for the dispatcher.",
      ].join("\n"),
    }),
    { explicitOverride: true },
  );
  assert.equal(r.eligible, false);
  assert.match(r.reason, /rotat|credential|secret/i);
});
