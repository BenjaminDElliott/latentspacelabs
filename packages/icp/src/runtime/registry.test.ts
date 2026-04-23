import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SkillRegistry, SkillRegistryError } from "./registry.js";
import type { SkillDefinition } from "./contract.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

function goodSkill(): SkillDefinition {
  return {
    name: "test-skill",
    version: "0.1.0",
    inputs: [],
    required_tools: ["linear-adapter"],
    autonomy_level: "L1-read-only",
    requires_approval_flag: false,
    evidence: { run_report: false, linear_write_back: false, cost_band: false },
    derived_from: ["docs/decisions/0012-integration-control-plane-software-architecture.md"],
    derived_at: "2026-04-23",
    async execute() {
      return { status: "succeeded" };
    },
  };
}

test("registry accepts a well-formed skill", async () => {
  const reg = new SkillRegistry({
    repoRoot: REPO_ROOT,
    availableTools: ["linear-adapter"],
  });
  const entry = await reg.register(goodSkill());
  assert.equal(entry.key, "test-skill@0.1.0");
  assert.equal(reg.list().length, 1);
  assert.equal(reg.get("test-skill")?.definition.version, "0.1.0");
});

test("registry rejects empty derived_from (ADR-0004)", async () => {
  const reg = new SkillRegistry({
    repoRoot: REPO_ROOT,
    availableTools: ["linear-adapter"],
  });
  const bad: SkillDefinition = { ...goodSkill(), derived_from: [] };
  await assert.rejects(() => reg.register(bad), SkillRegistryError);
});

test("registry rejects derived_from that does not resolve", async () => {
  const reg = new SkillRegistry({
    repoRoot: REPO_ROOT,
    availableTools: ["linear-adapter"],
  });
  const bad: SkillDefinition = {
    ...goodSkill(),
    derived_from: ["docs/decisions/does-not-exist.md"],
  };
  await assert.rejects(() => reg.register(bad), /derived_from path does not resolve/);
});

test("registry rejects derived_from outside canonical-doc roots (ADR-0016)", async () => {
  const reg = new SkillRegistry({
    repoRoot: REPO_ROOT,
    availableTools: ["linear-adapter"],
  });
  const bad: SkillDefinition = {
    ...goodSkill(),
    // Points at a real, resolvable file that is NOT under docs/{decisions,prds,process,templates}/.
    derived_from: ["package.json"],
  };
  await assert.rejects(
    () => reg.register(bad),
    /derived_from path must point into/,
  );
});

test("registry rejects unknown required tool", async () => {
  const reg = new SkillRegistry({
    repoRoot: REPO_ROOT,
    availableTools: [],
  });
  await assert.rejects(() => reg.register(goodSkill()), /required tool/);
});

test("registry rejects duplicate name@version", async () => {
  const reg = new SkillRegistry({
    repoRoot: REPO_ROOT,
    availableTools: ["linear-adapter"],
  });
  await reg.register(goodSkill());
  await assert.rejects(() => reg.register(goodSkill()), /duplicate skill/);
});

test("registry rejects non-semver version", async () => {
  const reg = new SkillRegistry({
    repoRoot: REPO_ROOT,
    availableTools: ["linear-adapter"],
  });
  const bad: SkillDefinition = { ...goodSkill(), version: "v1" };
  await assert.rejects(() => reg.register(bad), /semver/);
});
