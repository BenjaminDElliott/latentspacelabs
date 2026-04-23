/**
 * Agent invocation adapter (ADR-0012 § "Agent invocation adapter",
 * ADR-0013 § "Invocation categories" / "Minimum run contract",
 * ADR-0017 § Rule 1 / Rule 5).
 *
 * LAT-52 shipped a stub factory so `dispatch-ticket` could be exercised
 * end-to-end before any real provider was bound. LAT-61 promotes the adapter
 * to a real invocation path with three pieces:
 *
 *   1. A `CodingAgentProvider` boundary — the provider-pluggability seam.
 *      Swapping providers (a Claude Code harness today, a different runner
 *      tomorrow under LAT-57 / LAT-58 optimisation work) touches *only* an
 *      injected provider implementation; `dispatch-ticket`, the skill runner,
 *      and the minimum run contract are unchanged.
 *
 *   2. `createCodingAgentAdapter({ provider, ... })` — the adapter that
 *      wraps a provider. It validates the ADR-0013 minimum run contract
 *      before handing the request to the provider, maps provider errors
 *      and typed refusals onto `AgentInvocationResult`, and scrubs
 *      secret-shaped substrings from any text surfaced back to the runner.
 *
 *   3. `createCommandCodingAgentProvider(...)` — a minimum concrete
 *      provider that shells out to a locally-configured command and reads
 *      the last JSON line of its stdout as the provider result envelope.
 *      No secret-bearing external integration is invented; this is the
 *      sanctioned local-residence injection shape from ADR-0017 Rule 2
 *      and LAT-64 §6.3.10.
 *
 * Secret hygiene invariants (ADR-0017 Rule 5, ADR-0013 § Secrets):
 * - The adapter never reads `process.env` for credentials; the provider
 *   owns that at construction time and never serialises raw values into
 *   notes, messages, or the `AgentInvocationResult`.
 * - Any string the provider hands back is passed through a `scrubSecrets`
 *   redactor before it leaves the adapter, as a belt-and-braces guard
 *   against a provider that prints a token into stdout.
 * - Error messages thrown by this module carry no credential value,
 *   prefix, length, or derived fingerprint.
 *
 * The stub factory (`createStubAgentAdapter`) is kept for LAT-52 tests and
 * for the CLI harness's `--stub` path; the production adapter above is
 * what dispatch-ticket selects when a real provider is configured.
 */
import { spawn } from "node:child_process";
import type {
  AgentInvocationAdapter,
  AgentInvocationRequest,
  AgentInvocationResult,
} from "../runtime/contract.js";

/* ------------------------------------------------------------------ */
/* Stub adapter (LAT-52 compatibility)                                 */
/* ------------------------------------------------------------------ */

export interface StubAgentResponse {
  exit_signal?: AgentInvocationResult["exit_signal"];
  pr_url?: string | null;
  pr_branch?: string | null;
  commit_sha?: string | null;
  cost_band?: AgentInvocationResult["cost_band"];
  spent_usd?: number | null;
  notes?: ReadonlyArray<string>;
}

export interface StubAgentAdapterOptions {
  /** Canned responses per linear_issue_id. Missing ids get a default success. */
  responses?: Readonly<Record<string, StubAgentResponse>>;
  /** Records every invocation so tests can assert the adapter was (or was not) called. */
  invocationSink?: (req: AgentInvocationRequest) => void;
}

