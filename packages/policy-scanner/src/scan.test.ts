import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  scanRepository,
  detectMarkdownIndexHotspot,
  hasBlockingFindings,
  loadConfigFromFile,
} from "./scan.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

async function makeTempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "policy-scanner-"));
}

test("real repo passes scan at main branch baseline", async () => {
  const result = await scanRepository({ root: REPO_ROOT });
  const errors = result.findings.filter((f) => f.severity === "error");
  assert.deepEqual(
    errors,
    [],
    `expected zero error findings, got:\n${result.findings.map((f) => `${f.rule} ${f.file}: ${f.message}`).join("\n")}`,
  );
});

test("pnpm-lock.yaml is flagged as error", async () => {
  const dir = await makeTempRepo();
  try {
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 6.0\n");
    const result = await scanRepository({ root: dir });
    const hit = result.findings.find((f) => f.rule === "package-manager");
    assert.ok(hit, "expected a package-manager finding");
    assert.equal(hit!.severity, "error");
    assert.equal(hit!.file, "pnpm-lock.yaml");
    assert.ok(hasBlockingFindings(result));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pnpm-workspace.yaml and yarn.lock are each flagged", async () => {
  const dir = await makeTempRepo();
  try {
    await writeFile(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    await writeFile(join(dir, "yarn.lock"), "# yarn lockfile v1\n");
    const result = await scanRepository({ root: dir });
    const files = result.findings
      .filter((f) => f.rule === "package-manager")
      .map((f) => f.file)
      .sort();
    assert.deepEqual(files, ["pnpm-workspace.yaml", "yarn.lock"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("allowedPackageManagerFiles in config suppresses the finding", async () => {
  const dir = await makeTempRepo();
  try {
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 6.0\n");
    await writeFile(
      join(dir, ".repo-policy.json"),
      JSON.stringify({ allowedPackageManagerFiles: ["pnpm-lock.yaml"] }),
    );
    const config = await loadConfigFromFile(dir);
    const result = await scanRepository({
      root: dir,
      ...(config ? { config } : {}),
    });
    const hits = result.findings.filter((f) => f.rule === "package-manager");
    assert.equal(hits.length, 0, `expected zero package-manager findings, got ${JSON.stringify(hits)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("python script in scripts/ is flagged", async () => {
  const dir = await makeTempRepo();
  try {
    await mkdir(join(dir, "scripts"));
    await writeFile(join(dir, "scripts", "build.py"), "print('hi')\n");
    const result = await scanRepository({ root: dir });
    const hit = result.findings.find((f) => f.rule === "python-tooling");
    assert.ok(hit);
    assert.equal(hit!.severity, "error");
    assert.equal(hit!.file, "scripts/build.py");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("python file in docs/ is NOT flagged (documentation mentions ok)", async () => {
  const dir = await makeTempRepo();
  try {
    await mkdir(join(dir, "docs"));
    await writeFile(join(dir, "docs", "example.py"), "# illustrative only\n");
    const result = await scanRepository({ root: dir });
    const hit = result.findings.find((f) => f.rule === "python-tooling");
    assert.equal(hit, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("python file in packages/ is flagged (executable tooling location)", async () => {
  const dir = await makeTempRepo();
  try {
    await mkdir(join(dir, "packages", "thing", "src"), { recursive: true });
    await writeFile(join(dir, "packages", "thing", "src", "main.py"), "print('x')\n");
    const result = await scanRepository({ root: dir });
    const hit = result.findings.find((f) => f.rule === "python-tooling");
    assert.ok(hit, `expected python-tooling error, got ${JSON.stringify(result.findings)}`);
    assert.equal(hit!.file, "packages/thing/src/main.py");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("allowedPythonPaths suppresses a specific script", async () => {
  const dir = await makeTempRepo();
  try {
    await mkdir(join(dir, "scripts"));
    await writeFile(join(dir, "scripts", "approved.py"), "print('ok')\n");
    await writeFile(join(dir, "scripts", "unapproved.py"), "print('bad')\n");
    await writeFile(
      join(dir, ".repo-policy.json"),
      JSON.stringify({ allowedPythonPaths: ["scripts/approved.py"] }),
    );
    const config = await loadConfigFromFile(dir);
    const result = await scanRepository({
      root: dir,
      ...(config ? { config } : {}),
    });
    const hits = result.findings
      .filter((f) => f.rule === "python-tooling")
      .map((f) => f.file);
    assert.deepEqual(hits, ["scripts/unapproved.py"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("node_modules and .git are ignored", async () => {
  const dir = await makeTempRepo();
  try {
    await mkdir(join(dir, "node_modules"), { recursive: true });
    await writeFile(join(dir, "node_modules", "yarn.lock"), "# transitive\n");
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(join(dir, ".git", "pnpm-lock.yaml"), "# pretend\n");
    const result = await scanRepository({ root: dir });
    assert.deepEqual(
      result.findings.filter((f) => f.rule === "package-manager"),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("markdown hub with large table is warned", async () => {
  const dir = await makeTempRepo();
  try {
    await mkdir(join(dir, "docs"));
    const md = [
      "# Index",
      "",
      "| Title | Doc |",
      "| --- | --- |",
      "| A | [a](a.md) |",
      "| B | [b](b.md) |",
      "| C | [c](c.md) |",
      "",
    ].join("\n");
    await writeFile(join(dir, "docs", "README.md"), md);
    const result = await scanRepository({ root: dir });
    const hit = result.findings.find((f) => f.rule === "markdown-index-hotspot");
    assert.ok(hit);
    assert.equal(hit!.severity, "warn");
    assert.equal(hit!.file, "docs/README.md");
    assert.equal(hasBlockingFindings(result), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("markdown hub with long link list is warned", async () => {
  const dir = await makeTempRepo();
  try {
    await mkdir(join(dir, "docs"));
    const bullets = Array.from({ length: 7 }, (_, i) => `- [Item ${i}](item-${i}.md)`).join("\n");
    await writeFile(join(dir, "docs", "README.md"), `# Index\n\n${bullets}\n`);
    const result = await scanRepository({ root: dir });
    const hit = result.findings.find((f) => f.rule === "markdown-index-hotspot");
    assert.ok(hit, `expected warn, got ${JSON.stringify(result.findings)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("markdown hub with short prose does not trigger", async () => {
  const dir = await makeTempRepo();
  try {
    await mkdir(join(dir, "docs"));
    await writeFile(
      join(dir, "docs", "README.md"),
      "# Docs\n\nSome prose. See [one thing](x.md) and [another](y.md).\n",
    );
    const result = await scanRepository({ root: dir });
    const hits = result.findings.filter((f) => f.rule === "markdown-index-hotspot");
    assert.deepEqual(hits, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detectMarkdownIndexHotspot identifies a link table", () => {
  const md = [
    "| Name | Doc |",
    "| --- | --- |",
    "| A | [a](a.md) |",
    "| B | [b](b.md) |",
    "| C | [c](c.md) |",
  ].join("\n");
  const hit = detectMarkdownIndexHotspot(md, { minTableRows: 3, minListLinks: 6 });
  assert.ok(hit);
  assert.match(hit!, /3 rows containing links/);
});

test("detectMarkdownIndexHotspot ignores a 2-row link table", () => {
  const md = [
    "| A | B |",
    "| --- | --- |",
    "| 1 | [a](a.md) |",
    "| 3 | [b](b.md) |",
  ].join("\n");
  const hit = detectMarkdownIndexHotspot(md, { minTableRows: 3, minListLinks: 6 });
  assert.equal(hit, null);
});

test("detectMarkdownIndexHotspot ignores a reference table with no links", () => {
  const md = [
    "| Status | Meaning |",
    "| --- | --- |",
    "| draft | being written |",
    "| accepted | in force |",
    "| superseded | replaced |",
    "| archived | historical |",
  ].join("\n");
  const hit = detectMarkdownIndexHotspot(md, { minTableRows: 3, minListLinks: 6 });
  assert.equal(hit, null);
});

test("loadConfigFromFile returns undefined when absent", async () => {
  const dir = await makeTempRepo();
  try {
    const cfg = await loadConfigFromFile(dir);
    assert.equal(cfg, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfigFromFile throws on malformed JSON", async () => {
  const dir = await makeTempRepo();
  try {
    await writeFile(join(dir, ".repo-policy.json"), "{ not json");
    await assert.rejects(() => loadConfigFromFile(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
