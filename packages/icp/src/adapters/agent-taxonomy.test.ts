/**
 * Tests for the agent taxonomy (LAT-161).
 *
 * Verifies:
 *  - All four planned agent types are registered.
 *  - Each agent type exposes purpose, autonomy_level, risk_profile,
 *    invocation_pattern, typical_inputs, and typical_outputs.
 *  - Autonomy levels reference the ADR-0008 / ADR-0013 scale (L1–L4).
 *  - Risk profiles are one of: low | medium | high | critical.
 *  - Invocation patterns are one of: direct | proposed | acl-routed | stop-and-ask.
 *  - Extensibility: adding a new type must either match an existing
 *    classification or extend it cleanly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAgentType,
  getRegisteredAgentTypes,
  validateAgentType,
  classifyNewAgentType,
  AGENT_TYPE_IDS,
  type AgentTypeRegistration,
} from "./agent-taxonomy.js";

/* ------------------------------------------------------------------ */
/* Fixture helpers                                                     */
/* ------------------------------------------------------------------ */

function makeValidAgent(id: string): AgentTypeRegistration {
  return {
    id,
    purpose: `Test purpose for ${id}`,
    autonomy_level: "L2-propose",
    risk_profile: "medium",
    invocation_pattern: "acl-routed",
    typical_inputs: ["issue_id"],
    typical_outputs: ["pr_url", "run_report"],
  };
}

/* ------------------------------------------------------------------ */
/* Registration tests                                                 */
/* ------------------------------------------------------------------ */

test("getRegisteredAgentTypes returns exactly four types", () => {
  const types = getRegisteredAgentTypes();
  assert.equal(types.length, 4, "must return exactly four registered agent types");
});

test("all four expected type IDs are registered", () => {
  const types = getRegisteredAgentTypes();
  const ids = types.map((t) => t.id);
  for (const expected of AGENT_TYPE_IDS) {
    assert.ok(ids.includes(expected), `${expected} must be in registered types`);
  }
});

test("getAgentType returns the correct registration for each type", () => {
  for (const typeId of AGENT_TYPE_IDS) {
    const reg = getAgentType(typeId);
    assert.ok(reg, `${typeId} must have a registration`);
    assert.equal(reg.id, typeId);
    assert.ok(typeof reg.purpose === "string" && reg.purpose.length > 0);
    assert.ok(
      ["L1-read-only", "L2-propose", "L3-with-approval", "L4-autonomous"].includes(reg.autonomy_level),
    );
    assert.ok(
      ["low", "medium", "high", "critical"].includes(reg.risk_profile),
    );
    assert.ok(
      ["direct", "proposed", "acl-routed", "stop-and-ask"].includes(reg.invocation_pattern),
    );
    assert.ok(Array.isArray(reg.typical_inputs) && reg.typical_inputs.length > 0);
    assert.ok(Array.isArray(reg.typical_outputs) && reg.typical_outputs.length > 0);
  }
});

/* ------------------------------------------------------------------ */
/* Validation tests                                                   */
/* ------------------------------------------------------------------ */

test("validateAgentType accepts a well-formed registration", () => {
  const valid = makeValidAgent("test-agent");
  const errors = validateAgentType(valid);
  assert.equal(errors.length, 0, `must pass validation: ${JSON.stringify(errors)}`);
});

test("validateAgentType rejects missing id", () => {
  const invalid = { ...makeValidAgent("test-agent"), id: "" };
  const errors = validateAgentType(invalid as AgentTypeRegistration);
  assert.ok(errors.length > 0, "must reject empty id");
});

test("validateAgentType rejects unknown autonomy level", () => {
  const invalid = { ...makeValidAgent("test-agent"), autonomy_level: "L99" as "L1-read-only" };
  const errors = validateAgentType(invalid as AgentTypeRegistration);
  assert.ok(errors.length > 0, "must reject unknown autonomy level");
});

test("validateAgentType rejects unknown risk profile", () => {
  const invalid = { ...makeValidAgent("test-agent"), risk_profile: "extreme" as "low" };
  const errors = validateAgentType(invalid as AgentTypeRegistration);
  assert.ok(errors.length > 0, "must reject unknown risk profile");
});

test("validateAgentType rejects unknown invocation pattern", () => {
  const invalid = { ...makeValidAgent("test-agent"), invocation_pattern: "manual" as "direct" };
  const errors = validateAgentType(invalid as AgentTypeRegistration);
  assert.ok(errors.length > 0, "must reject unknown invocation pattern");
});

/* ------------------------------------------------------------------ */
/* Extensibility tests                                                */
/* ------------------------------------------------------------------ */

test("classifyNewAgentType classifies coding correctly", () => {
  const classification = classifyNewAgentType({
    id: "custom-coding",
    purpose: "Writes code from tickets",
    autonomy_level: "L3-with-approval",
    risk_profile: "medium",
    invocation_pattern: "acl-routed",
    typical_inputs: ["ticket_id"],
    typical_outputs: ["pr_url"],
    domain: "code-generation",
  });
  assert.equal(classification.match, "coding");
  assert.ok(classification.confidence >= 0.25);
});

test("classifyNewAgentType classifies qa correctly", () => {
  const classification = classifyNewAgentType({
    id: "custom-qa",
    purpose: "Runs tests and evaluates quality",
    autonomy_level: "L2-propose",
    risk_profile: "low",
    invocation_pattern: "acl-routed",
    typical_inputs: ["pr_url"],
    typical_outputs: ["qa_report"],
    domain: "testing",
  });
  assert.equal(classification.match, "qa");
  assert.ok(classification.confidence >= 0.25);
});

test("classifyNewAgentType classifies pr-review correctly", () => {
  const classification = classifyNewAgentType({
    id: "custom-review",
    purpose: "Reviews pull requests for correctness",
    autonomy_level: "L2-propose",
    risk_profile: "low",
    invocation_pattern: "acl-routed",
    typical_inputs: ["pr_url"],
    typical_outputs: ["review_comments"],
    domain: "code-review",
  });
  assert.equal(classification.match, "pr-review");
  assert.ok(classification.confidence >= 0.25);
});

test("classifyNewAgentType classifies sre/deploy correctly", () => {
  const classification = classifyNewAgentType({
    id: "custom-sre",
    purpose: "Deploys and manages infrastructure",
    autonomy_level: "L3-with-approval",
    risk_profile: "high",
    invocation_pattern: "acl-routed",
    typical_inputs: ["env", "artifact"],
    typical_outputs: ["deploy_status"],
    domain: "infrastructure",
  });
  assert.equal(classification.match, "sre");
  assert.ok(classification.confidence >= 0.25);
});

test("classifyNewAgentType returns no match for unknown domains", () => {
  const classification = classifyNewAgentType({
    id: "unknown-agent",
    purpose: "Does something not covered",
    autonomy_level: "L1-read-only",
    risk_profile: "low",
    invocation_pattern: "direct",
    typical_inputs: ["input"],
    typical_outputs: ["output"],
    domain: "data-warehouse",
  });
  assert.equal(classification.match, null);
});

test("classifyNewAgentType requires confidence threshold for match", () => {
  // Purpose says "code" but domain is unrelated — should not match strongly
  const classification = classifyNewAgentType({
    id: "weak-code-agent",
    purpose: "Parses code files for statistics",
    autonomy_level: "L1-read-only",
    risk_profile: "low",
    invocation_pattern: "direct",
    typical_inputs: ["file_path"],
    typical_outputs: ["stats"],
    domain: "analytics",
  });
  assert.ok(classification.confidence < 0.5, "weak match should have low confidence");
  assert.equal(classification.match, null);
});
