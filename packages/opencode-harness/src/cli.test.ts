import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "./cli.js";

const FIXTURE_PATH = new URL("./__fixtures__/lat-999-noop-pack.md", import.meta.url).pathname;

describe("cli main()", () => {
  it("prints usage and returns non-zero with no args", async () => {
    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string) => {
      stdoutChunks.push(c);
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await main([]);
      assert.equal(code, 64);
      assert.ok(stdoutChunks.join("").includes("Usage: opencode-dry-run"));
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it("returns exit code 0 for a ready pack and writes the summary to --out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-cli-test-"));
    const out = join(dir, "summary.md");
    try {
      const code = await main([FIXTURE_PATH, "--format", "markdown", "--out", out]);
      assert.equal(code, 0);
      const written = await readFile(out, "utf8");
      assert.match(written, /opencode dry-run summary/);
      assert.match(written, /LAT-999/);
      assert.doesNotMatch(written, /https?:\/\//);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns exit code 3 for an unreadable pack", async () => {
    const code = await main(["/does/not/exist.md", "--format", "json"]);
    assert.equal(code, 3);
  });
});
