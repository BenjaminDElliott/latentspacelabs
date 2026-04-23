/**
 * Direct-Path Anthropic proof harness (LAT-67).
 *
 * This module is the E1-evidence producer for the first Direct-Path
 * invocation. It is a thin orchestration layer over
 * `createDirectAnthropicProviderClient` that:
 *
 *   1. Loads `ANTHROPIC_API_KEY` through the single sanctioned env
 *      reader (`loadAnthropicCredentialFromEnv`). Missing → fail closed
 *      with exactly `ANTHROPIC_API_KEY not set`.
 *   2. Executes one `ping()` call at a fixed model / prompt / max-tokens
 *      pair (`claude-3-haiku-20240307` / `"ping"` / 16) — no retries, no
 *      streaming, no multi-turn. Non-goals of the ticket.
 *   3. Determines the LAT-66 cost-band check outcome from the structured
 *      ping result. A concrete non-`unknown` band is `pass`; anything
 *      else is `fail` with a sanitised reason.
 *   4. Serialises an E1 evidence artefact — secret-safe by construction
 *      — into a stable on-disk location under `runs/evidence/LAT-67/`.
 *
 * The harness intentionally does **not** register as a `SkillDefinition`
 * in the runtime registry: the proof exists to cross the Direct-Path
 * seam once, produce evidence, and exit. Making it a full skill would
 * require the typed ICP credential loader (ADR-0017 Rule 1), which is
 * scheduled for a later ticket. Until that lands, this harness is the
 * sanctioned Direct-Path call path, and the binding rule "skills do not
 * read process.env" stays honoured — the reader is this harness, not a
 * skill.
 *
 * Secret-hygiene invariants:
 *
 *   - No field in the serialised evidence is the credential value.
 *     Only a `secret_source` *label* (`"env:ANTHROPIC_API_KEY"`) is
 *     written. Tests assert the artefact does not contain the key.
 *   - Notes surfaced from the client have already been scrubbed by the
 *     client; the harness re-scrubs before writing, belt-and-braces.
 *   - Error messages the harness surfaces contain no credential value,
 *     prefix, length, or derived fingerprint.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  LAT67_PROOF_MAX_TOKENS,
  LAT67_PROOF_MODEL,
  LAT67_PROOF_PROMPT,
  createDirectAnthropicProviderClient,
  loadAnthropicCredentialFromEnv,
  type DirectAnthropicClient,
  type DirectProviderPingResult,
  type EnvLike,
} from "../adapters/direct-provider-client.js";
import { scrubSecrets } from "../adapters/agent-invocation-adapter.js";

/* ------------------------------------------------------------------ */
/* Evidence shape                                                      */
/* ------------------------------------------------------------------ */

export const E1_EVIDENCE_SCHEMA_VERSION = "1.0.0";
export const E1_EVIDENCE_ID = "E1-direct-provider-ping";

/**
 * E1 evidence artefact shape. Deliberately narrow: provider, model,
 * status, tokens, latency, cost-band check, secret_source only. Every
 * field is a label, integer, or duration; none of the fields is or
 * derives from the credential value.
 */
export interface DirectProviderE1Evidence {
  schema_version: string;
  evidence_id: string;
  linear_issue_id: string;
  run_id: string;
  generated_at: string;
  provider: "anthropic";
  model: string;
  endpoint: string;
  anthropic_version: string;
  request: {
    max_tokens: number;
    prompt: string;
  };
  status: number;
  ok: boolean;
  tokens: {
    input: number | null;
    output: number | null;
  };
  latency_ms: number;
  cost_band: DirectProviderPingResult["cost_band"];
  cost_band_unavailable_reason: string | null;
  cost_band_check: {
    outcome: "pass" | "fail";
    reason: string;
  };
  secret_source: string;
  notes: ReadonlyArray<string>;
}