export function createStubAgentAdapter(
  opts: StubAgentAdapterOptions = {},
): AgentInvocationAdapter {
  return {
    async invoke(req: AgentInvocationRequest): Promise<AgentInvocationResult> {
      opts.invocationSink?.(req);
      const canned = opts.responses?.[req.linear_issue_id];
      return {
        exit_signal: canned?.exit_signal ?? "succeeded",
        pr_url:
          canned?.pr_url ??
          `https://github.com/stub/repo/pull/${req.linear_issue_id.toLowerCase()}`,
        pr_branch: canned?.pr_branch ?? `${req.linear_issue_id.toLowerCase()}-stub`,
        commit_sha: canned?.commit_sha ?? "0000000",
        cost_band: canned?.cost_band ?? "normal",
        spent_usd: canned?.spent_usd ?? null,
        notes: canned?.notes ?? [`stub agent invocation for ${req.linear_issue_id}`],
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Provider boundary                                                   */
/* ------------------------------------------------------------------ */

/**
 * Typed refusal a provider returns when it decides not to run a request.
 * Distinct from the adapter-level refusals (which happen *before* the
 * provider is called) so the runner can tell pre-flight refusals apart
 * from provider-side decisions.
 */
export type CodingAgentRefusalKind =
  | "missing_approval"
  | "unsupported_ticket_shape"
  | "missing_minimum_context"
  | "missing_repo"
  | "missing_budget_cap"
  | "cost_runaway_risk"
  | "provider_refused"
  | "provider_error"
  | "provider_timeout"
  | "provider_not_configured";

export interface CodingAgentRefusal {
  /** Marks the envelope as a refusal vs a run. */
  kind: "refusal";
  reason: CodingAgentRefusalKind;
  /** Sanitised human-readable message. Never contains secret values. */
  message: string;
  /**
   * Runner-facing projection: `needs_human` means a human can resolve and
   * retry; `failed` means the provider tried and surfaced a non-recoverable
   * error; `cancelled` means the provider declined but no action is needed.
   */
  exit_signal: "failed" | "needs_human" | "cancelled";
}

export interface CodingAgentRun {
  kind: "run";
  /** `succeeded` / `failed` / `needs_human` / `cancelled` per ADR-0013. */
  exit_signal: AgentInvocationResult["exit_signal"];
  pr_url?: string | null;
  pr_branch?: string | null;
  commit_sha?: string | null;
  cost_band?: AgentInvocationResult["cost_band"];
  spent_usd?: number | null;
  notes?: ReadonlyArray<string>;
}

export type CodingAgentProviderResult = CodingAgentRun | CodingAgentRefusal;

/**
 * The provider-pluggability boundary. A provider receives the (already-
 * validated) request and returns a run envelope or a typed refusal. It
 * must never throw for normal refusal or policy decisions — the adapter
 * maps `throw` onto a `provider_error` refusal automatically so a poorly-
 * behaved provider still cannot surface a raw exception to the runner.
 */
export interface CodingAgentProvider {
  /** Human-readable identity surfaced in notes. Never a secret. */
  readonly id: string;
  dispatch(req: CodingAgentProviderRequest): Promise<CodingAgentProviderResult>;
}

/**
 * What the adapter hands a provider after pre-flight validation. This is a
 * narrower, validated projection of `AgentInvocationRequest` — every field
 * the ADR-0013 minimum run contract flags as "required for side-effecting
 * invocation" is non-null here.
 */
export interface CodingAgentProviderRequest {
  linear_issue_id: string;
  repo: string;
  branch_target: string;
  branch_naming: string;
  ticket_title: string;
  ticket_summary: string;
  guardrails: ReadonlyArray<string>;
  non_goals: ReadonlyArray<string>;
  budget_cap_usd: number;
  cost_band_observed: AgentInvocationResult["cost_band"];
  skill_name_and_version: string;
  autonomy_level: AgentInvocationRequest["autonomy_level"];
  approve: boolean;
  run_id: string;
}

/* ------------------------------------------------------------------ */
/* Real adapter                                                        */
/* ------------------------------------------------------------------ */

export interface CodingAgentAdapterOptions {
  provider: CodingAgentProvider;
  /**
   * Optional sanitisation patterns the adapter will scrub from every
   * string it surfaces back to the runner, in addition to the built-in
   * token-shape patterns. Use for org-specific secret prefixes.
   */
  extraSecretPatterns?: ReadonlyArray<RegExp>;
  /**
   * Optional event hook for sanitised structured logging. Never receives
   * raw provider stdout, credentials, or request bodies.
   */
  onEvent?: (event: CodingAgentAdapterEvent) => void;
  /** Optional clock override for tests. */
  now?: () => Date;
}

export type CodingAgentAdapterEvent =
  | { type: "invocation_refused"; issueId: string; reason: CodingAgentRefusalKind; message: string }
  | { type: "invocation_started"; issueId: string; provider: string; runId: string }
  | { type: "invocation_ok"; issueId: string; provider: string; exit_signal: AgentInvocationResult["exit_signal"]; runId: string }
  | { type: "invocation_failed"; issueId: string; provider: string; reason: CodingAgentRefusalKind; message: string; runId: string };

/**
 * Build a real coding-agent invocation adapter around an injected provider.
 *
 * Pre-flight refusals (no approval, unsupported ticket shape, missing
 * minimum context, missing repo, missing budget cap, runaway-cost band)
 * are enforced here before the provider is called. Provider-side refusals
 * and errors are mapped into the same `AgentInvocationResult` shape so
 * the ICP runner records structured evidence and never auto-merges.
 */
export function createCodingAgentAdapter(
  opts: CodingAgentAdapterOptions,
): AgentInvocationAdapter {
  const provider = opts.provider;
  const emit = (e: CodingAgentAdapterEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      // Observer must never break the adapter.
    }
  };
  const scrub = (s: string): string => scrubSecrets(s, opts.extraSecretPatterns);

  return {
    async invoke(req: AgentInvocationRequest): Promise<AgentInvocationResult> {
      const runId = req.run_id ?? `run-${Date.now().toString(36)}`;
      const issueId = req.linear_issue_id;

      const refusal = preflightRefuse(req);
      if (refusal) {
        emit({
          type: "invocation_refused",
          issueId,
          reason: refusal.reason,
          message: refusal.message,
        });
        return refusalToResult(refusal, provider.id, scrub);
      }

      // Narrow into a validated provider request. Non-null assertions are
      // safe because `preflightRefuse` returned null above.
      const providerReq: CodingAgentProviderRequest = {
        linear_issue_id: issueId,
        repo: req.repo as string,
        branch_target: req.branch_target ?? "main",
        branch_naming: req.branch_naming ?? `lat-${issueNumber(issueId)}-<slug>`,
        ticket_title: req.ticket_context?.title ?? "",
        ticket_summary: req.ticket_context?.summary ?? "",
        guardrails: req.ticket_context?.guardrails ?? [],
        non_goals: req.ticket_context?.non_goals ?? [],
        budget_cap_usd: req.budget_cap_usd as number,
        cost_band_observed: req.cost_band_observed ?? "normal",
        skill_name_and_version: req.skill_name_and_version ?? "unknown@0.0.0",
        autonomy_level: req.autonomy_level,
        approve: req.approve,
        run_id: runId,
      };

      emit({
        type: "invocation_started",
        issueId,
        provider: provider.id,
        runId,
      });

      let result: CodingAgentProviderResult;
      try {
        result = await provider.dispatch(providerReq);
      } catch (err) {
        const message = scrub(
          `Coding provider threw an unexpected exception: ${sanitiseError(err)}`,
        );
        const ref: CodingAgentRefusal = {
          kind: "refusal",
          reason: "provider_error",
          message,
          exit_signal: "failed",
        };
        emit({
          type: "invocation_failed",
          issueId,
          provider: provider.id,
          reason: ref.reason,
          message: ref.message,
          runId,
        });
        return refusalToResult(ref, provider.id, scrub);
      }

      if (result.kind === "refusal") {
        emit({
          type: "invocation_failed",
          issueId,
          provider: provider.id,
          reason: result.reason,
          message: result.message,
          runId,
        });
        return refusalToResult(result, provider.id, scrub);
      }

      emit({
        type: "invocation_ok",
        issueId,
        provider: provider.id,
        exit_signal: result.exit_signal,
        runId,
      });

      const notes = (result.notes ?? []).map(scrub);
      return {
        exit_signal: result.exit_signal,
        pr_url: result.pr_url ?? null,
        pr_branch: result.pr_branch ?? null,
        commit_sha: result.commit_sha ?? null,
        cost_band: result.cost_band ?? "unknown",
        spent_usd: result.spent_usd ?? null,
        notes:
          notes.length > 0
            ? notes
            : [`coding provider ${provider.id} ran for ${issueId}`],
      };
    },
  };
}

function preflightRefuse(
  req: AgentInvocationRequest,
): CodingAgentRefusal | null {
  if (req.agent_type !== "coding") {
    return {
      kind: "refusal",
      reason: "unsupported_ticket_shape",
      message: `agent_type="${req.agent_type}" is not supported by the coding-agent adapter. Only "coding" is bound today (ADR-0013 placement table).`,
      exit_signal: "failed",
    };
  }
  if (!req.approve) {
    return {
      kind: "refusal",
      reason: "missing_approval",
      message: `Invocation for ${req.linear_issue_id} refused: approve=false at autonomy ${req.autonomy_level}. ADR-0013 requires explicit approval for side-effecting runs at L3+.`,
      exit_signal: "needs_human",
    };
  }
  if (typeof req.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(req.repo)) {
    return {
      kind: "refusal",
      reason: "missing_repo",
      message: `Invocation for ${req.linear_issue_id} refused: missing or malformed repo (expected "owner/name" per ADR-0013 minimum run contract).`,
      exit_signal: "failed",
    };
  }
  if (
    typeof req.budget_cap_usd !== "number" ||
    !Number.isFinite(req.budget_cap_usd) ||
    req.budget_cap_usd <= 0
  ) {
    return {
      kind: "refusal",
      reason: "missing_budget_cap",
      message: `Invocation for ${req.linear_issue_id} refused: no numeric Budget cap on the ticket (ADR-0009 preflight, ADR-0013).`,
      exit_signal: "needs_human",
    };
  }
  if (
    req.cost_band_observed === "runaway_risk" ||
    req.cost_band_observed === "elevated"
  ) {
    return {
      kind: "refusal",
      reason: "cost_runaway_risk",
      message: `Invocation for ${req.linear_issue_id} refused: cost_band_observed=${req.cost_band_observed}. ADR-0009 halts dispatch when the caller already knows the band is above normal.`,
      exit_signal: "needs_human",
    };
  }
  if (!req.ticket_context || typeof req.ticket_context.title !== "string") {
    return {
      kind: "refusal",
      reason: "missing_minimum_context",
      message: `Invocation for ${req.linear_issue_id} refused: no ticket_context.title; the provider cannot open a LAT-NN: PR without the ticket title and summary.`,
      exit_signal: "failed",
    };
  }
  if (
    typeof req.skill_name_and_version !== "string" ||
    !req.skill_name_and_version.includes("@")
  ) {
    return {
      kind: "refusal",
      reason: "missing_minimum_context",
      message: `Invocation for ${req.linear_issue_id} refused: skill_name_and_version is required by ADR-0013's minimum run contract ("name@version").`,
      exit_signal: "failed",
    };
  }
  return null;
}

function refusalToResult(
  refusal: CodingAgentRefusal,
  providerId: string,
  scrub: (s: string) => string,
): AgentInvocationResult {
  return {
    exit_signal: refusal.exit_signal,
    pr_url: null,
    pr_branch: null,
    commit_sha: null,
    cost_band: "unknown",
    spent_usd: null,
    notes: [
      `coding-agent adapter refused (provider=${providerId}, reason=${refusal.reason})`,
      scrub(refusal.message),
    ],
  };
}

function issueNumber(issueId: string): string {
  const m = /-(\d+)$/.exec(issueId);
  return m ? (m[1] as string) : "nn";
}

/* ------------------------------------------------------------------ */
/* Local command provider                                              */
/* ------------------------------------------------------------------ */

export interface CommandCodingAgentProviderOptions {
  /** Human-readable provider identity surfaced in notes. */
  id?: string;
  /** Executable or path. Required; if missing, dispatch() refuses. */
  command: string;
  /** Positional arguments passed before the JSON request on stdin. */
  args?: ReadonlyArray<string>;
  /** Working directory for the spawned process. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Environment for the spawned process. Callers resolve their own
   * credentials *outside* the adapter (ADR-0017 Rule 1) and inject them
   * here if the command needs them. The adapter never mutates this map
   * or forwards `process.env` implicitly.
   */
  env?: Readonly<Record<string, string>>;
  /** Max wall time before the adapter kills the process and refuses. */
  timeoutMs?: number;
  /** Injectable spawn for tests. Defaults to `child_process.spawn`. */
  spawn?: SpawnLike;
}

/** The minimum spawn surface the provider depends on. */
export type SpawnLike = (
  command: string,
  args: ReadonlyArray<string>,
  options: {
    cwd?: string;
    env?: Record<string, string>;
  },
) => SpawnedLike;

export interface SpawnedLike {
  readonly stdin: { write(chunk: string): void; end(): void };
  readonly stdout: { on(event: "data", cb: (chunk: Buffer | string) => void): void };
  readonly stderr: { on(event: "data", cb: (chunk: Buffer | string) => void): void };
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "close", cb: (code: number | null) => void): void;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/**
 * Spawn a local command and use its last JSON-object line on stdout as the
 * provider result envelope. The command reads the invocation request as a
 * single JSON object on stdin (stdin is closed immediately after write).
 *
 * This is a minimum concrete provider — it proves the boundary without
 * shipping a secret-bearing external integration. A future provider
 * (Claude Code SDK binding, hosted runner, etc.) slots in by implementing
 * `CodingAgentProvider` and being passed to `createCodingAgentAdapter`.
 */
export function createCommandCodingAgentProvider(
  opts: CommandCodingAgentProviderOptions,
): CodingAgentProvider {
  const id = opts.id ?? `command:${opts.command}`;
  return {
    id,
    async dispatch(req: CodingAgentProviderRequest): Promise<CodingAgentProviderResult> {
      if (typeof opts.command !== "string" || opts.command.length === 0) {
        return {
          kind: "refusal",
          reason: "provider_not_configured",
          message:
            "Command coding-agent provider was constructed without a command path. Configure CODING_AGENT_COMMAND or pass { command } explicitly.",
          exit_signal: "failed",
        };
      }

      const spawnImpl: SpawnLike =
        opts.spawn ?? ((cmd, args, options) => spawn(cmd, [...args], options) as unknown as SpawnedLike);
      const args = opts.args ?? [];
      const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
      const spawnOptions: { cwd?: string; env?: Record<string, string> } = {};
      if (typeof opts.cwd === "string") spawnOptions.cwd = opts.cwd;
      if (opts.env) spawnOptions.env = { ...opts.env };

      let child: SpawnedLike;
      try {
        child = spawnImpl(opts.command, args, spawnOptions);
      } catch (err) {
        return {
          kind: "refusal",
          reason: "provider_error",
          message: `Failed to spawn coding provider command: ${sanitiseError(err)}`,
          exit_signal: "failed",
        };
      }

      return new Promise<CodingAgentProviderResult>((resolvePromise) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        const settle = (r: CodingAgentProviderResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolvePromise(r);
        };

        const timer = setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {
            // best effort
          }
          settle({
            kind: "refusal",
            reason: "provider_timeout",
            message: `Coding provider timed out after ${timeoutMs}ms for ${req.linear_issue_id}.`,
            exit_signal: "failed",
          });
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
          stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
          stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        });
        child.on("error", (err) => {
          settle({
            kind: "refusal",
            reason: "provider_error",
            message: `Coding provider process errored before exit: ${sanitiseError(err)}`,
            exit_signal: "failed",
          });
        });
        child.on("close", (code) => {
          if (code !== 0) {
            const tail = stderr.trim().split("\n").slice(-3).join(" | ");
            settle({
              kind: "refusal",
              reason: "provider_error",
              message: `Coding provider exited with code ${code ?? "null"}. Last stderr: ${tail || "<empty>"}.`,
              exit_signal: "failed",
            });
            return;
          }
          const parsed = parseProviderEnvelope(stdout);
          if (!parsed) {
            settle({
              kind: "refusal",
              reason: "provider_error",
              message:
                "Coding provider exited 0 but did not emit a parseable JSON result envelope on stdout.",
              exit_signal: "failed",
            });
            return;
          }
          settle(parsed);
        });

        try {
          child.stdin.write(JSON.stringify(serialiseProviderRequest(req)) + "\n");
          child.stdin.end();
        } catch (err) {
          settle({
            kind: "refusal",
            reason: "provider_error",
            message: `Failed to write request to coding provider stdin: ${sanitiseError(err)}`,
            exit_signal: "failed",
          });
        }
      });
    },
  };
}

