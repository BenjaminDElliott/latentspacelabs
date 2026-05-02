/**
 * Types for the LAT-117 sandboxed agent control loop MVP.
 *
 * Pure types — no I/O. The control loop reuses the LAT-105 ticket-pack
 * harness to gate dispatch. Once the pack is judged `ready`, the loop
 * delegates the actual execution to a `RuntimeAdapter`. The adapter is
 * the seam: a deterministic mock for CI/tests, or a real opencode/sandbox
 * adapter when `mode` is `live` and a provider is configured.
 *
 * Nothing in this file knows about endpoint URLs, tokens, or any specific
 * runtime provider. Adapters resolve their own configuration from env at
 * the boundary; the control loop only forwards a redacted record of which
 * provider/runtime identifier was used.
 */

import type {
  CostBand,
  DryRunSummary,
  RiskLevel,
} from "@latentspacelabs/opencode-harness";

/**
 * Final terminal state for a single bounded dispatch.
 *
 * `planned`     — pre-flight passed but the loop was asked not to dispatch
 *                 (e.g. mode=plan).
 * `running`     — only used while in flight; never observed in a final
 *                 summary returned by `runControlLoop`.
 * `refused`     — control loop refused before contacting the adapter
 *                 (guardrail, missing config, ambiguous/oversized pack).
 * `failed`      — adapter returned an unrecoverable error (timeout,
 *                 sandbox crash, opencode error).
 * `checks_failed` — adapter completed, evidence collected, but one or
 *                 more required checks did not pass.
 * `ready_for_review` — adapter completed and all required checks passed;
 *                 a human should review the resulting branch/PR plan
 *                 before merge.
 */
export type RunState =
  | "planned"
  | "running"
  | "refused"
  | "failed"
  | "checks_failed"
  | "ready_for_review";

export type RunMode = "mock" | "plan" | "live";

export type CheckOutcome = "passed" | "failed" | "skipped" | "manual";

/**
 * What the runtime is allowed to do with this check. Mirrors
 * `CheckPlanItem.kind` from the LAT-105 harness so the loop can
 * preserve the distinction in evidence:
 *
 * - `shell`  — executed by the adapter via `/bin/sh -c`.
 * - `policy` — structurally validated by the adapter or recorded as
 *              `manual` if the adapter has no signal to verify it.
 * - `manual` — surfaced in evidence for human review; never executed.
 */
export type CheckKind = "shell" | "policy" | "manual";

export interface CheckResult {
  name: string;
  command: string;
  outcome: CheckOutcome;
  durationMs: number;
  detail?: string;
  /** Defaults to `shell` for legacy adapters that don't set it. */
  kind?: CheckKind;
}

export interface RefusalEvidence {
  code: string;
  message: string;
}

/**
 * Identifier the adapter returns so we can correlate this run with logs in
 * an external system without ever holding the endpoint URL or token. The
 * loop only stores these stringly-typed fields verbatim and never derives
 * URLs from them.
 */
export interface ProviderEvidence {
  /** Stable adapter id, e.g. `mock` or `opencode-sandbox`. */
  adapter: string;
  /** Free-form runtime identifier the adapter chose. Must NOT be a URL. */
  runtimeId: string;
  /** Cost class actually consumed. Must equal the pack's costBand. */
  costClass: CostBand;
}

export interface BranchEvidence {
  branch: string;
  prTitlePrefix: string;
  prBase: string;
  /** PR link if the adapter opened one, else null. MVP loop never opens. */
  prUrl: string | null;
}

/** Where the adapter wrote its raw logs. The loop never reads this back. */
export interface LogsLocation {
  type: "local-file" | "memory" | "external";
  path: string;
}

export interface RunEvidence {
  ticket: string;
  packPath: string;
  state: RunState;
  mode: RunMode;
  costBand: CostBand | "unknown";
  riskLevel: RiskLevel | "unknown";
  provider: ProviderEvidence | null;
  branch: BranchEvidence | null;
  checks: CheckResult[];
  refusals: RefusalEvidence[];
  logs: LogsLocation | null;
  startedAt: string;
  finishedAt: string;
  /** What the human should do next, in plain English. */
  nextHumanAction: string;
}

export interface RunSummary {
  schemaVersion: "1.0.0";
  evidence: RunEvidence;
  /** The dry-run summary that gated this dispatch. Always present. */
  preflight: DryRunSummary;
}

/**
 * Adapter request: everything an adapter needs to run, with no secrets.
 */
export interface AdapterRequest {
  ticket: string;
  packPath: string;
  packRaw: string;
  costBand: CostBand;
  riskLevel: RiskLevel;
  branch: string;
  prTitlePrefix: string;
  prBase: string;
  filesInScope: string[];
  filesForbidden: string[];
  /** Required checks the adapter must run before reporting success. */
  requiredChecks: ReadonlyArray<{ name: string; command: string }>;
}

export interface AdapterRunResult {
  /** What state the adapter wants the loop to terminate in. */
  state: Extract<RunState, "failed" | "checks_failed" | "ready_for_review">;
  provider: ProviderEvidence;
  branch: BranchEvidence;
  checks: CheckResult[];
  logs: LogsLocation;
  /** Optional adapter-supplied extra refusals (e.g. timeout). */
  refusals?: RefusalEvidence[];
}

/**
 * The seam. A runtime adapter is the only thing in this package allowed to
 * talk to opencode, a sandbox, or the network. Adapters are responsible
 * for their own config resolution and for never leaking endpoint material
 * into the result they return.
 */
export interface RuntimeAdapter {
  /** Stable id. Used as `provider.adapter`. */
  readonly id: string;
  /**
   * Resolve config (env / file). Throw a `MissingConfigError` if a live
   * adapter is asked to run without the config it needs. The control loop
   * catches this and refuses with `missing_runtime_config`.
   */
  prepare(): Promise<void>;
  run(req: AdapterRequest): Promise<AdapterRunResult>;
}

/**
 * Throw from an adapter's `prepare()` (or from `selectAdapter`) when the
 * caller asked for a live run but the runtime is not configured. The
 * control loop translates this into a structured refusal and never
 * silently falls back to a different cost class or adapter.
 */
export class MissingConfigError extends Error {
  override readonly name = "MissingConfigError";
  readonly missingKeys: ReadonlyArray<string>;
  constructor(message: string, missingKeys: ReadonlyArray<string> = []) {
    super(message);
    this.missingKeys = missingKeys;
  }
}
