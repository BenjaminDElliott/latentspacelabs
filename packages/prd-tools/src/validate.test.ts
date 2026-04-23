import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePrdDirectory, parseFrontmatter } from "./validate.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const REAL_PRDS_DIR = join(REPO_ROOT, "docs", "prds");

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "prd-tools-"));
}

interface PrdFrontmatterOverrides {
  prd_id?: string;
  title?: string;
  status?: string;
  owner?: string;
  date?: string;
  related_linear?: string[];
  related_adrs?: string[];
  derived_from?: string[];
  supersedes?: string;
  superseded_by?: string;
}

function renderList(key: string, items: string[] | undefined): string {
  if (items === undefined) return `${key}:\n`;
  if (items.length === 0) return `${key}:\n`;
  return `${key}:\n${items.map((i) => `  - ${i}`).join("\n")}\n`;
}

function renderScalar(key: string, value: string | undefined): string {
  if (value === undefined || value === "") return `${key}:\n`;
  return `${key}: ${value}\n`;
}

function prdFile(overrides: PrdFrontmatterOverrides = {}): string {
  const {
    prd_id = "LAT-99-example",
    title = "Example PRD",
    status = "draft",
    owner = "Test User",
    date = "2026-04-23",
    related_linear = ["LAT-99"],
    related_adrs = ["ADR-0001"],
    derived_from = ["root-agentic-development-flywheel"],
    supersedes,
    superseded_by,
  } = overrides;

  return `---
${renderScalar("prd_id", prd_id)}${renderScalar("title", title)}${renderScalar("status", status)}${renderScalar("owner", owner)}${renderScalar("date", date)}${renderList("related_linear", related_linear)}${renderList("related_adrs", related_adrs)}${renderList("derived_from", derived_from)}${renderScalar("supersedes", supersedes)}${renderScalar("superseded_by", superseded_by)}---

# ${title}

body
`;
}

function rootPrdFile(slug: string, overrides: PrdFrontmatterOverrides = {}): string {
  return prdFile({
    prd_id: `root-${slug}`,
    title: "Root PRD",
    derived_from: [],
    ...overrides,
  });
}

test("real docs/prds passes validation", async () => {
  const result = await validatePrdDirectory(REAL_PRDS_DIR);
  assert.deepEqual(
    result.errors,
    [],
    `Expected zero errors, got:\n${result.errors.map((e) => `${e.file}: ${e.message}`).join("\n")}`,
  );
  assert.ok(result.filesChecked.length >= 2, "expected at least 2 PRD files");
});