/**
 * The JSON shape the command provider writes to stdin. Kept as a stable
 * contract so future command-based providers can conform without knowing
 * the internal TypeScript types.
 */
export interface SerialisedProviderRequest {
  schema_version: "1.0.0";
  linear_issue_id: string;
  repo: string;
  branch_target: string;
  branch_naming: string;
  ticket: {
    title: string;
    summary: string;
    guardrails: ReadonlyArray<string>;
    non_goals: ReadonlyArray<string>;
  };
  budget_cap_usd: number;
  cost_band_observed: AgentInvocationResult["cost_band"];
  skill_name_and_version: string;
  autonomy_level: AgentInvocationRequest["autonomy_level"];
  approve: boolean;
  run_id: string;
}

function serialiseProviderRequest(
  req: CodingAgentProviderRequest,
): SerialisedProviderRequest {
  return {
    schema_version: "1.0.0",
    linear_issue_id: req.linear_issue_id,
    repo: req.repo,
    branch_target: req.branch_target,
    branch_naming: req.branch_naming,
    ticket: {
      title: req.ticket_title,
      summary: req.ticket_summary,
      guardrails: req.guardrails,
      non_goals: req.non_goals,
    },
    budget_cap_usd: req.budget_cap_usd,
    cost_band_observed: req.cost_band_observed,
    skill_name_and_version: req.skill_name_and_version,
    autonomy_level: req.autonomy_level,
    approve: req.approve,
    run_id: req.run_id,
  };
}

