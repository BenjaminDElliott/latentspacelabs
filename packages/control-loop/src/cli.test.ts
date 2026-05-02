import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "./cli.js";

const READY_PACK = new URL("./__fixtures__/ready-pack.md", import.meta.url).pathname;
const BLOCKED_PACK = new URL("./__fixtures__/blocked-pack.md", import.meta.url).pathname;

interface CapturedStreams {
  stdout: string;
  stderr: string;
  restore: () => void;
}

function captureStreams(): CapturedStreams {
  let stdout = "";
  let stderr = "";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: string | Uint8Array): boolean => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: string | Uint8Array): boolean => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  };
  return {
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    restore: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdout as any).write = origOut;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stderr as any).write = origErr;
    },
  };
}

describe("control-loop CLI", () => {
  it("exits 0 with markdown summary for a ready pack in mock mode", async () => {
    const cap = captureStreams();
    try {
      const code = await main([READY_PACK, "--mode", "mock"]);
      assert.equal(code, 0);
      assert.match(cap.stdout, /control-loop run — LAT-999/);
      assert.match(cap.stdout, /READY_FOR_REVIEW/);
    } finally {
      cap.restore();
    }
  });

  it("exits 2 for a blocked pack", async () => {
    const cap = captureStreams();
    try {
      const code = await main([BLOCKED_PACK, "--mode", "mock"]);
      assert.equal(code, 2);
      assert.match(cap.stdout, /REFUSED/);
    } finally {
      cap.restore();
    }
  });

  it("writes JSON to --out and exits 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "control-loop-cli-test-"));
    const outPath = join(dir, "summary.json");
    const cap = captureStreams();
    try {
      const code = await main([READY_PACK, "--mode", "mock", "--format", "json", "--out", outPath]);
      assert.equal(code, 0);
      const body = await readFile(outPath, "utf8");
      const parsed = JSON.parse(body) as Record<string, unknown>;
      assert.equal(parsed["schemaVersion"], "1.0.0");
    } finally {
      cap.restore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown flags with exit 64", async () => {
    const cap = captureStreams();
    try {
      const code = await main([READY_PACK, "--bogus"]);
      assert.equal(code, 64);
      assert.match(cap.stderr, /unknown flag/);
    } finally {
      cap.restore();
    }
  });

  it("rejects an invalid mode value", async () => {
    const cap = captureStreams();
    try {
      const code = await main([READY_PACK, "--mode", "wild"]);
      assert.equal(code, 64);
      assert.match(cap.stderr, /--mode must be/);
    } finally {
      cap.restore();
    }
  });

  it("prints usage and exits 64 when invoked without a pack path", async () => {
    const cap = captureStreams();
    try {
      const code = await main([]);
      assert.equal(code, 64);
      assert.match(cap.stdout, /Usage: control-loop/);
    } finally {
      cap.restore();
    }
  });
});
