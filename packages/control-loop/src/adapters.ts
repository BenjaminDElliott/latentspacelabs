/**
 * Runtime adapter implementations.
 *
 * Two adapters live here: a deterministic mock used by CI and tests, and a
 * placeholder live adapter that refuses unless explicitly configured. The
 * live adapter is intentionally minimal — LAT-117 is the first vertical
 * slice; the real opencode/sandbox wiring will land behind this seam in a
 * follow-up. What matters now is that:
 *
 *   1. The adapter selection is config-driven (env), not hardcoded.
 *   2. A live request without config refuses cleanly via `MissingConfigError`.
 *   3. No URL, token, or runtime hostname is ever embedded in this file.
 */

import type {
  AdapterRequest,
  AdapterRunResult,
  CheckResult,
  RuntimeAdapter,
} from "./types.js";
import { MissingConfigError } from "./types.js";

export interface MockAdapterOptions {
  /** Force a particular outcome. Default: all checks pass. */
  outcome?: "ready_for_review" | "checks_failed" | "failed";
  /** Override the runtime identifier (default: deterministic per ticket). */
  runtimeId?: string;
  /** Override the timestamp source for stable test snapshots. */
  now?: () => Date;
}

/**
 * Mock adapter — deterministic, offline, and free. The control loop uses
 * this in CI and any local test that does not want to spend cloud or
 * sandbox resources. The mock does not generate fake PR URLs or fake log
 * paths it cannot back up; it returns null/`memory` for those.
 */
export class MockRuntimeAdapter implements RuntimeAdapter {
  readonly id = "mock";
  private readonly outcome: MockAdapterOptions["outcome"];
  private readonly runtimeIdOverride: string | undefined;
  private readonly now: () => Date;

  constructor(options: MockAdapterOptions = {}) {
    this.outcome = options.outcome ?? "ready_for_review";
    this.runtimeIdOverride = options.runtimeId;
    this.now = options.now ?? (() => new Date());
  }

  async prepare(): Promise<void> {
    // Mock has nothing to prepare; this method exists for interface parity.
  }

  async run(req: AdapterRequest): Promise<AdapterRunResult> {
    const runtimeId = this.runtimeIdOverride ?? `mock-${req.ticket.toLowerCase()}`;
    const checks: CheckResult[] = req.requiredChecks.map((c) => ({
      name: c.name,
      command: c.command,
      outcome: this.outcome === "checks_failed" ? "failed" : "passed",
      durationMs: 0,
      ...(this.outcome === "checks_failed"
        ? { detail: "mock adapter forced this check to fail" }
        : {}),
    }));

    if (this.outcome === "failed") {
      return {
        state: "failed",
        provider: {
          adapter: this.id,
          runtimeId,
          costClass: req.costBand,
        },
        branch: {
          branch: req.branch,
          prTitlePrefix: req.prTitlePrefix,
          prBase: req.prBase,
          prUrl: null,
        },
        checks: [],
        logs: { type: "memory", path: `mock://${runtimeId}/run.log` },
        refusals: [
          {
            code: "adapter_failure",
            message: "mock adapter was configured to simulate an unrecoverable failure",
          },
        ],
      };
    }

    return {
      state: this.outcome === "checks_failed" ? "checks_failed" : "ready_for_review",
      provider: {
        adapter: this.id,
        runtimeId,
        costClass: req.costBand,
      },
      branch: {
        branch: req.branch,
        prTitlePrefix: req.prTitlePrefix,
        prBase: req.prBase,
        // Mock adapter never opens real PRs.
        prUrl: null,
      },
      checks,
      logs: {
        type: "memory",
        path: `mock://${runtimeId}/run-${this.now().toISOString()}.log`,
      },
    };
  }
}

/**
 * Live opencode/sandbox adapter — placeholder. The first vertical slice
 * (LAT-117) deliberately stops short of wiring opencode. This adapter
 * checks for the env vars a real implementation would need and refuses
 * cleanly when any are missing. When all are present it still refuses
 * with `live_adapter_not_implemented`, so a misconfigured live run can
 * never silently fall through to a mock or spend cloud cost.
 */
export interface LiveAdapterEnv {
  /** Stable provider id, e.g. `opencode-runpod`. NEVER a URL. */
  CONTROL_LOOP_PROVIDER?: string | undefined;
  /** Sandbox/runtime identifier. NEVER the endpoint URL. */
  CONTROL_LOOP_RUNTIME_ID?: string | undefined;
  /** Indicates the operator wired credentials at the boundary. */
  CONTROL_LOOP_LIVE_ENABLED?: string | undefined;
}

export class LiveOpencodeAdapter implements RuntimeAdapter {
  readonly id = "opencode-live";
  private readonly env: LiveAdapterEnv;

  constructor(env: LiveAdapterEnv) {
    this.env = env;
  }

  async prepare(): Promise<void> {
    const missing: string[] = [];
    if (!this.env.CONTROL_LOOP_PROVIDER || this.env.CONTROL_LOOP_PROVIDER.length === 0) {
      missing.push("CONTROL_LOOP_PROVIDER");
    }
    if (!this.env.CONTROL_LOOP_RUNTIME_ID || this.env.CONTROL_LOOP_RUNTIME_ID.length === 0) {
      missing.push("CONTROL_LOOP_RUNTIME_ID");
    }
    if (this.env.CONTROL_LOOP_LIVE_ENABLED !== "1") {
      missing.push("CONTROL_LOOP_LIVE_ENABLED=1");
    }
    if (missing.length > 0) {
      throw new MissingConfigError(
        `live opencode adapter is missing required configuration: ${missing.join(", ")}. ` +
          "The control loop refuses to run live without explicit configuration.",
        missing,
      );
    }
  }

  async run(_req: AdapterRequest): Promise<AdapterRunResult> {
    throw new MissingConfigError(
      "live opencode adapter is not yet implemented in this MVP slice. " +
        "Set up the live adapter behind this seam in a follow-up; do not silently fall back to mock.",
      ["live_adapter_not_implemented"],
    );
  }
}

export interface SelectAdapterOptions {
  mode: "mock" | "plan" | "live";
  env: NodeJS.ProcessEnv;
}

export function selectAdapter(opts: SelectAdapterOptions): RuntimeAdapter {
  switch (opts.mode) {
    case "mock":
    case "plan":
      return new MockRuntimeAdapter();
    case "live":
      return new LiveOpencodeAdapter({
        CONTROL_LOOP_PROVIDER: opts.env["CONTROL_LOOP_PROVIDER"],
        CONTROL_LOOP_RUNTIME_ID: opts.env["CONTROL_LOOP_RUNTIME_ID"],
        CONTROL_LOOP_LIVE_ENABLED: opts.env["CONTROL_LOOP_LIVE_ENABLED"],
      });
  }
}
