/**
 * Runtime adapter implementations.
 *
 * The deterministic mock used by CI/tests lives here. The real live
 * adapter (LAT-121) lives in `live-adapter.ts` and is re-exported below
 * so existing imports keep working. The selection rules:
 *
 *   1. Adapter selection is config-driven (env), not hardcoded.
 *   2. A live request without config refuses cleanly via `MissingConfigError`.
 *   3. No URL, token, or runtime hostname is ever embedded in this file.
 */

import type {
  AdapterRequest,
  AdapterRunResult,
  CheckResult,
  RuntimeAdapter,
} from "./types.js";

import { LiveOpencodeAdapter } from "./live-adapter.js";
import type { LiveAdapterEnv } from "./live-adapter.js";

export { LiveOpencodeAdapter } from "./live-adapter.js";
export type {
  LiveAdapterEnv,
  LiveOpencodeAdapterOptions,
  RunPodFetcher,
  RunPodFetchOptions,
  RunPodMetadata,
  ProcessRunner,
  ProcessSpawnOptions,
  ProcessResult,
} from "./live-adapter.js";

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

export interface SelectAdapterOptions {
  mode: "mock" | "plan" | "live";
  env: NodeJS.ProcessEnv;
}

export function selectAdapter(opts: SelectAdapterOptions): RuntimeAdapter {
  switch (opts.mode) {
    case "mock":
    case "plan":
      return new MockRuntimeAdapter();
    case "live": {
      const env: LiveAdapterEnv = {
        CONTROL_LOOP_LIVE_ENABLED: opts.env["CONTROL_LOOP_LIVE_ENABLED"],
        CONTROL_LOOP_PROVIDER: opts.env["CONTROL_LOOP_PROVIDER"],
        CONTROL_LOOP_WORKDIR: opts.env["CONTROL_LOOP_WORKDIR"],
        CONTROL_LOOP_OPENCODE_BIN: opts.env["CONTROL_LOOP_OPENCODE_BIN"],
        CONTROL_LOOP_OPENCODE_MODEL: opts.env["CONTROL_LOOP_OPENCODE_MODEL"],
        CONTROL_LOOP_TIMEOUT_MS: opts.env["CONTROL_LOOP_TIMEOUT_MS"],
        RUNPOD_API_KEY: opts.env["RUNPOD_API_KEY"],
        RUNPOD_VLLM_API_KEY: opts.env["RUNPOD_VLLM_API_KEY"],
        RUNPOD_POD_ID: opts.env["RUNPOD_POD_ID"],
      };
      return new LiveOpencodeAdapter({ env });
    }
  }
}
