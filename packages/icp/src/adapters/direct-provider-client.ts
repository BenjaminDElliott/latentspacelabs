/**
 * Direct model-provider client (LAT-67, ADR-0013 § "Direct-Path Operations",
 * ADR-0017 Rule 1 / Rule 5).
 *
 * LAT-67 is the first Direct-Path proof: a minimal Anthropic client that
 * passes through the LAT-61 provider seam without shelling out to a
 * coding-agent runner. It exists to prove end-to-end that a skill running
 * inside the ICP can reach a model provider, produce the LAT-66 cost-band
 * evidence the runner gate requires, and emit a structured evidence
 * artefact that names the provider and model without ever serialising the
 * credential value.
 *
 * What this module is:
 *
 *   - `loadAnthropicCredentialFromEnv(env=process.env)` — the single
 *     sanctioned reader of `process.env.ANTHROPIC_API_KEY` for this path.
 *     The ICP's typed credential loader (ADR-0017) is the long-term home;
 *     until it lands, this function is the boundary. It fails closed with
 *     exactly `ANTHROPIC_API_KEY not set` when the variable is absent; the
 *     message carries no value, prefix, length, or derived fingerprint.
 *
 *   - `createDirectAnthropicProviderClient({ apiKey, ... })` — closure over
 *     the API key. The returned client never re-exposes the key through
 *     its public surface, its notes, its event stream, or its return
 *     values. Callers get `ping()` only.
 *
 *   - `DirectProviderPingResult` — the secret-safe envelope the proof
 *     harness writes into E1 evidence. It carries provider / model /
 *     status / usage / latency / a cost-band determination and a
 *     `secret_source` *label* (never a value) so downstream readers can
 *     distinguish an env-injected credential from a future loader-injected
 *     credential without parsing narrative.
 *
 * What this module is **not**:
 *
 *   - Not a streaming client. Not a tool-use client. Not a multi-turn
 *     chat client. Not a Bedrock client. LAT-67's non-goals are explicit.
 *   - Not a retry/backoff layer. A failing call surfaces the failure to
 *     the harness, which records it in evidence; the harness does not
 *     auto-retry.
 *   - Not a route for a caller to read the key back out. There is no
 *     `getApiKey()` and no serialisation that would leak the value.
 *
 * Secret hygiene invariants:
 *
 *   - The raw credential only ever lives in (a) `process.env` (where the
 *     operator put it), (b) the local variable `apiKey` inside the
 *     closure this module returns, and (c) the outgoing HTTPS request's
 *     `x-api-key` header. It never enters logs, notes, events, evidence,
 *     error messages, or return values.
 *   - The message a missing-credential failure throws is exactly the
 *     string `ANTHROPIC_API_KEY not set`. Tests assert no value,
 *     prefix, or length leaks into that message.
 *   - A response or error that could contain the provider's echoed key
 *     is passed through the shared `scrubSecrets` redactor before being
 *     surfaced as a `notes[]` entry on the result.
 */
import { scrubSecrets } from "./agent-invocation-adapter.js";
import type { CostBand } from "../runtime/contract.js";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * `process.env`-shaped surface the credential loader depends on. Accepting
 * an injected env makes the loader testable without mutating the real
 * process environment, and keeps the "single sanctioned reader of
 * `process.env.ANTHROPIC_API_KEY`" invariant narrow: production calls
 * default the argument to `process.env`.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface DirectAnthropicClientOptions {
  /**
   * Anthropic API key loaded by `loadAnthropicCredentialFromEnv` (or, in
   * a future ICP credential-loader world, by the loader). Never read from
   * `process.env` *inside* this module — callers resolve credentials at
   * the boundary and inject them here. The client closes over the value
   * and does not re-expose it.
   */
  apiKey: string;
  /**
   * Override the endpoint for tests or alternate Anthropic-compatible
   * surfaces. Defaults to the public Anthropic `/v1/messages` endpoint.
   */
  endpoint?: string;
  /**
   * Override `fetch` for tests. Defaults to `globalThis.fetch` which
   * Node 20+ provides natively.
   */
  fetch?: FetchLike;
  /**
   * Override the Anthropic API version header sent on every request.
   * Defaults to the canonical pinned `2023-06-01` value per the public
   * Anthropic API reference.
   */
  anthropicVersion?: string;
  /**
   * Wall-clock source for latency measurement. Defaults to
   * `Date.now`. Injected for deterministic test output.
   */
  now?: () => number;
  /**
   * Optional secret-safe event hook for structured observability. Events
   * NEVER receive the raw API key, request bodies, or raw response text.
   */
  onEvent?: (event: DirectAnthropicClientEvent) => void;
}

export interface DirectAnthropicClientPingOptions {
  /**
   * Human-readable label identifying *where* the credential came from.
   * The label is a string tag only — `"env:ANTHROPIC_API_KEY"`,
   * `"loader:anthropic:default"`, etc. The *value* is never passed.
   */
  secret_source: string;
  /**
   * Stable per-run correlation id threaded into evidence. The client
   * does not send this to the provider; it is surfaced back so the
   * harness can correlate the provider response with a run.
   */
  run_id: string;
}

