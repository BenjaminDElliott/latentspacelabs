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
    evidence: { run_report: false, linear_write_back: false },
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
    evidence: { run_report: true, linear_write_back: false },
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
