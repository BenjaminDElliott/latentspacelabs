import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SkillRegistry } from "./registry.js";
import { SkillRunner } from "./runner.js";
import type {
  ResolvedTools,
  SkillDefinition,
} from "./contract.js";
import { createPolicyEvaluator } from "../adapters/policy-evaluator.js";
import { createRunRecorder } from "../adapters/run-recorder.js";
import { createWriteBackFormatter } from "../adapters/write-back-formatter.js";
import { createStubLinearAdapter } from "../adapters/linear-adapter.js";
import { createStubAgentAdapter } from "../adapters/agent-invocation-adapter.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

function tools(): ResolvedTools {
  return {
    linear: createStubLinearAdapter({ issues: {} }),
    policy: createPolicyEvaluator(),
    agents: createStubAgentAdapter(),
    runRecorder: createRunRecorder(),
    writeBack: createWriteBackFormatter(),
  };
}

function minimalL3Skill(): SkillDefinition {
  return {
    name: "gate-test",
    version: "0.1.0",
    inputs: [{ name: "x", type: "string", required: true }],
    required_tools: [],
    autonomy_level: "L3-with-approval",
    requires_approval_flag: true,
    evidence: { run_report: false, linear_write_back: false, cost_band: false },
    derived_from: ["docs/decisions/0012-integration-control-plane-software-architecture.md"],
    derived_at: "2026-04-23",
    async execute() {
      return { status: "succeeded" };
    },
  };
}

test("runner refuses L3 skill without approval", async () => {
  const reg = new SkillRegistry({ repoRoot: REPO_ROOT, availableTools: [] });
  await reg.register(minimalL3Skill());
  const runner = new SkillRunner({
    registry: reg,
    tools: tools(),
    autonomyCap: "L2-propose",
  });
  const result = await runner.run({
    skill: "gate-test",
    inputs: { x: "y" },
    approve: false,
    dry_run: false,
  });
  assert.equal(result.status, "needs_human");
});

test("runner allows dry_run without approval", async () => {
  const reg = new SkillRegistry({ repoRoot: REPO_ROOT, availableTools: [] });
  await reg.register(minimalL3Skill());
  const runner = new SkillRunner({
    registry: reg,
    tools: tools(),
    autonomyCap: "L2-propose",
  });
  const result = await runner.run({
    skill: "gate-test",
    inputs: { x: "y" },
    approve: false,
    dry_run: true,
  });
  assert.equal(result.status, "succeeded");
});

test("runner fails when required inputs are missing", async () => {
  const reg = new SkillRegistry({ repoRoot: REPO_ROOT, availableTools: [] });
  await reg.register(minimalL3Skill());
  const runner = new SkillRunner({
    registry: reg,
    tools: tools(),
    autonomyCap: "L4-autonomous",
  });
  const result = await runner.run({
    skill: "gate-test",
    inputs: {},
    approve: true,
    dry_run: false,
  });
  assert.equal(result.status, "failed");
  assert.match(result.reasons.join(" "), /missing required inputs/);
});

test("runner enforces evidence contract", async () => {
  const skill: SkillDefinition = {
    ...minimalL3Skill(),
    name: "evidence-test",
    requires_approval_flag: false,
    autonomy_level: "L1-read-only",
    evidence: { run_report: true, linear_write_back: false, cost_band: false },
    inputs: [],
    async execute() {
      return { status: "succeeded" };
    },
  };
  const reg = new SkillRegistry({ repoRoot: REPO_ROOT, availableTools: [] });
  await reg.register(skill);
  const runner = new SkillRunner({
    registry: reg,
    tools: tools(),
    autonomyCap: "L4-autonomous",
  });
  const result = await runner.run({
    skill: "evidence-test",
    inputs: {},
    approve: false,
    dry_run: false,
  });
  assert.equal(result.status, "failed");
  assert.match(result.reasons.join(" "), /evidence contract violated/);
});

/* ---- LAT-66: cost-band evidence enforcement ---- */

