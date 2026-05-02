import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LiveOpencodeAdapter,
  redactSecrets,
  type LiveAdapterEnv,
  type ProcessResult,
  type ProcessRunner,
  type ProcessSpawnOptions,
  type RunPodFetcher,
  type RunPodMetadata,
} from "./live-adapter.js";
import { MissingConfigError } from "./types.js";
import type { AdapterRequest } from "./types.js";

const FAKE_TOKEN = "rp_TEST_TOKEN_NOT_REAL_abcdef0123";
const FAKE_POD = "pod_TEST_NOT_REAL_xyz";

function makeReq(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    ticket: "LAT-121",
    packPath: "/tmp/pack.md",
    packRaw: "# pack\n",
    costBand: "low",
    riskLevel: "low",
    branch: "lat-121-test",
    prTitlePrefix: "LAT-121:",
    prBase: "main",
    filesInScope: ["packages/control-loop/**"],
    filesForbidden: [".github/workflows/**"],
    requiredChecks: [{ name: "noop", command: "true" }],
    ...overrides,
  };
}

function makeEnv(overrides: Partial<LiveAdapterEnv> = {}): LiveAdapterEnv {
  return {
    CONTROL_LOOP_LIVE_ENABLED: "1",
    CONTROL_LOOP_PROVIDER: "opencode-runpod",
    CONTROL_LOOP_WORKDIR: "/tmp/sandbox-irrelevant",
    CONTROL_LOOP_OPENCODE_BIN: "opencode-fake",
    RUNPOD_VLLM_API_KEY: FAKE_TOKEN,
    RUNPOD_POD_ID: FAKE_POD,
    ...overrides,
  };
}

function runPodOk(meta: Partial<RunPodMetadata> = {}): RunPodFetcher {
  return async () => ({ desiredStatus: "RUNNING", ...meta });
}

const runPodStopped: RunPodFetcher = async () => ({ desiredStatus: "EXITED" });

function makeProcessRunner(scripted: ReadonlyArray<Partial<ProcessResult>>): {
  runProcess: ProcessRunner;
  calls: ProcessSpawnOptions[];
} {
  const calls: ProcessSpawnOptions[] = [];
  let i = 0;
  const runProcess: ProcessRunner = async (opts) => {
    calls.push(opts);
    const next = scripted[Math.min(i, scripted.length - 1)] ?? {};
    i += 1;
    return {
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 1,
      ...next,
    };
  };
  return { runProcess, calls };
}

