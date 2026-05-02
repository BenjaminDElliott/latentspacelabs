import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTicketPack } from "./ticket-pack.js";
import type { DispatchIssue } from "./types.js";

function makeIssue(overrides: Partial<DispatchIssue> = {}): DispatchIssue {
  return {
    identifier: "LAT-200",
    uuid: "uuid-200",
    title: "Add a foo to the bar",
    description: "## Acceptance Criteria\n- [ ] do the thing\n",
    stateName: "Backlog",
    stateId: "state-backlog",
    labels: [],
    ...overrides,
  };
}

test("buildTicketPack: includes header, identifier, branch, prefix", () => {
  const r = buildTicketPack({ issue: makeIssue() });
  assert.match(r.content, /# opencode Ticket Pack/);
  assert.match(r.content, /\*\*Linear ID:\*\* LAT-200/);
  assert.match(r.content, /\*\*Readiness status:\*\* ready/);
  assert.equal(r.prTitlePrefix, "LAT-200:");
  assert.match(r.branch, /^lat-200-/);
  assert.equal(r.filename, "lat-200.pack.md");
});

test("buildTicketPack: truncates oversized descriptions", () => {
  const longDesc = "## Acceptance Criteria\n" + "x".repeat(20000);
  const r = buildTicketPack({
    issue: makeIssue({ description: longDesc }),
    maxDescriptionChars: 500,
  });
  assert.match(r.content, /\[truncated by dispatcher\]/);
  // The block must remain shorter than full description.
  assert.ok(r.content.length < longDesc.length);
});

test("buildTicketPack: includes branch & PR rules and forbidden actions", () => {
  const r = buildTicketPack({ issue: makeIssue() });
  assert.match(r.content, /## Branch \/ PR rules/);
  assert.match(r.content, /## Forbidden actions/);
  assert.match(r.content, /No deploys, merges/);
});

test("buildTicketPack: handles no description gracefully", () => {
  const r = buildTicketPack({ issue: makeIssue({ description: "" }) });
  assert.match(r.content, /\(no description provided\)/);
});

test("buildTicketPack: branch slug avoids special chars", () => {
  const r = buildTicketPack({
    issue: makeIssue({ title: "Fix !!! the @@@ thing/here" }),
  });
  assert.match(r.branch, /^lat-200-fix-the-thing-here$/);
});