/**
 * Finds the last JSON object on its own line in `stdout` and coerces it
 * into a `CodingAgentProviderResult`. Rejects shapes that claim "run" but
 * carry no `exit_signal`, and rejects unknown `kind` values.
 */
export function parseProviderEnvelope(
  stdout: string,
): CodingAgentProviderResult | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || line[0] !== "{") continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed["kind"] === "refusal") {
        const reason = parsed["reason"];
        const message = parsed["message"];
        const exitSignal = parsed["exit_signal"];
        if (
          !isCodingAgentRefusalKind(reason) ||
          typeof message !== "string" ||
          !isRefusalExit(exitSignal)
        ) {
          return null;
        }
        return {
          kind: "refusal",
          reason,
          message,
          exit_signal: exitSignal,
        };
      }
      if (parsed["kind"] === "run") {
        const exitSignal = parsed["exit_signal"];
        if (!isRunExit(exitSignal)) return null;
        const run: CodingAgentRun = {
          kind: "run",
          exit_signal: exitSignal,
          pr_url: asStringOrNull(parsed["pr_url"]),
          pr_branch: asStringOrNull(parsed["pr_branch"]),
          commit_sha: asStringOrNull(parsed["commit_sha"]),
          spent_usd: asNumberOrNull(parsed["spent_usd"]),
        };
        if (isCostBand(parsed["cost_band"])) run.cost_band = parsed["cost_band"];
        const notes = asStringArray(parsed["notes"]);
        if (notes) run.notes = notes;
        return run;
      }
      return null;
    } catch {
      continue;
    }
  }
  return null;
}