/**
 * Structured result of a single Direct-Path `ping` call. Every field is
 * secret-safe by construction:
 *
 *   - `provider`, `model`, `endpoint` are labels.
 *   - `status` is the HTTP status code (200 on success, an integer for
 *     non-2xx). Never a header value.
 *   - `tokens` are integer counts extracted from the response envelope.
 *   - `latency_ms` is a duration, not a timestamp.
 *   - `cost_band_check` is the LAT-66 determination the harness writes
 *     into E1 evidence. `pass` when the call succeeded with a concrete
 *     non-`unknown` band; `fail` otherwise (with a sanitised reason).
 *   - `secret_source` is the caller-supplied label (never the value).
 *   - `notes[]` are scrubbed strings.
 */
export interface DirectProviderPingResult {
  provider: "anthropic";
  model: string;
  endpoint: string;
  anthropic_version: string;
  run_id: string;
  ok: boolean;
  status: number;
  latency_ms: number;
  tokens: {
    input: number | null;
    output: number | null;
  };
  cost_band: CostBand;
  cost_band_unavailable_reason: string | null;
  cost_band_check: {
    outcome: "pass" | "fail";
    reason: string;
  };
  secret_source: string;
  notes: ReadonlyArray<string>;
}

export type DirectAnthropicClientEvent =
  | { type: "ping_started"; provider: "anthropic"; model: string; run_id: string; secret_source: string }
  | { type: "ping_ok"; provider: "anthropic"; model: string; run_id: string; status: number; latency_ms: number; input_tokens: number | null; output_tokens: number | null }
  | { type: "ping_failed"; provider: "anthropic"; model: string; run_id: string; status: number | null; reason: string };

export interface DirectAnthropicClient {
  ping(opts: DirectAnthropicClientPingOptions): Promise<DirectProviderPingResult>;
}

/**
 * Minimum `fetch`-shaped surface the client depends on. Matching a
 * subset of `globalThis.fetch` lets Node's native fetch be passed
 * through without coercion while keeping tests decoupled from DOM types.
 */
