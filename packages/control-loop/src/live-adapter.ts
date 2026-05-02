/**
 * Live opencode adapter (LAT-121).
 *
 * The first real adapter behind the LAT-117 RuntimeAdapter seam. It
 * invokes a locally-installed `opencode` CLI against a remote vLLM-hosted
 * Qwen runtime (RunPod, today). Three properties matter most:
 *
 *   1. **No secrets cross the seam.** The RunPod token and pod id are
 *      read from process env at the boundary, used to call RunPod's REST
 *      API for runtime metadata, and never passed back to the control
 *      loop. Stdout/stderr from the spawned process are scrubbed before
 *      they reach evidence.
 *
 *   2. **No silent fallback.** If any required env var is missing, if the
 *      RunPod metadata lookup fails, or if the pod is not running, the
 *      adapter throws `MissingConfigError` and the loop refuses. Mock
 *      mode is never substituted for a misconfigured live mode.
 *
 *   3. **No auto-merge / no PR.** This adapter spawns opencode with the
 *      ticket pack inside a sandbox working directory and runs the
 *      pack's required checks. It returns structured evidence. It never
 *      pushes, opens, or merges anything.
 *
 * Process and HTTP boundaries are injected so unit tests can drive
 * happy-path, timeout, non-zero-exit, and metadata-failure scenarios
 * deterministically. CI never makes a real network call.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AdapterRequest,
  AdapterRunResult,
  CheckResult,
  RuntimeAdapter,
} from "./types.js";
import { MissingConfigError } from "./types.js";

/**
 * Env names this adapter understands. Listed here so they appear in one
 * place; values are read at construction time and never returned to the
 * caller. Secret-bearing names live alongside non-secret names so an
 * operator can audit them, but only `RUNPOD_VLLM_API_KEY` is treated as
 * sensitive — that is the only value the redactor must scrub.
 */
export interface LiveAdapterEnv {
  /** Operator must set this to "1" to opt in. */
  CONTROL_LOOP_LIVE_ENABLED?: string | undefined;
  /** Stable provider tag, e.g. `opencode-runpod`. NEVER a URL. */
  CONTROL_LOOP_PROVIDER?: string | undefined;
  /** Local path or sandbox directory the agent may write inside. Required. */
  CONTROL_LOOP_WORKDIR?: string | undefined;
  /** Path to the `opencode` binary. Defaults to `opencode` on PATH. */
  CONTROL_LOOP_OPENCODE_BIN?: string | undefined;
  /** Optional model id override forwarded to opencode (non-secret). */
  CONTROL_LOOP_OPENCODE_MODEL?: string | undefined;
  /** Optional wall-clock cap, in milliseconds. Default: 300000 (5 min). */
  CONTROL_LOOP_TIMEOUT_MS?: string | undefined;
  /**
   * RunPod REST bearer token. SECRET — never logged, never serialized,
   * never returned in evidence. Presence is reported, value is not.
   */
  RUNPOD_VLLM_API_KEY?: string | undefined;
  /** RunPod pod identifier. Used to fetch runtime metadata. */
  RUNPOD_POD_ID?: string | undefined;
}

/**
 * Subset of RunPod's GET /v1/pods/{podId} response we consume. The
 * adapter intentionally keeps this narrow: only fields needed to decide
 * whether the pod is reachable land here. Endpoint URL details are not
 * propagated outside this module.
 */
export interface RunPodMetadata {
  desiredStatus: string;
  /** Optional but useful for evidence. Never a URL or token. */
  gpuTypeId?: string | undefined;
  /** Cost in USD/hr if RunPod returns it; opaque otherwise. */
  costPerHr?: number | undefined;
}

export interface RunPodFetchOptions {
  podId: string;
  apiKey: string;
  signal?: AbortSignal;
}

export type RunPodFetcher = (opts: RunPodFetchOptions) => Promise<RunPodMetadata>;