function isCodingAgentRefusalKind(v: unknown): v is CodingAgentRefusalKind {
  return (
    v === "missing_approval" ||
    v === "unsupported_ticket_shape" ||
    v === "missing_minimum_context" ||
    v === "missing_repo" ||
    v === "missing_budget_cap" ||
    v === "cost_runaway_risk" ||
    v === "provider_refused" ||
    v === "provider_error" ||
    v === "provider_timeout" ||
    v === "provider_not_configured"
  );
}
function isRefusalExit(v: unknown): v is CodingAgentRefusal["exit_signal"] {
  return v === "failed" || v === "needs_human" || v === "cancelled";
}
function isRunExit(v: unknown): v is AgentInvocationResult["exit_signal"] {
  return v === "succeeded" || v === "failed" || v === "needs_human" || v === "cancelled";
}
function isCostBand(v: unknown): v is AgentInvocationResult["cost_band"] {
  return v === "normal" || v === "elevated" || v === "runaway_risk" || v === "unknown";
}
function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function asNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asStringArray(v: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const e of v) {
    if (typeof e === "string") out.push(e);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Secret-safe error sanitisation                                      */
/* ------------------------------------------------------------------ */

function sanitiseError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}

const DEFAULT_SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /lin_api_[A-Za-z0-9_\-]+/g,
  /ghp_[A-Za-z0-9_\-]+/g,
  /github_pat_[A-Za-z0-9_\-]+/g,
  /agp_[A-Za-z0-9_\-]+/g,
  /sk-[A-Za-z0-9_\-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
];

/**
 * Scrub token-shaped substrings from a message. Not a security control
 * on its own — the primary contract is that secrets never enter the
 * adapter in the first place (ADR-0017 Rule 1) — but a cheap belt-and-
 * braces guard against a misbehaving provider or an operator who pipes
 * `echo $TOKEN` into their local provider for debugging.
 */
export function scrubSecrets(
  message: string,
  extra?: ReadonlyArray<RegExp>,
): string {
  let out = message;
  for (const pattern of DEFAULT_SECRET_PATTERNS) {
    out = out.replace(pattern, "<redacted>");
  }
  if (extra) {
    for (const pattern of extra) {
      out = out.replace(pattern, "<redacted>");
    }
  }
  return out;
}