export interface DirectAnthropicProofOptions {
  /** Linear ticket the evidence is filed against. Defaults to LAT-67. */
  linear_issue_id?: string;
  /**
   * Stable per-run id. Callers pass one to correlate the evidence with
   * a harness invocation; the harness falls back to a time-bucket id.
   */
  run_id?: string;
  /**
   * Repo-root-relative directory the evidence is written beneath.
   * Defaults to `runs/evidence/<linear_issue_id>/` so the artefact
   * lives alongside ADR-0006 run reports without colliding.
   */
  evidence_dir?: string;
  /**
   * Repo root override. Defaults to `process.cwd()`. Tests pass a temp
   * dir so writes don't pollute the working tree.
   */
  repo_root?: string;
  /**
   * Injected env reader. Defaults to `process.env`. The harness is the
   * only sanctioned reader of `ANTHROPIC_API_KEY` in the codebase.
   */
  env?: EnvLike;
  /**
   * Injected Direct-Path client. Defaults to a freshly built
   * `createDirectAnthropicProviderClient`. Tests inject a client that
   * returns canned ping results without touching the network.
   */
  clientFactory?: (apiKey: string) => DirectAnthropicClient;
  /** Clock source for `generated_at`. Defaults to `new Date`. */
  now?: () => Date;
}

export interface DirectAnthropicProofResult {
  /** Absolute path the evidence JSON was written to. */
  evidence_path: string;
  /** Parsed evidence object, identical to the written JSON. */
  evidence: DirectProviderE1Evidence;
  /** Raw (secret-safe) ping result from the client. */
  ping: DirectProviderPingResult;
}

/* ------------------------------------------------------------------ */
/* Proof harness                                                       */
/* ------------------------------------------------------------------ */

/**
 * Execute the LAT-67 Direct-Path proof end-to-end: load env, ping,
 * derive the LAT-66 cost-band check, write E1 evidence, return the
 * evidence plus its path.
 *
 * Missing `ANTHROPIC_API_KEY` → throws an `Error` whose message is
 * exactly `ANTHROPIC_API_KEY not set`. Callers catch the error and
 * surface the sanitised message to the operator without writing any
 * evidence artefact.
 */
export async function runDirectAnthropicProof(
  opts: DirectAnthropicProofOptions = {},
): Promise<DirectAnthropicProofResult> {
  const linearIssueId = opts.linear_issue_id ?? "LAT-67";
  const runId = opts.run_id ?? `lat67-${Date.now().toString(36)}`;
  const env = opts.env ?? process.env;
  const repoRoot = opts.repo_root ?? process.cwd();
  const evidenceDir =
    opts.evidence_dir ?? join("runs", "evidence", linearIssueId);
  const now = opts.now ?? (() => new Date());

  // Fail closed before any side effect when the credential is absent.
  // Exact message is part of the ticket's acceptance contract.
  const apiKey = loadAnthropicCredentialFromEnv(env);

  const client = opts.clientFactory
    ? opts.clientFactory(apiKey)
    : createDirectAnthropicProviderClient({ apiKey });

  const ping = await client.ping({
    run_id: runId,
    secret_source: "env:ANTHROPIC_API_KEY",
  });

  const evidence: DirectProviderE1Evidence = {
    schema_version: E1_EVIDENCE_SCHEMA_VERSION,
    evidence_id: E1_EVIDENCE_ID,
    linear_issue_id: linearIssueId,
    run_id: runId,
    generated_at: now().toISOString(),
    provider: "anthropic",
    model: ping.model,
    endpoint: ping.endpoint,
    anthropic_version: ping.anthropic_version,
    request: {
      max_tokens: LAT67_PROOF_MAX_TOKENS,
      prompt: LAT67_PROOF_PROMPT,
    },
    status: ping.status,
    ok: ping.ok,
    tokens: {
      input: ping.tokens.input,
      output: ping.tokens.output,
    },
    latency_ms: ping.latency_ms,
    cost_band: ping.cost_band,
    cost_band_unavailable_reason: ping.cost_band_unavailable_reason,
    cost_band_check: {
      outcome: ping.cost_band_check.outcome,
      reason: scrubSecrets(ping.cost_band_check.reason),
    },
    secret_source: ping.secret_source,
    notes: ping.notes.map((n) => scrubSecrets(n)),
  };

  const evidencePath = resolve(
    repoRoot,
    evidenceDir,
    `${E1_EVIDENCE_ID}.json`,
  );
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(
    evidencePath,
    JSON.stringify(evidence, null, 2) + "\n",
    "utf8",
  );

  // Reassert the cost-band gate the ICP runner enforces (LAT-66). If
  // `ping.ok` is true and the band is anything other than a concrete
  // non-`unknown` value, the client is miswritten.
  if (ping.ok && (evidence.cost_band === "unknown" || evidence.cost_band_check.outcome !== "pass")) {
    throw new Error(
      "LAT-67 proof: ok ping produced non-passing cost_band_check; evidence written but does not satisfy LAT-66 gate",
    );
  }

  return { evidence, evidence_path: evidencePath, ping };
}

