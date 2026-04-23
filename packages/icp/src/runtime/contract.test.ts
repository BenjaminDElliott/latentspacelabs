import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RUN_REPORT_SCHEMA_VERSION,
  toRunStatus,
  type SkillStatus,
  type TriggeredBy,
} from "./contract.js";

test("contract: schema version is a non-empty SemVer-shaped string", () => {
  assert.ok(RUN_REPORT_SCHEMA_VERSION.length > 0);
  assert.match(RUN_REPORT_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
});

test("contract: toRunStatus maps the full SkillStatus surface", () => {
  const cases: Array<[SkillStatus, ReturnType<typeof toRunStatus>]> = [
    ["succeeded", "succeeded"],
    ["failed", "failed"],
    ["needs_human", "needs_human"],
    ["ready", "needs_human"],
    ["caution", "needs_human"],
    ["blocked", "needs_human"],
    ["stopped", "cancelled"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(toRunStatus(input), expected, `toRunStatus(${input})`);
  }
});

test("contract: triggered_by accepts LAT-36 additions (hook, mcp)", () => {
  // Purely a compile-time assertion expressed as a runtime no-op so the
  // typechecker fails if `hook` or `mcp` regress out of the TriggeredBy union.
  const acceptable: ReadonlyArray<TriggeredBy> = [
    "user",
    "linear_status",
    "schedule",
    "webhook",
    "agent",
    "github_comment",
    "hook",
    "mcp",
  ];
  assert.equal(acceptable.length, 8);
});