export type FetchLike = (
  input: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchLikeResponse>;

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

/* ------------------------------------------------------------------ */
/* Credential loader                                                   */
/* ------------------------------------------------------------------ */

/**
 * The single sanctioned reader of `process.env.ANTHROPIC_API_KEY` for
 * the LAT-67 Direct-Path proof. ADR-0017 Rule 1 names the typed ICP
 * credential loader as the long-term home; this function is the
 * pre-loader boundary.
 *
 * Fails closed with exactly `ANTHROPIC_API_KEY not set` when the
 * variable is absent or empty. The message is asserted verbatim by
 * tests and is the contract the ticket specifies.
 */
export function loadAnthropicCredentialFromEnv(env: EnvLike = process.env): string {
  const v = env["ANTHROPIC_API_KEY"];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  return v;
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

/**
 * LAT-67 pins the proof model and max-tokens ceiling so the first
 * Direct-Path call has no cost-band ambiguity. Future Direct skills
 * will parameterise these; the proof does not.
 */
export const LAT67_PROOF_MODEL = "claude-3-haiku-20240307";
export const LAT67_PROOF_MAX_TOKENS = 16;
export const LAT67_PROOF_PROMPT = "ping";

/**
 * Build a Direct-Path Anthropic client. The returned object exposes only
 * `ping`; `apiKey` is closed over and never re-surfaced.
 *
 * Swapping providers (future OpenAI / Bedrock clients under a separate
 * ticket) touches only a parallel module next to this one; the LAT-61
 * provider seam is unchanged.
 */
export function createDirectAnthropicProviderClient(
  opts: DirectAnthropicClientOptions,
): DirectAnthropicClient {
  if (typeof opts.apiKey !== "string" || opts.apiKey.length === 0) {
    throw new Error(
      "Direct Anthropic client was constructed without an API key. Load it through loadAnthropicCredentialFromEnv (or the future ICP credential loader); never read process.env from a skill.",
    );
  }
  const apiKey = opts.apiKey;
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const anthropicVersion = opts.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
  const doFetch: FetchLike =
    opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof doFetch !== "function") {
    throw new Error(
      "Direct Anthropic client: no fetch implementation available. Pass opts.fetch explicitly on Node <20.",
    );
  }
  const now = opts.now ?? (() => Date.now());

  const emit = (ev: DirectAnthropicClientEvent) => {
    try {
      opts.onEvent?.(ev);
    } catch {
      // Observer must never break the client.
    }
  };

  return {
    async ping(pingOpts: DirectAnthropicClientPingOptions): Promise<DirectProviderPingResult> {
      const model = LAT67_PROOF_MODEL;
      const secretSource = pingOpts.secret_source;
      const runId = pingOpts.run_id;
      const startedAt = now();

      emit({
        type: "ping_started",
        provider: "anthropic",
        model,
        run_id: runId,
        secret_source: secretSource,
      });

      const body = JSON.stringify({
        model,
        max_tokens: LAT67_PROOF_MAX_TOKENS,
        messages: [{ role: "user", content: LAT67_PROOF_PROMPT }],
      });

      let res: FetchLikeResponse;
      try {
        res = await doFetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": anthropicVersion,
          },
          body,
        });
      } catch (err) {
        const reason = scrubSecrets(sanitiseError(err));
        const latency = now() - startedAt;
        emit({
          type: "ping_failed",
          provider: "anthropic",
          model,
          run_id: runId,
          status: null,
          reason,
        });
        return buildFailureResult({
          endpoint,
          anthropicVersion,
          runId,
          secretSource,
          model,
          status: 0,
          latencyMs: latency,
          reason: `network error before HTTP status: ${reason}`,
        });
      }

      const latency = now() - startedAt;

      if (!res.ok) {
        // Pull a short tail of the response text, scrubbed, for the note.
        // Not echoed into the raw evidence artefact — only the sanitised
        // reason is surfaced, and never the request body.
        let tail = "";
        try {
          const raw = await res.text();
          tail = scrubSecrets(raw).slice(0, 200);
        } catch {
          tail = "<response body unreadable>";
        }
        const reason = `HTTP ${res.status} from Anthropic /v1/messages: ${tail || "<empty body>"}`;
        emit({
          type: "ping_failed",
          provider: "anthropic",
          model,
          run_id: runId,
          status: res.status,
          reason: scrubSecrets(reason),
        });
        return buildFailureResult({
          endpoint,
          anthropicVersion,
          runId,
          secretSource,
          model,
          status: res.status,
          latencyMs: latency,
          reason,
        });
      }

      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch (err) {
        const reason = scrubSecrets(
          `HTTP 200 but response body was not valid JSON: ${sanitiseError(err)}`,
        );
        emit({
          type: "ping_failed",
          provider: "anthropic",
          model,
          run_id: runId,
          status: res.status,
          reason,
        });
        return buildFailureResult({
          endpoint,
          anthropicVersion,
          runId,
          secretSource,
          model,
          status: res.status,
          latencyMs: latency,
          reason,
        });
      }

      const usage = extractUsage(parsed);

      emit({
        type: "ping_ok",
        provider: "anthropic",
        model,
        run_id: runId,
        status: res.status,
        latency_ms: latency,
        input_tokens: usage.input,
        output_tokens: usage.output,
      });

      return {
        provider: "anthropic",
        model,
        endpoint,
        anthropic_version: anthropicVersion,
        run_id: runId,
        ok: true,
        status: res.status,
        latency_ms: latency,
        tokens: { input: usage.input, output: usage.output },
        cost_band: "normal",
        cost_band_unavailable_reason: null,
        cost_band_check: {
          outcome: "pass",
          reason: `HTTP 200 with max_tokens=${LAT67_PROOF_MAX_TOKENS}; within ADR-0009 normal band for a single ${model} ping.`,
        },
        secret_source: secretSource,
        notes: [
          `direct:anthropic ping ok model=${model} status=${res.status} latency_ms=${latency}`,
        ],
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface FailureInput {
  endpoint: string;
  anthropicVersion: string;
  runId: string;
  secretSource: string;
  model: string;
  status: number;
  latencyMs: number;
  reason: string;
}

function buildFailureResult(f: FailureInput): DirectProviderPingResult {
  const scrubbedReason = scrubSecrets(f.reason);
  return {
    provider: "anthropic",
    model: f.model,
    endpoint: f.endpoint,
    anthropic_version: f.anthropicVersion,
    run_id: f.runId,
    ok: false,
    status: f.status,
    latency_ms: f.latencyMs,
    tokens: { input: null, output: null },
    cost_band: "unknown",
    cost_band_unavailable_reason: `direct:anthropic ping did not return HTTP 200 (status=${f.status}); no usage surfaced`,
    cost_band_check: {
      outcome: "fail",
      reason: scrubbedReason,
    },
    secret_source: f.secretSource,
    notes: [
      `direct:anthropic ping failed model=${f.model} status=${f.status} latency_ms=${f.latencyMs}`,
      scrubbedReason,
    ],
  };
}

function extractUsage(parsed: unknown): { input: number | null; output: number | null } {
  if (!parsed || typeof parsed !== "object") return { input: null, output: null };
  const usage = (parsed as Record<string, unknown>)["usage"];
  if (!usage || typeof usage !== "object") return { input: null, output: null };
  const u = usage as Record<string, unknown>;
  const input = typeof u["input_tokens"] === "number" ? (u["input_tokens"] as number) : null;
  const output = typeof u["output_tokens"] === "number" ? (u["output_tokens"] as number) : null;
  return { input, output };
}

function sanitiseError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}