async function withSandbox<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const path = await mkdtemp(join(tmpdir(), "live-adapter-test-"));
  try {
    return await fn(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

describe("LiveOpencodeAdapter.prepare — env validation", () => {
  it("refuses with MissingConfigError listing every missing key", async () => {
    const adapter = new LiveOpencodeAdapter({ env: {} });
    await assert.rejects(
      adapter.prepare(),
      (err: unknown) => {
        assert.ok(err instanceof MissingConfigError);
        assert.deepEqual(
          [...err.missingKeys].sort(),
          [
            "CONTROL_LOOP_LIVE_ENABLED=1",
            "CONTROL_LOOP_PROVIDER",
            "CONTROL_LOOP_WORKDIR",
            "RUNPOD_POD_ID",
            "RUNPOD_VLLM_API_KEY",
          ].sort(),
        );
        return true;
      },
    );
  });

  it("does not echo any env value in the missing-config error message", async () => {
    const adapter = new LiveOpencodeAdapter({
      env: {
        // Partial — only one of the secrets present, plus a non-secret tag.
        CONTROL_LOOP_PROVIDER: "opencode-runpod",
        RUNPOD_VLLM_API_KEY: FAKE_TOKEN,
      },
    });
    await assert.rejects(adapter.prepare(), (err: unknown) => {
      assert.ok(err instanceof MissingConfigError);
      assert.doesNotMatch(err.message, new RegExp(FAKE_TOKEN));
      assert.doesNotMatch(err.message, /opencode-runpod/);
      return true;
    });
  });

  it("refuses if pod is not RUNNING (RunPod metadata says EXITED)", async () => {
    const adapter = new LiveOpencodeAdapter({
      env: makeEnv(),
      runpod: runPodStopped,
    });
    await assert.rejects(adapter.prepare(), (err: unknown) => {
      assert.ok(err instanceof MissingConfigError);
      assert.match(err.message, /not RUNNING/);
      assert.match(err.message, /EXITED/);
      assert.doesNotMatch(err.message, new RegExp(FAKE_TOKEN));
      assert.doesNotMatch(err.message, new RegExp(FAKE_POD));
      return true;
    });
  });

  it("redacts the token and pod id from a RunPod fetch failure", async () => {
    const failing: RunPodFetcher = async () => {
      throw new Error(
        `connect failed for https://rest.runpod.io/v1/pods/${FAKE_POD} with Authorization: Bearer ${FAKE_TOKEN}`,
      );
    };
    const adapter = new LiveOpencodeAdapter({
      env: makeEnv(),
      runpod: failing,
    });
    await assert.rejects(adapter.prepare(), (err: unknown) => {
      assert.ok(err instanceof MissingConfigError);
      assert.doesNotMatch(err.message, new RegExp(FAKE_TOKEN));
      assert.doesNotMatch(err.message, new RegExp(FAKE_POD));
      assert.match(err.message, /\[REDACTED\]/);
      return true;
    });
  });

  it("succeeds when env is complete and pod is RUNNING", async () => {
    const adapter = new LiveOpencodeAdapter({
      env: makeEnv(),
      runpod: runPodOk({ gpuTypeId: "NVIDIA-A100-80GB" }),
    });
    await adapter.prepare();
  });
});

describe("LiveOpencodeAdapter.run — outcomes", () => {
  it("returns ready_for_review when opencode and all checks pass", async () => {
    await withSandbox(async (sandbox) => {
      const { runProcess, calls } = makeProcessRunner([
        { exitCode: 0, stdout: "implementing...\n" }, // opencode
        { exitCode: 0 }, // check
      ]);
      const adapter = new LiveOpencodeAdapter({
        env: makeEnv(),
        runpod: runPodOk(),
        runProcess,
        makeSandbox: async () => ({ path: sandbox, cleanup: async () => {} }),
      });
      await adapter.prepare();
      const result = await adapter.run(
        makeReq({ requiredChecks: [{ name: "ok", command: "true" }] }),
      );
      assert.equal(result.state, "ready_for_review");
      assert.equal(result.provider.adapter, "opencode-live");
      assert.equal(result.provider.runtimeId, "opencode-runpod");
      assert.equal(result.branch.prUrl, null);
      assert.equal(result.checks.length, 1);
      assert.equal(result.checks[0]?.outcome, "passed");
      assert.equal(result.logs.type, "local-file");
      assert.equal(calls.length, 2);
    });
  });

  it("returns checks_failed when any required check fails", async () => {
    await withSandbox(async (sandbox) => {
      const { runProcess } = makeProcessRunner([
        { exitCode: 0 }, // opencode passes
        { exitCode: 0 }, // first check passes
        { exitCode: 1, stderr: `oops involving ${FAKE_TOKEN}` }, // second check fails
      ]);
      const adapter = new LiveOpencodeAdapter({
        env: makeEnv(),
        runpod: runPodOk(),
        runProcess,
        makeSandbox: async () => ({ path: sandbox, cleanup: async () => {} }),
      });
      await adapter.prepare();
      const result = await adapter.run(
        makeReq({
          requiredChecks: [
            { name: "first", command: "true" },
            { name: "second", command: "false" },
          ],
        }),
      );
      assert.equal(result.state, "checks_failed");
      assert.equal(result.checks.length, 2);
      assert.equal(result.checks[0]?.outcome, "passed");
      assert.equal(result.checks[1]?.outcome, "failed");
      const detail = result.checks[1]?.detail ?? "";
      assert.doesNotMatch(detail, new RegExp(FAKE_TOKEN));
      assert.match(detail, /\[REDACTED\]/);
    });
  });

  it("returns failed when opencode exits non-zero", async () => {
    await withSandbox(async (sandbox) => {
      const { runProcess } = makeProcessRunner([
        { exitCode: 7, stderr: `crash with token=${FAKE_TOKEN}` },
      ]);
      const adapter = new LiveOpencodeAdapter({
        env: makeEnv(),
        runpod: runPodOk(),
        runProcess,
        makeSandbox: async () => ({ path: sandbox, cleanup: async () => {} }),
      });
      await adapter.prepare();
      const result = await adapter.run(makeReq());
      assert.equal(result.state, "failed");
      assert.ok(result.refusals && result.refusals.length > 0);
      const msg = result.refusals?.[0]?.message ?? "";
      assert.match(msg, /opencode exited with code 7/);
      assert.doesNotMatch(msg, new RegExp(FAKE_TOKEN));
    });
  });

  it("returns failed with adapter_timeout when the process times out", async () => {
    await withSandbox(async (sandbox) => {
      const { runProcess } = makeProcessRunner([{ timedOut: true, exitCode: null }]);
      const adapter = new LiveOpencodeAdapter({
        env: makeEnv({ CONTROL_LOOP_TIMEOUT_MS: "5000" }),
        runpod: runPodOk(),
        runProcess,
        makeSandbox: async () => ({ path: sandbox, cleanup: async () => {} }),
      });
      await adapter.prepare();
      const result = await adapter.run(makeReq());
      assert.equal(result.state, "failed");
      assert.ok(result.refusals?.some((r) => r.code === "adapter_timeout"));
    });
  });

  it("never includes the RunPod token or pod id in any returned field", async () => {
    await withSandbox(async (sandbox) => {
      const { runProcess } = makeProcessRunner([
        { exitCode: 0, stdout: `bearer=${FAKE_TOKEN} pod=${FAKE_POD}` },
        { exitCode: 0 },
      ]);
      const adapter = new LiveOpencodeAdapter({
        env: makeEnv(),
        runpod: runPodOk(),
        runProcess,
        makeSandbox: async () => ({ path: sandbox, cleanup: async () => {} }),
      });
      await adapter.prepare();
      const result = await adapter.run(makeReq());
      const json = JSON.stringify(result);
      assert.doesNotMatch(json, new RegExp(FAKE_TOKEN));
      assert.doesNotMatch(json, new RegExp(FAKE_POD));
    });
  });

  it("forwards the RunPod credential to the spawned child via env, never argv", async () => {
    await withSandbox(async (sandbox) => {
      const { runProcess, calls } = makeProcessRunner([{ exitCode: 0 }, { exitCode: 0 }]);
      const adapter = new LiveOpencodeAdapter({
        env: makeEnv(),
        runpod: runPodOk(),
        runProcess,
        makeSandbox: async () => ({ path: sandbox, cleanup: async () => {} }),
      });
      await adapter.prepare();
      await adapter.run(makeReq());
      const opencodeCall = calls[0];
      assert.ok(opencodeCall);
      // Token and pod id must NOT appear on argv.
      for (const a of opencodeCall.args) {
        assert.doesNotMatch(a, new RegExp(FAKE_TOKEN));
        assert.doesNotMatch(a, new RegExp(FAKE_POD));
      }
      // They MUST be present in env (the spawned opencode needs them).
      assert.equal(opencodeCall.env["RUNPOD_VLLM_API_KEY"], FAKE_TOKEN);
      assert.equal(opencodeCall.env["RUNPOD_POD_ID"], FAKE_POD);
    });
  });

  it("throws if run() is called before prepare()", async () => {
    const adapter = new LiveOpencodeAdapter({
      env: makeEnv(),
      runpod: runPodOk(),
    });
    await assert.rejects(adapter.run(makeReq()), MissingConfigError);
  });
});

describe("redactSecrets", () => {
  it("replaces the literal token and pod id everywhere they appear", () => {
    const out = redactSecrets(
      `token=${FAKE_TOKEN}, pod=${FAKE_POD}, repeated=${FAKE_TOKEN}`,
      [FAKE_TOKEN, FAKE_POD],
    );
    assert.doesNotMatch(out, new RegExp(FAKE_TOKEN));
    assert.doesNotMatch(out, new RegExp(FAKE_POD));
    assert.match(out, /\[REDACTED\]/);
  });

  it("redacts Authorization headers and RunPod URLs even when no literal token is supplied", () => {
    const out = redactSecrets(
      "GET https://rest.runpod.io/v1/pods/abc with Authorization: Bearer xyzxyzxyz12345",
      [],
    );
    assert.doesNotMatch(out, /Bearer xyzxyzxyz12345/);
    assert.doesNotMatch(out, /https:\/\/rest\.runpod\.io/);
  });

  it("ignores secrets shorter than 4 characters to avoid mangling normal text", () => {
    const out = redactSecrets("the cat sat on a mat", ["a"]);
    assert.equal(out, "the cat sat on a mat");
  });
});