test("valid root + feature PRD in a fresh directory pass", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "root-flywheel.md"), rootPrdFile("flywheel"));
    await writeFile(
      join(dir, "LAT-100-intake.md"),
      prdFile({
        prd_id: "LAT-100-intake",
        related_linear: ["LAT-100"],
        derived_from: ["root-flywheel"],
      }),
    );
    const result = await validatePrdDirectory(dir);
    assert.deepEqual(result.errors, []);
    assert.equal(result.filesChecked.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("NNNN-*.md numeric filename is rejected", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(
      join(dir, "0001-low-friction-intake.md"),
      prdFile({ prd_id: "0001-low-friction-intake" }),
    );
    const result = await validatePrdDirectory(dir);
    const err = result.errors.find((e) => e.message.includes("numeric filename"));
    assert.ok(err, `expected numeric filename error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unrecognized filename is rejected", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "random-thing.md"), prdFile());
    const result = await validatePrdDirectory(dir);
    const err = result.errors.find((e) => e.message.includes("filename does not match"));
    assert.ok(err);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("duplicate prd_id fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "root-flywheel.md"), rootPrdFile("flywheel"));
    await writeFile(
      join(dir, "LAT-100-intake.md"),
      prdFile({
        prd_id: "LAT-101-intake",
        related_linear: ["LAT-100"],
        derived_from: ["root-flywheel"],
      }),
    );
    await writeFile(
      join(dir, "LAT-101-intake.md"),
      prdFile({
        prd_id: "LAT-101-intake",
        related_linear: ["LAT-101"],
        derived_from: ["root-flywheel"],
      }),
    );
    const result = await validatePrdDirectory(dir);
    const dupErr = result.errors.find((e) =>
      e.message.includes("duplicate frontmatter prd_id"),
    );
    assert.ok(dupErr, `expected duplicate prd_id error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prd_id not matching filename stem fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "root-flywheel.md"), rootPrdFile("flywheel"));
    await writeFile(
      join(dir, "LAT-100-intake.md"),
      prdFile({
        prd_id: "LAT-101-intake",
        related_linear: ["LAT-100"],
        derived_from: ["root-flywheel"],
      }),
    );
    const result = await validatePrdDirectory(dir);
    const err = result.errors.find((e) => e.message.includes("does not match filename stem"));
    assert.ok(err, `expected prd_id/stem mismatch, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing required frontmatter key fails", async () => {
  const dir = await makeTempDir();
  try {
    const content = `---
prd_id: LAT-100-intake
title: Missing status
owner: Test User
date: 2026-04-23
related_linear:
  - LAT-100
related_adrs:
  - ADR-0001
derived_from:
  - root-flywheel
supersedes:
superseded_by:
---

body
`;
    await writeFile(join(dir, "root-flywheel.md"), rootPrdFile("flywheel"));
    await writeFile(join(dir, "LAT-100-intake.md"), content);
    const result = await validatePrdDirectory(dir);
    const err = result.errors.find((e) => e.message.includes("'status'"));
    assert.ok(err, `expected status missing error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid status value fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "root-flywheel.md"), rootPrdFile("flywheel"));
    await writeFile(
      join(dir, "LAT-100-intake.md"),
      prdFile({
        prd_id: "LAT-100-intake",
        status: "wip",
        related_linear: ["LAT-100"],
        derived_from: ["root-flywheel"],
      }),
    );
    const result = await validatePrdDirectory(dir);
    const err = result.errors.find((e) => e.message.includes("status 'wip'"));
    assert.ok(err, `expected invalid status error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing frontmatter fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "root-flywheel.md"), "# no frontmatter\n");
    const result = await validatePrdDirectory(dir);
    const err = result.errors.find((e) => e.message.includes("frontmatter"));
    assert.ok(err);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("root PRD with non-empty derived_from fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(
      join(dir, "root-flywheel.md"),
      rootPrdFile("flywheel", { derived_from: ["root-other"] }),
    );
    const result = await validatePrdDirectory(dir);
    const err = result.errors.find((e) =>
      e.message.includes("root PRD must have empty derived_from"),
    );
    assert.ok(err, `expected root derived_from error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("feature PRD with empty derived_from fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "root-flywheel.md"), rootPrdFile("flywheel"));
    await writeFile(
      join(dir, "LAT-100-intake.md"),
      prdFile({
        prd_id: "LAT-100-intake",
        related_linear: ["LAT-100"],
        derived_from: [],
      }),
    );
    const result = await validatePrdDirectory(dir);
    const err = result.errors.find((e) =>
      e.message.includes("feature PRD must set derived_from"),
    );
    assert.ok(err, `expected feature derived_from error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("feature PRD derived_from pointing at unknown stem fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "root-flywheel.md"), rootPrdFile("flywheel"));
    await writeFile(
      join(dir, "LAT-100-intake.md"),
      prdFile({
        prd_id: "LAT-100-intake",
        related_linear: ["LAT-100"],
        derived_from: ["root-nonexistent"],
      }),
    );
    const result = await validatePrdDirectory(dir);
    const err = result.errors.find((e) =>
      e.message.includes("derived_from 'root-nonexistent'"),
    );
    assert.ok(err, `expected derived_from resolution error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("feature PRD derived_from pointing at a feature PRD fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "root-flywheel.md"), rootPrdFile("flywheel"));
    await writeFile(
      join(dir, "LAT-99-parent.md"),
      prdFile({
        prd_id: "LAT-99-parent",
        related_linear: ["LAT-99"],
        derived_from: ["root-flywheel"],
      }),
    );
    await writeFile(
      join(dir, "LAT-100-intake.md"),
      prdFile({
        prd_id: "LAT-100-intake",
        related_linear: ["LAT-100"],
        derived_from: ["LAT-99-parent"],
      }),
    );
    const result = await validatePrdDirectory(dir);
    const err = result.errors.find((e) =>
      e.message.includes("is not a root PRD"),
    );
    assert.ok(err, `expected not-a-root error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("feature PRD filename LAT-NN not in related_linear fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "root-flywheel.md"), rootPrdFile("flywheel"));
    await writeFile(
      join(dir, "LAT-100-intake.md"),
      prdFile({
        prd_id: "LAT-100-intake",
        related_linear: ["LAT-200"],
        derived_from: ["root-flywheel"],
      }),
    );
    const result = await validatePrdDirectory(dir);
    const err = result.errors.find((e) =>
      e.message.includes("does not appear in related_linear"),
    );
    assert.ok(err, `expected linear prefix error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("README.md is ignored", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "README.md"), "# not a PRD\n");
    await writeFile(join(dir, "root-flywheel.md"), rootPrdFile("flywheel"));
    const result = await validatePrdDirectory(dir);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.filesChecked, ["root-flywheel.md"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nested subdirectories are ignored", async () => {
  const dir = await makeTempDir();
  try {
    await mkdir(join(dir, "drafts"));
    await writeFile(
      join(dir, "drafts", "LAT-999-draft.md"),
      prdFile({ prd_id: "LAT-999-draft", related_linear: ["LAT-999"] }),
    );
    await writeFile(join(dir, "root-flywheel.md"), rootPrdFile("flywheel"));
    const result = await validatePrdDirectory(dir);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.filesChecked, ["root-flywheel.md"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseFrontmatter returns null for file with no leading ---", () => {
  assert.equal(parseFrontmatter("# hi\nno frontmatter"), null);
});

test("parseFrontmatter handles list values", () => {
  const parsed = parseFrontmatter(`---
prd_id: LAT-100-intake
related_linear:
  - LAT-100
  - LAT-101
---
body
`);
  assert.ok(parsed);
  assert.equal(parsed.fields["prd_id"], "LAT-100-intake");
  assert.deepEqual(parsed.fields["related_linear"], ["LAT-100", "LAT-101"]);
});