function costBandSkill(
  exec: () => Promise<{ status: "succeeded" } & Record<string, unknown>>,
): SkillDefinition {
  return {
    name: "cost-band-test",
    version: "0.1.0",
    inputs: [],
    required_tools: [],
    autonomy_level: "L3-with-approval",
    requires_approval_flag: true,
    // `cost_band: true` is the LAT-66 gate. Skills that declare it must
    // produce a concrete band (or an explicit unknown + reason) on success.
    evidence: { run_report: false, linear_write_back: false, cost_band: true },
    derived_from: ["docs/decisions/0009-cost-controls-and-runaway-cost-interrupts.md"],
    derived_at: "2026-04-23",
    async execute() {
      return exec();
    },
  };
}

test("LAT-66: runner refuses side-effecting success with no cost_band evidence", async () => {
  const reg = new SkillRegistry({ repoRoot: REPO_ROOT, availableTools: [] });
  await reg.register(
    costBandSkill(async () => ({ status: "succeeded" })),
  );
  const runner = new SkillRunner({
    registry: reg,
    tools: tools(),
    autonomyCap: "L4-autonomous",
  });
  const result = await runner.run({
    skill: "cost-band-test",
    inputs: {},
    approve: true,
    dry_run: false,
  });
  assert.equal(result.status, "failed");
  assert.match(result.reasons.join(" "), /no cost_band/);
});

test("LAT-66: runner refuses cost_band=unknown without an unavailable reason", async () => {
  const reg = new SkillRegistry({ repoRoot: REPO_ROOT, availableTools: [] });
  await reg.register(
    costBandSkill(async () => ({
      status: "succeeded",
      cost_band: "unknown",
    })),
  );
  const runner = new SkillRunner({
    registry: reg,
    tools: tools(),
    autonomyCap: "L4-autonomous",
  });
  const result = await runner.run({
    skill: "cost-band-test",
    inputs: {},
    approve: true,
    dry_run: false,
  });
  assert.equal(result.status, "failed");
  assert.match(
    result.reasons.join(" "),
    /cost_band_unavailable_reason/,
  );
});

test("LAT-66: runner accepts cost_band=unknown paired with an explicit reason", async () => {
  const reg = new SkillRegistry({ repoRoot: REPO_ROOT, availableTools: [] });
  await reg.register(
    costBandSkill(async () => ({
      status: "succeeded",
      cost_band: "unknown",
      cost_band_unavailable_reason: "command provider returned no spend",
    })),
  );
  const runner = new SkillRunner({
    registry: reg,
    tools: tools(),
    autonomyCap: "L4-autonomous",
  });
  const result = await runner.run({
    skill: "cost-band-test",
    inputs: {},
    approve: true,
    dry_run: false,
  });
  assert.equal(result.status, "succeeded");
});

test("LAT-66: runner accepts a concrete cost band on success", async () => {
  const reg = new SkillRegistry({ repoRoot: REPO_ROOT, availableTools: [] });
  await reg.register(
    costBandSkill(async () => ({
      status: "succeeded",
      cost_band: "normal",
      cost_band_unavailable_reason: null,
    })),
  );
  const runner = new SkillRunner({
    registry: reg,
    tools: tools(),
    autonomyCap: "L4-autonomous",
  });
  const result = await runner.run({
    skill: "cost-band-test",
    inputs: {},
    approve: true,
    dry_run: false,
  });
  assert.equal(result.status, "succeeded");
});

test("LAT-66: cost-band gate does not fire for dry-run evaluations", async () => {
  const reg = new SkillRegistry({ repoRoot: REPO_ROOT, availableTools: [] });
  await reg.register(
    costBandSkill(async () => ({ status: "succeeded" })),
  );
  const runner = new SkillRunner({
    registry: reg,
    tools: tools(),
    autonomyCap: "L4-autonomous",
  });
  const result = await runner.run({
    skill: "cost-band-test",
    inputs: {},
    approve: true,
    dry_run: true,
  });
  // Dry-run bypass is intentional: no side effects, no spend, so no evidence
  // obligation. The gate only fires when the run would otherwise record a
  // real, side-effecting success (ADR-0009).
  assert.equal(result.status, "succeeded");
});
