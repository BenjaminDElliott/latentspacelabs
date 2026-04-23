import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateAdrDirectory, parseFrontmatter } from "./validate.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const REAL_DECISIONS_DIR = join(REPO_ROOT, "docs", "decisions");

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "adr-tools-"));
}

function validAdr(id: string, title: string, extra = ""): string {
  return `---
id: ${id}
title: ${title}
status: proposed
date: 2026-04-23
decision_makers:
  - Test User
${extra}---

# ${id}: ${title}
`;
}

test("real docs/decisions passes validation", async () => {
  const result = await validateAdrDirectory(REAL_DECISIONS_DIR);
  assert.deepEqual(
    result.errors,
    [],
    `Expected zero errors, got:\n${result.errors.map((e) => `${e.file}: ${e.message}`).join("\n")}`,
  );
  assert.ok(result.filesChecked.length >= 14, "expected at least 14 ADR files");
});

test("two valid ADRs in a fresh directory pass", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "0001-first.md"), validAdr("ADR-0001", "First"));
    await writeFile(join(dir, "0002-second.md"), validAdr("ADR-0002", "Second"));
    const result = await validateAdrDirectory(dir);
    assert.deepEqual(result.errors, []);
    assert.equal(result.filesChecked.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("duplicate filename prefix fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "0001-first.md"), validAdr("ADR-0001", "First"));
    await writeFile(
      join(dir, "0001-other.md"),
      validAdr("ADR-0001", "Other"),
    );
    const result = await validateAdrDirectory(dir);
    const dupErr = result.errors.find((e) =>
      e.message.includes("duplicate filename prefix"),
    );
    assert.ok(dupErr, `expected duplicate prefix error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("duplicate frontmatter id fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "0001-first.md"), validAdr("ADR-0001", "First"));
    // Second file: filename says 0002 but id collides with first.
    await writeFile(join(dir, "0002-second.md"), validAdr("ADR-0001", "Second"));
    const result = await validateAdrDirectory(dir);
    const dupErr = result.errors.find((e) =>
      e.message.includes("duplicate frontmatter id"),
    );
    assert.ok(dupErr, `expected duplicate id error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("filename prefix vs frontmatter id mismatch fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "0011-mismatch.md"), validAdr("ADR-0013", "Mismatch"));
    const result = await validateAdrDirectory(dir);
    const err = result.errors.find((e) =>
      e.message.includes("does not match frontmatter id"),
    );
    assert.ok(err, `expected mismatch error, got: ${JSON.stringify(result.errors)}`);
    assert.match(err!.message, /0011/);
    assert.match(err!.message, /ADR-0013/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing required frontmatter key fails", async () => {
  const dir = await makeTempDir();
  try {
    const content = `---
id: ADR-0001
title: Missing status
date: 2026-04-23
decision_makers:
  - Test User
---

body
`;
    await writeFile(join(dir, "0001-missing-status.md"), content);
    const result = await validateAdrDirectory(dir);
    const err = result.errors.find((e) => e.message.includes("'status'"));
    assert.ok(err, `expected status missing error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing frontmatter fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "0001-no-frontmatter.md"), "# no frontmatter\n");
    const result = await validateAdrDirectory(dir);
    const err = result.errors.find((e) => e.message.includes("frontmatter"));
    assert.ok(err);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bad filename format fails", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "1-short.md"), validAdr("ADR-0001", "Short"));
    const result = await validateAdrDirectory(dir);
    const err = result.errors.find((e) => e.message.includes("filename does not match"));
    assert.ok(err);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bad id format fails", async () => {
  const dir = await makeTempDir();
  try {
    const content = `---
id: ADR-1
title: Bad id
status: proposed
date: 2026-04-23
decision_makers:
  - Test User
---

body
`;
    await writeFile(join(dir, "0001-bad-id.md"), content);
    const result = await validateAdrDirectory(dir);
    const err = result.errors.find((e) => e.message.includes("does not match ADR-NNNN"));
    assert.ok(err, `expected bad id format error, got: ${JSON.stringify(result.errors)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("README.md is ignored", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, "README.md"), "# not an ADR\n");
    await writeFile(join(dir, "0001-first.md"), validAdr("ADR-0001", "First"));
    const result = await validateAdrDirectory(dir);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.filesChecked, ["0001-first.md"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nested subdirectories are ignored", async () => {
  const dir = await makeTempDir();
  try {
    await mkdir(join(dir, "drafts"));
    await writeFile(
      join(dir, "drafts", "0099-draft.md"),
      validAdr("ADR-0099", "Draft"),
    );
    await writeFile(join(dir, "0001-first.md"), validAdr("ADR-0001", "First"));
    const result = await validateAdrDirectory(dir);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.filesChecked, ["0001-first.md"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseFrontmatter returns null for file with no leading ---", () => {
  assert.equal(parseFrontmatter("# hi\nno frontmatter"), null);
});

test("parseFrontmatter handles list values", () => {
  const parsed = parseFrontmatter(`---
id: ADR-0001
decision_makers:
  - Alice
  - Bob
---
body
`);
  assert.ok(parsed);
  assert.equal(parsed.fields["id"], "ADR-0001");
  assert.deepEqual(parsed.fields["decision_makers"], ["Alice", "Bob"]);
});
