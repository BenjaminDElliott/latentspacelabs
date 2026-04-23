import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateReadiness } from "./readiness-check.js";
import type { ReadinessTicketInput } from "./contract.js";

function readyTicket(
  overrides: Partial<ReadinessTicketInput> = {},
): ReadinessTicketInput {
  return {
    linear_issue_id: "LAT-999",
    risk_level: "low",
    budget_cap_usd: 5,
    scope_in: ["ship the thing"],
    scope_out: ["do not refactor unrelated code"],
    acceptance_criteria: ["returns 200"],
    has_tests_section: true,
    sequencing_status: "ready",
    repo: "BenjaminDElliott/latentspacelabs",
    goal: "add a /healthz endpoint returning 200 and the git SHA",
    ...overrides,
  };
}

test("readiness: passes a fully agent-ready ticket as `ready`", () => {
  const report = evaluateReadiness(readyTicket());
  assert.equal(report.verdict, "ready");
  assert.equal(report.reasons.length, 0);
  assert.equal(report.refusal_markdown, null);
});

test("readiness: refuses when budget cap is missing", () => {
  const report = evaluateReadiness(readyTicket({ budget_cap_usd: null }));
  assert.equal(report.verdict, "refuse");
  const categories = report.reasons.map((r) => r.category);
  assert.ok(
    categories.includes("missing_budget_cap"),
    `expected missing_budget_cap in ${categories.join(",")}`,
  );
  assert.match(report.refusal_markdown ?? "", /Pre-flight: REFUSED/);
});

test("readiness: refuses when repo is missing or malformed", () => {
  const r1 = evaluateReadiness(readyTicket({ repo: null }));
  const r2 = evaluateReadiness(readyTicket({ repo: "not-a-slash" }));
  for (const report of [r1, r2]) {
    assert.equal(report.verdict, "refuse");
    assert.ok(report.reasons.some((r) => r.category === "missing_repo"));
  }
});

test("readiness: refuses when scope_out is empty (pre-flight §2)", () => {
  const report = evaluateReadiness(readyTicket({ scope_out: [] }));
  assert.equal(report.verdict, "refuse");
  assert.ok(
    report.reasons.some(
      (r) => r.category === "preflight_ticket_not_agent_ready",
    ),
  );
});

test("readiness: refuses when tests section is missing", () => {
  const report = evaluateReadiness(readyTicket({ has_tests_section: false }));
  assert.equal(report.verdict, "refuse");
  assert.ok(
    report.reasons.some((r) =>
      r.message.includes("Tests section is missing"),
    ),
  );
});

test("readiness: refuses when risk level is not classified", () => {
  const report = evaluateReadiness(readyTicket({ risk_level: null }));
  assert.equal(report.verdict, "refuse");
  assert.ok(
    report.reasons.some((r) => r.message.includes("Risk level")),
  );
});

test("readiness: sequencing=unknown falls safely to caution (ADR-0005)", () => {
  const report = evaluateReadiness(
    readyTicket({ sequencing_status: "unknown" }),
  );
  assert.equal(report.verdict, "caution");
  assert.equal(report.refusal_markdown, null);
});

test("readiness: sequencing=blocked refuses dispatch", () => {
  const report = evaluateReadiness(
    readyTicket({ sequencing_status: "blocked" }),
  );
  assert.equal(report.verdict, "refuse");
});

test("readiness: sequencing=caution yields caution verdict", () => {
  const report = evaluateReadiness(
    readyTicket({ sequencing_status: "caution" }),
  );
  assert.equal(report.verdict, "caution");
});

test("readiness: refusal markdown lists each failed check", () => {
  const report = evaluateReadiness(
    readyTicket({ budget_cap_usd: null, scope_out: [], repo: null }),
  );
  assert.equal(report.verdict, "refuse");
  const md = report.refusal_markdown ?? "";
  assert.match(md, /missing_budget_cap/);
  assert.match(md, /preflight_ticket_not_agent_ready/);
  assert.match(md, /missing_repo/);
  assert.match(md, /return to `needs-refinement`/);
});