/* ------------------------------------------------------------------ */
/* CLI entrypoint                                                      */
/* ------------------------------------------------------------------ */

/**
 * CLI shape for `bin/direct-anthropic-proof`. Flags (all optional):
 *   --linear-issue-id=LAT-NN   (default LAT-67)
 *   --run-id=<id>              (default time-bucket)
 *   --evidence-dir=<dir>       (repo-relative; default runs/evidence/<ticket>/)
 *
 * Exit codes:
 *   0 — evidence written, cost_band_check=pass
 *   1 — ping failed or cost_band_check=fail; evidence written for the record
 *   2 — ANTHROPIC_API_KEY not set, or other pre-flight failure
 */
export async function cliMain(
  argv: ReadonlyArray<string>,
  io: {
    stdout: { write(s: string): void };
    stderr: { write(s: string): void };
    cwd: () => string;
    env: EnvLike;
  },
): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    io.stdout.write(renderHelp());
    return 0;
  }

  try {
    const result = await runDirectAnthropicProof({
      linear_issue_id: parsed["linear-issue-id"] ?? "LAT-67",
      ...(parsed["run-id"] ? { run_id: parsed["run-id"] } : {}),
      ...(parsed["evidence-dir"] ? { evidence_dir: parsed["evidence-dir"] } : {}),
      repo_root: io.cwd(),
      env: io.env,
    });
    io.stdout.write(
      JSON.stringify(
        {
          status: result.ping.ok ? "ok" : "failed",
          evidence_path: result.evidence_path,
          provider: result.evidence.provider,
          model: result.evidence.model,
          http_status: result.evidence.status,
          latency_ms: result.evidence.latency_ms,
          tokens: result.evidence.tokens,
          cost_band: result.evidence.cost_band,
          cost_band_check: result.evidence.cost_band_check.outcome,
        },
        null,
        2,
      ) + "\n",
    );
    return result.ping.ok && result.evidence.cost_band_check.outcome === "pass"
      ? 0
      : 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr.write(scrubSecrets(msg) + "\n");
    return msg === "ANTHROPIC_API_KEY not set" ? 2 : 2;
  }
}

interface ParsedArgs {
  help: boolean;
  "linear-issue-id"?: string;
  "run-id"?: string;
  "evidence-dir"?: string;
}

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const out: ParsedArgs = { help: false };
  for (const a of argv) {
    if (a === "-h" || a === "--help") {
      out.help = true;
      continue;
    }
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    if (val === undefined) continue;
    if (key === "linear-issue-id" || key === "run-id" || key === "evidence-dir") {
      out[key] = val;
    }
  }
  return out;
}

function renderHelp(): string {
  return [
    "direct-anthropic-proof — LAT-67 Direct-Path Anthropic invocation proof",
    "",
    "Usage: direct-anthropic-proof [--linear-issue-id=LAT-NN]",
    "                              [--run-id=<id>]",
    "                              [--evidence-dir=<repo-relative-dir>]",
    "",
    "Environment:",
    "  ANTHROPIC_API_KEY   Required. Loaded by the single sanctioned env reader.",
    "                      If absent, exits 2 with 'ANTHROPIC_API_KEY not set'.",
    "",
    "Exit codes:",
    "  0  ping ok and cost_band_check=pass",
    "  1  ping failed or cost_band_check=fail (evidence written)",
    "  2  pre-flight failure (missing key, etc.)",
    "",
  ].join("\n");
}
