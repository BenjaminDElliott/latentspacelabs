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

/** RunPod **console** API key shape (management REST only). */
const FAKE_RUNPOD_API = "example-runpod-console-api-key-not-real-abcdef012345";
/** vLLM / inference bearer (optional child env only). */
const FAKE_VLLM_KEY = "example-vllm-inference-key-not-real-ghij678901234";
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
    RUNPOD_API_KEY: FAKE_RUNPOD_API,
    RUNPOD_VLLM_API_KEY: FAKE_VLLM_KEY,
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
            "RUNPOD_API_KEY",
            "RUNPOD_POD_ID",
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
        RUNPOD_API_KEY: FAKE_RUNPOD_API,
      },
    });
    await assert.rejects(adapter.prepare(), (err: unknown) => {
      assert.ok(err instanceof MissingConfigError);
      assert.doesNotMatch(err.message, new RegExp(FAKE_RUNPOD_API));
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
      assert.doesNotMatch(err.message, new RegExp(FAKE_RUNPOD_API));
      assert.doesNotMatch(err.message, new RegExp(FAKE_VLLM_KEY));
      assert.doesNotMatch(err.message, new RegExp(FAKE_POD));
      return true;
    });
  });

  it("redacts the token and pod id from a RunPod fetch failure", async () => {
    const failing: RunPodFetcher = async () => {
      throw new Error(
        `connect failed for https://rest.runpod.io/v1/pods/${FAKE_POD} with Authorization: Bearer ${FAKE_RUNPOD_API}`,
      );
    };
    const adapter = new LiveOpencodeAdapter({
      env: makeEnv(),
      runpod: failing,
    });
    await assert.rejects(adapter.prepare(), (err: unknown) => {
      assert.ok(err instanceof MissingConfigError);
      assert.doesNotMatch(err.message, new RegExp(FAKE_RUNPOD_API));
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
        { exitCode: 1, stderr: `oops involving ${FAKE_VLLM_KEY}` }, // second check fails
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
      assert.doesNotMatch(detail, new RegExp(FAKE_VLLM_KEY));
      assert.match(detail, /\[REDACTED\]/);
    });
  });

  it("returns failed when opencode exits non-zero", async () => {
    await withSandbox(async (sandbox) => {
      const { runProcess } = makeProcessRunner([
        { exitCode: 7, stderr: `crash with token=${FAKE_VLLM_KEY}` },
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
      assert.doesNotMatch(msg, new RegExp(FAKE_VLLM_KEY));
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
        { exitCode: 0, stdout: `bearer=${FAKE_VLLM_KEY} mgmt=${FAKE_RUNPOD_API} pod=${FAKE_POD}` },
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
      assert.doesNotMatch(json, new RegExp(FAKE_VLLM_KEY));
      assert.doesNotMatch(json, new RegExp(FAKE_RUNPOD_API));
      assert.doesNotMatch(json, new RegExp(FAKE_POD));
    });
  });

  it("forwards inference key and pod id to the child via env, never argv; never forwards console API key", async () => {
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
      for (const a of opencodeCall.args) {
        assert.doesNotMatch(a, new RegExp(FAKE_RUNPOD_API));
        assert.doesNotMatch(a, new RegExp(FAKE_VLLM_KEY));
        assert.doesNotMatch(a, new RegExp(FAKE_POD));
      }
      assert.equal(opencodeCall.env["RUNPOD_VLLM_API_KEY"], FAKE_VLLM_KEY);
      assert.equal(opencodeCall.env["RUNPOD_POD_ID"], FAKE_POD);
      assert.notEqual(
        opencodeCall.env["RUNPOD_API_KEY"],
        FAKE_RUNPOD_API,
        "adapter must not inject RUNPOD_API_KEY into the child; console key is management-only",
      );
    });
  });

  it("forwards the ticket pack to opencode via -f and uses workdir as cwd", async () => {
    await withSandbox(async (sandbox) => {
      const workdir = "/tmp/sandbox-irrelevant";
      const { runProcess, calls } = makeProcessRunner([{ exitCode: 0 }, { exitCode: 0 }]);
      const adapter = new LiveOpencodeAdapter({
        env: makeEnv({ CONTROL_LOOP_WORKDIR: workdir }),
        runpod: runPodOk(),
        runProcess,
        makeSandbox: async () => ({ path: sandbox, cleanup: async () => {} }),
      });
      await adapter.prepare();
      await adapter.run(makeReq());
      const opencodeCall = calls[0];
      assert.ok(opencodeCall);
      assert.equal(opencodeCall.cwd, workdir);
      assert.ok(!opencodeCall.args.includes("--pack"));
      assert.ok(!opencodeCall.args.includes("--workdir"));
      const fIdx = opencodeCall.args.indexOf("-f");
      assert.ok(fIdx >= 0, "expected -f before pack path");
      assert.equal(opencodeCall.args[fIdx + 1], join(sandbox, "ticket-pack.md"));
      assert.ok(opencodeCall.args.includes("run"));
      assert.ok(opencodeCall.args.includes("--print-logs"));
      const msg =
        "Implement the attached ticket pack exactly. Refuse if anything is unclear or out of scope.";
      const msgIdx = opencodeCall.args.indexOf(msg);
      const fIdx2 = opencodeCall.args.indexOf("-f");
      assert.ok(msgIdx >= 0 && fIdx2 >= 0 && msgIdx < fIdx2, "message must precede -f so yargs does not treat the prompt as another --file path");
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
      `token=${FAKE_RUNPOD_API}, pod=${FAKE_POD}, repeated=${FAKE_RUNPOD_API}`,
      [FAKE_RUNPOD_API, FAKE_POD],
    );
    assert.doesNotMatch(out, new RegExp(FAKE_RUNPOD_API));
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
