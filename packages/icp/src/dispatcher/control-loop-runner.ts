/**
 * Control-loop CLI invoker for the LAT-129 dispatcher.
 *
 * Spawns the existing `node packages/control-loop/dist/cli.js
 * <ticket-pack> --mode <mode> --format json` subprocess once, captures
 * stdout/stderr, redacts both before returning, and parses the JSON
 * summary so the orchestration can decide whether to promote the issue.
 *
 * The runner never logs the spawn command's environment, never logs the
 * args, and never includes captured raw stdout/stderr in error messages
 * — only the redacted form ever leaves this module.
 */

import { spawn as nodeSpawn } from "node:child_process";

import { redactOutput } from "./redact.js";
import type {
  ControlLoopJsonSummary,
  ControlLoopRunResult,
  DispatcherSpawn,
  DispatcherSpawnedProcess,
} from "./types.js";

export interface RunControlLoopOptions {
  /** Absolute path to the control-loop CLI script. */
  cliPath: string;
  /** Absolute path to the generated ticket pack. */
  packPath: string;
  /** `mock` | `plan` | `live`. The dispatcher passes through whatever the operator chose. */
  mode: "mock" | "plan" | "live";
  /** Working directory for the child process. */
  cwd: string;
  /** Environment for the child process. The dispatcher prunes secrets that the control loop does not need. */
  env: Record<string, string>;
  /** Hard timeout. Defaults to 30 minutes. */
  timeoutMs?: number;
  /**
   * Extra literal secret values to scrub from captured output. The
   * caller passes any process.env values it considered before
   * constructing the child env so a misbehaving subprocess can't
   * exfiltrate them by echoing.
   */
  extraSecrets?: ReadonlyArray<string>;
  /** Test seam. */
  spawn?: DispatcherSpawn;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export async function runControlLoopCli(
  opts: RunControlLoopOptions,
): Promise<ControlLoopRunResult> {
  const spawnImpl: DispatcherSpawn =
    opts.spawn ??
    ((cmd, args, options) =>
      nodeSpawn(cmd, [...args], options) as unknown as DispatcherSpawnedProcess);

  const args: ReadonlyArray<string> = [
    opts.cliPath,
    opts.packPath,
    "--mode",
    opts.mode,
    "--format",
    "json",
  ];

  const child = spawnImpl("node", args, { cwd: opts.cwd, env: opts.env });

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<ControlLoopRunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finalise = (exitCode: number, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const safeStdout = redactOutput(stdout, {
        ...(opts.extraSecrets ? { extraSecrets: opts.extraSecrets } : {}),
      });
      const safeStderr = redactOutput(
        timedOut
          ? stderr + `\n[dispatcher] control-loop timed out after ${timeoutMs}ms`
          : stderr,
        {
          ...(opts.extraSecrets ? { extraSecrets: opts.extraSecrets } : {}),
        },
      );
      resolve({
        exitCode,
        stdout: safeStdout,
        stderr: safeStderr,
        jsonSummary: extractJsonSummary(stdout),
      });
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // best effort
      }
      finalise(124, true);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.on("error", () => {
      finalise(1, false);
    });
    child.on("close", (code) => {
      finalise(typeof code === "number" ? code : 1, false);
    });
  });
}

/**
 * Try to extract the JSON object emitted by `control-loop --format
 * json`. The CLI prints the object as a single block followed by a
 * newline. If parsing fails we return null and let the caller treat the
 * outcome as opaque.
 */
function extractJsonSummary(stdout: string): ControlLoopJsonSummary | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;

  // Find the first `{` and try to parse from there.
  const start = trimmed.indexOf("{");
  if (start < 0) return null;
  // Find the matching closing brace by simple bracket counting that
  // skips strings. Good enough for the canonical control-loop output.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i += 1) {
    const c = trimmed[i] ?? "";
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate) as unknown;
          if (looksLikeSummary(parsed)) return parsed;
          return null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function looksLikeSummary(v: unknown): v is ControlLoopJsonSummary {
  if (typeof v !== "object" || v === null) return false;
  const o = v as { schemaVersion?: unknown; evidence?: unknown };
  if (typeof o.schemaVersion !== "string") return false;
  if (typeof o.evidence !== "object" || o.evidence === null) return false;
  const ev = o.evidence as { state?: unknown };
  return typeof ev.state === "string";
}