/** Default REST fetcher. Lives behind a function so tests can stub it. */
export const defaultRunPodFetcher: RunPodFetcher = async ({ podId, apiKey, signal }) => {
  // URL is constructed locally and never returned. The host is the
  // documented RunPod REST host; do not put pod-specific details in any
  // log line that leaves this function.
  const url = `https://rest.runpod.io/v1/pods/${encodeURIComponent(podId)}`;
  let response: Response;
  try {
    const init: RequestInit = {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    };
    if (signal !== undefined) init.signal = signal;
    response = await fetch(url, init);
  } catch (err) {
    throw new Error(
      `RunPod metadata request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    // Status only — never echo response body, which can include the URL
    // we just sent or an error containing the pod id.
    throw new Error(`RunPod metadata request returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as Record<string, unknown>;
  const desiredStatus = typeof body["desiredStatus"] === "string" ? (body["desiredStatus"] as string) : "UNKNOWN";
  const gpuTypeId = typeof body["gpuTypeId"] === "string" ? (body["gpuTypeId"] as string) : undefined;
  const costPerHr = typeof body["costPerHr"] === "number" ? (body["costPerHr"] as number) : undefined;
  return { desiredStatus, gpuTypeId, costPerHr };
};

export interface ProcessSpawnOptions {
  bin: string;
  args: ReadonlyArray<string>;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export type ProcessRunner = (opts: ProcessSpawnOptions) => Promise<ProcessResult>;

/**
 * Default runner — spawns the binary, captures stdio with a hard cap, and
 * kills the process if it overruns the timeout. Output is captured but
 * not yet redacted; redaction is applied later by the adapter so tests
 * can verify the redactor independently.
 */
export const defaultProcessRunner: ProcessRunner = (opts) => {
  return new Promise<ProcessResult>((resolve) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child: ChildProcess;
    try {
      child = spawn(opts.bin, [...opts.args], {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        timedOut: false,
        durationMs: Date.now() - started,
      });
      return;
    }
    const MAX_BYTES = 1_000_000; // 1 MiB cap per stream; opencode is verbose.
    child.stdout?.on("data", (buf: Buffer) => {
      if (stdout.length < MAX_BYTES) stdout += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      if (stderr.length < MAX_BYTES) stderr += buf.toString("utf8");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        stdout,
        stderr: stderr + (stderr.length > 0 ? "\n" : "") + (err instanceof Error ? err.message : String(err)),
        timedOut,
        durationMs: Date.now() - started,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
};

/**
 * Scrub strings before they enter evidence, logs, or any error returned
 * to the loop. The redactor is intentionally conservative: it removes
 * the literal token, the pod id, anything after `Authorization: Bearer`,
 * and any URL containing `runpod`. False positives here are far cheaper
 * than a leaked credential.
 */
export function redactSecrets(input: string, secrets: ReadonlyArray<string>): string {
  let out = input;
  for (const s of secrets) {
    if (s.length < 4) continue;
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "g"), "[REDACTED]");
  }
  out = out.replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [REDACTED]");
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/g, "Bearer [REDACTED]");
  out = out.replace(/https?:\/\/[^\s"'<>]*runpod[^\s"'<>]*/gi, "[REDACTED-URL]");
  return out;
}

export interface LiveOpencodeAdapterOptions {
  env: LiveAdapterEnv;
  /** Inject for tests. Defaults to the real REST fetcher. */
  runpod?: RunPodFetcher;
  /** Inject for tests. Defaults to a real child_process spawner. */
  runProcess?: ProcessRunner;
  /** Inject a clock for stable evidence timestamps in tests. */
  now?: () => Date;
  /**
   * Override the working-directory factory. Tests use this to skip the
   * mkdtemp call. Returns `{ path, cleanup }`.
   */
  makeSandbox?: () => Promise<{ path: string; cleanup: () => Promise<void> }>;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30 * 60_000; // 30 minutes hard ceiling.

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) return DEFAULT_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return DEFAULT_TIMEOUT_MS;
  if (n < MIN_TIMEOUT_MS) return MIN_TIMEOUT_MS;
  if (n > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
  return n;
}

async function defaultMakeSandbox(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), "control-loop-live-"));
  return {
    path,
    cleanup: async () => {
      await rm(path, { recursive: true, force: true });
    },
  };
}

/**
 * Real adapter. See file header for properties; see `prepare()` and
 * `run()` for the actual sequencing.
 */
export class LiveOpencodeAdapter implements RuntimeAdapter {
  readonly id = "opencode-live";
  private readonly env: LiveAdapterEnv;
  private readonly runpod: RunPodFetcher;
  private readonly runProcess: ProcessRunner;
  private readonly now: () => Date;
  private readonly makeSandbox: () => Promise<{ path: string; cleanup: () => Promise<void> }>;

  /** Set in `prepare()` after env is validated. */
  private resolved: {
    apiKey: string;
    podId: string;
    workdir: string;
    bin: string;
    model: string | undefined;
    provider: string;
    timeoutMs: number;
  } | null = null;

  /** Captured in `prepare()`; reported in evidence as runtime tag. */
  private metadata: RunPodMetadata | null = null;

  constructor(opts: LiveOpencodeAdapterOptions) {
    this.env = opts.env;
    this.runpod = opts.runpod ?? defaultRunPodFetcher;
    this.runProcess = opts.runProcess ?? defaultProcessRunner;
    this.now = opts.now ?? (() => new Date());
    this.makeSandbox = opts.makeSandbox ?? defaultMakeSandbox;
  }

  async prepare(): Promise<void> {
    const missing: string[] = [];
    const env = this.env;
    if (env.CONTROL_LOOP_LIVE_ENABLED !== "1") missing.push("CONTROL_LOOP_LIVE_ENABLED=1");
    if (!env.CONTROL_LOOP_PROVIDER || env.CONTROL_LOOP_PROVIDER.length === 0) {
      missing.push("CONTROL_LOOP_PROVIDER");
    }
    if (!env.CONTROL_LOOP_WORKDIR || env.CONTROL_LOOP_WORKDIR.length === 0) {
      missing.push("CONTROL_LOOP_WORKDIR");
    }
    if (!env.RUNPOD_VLLM_API_KEY || env.RUNPOD_VLLM_API_KEY.length === 0) {
      missing.push("RUNPOD_VLLM_API_KEY");
    }
    if (!env.RUNPOD_POD_ID || env.RUNPOD_POD_ID.length === 0) {
      missing.push("RUNPOD_POD_ID");
    }
    if (missing.length > 0) {
      // Do NOT include any partial values; the keys themselves are safe.
      throw new MissingConfigError(
        `live opencode adapter is missing required configuration: ${missing.join(", ")}. ` +
          "Set every variable explicitly. The control loop refuses to run live without them.",
        missing,
      );
    }

    const apiKey = env.RUNPOD_VLLM_API_KEY as string;
    const podId = env.RUNPOD_POD_ID as string;
    const workdir = env.CONTROL_LOOP_WORKDIR as string;
    const bin = env.CONTROL_LOOP_OPENCODE_BIN && env.CONTROL_LOOP_OPENCODE_BIN.length > 0
      ? env.CONTROL_LOOP_OPENCODE_BIN
      : "opencode";
    const model = env.CONTROL_LOOP_OPENCODE_MODEL && env.CONTROL_LOOP_OPENCODE_MODEL.length > 0
      ? env.CONTROL_LOOP_OPENCODE_MODEL
      : undefined;
    const provider = env.CONTROL_LOOP_PROVIDER as string;
    const timeoutMs = parseTimeout(env.CONTROL_LOOP_TIMEOUT_MS);

    // Probe the runtime so we never dispatch into a stopped or unreachable
    // pod. Any fetch failure becomes a MissingConfigError so the control
    // loop refuses cleanly with `missing_runtime_config`. We deliberately
    // do not retry: the operator should fix the pod and re-run.
    let metadata: RunPodMetadata;
    try {
      metadata = await this.runpod({ podId, apiKey });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new MissingConfigError(
        `RunPod metadata lookup failed: ${redactSecrets(message, [apiKey, podId])}. ` +
          "Refusing to invoke opencode against an unreachable pod.",
        ["RUNPOD_POD_ID"],
      );
    }
    if (metadata.desiredStatus !== "RUNNING") {
      throw new MissingConfigError(
        `RunPod pod is not RUNNING (desiredStatus=${metadata.desiredStatus}). ` +
          "Start the pod and re-run.",
        ["RUNPOD_POD_ID"],
      );
    }

    this.resolved = { apiKey, podId, workdir, bin, model, provider, timeoutMs };
    this.metadata = metadata;
  }

  async run(req: AdapterRequest): Promise<AdapterRunResult> {
    if (this.resolved === null) {
      throw new MissingConfigError(
        "LiveOpencodeAdapter.run() called before prepare(). This is a control-loop bug.",
        ["adapter_lifecycle"],
      );
    }
    const { apiKey, podId, workdir, bin, model, provider, timeoutMs } = this.resolved;
    const secrets = [apiKey, podId];

    const sandbox = await this.makeSandbox();
    const sandboxPath = sandbox.path;
    let logsPath = `local-file://${sandboxPath}/run.log`;

    try {
      // Build opencode args. Keep this list short and explicit; do not
      // pass the pack's raw text on the command line (where it would be
      // visible in process listings) — opencode reads it from a file.
      const packDest = join(sandboxPath, "ticket-pack.md");
      // Write the pack into the sandbox so the spawned process can read
      // it from the working directory.
      const { writeFile } = await import("node:fs/promises");
      await writeFile(packDest, req.packRaw, "utf8");

      const args: string[] = [
        "run",
        "--pack",
        packDest,
        "--workdir",
        workdir,
      ];
      if (model !== undefined) {
        args.push("--model", model);
      }

      // Forward the RunPod credential to the spawned process via env so
      // it never appears on argv (where ps could see it). We pass only
      // what opencode needs.
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        RUNPOD_VLLM_API_KEY: apiKey,
        RUNPOD_POD_ID: podId,
      };

      const result = await this.runProcess({
        bin,
        args,
        cwd: sandboxPath,
        env: childEnv,
        timeoutMs,
      });

      const stdoutClean = redactSecrets(result.stdout, secrets);
      const stderrClean = redactSecrets(result.stderr, secrets);

      if (result.timedOut) {
        return {
          state: "failed",
          provider: { adapter: this.id, runtimeId: provider, costClass: req.costBand },
          branch: {
            branch: req.branch,
            prTitlePrefix: req.prTitlePrefix,
            prBase: req.prBase,
            prUrl: null,
          },
          checks: [],
          logs: { type: "local-file", path: logsPath },
          refusals: [
            {
              code: "adapter_timeout",
              message:
                `opencode exceeded the ${timeoutMs}ms wall-clock cap and was killed. ` +
                "No checks were run. Increase CONTROL_LOOP_TIMEOUT_MS or shrink the pack.",
            },
          ],
        };
      }

      if (result.exitCode !== 0) {
        return {
          state: "failed",
          provider: { adapter: this.id, runtimeId: provider, costClass: req.costBand },
          branch: {
            branch: req.branch,
            prTitlePrefix: req.prTitlePrefix,
            prBase: req.prBase,
            prUrl: null,
          },
          checks: [],
          logs: { type: "local-file", path: logsPath },
          refusals: [
            {
              code: "adapter_failure",
              message:
                `opencode exited with code ${result.exitCode ?? "null"}` +
                (result.signal ? ` (signal=${result.signal})` : "") +
                `. stderr (redacted): ${truncate(stderrClean, 512)}`,
            },
          ],
        };
      }

      // Run required checks inside the same sandbox, sequentially. Each
      // check is a shell command from the pack; their stdout/stderr is
      // captured but not surfaced unless the check fails.
      const checks: CheckResult[] = [];
      let anyFailed = false;
      for (const c of req.requiredChecks) {
        const checkResult = await this.runProcess({
          bin: "/bin/sh",
          args: ["-c", c.command],
          cwd: workdir,
          env: childEnv,
          timeoutMs,
        });
        const outcome = checkResult.exitCode === 0 ? "passed" : "failed";
        if (outcome === "failed") anyFailed = true;
        const cr: CheckResult = {
          name: c.name,
          command: c.command,
          outcome,
          durationMs: checkResult.durationMs,
        };
        if (outcome === "failed") {
          const detailRaw = checkResult.stderr || checkResult.stdout || "(no output)";
          cr.detail = truncate(redactSecrets(detailRaw, secrets), 512);
        }
        checks.push(cr);
      }

      // Stash redacted logs alongside the sandbox so an operator can
      // inspect them. We do NOT include them in the JSON evidence —
      // logs.path is the only pointer.
      const { writeFile: write2 } = await import("node:fs/promises");
      await write2(
        join(sandboxPath, "run.log"),
        `# opencode stdout (redacted)\n${stdoutClean}\n# opencode stderr (redacted)\n${stderrClean}\n`,
        "utf8",
      );
      logsPath = `local-file://${sandboxPath}/run.log`;

      return {
        state: anyFailed ? "checks_failed" : "ready_for_review",
        provider: { adapter: this.id, runtimeId: provider, costClass: req.costBand },
        branch: {
          branch: req.branch,
          prTitlePrefix: req.prTitlePrefix,
          prBase: req.prBase,
          // The live adapter never opens a PR. The branch plan is
          // recorded so a human can take it from here.
          prUrl: null,
        },
        checks,
        logs: { type: "local-file", path: logsPath },
      };
    } finally {
      // Sandbox cleanup is best-effort; the path is already in evidence
      // if the operator wants to keep it. Default factory removes it.
      try {
        await sandbox.cleanup();
      } catch {
        // Ignore — the OS will eventually reclaim tmp.
      }
    }
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[truncated]`;
}
