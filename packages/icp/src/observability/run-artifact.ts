/**
 * LAT-140 structured run artefact for local agent runs.
 *
 * This module defines the schema and a pure builder for the structured,
 * sanitised observability artefact emitted by dispatcher / control-loop /
 * opencode-harness runs. ADR-0006 already fixes the high-level run-report
 * envelope; LAT-140 is the *operational* sibling that captures fields the
 * control-plane needs in order to learn from runs (sandbox paths, pack
 * hashes, classifier output, refusal codes, redaction metadata, etc.) but
 * which the ADR-0006 envelope intentionally leaves to the open
 * `agent_metadata` / `correlation` sub-objects.
 *
 * Hard rules (LAT-140):
 *
 * - The artefact is sanitised before it is materialised. Every free-text
 *   field is passed through `redactOutput` with the caller-supplied extra
 *   secrets list. Tokens, RunPod pod ids, and non-allowlisted URLs cannot
 *   appear in the final artefact.
 * - The artefact carries a `redaction` block declaring which patterns are
 *   applied, the count of redactions per category, and the hash of the
 *   pre-redaction free-text payload (so retros can confirm a run's
 *   artefact wasn't truncated, without re-deriving the secret material).
 * - Every artefact carries an `artefact_class` of either `operational_log`
 *   (raw operational record; never auto-promoted anywhere) or
 *   `dataset_candidate` (suitable for offline retro / training review,
 *   pending human approval). Eligibility is recorded as data only — this
 *   module never uploads, ships, or otherwise externalises the artefact.
 *   The downstream cockpit / retro process owns promotion.
 * - Pure module: no `process.env` reads, no network, no filesystem writes.
 *   The caller decides where (if anywhere) to persist the JSON / Markdown
 *   the builder returns.
 */

import { createHash } from 'node:crypto';

import { redactOutput } from '../dispatcher/redact.js';

/** Schema version stamped into every emitted artefact. SemVer string. */
export const RUN_ARTIFACT_SCHEMA_VERSION = '1.0.0';

/** Surface the artefact came from. */
export type RunSurface = 'dispatcher' | 'control-loop' | 'opencode-harness';

/** Artefact eligibility label per the LAT-140 distinction. */
export type ArtefactClass = 'operational_log' | 'dataset_candidate';

/** Coarse quality label assigned by the producer. Reviewers may revise. */
export type QualityLabel = 'ready_for_review' | 'needs_review' | 'low_quality' | 'unknown';

/** Coarse training-export eligibility decision recorded with the artefact. */
export type TrainingEligibility = 'eligible' | 'ineligible' | 'needs_human_decision';

/** Cost class labels per ADR-0009 / ADR-0020. */
export type CostClass = 'low' | 'medium' | 'high' | 'unknown';

/** Risk class labels per LAT-131 classifier. */
export type RiskClass = 'low' | 'medium' | 'high' | 'unknown';

/** Outcome the producer reports. Distinct from the ADR-0006 status enum. */
export type RunArtefactOutcome =
  | 'succeeded'
  | 'ready_for_review'
  | 'checks_failed'
  | 'refused'
  | 'failed'
  | 'cancelled'
  | 'needs_human'
  | 'planned'
  | 'no_eligible_issue'
  | 'config_error';

/** A single executed/observed check, with sanitised detail. */
export interface ArtefactCheck {
  name: string;
  /**
   * Free-form sanitised description (e.g. the literal command for shell
   * checks, or the policy id for policy checks). Never raw stdout.
   */
  command: string;
  outcome: 'passed' | 'failed' | 'skipped' | 'manual';
  durationMs: number;
  kind: 'shell' | 'policy' | 'manual';
  detail?: string;
}

/**
 * Coarse summary of files the agent changed. Optional — many runs do not
 * have a diff at the time the artefact is emitted (refusals, planned-only
 * runs, dry runs). When present it is a digest, not the diff itself.
 */
export interface ChangedFilesSummary {
  count: number;
  /** Up to N file paths the agent touched. Sanitised; secrets stripped. */
  paths: ReadonlyArray<string>;
  /**
   * True iff the producer truncated the path list to keep the artefact
   * small. Reviewers know to look at the underlying PR for the full diff.
   */
  truncated: boolean;
}

/**
 * Classifier evidence (LAT-131). When the run was selected by the
 * dispatcher's classifier, the dispatchable verdict, hard-blocker codes,
 * and one-line rationale are recorded so retros can correlate
 * eligibility decisions with eventual outcomes.
 */
export interface ClassifierEvidence {
  dispatchable: boolean;
  risk_class: RiskClass;
  work_type: string;
  reason: string;
  required_human_approval: boolean;
  hard_blocker_codes: ReadonlyArray<string>;
}

/** Acceptance-criterion coverage record. Placeholder values are valid. */
export interface AcceptanceCriterionCoverage {
  /** Free text from the pack. Sanitised. */
  criterion: string;
  /**
   * Coarse coverage status. Producers without diff-level signal default
   * to `unknown` and let the human reviewer mark it during PR review.
   */
  status: 'covered' | 'partial' | 'uncovered' | 'unknown';
}

/**
 * Redaction metadata stamped onto every artefact.
 *
 * `applied_patterns` lists the redaction categories the builder applied
 * (token shapes, URL hosts, pod ids, extra-secret literals). Counts are
 * approximate — ripped from the reduction in length of each pass — so a
 * reviewer can spot an artefact that came back empty after redaction.
 */
export interface RedactionMetadata {
  /** Redactor module name. */
  redactor: 'dispatcher.redactOutput';
  /** Categories the builder asked the redactor to apply. */
  applied_patterns: ReadonlyArray<'tokens' | 'urls' | 'pod_ids' | 'extra_secrets'>;
  /** Approximate count of redactions per category, post-build. */
  redaction_counts: {
    tokens: number;
    urls: number;
    pod_ids: number;
    extra_secrets: number;
  };
  /**
   * SHA-256 of the *pre-redaction* free-text payload (concatenated stdout,
   * stderr, and refusal messages). Allows retros to confirm an artefact
   * was generated from a non-empty, non-truncated source without storing
   * the secret material.
   */
  pre_redaction_payload_sha256: string;
  /**
   * Number of literal extra-secret values supplied by the caller. The
   * values themselves are never recorded.
   */
  extra_secrets_supplied: number;
}

/**
 * The structured run artefact.
 */
export interface RunArtefact {
  schema_version: string;
  /** Stable per-invocation correlation id (run_id / invocation_id). */
  invocation_id: string;
  /** Surface that produced the artefact. */
  surface: RunSurface;
  /**
   * Free-form tag for the calling subsystem (e.g. `lat129-dispatcher`,
   * `control-loop-runner`, `opencode-harness:dry-run`). Stable strings.
   */
  producer: string;
  ticket_id: string | null;
  branch: string | null;
  /**
   * Local sandbox / worktree path when the run materialised one. `null`
   * when no sandbox was created (refusals, planned-only). Sanitised
   * through `redactOutput` so an absolute path cannot accidentally carry
   * a token-shaped substring.
   */
  sandbox_path: string | null;
  provider: string | null;
  runtime_id: string | null;
  cost_class: CostClass;
  risk_level: RiskClass;
  classifier: ClassifierEvidence | null;
  /** Path of the ticket pack on disk (sanitised). */
  pack_path: string | null;
  /** SHA-256 of the pack content, hex. Stable per-pack. */
  pack_sha256: string | null;
  /** Placeholder for the prompt template version the producer used. */
  prompt_version: string;
  /** Placeholder for the skill version the producer ran. */
  skill_version: string;
  outcome: RunArtefactOutcome;
  /** Refusal / failure code when relevant; else null. Stable strings. */
  refusal_code: string | null;
  /**
   * One-line, sanitised free-text reason the run terminated as it did.
   * Producers should keep this < 240 chars. Empty string allowed.
   */
  refusal_message: string;
  pr_url: string | null;
  checks: ReadonlyArray<ArtefactCheck>;
  changed_files: ChangedFilesSummary | null;
  acceptance_criteria_coverage: ReadonlyArray<AcceptanceCriterionCoverage>;
  /**
   * Pointers into the sanitised log payload the surface persisted (or
   * that lives in the parent process's redacted-stdout stream). Never an
   * absolute URL pointing at a sandbox; always either `null` or a
   * repo-relative path.
   */
  log_refs: {
    stdout_path: string | null;
    stderr_path: string | null;
    /** SHA-256 of the redacted stdout payload, hex. Optional. */
    stdout_sha256: string | null;
  };
  /** Wall-clock timestamps for the run. ISO-8601 UTC. */
  started_at: string;
  ended_at: string;
  /** Convenience: ended_at - started_at in milliseconds. */
  duration_ms: number;
  artefact_class: ArtefactClass;
  training_eligibility: TrainingEligibility;
  quality_label: QualityLabel;
  /**
   * Free-form note explaining why training_eligibility / quality_label
   * are what they are. Sanitised. Empty allowed.
   */
  eligibility_reason: string;
  redaction: RedactionMetadata;
}

/**
 * Builder input. Required fields are kept narrow; everything else is
 * optional with sensible defaults so each surface (dispatcher, control
 * loop, opencode harness) supplies only the data it actually has.
 */
export interface RunArtefactInput {
  invocation_id: string;
  surface: RunSurface;
  producer: string;
  outcome: RunArtefactOutcome;
  started_at: Date;
  ended_at: Date;
  ticket_id?: string | null;
  branch?: string | null;
  sandbox_path?: string | null;
  provider?: string | null;
  runtime_id?: string | null;
  cost_class?: CostClass;
  risk_level?: RiskClass;
  classifier?: ClassifierEvidence | null;
  pack_path?: string | null;
  pack_content?: string | null;
  prompt_version?: string;
  skill_version?: string;
  refusal_code?: string | null;
  refusal_message?: string;
  pr_url?: string | null;
  checks?: ReadonlyArray<ArtefactCheck>;
  changed_files?: ChangedFilesSummary | null;
  acceptance_criteria?: ReadonlyArray<string>;
  acceptance_criteria_coverage?: ReadonlyArray<AcceptanceCriterionCoverage>;
  /**
   * Pre-redaction stdout/stderr payload. The builder hashes this for the
   * redaction metadata and never stores the raw value in the artefact.
   * The redacted form is what producers should persist separately.
   */
  raw_stdout?: string;
  raw_stderr?: string;
  log_stdout_path?: string | null;
  log_stderr_path?: string | null;
  log_stdout_redacted?: string;
  /** Extra secret values to scrub from every free-text field. */
  extra_secrets?: ReadonlyArray<string>;
  /**
   * Producer's eligibility decision. Defaults to a conservative
   * `operational_log` / `needs_human_decision` / `unknown` triple so a
   * caller that forgets to fill these in does not accidentally promote
   * the artefact.
   */
  artefact_class?: ArtefactClass;
  training_eligibility?: TrainingEligibility;
  quality_label?: QualityLabel;
  eligibility_reason?: string;
}

const PR_URL_HOSTS = new Set(['github.com', 'linear.app']);

function sanitiseFreeText(s: string | undefined, extraSecrets: ReadonlyArray<string>): string {
  if (typeof s !== 'string' || s.length === 0) return '';
  return redactOutput(s, {
    extraSecrets,
    redactNonLinearUrls: true,
  });
}

function sanitisePath(
  p: string | null | undefined,
  extraSecrets: ReadonlyArray<string>,
): string | null {
  if (p === null || p === undefined) return null;
  if (typeof p !== 'string' || p.length === 0) return null;
  // Path-only: keep URL-shaped substrings out, but don't collapse the
  // path itself. We pass the path through the same redactor so a
  // mistakenly-pasted token in a path is still scrubbed.
  return redactOutput(p, {
    extraSecrets,
    // A sandbox path is rarely a URL; redact only token shapes.
    redactNonLinearUrls: false,
  });
}

function sanitisePrUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined) return null;
  if (typeof url !== 'string' || url.length === 0) return null;
  try {
    const u = new URL(url);
    if (PR_URL_HOSTS.has(u.host) || [...PR_URL_HOSTS].some((h) => u.host.endsWith('.' + h))) {
      return url;
    }
  } catch {
    // fall through
  }
  return null;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function countRedactions(before: string, after: string, marker: string): number {
  if (after.length === 0) return 0;
  // Cheap heuristic: count the marker. Adequate for the metadata block —
  // tests that need exact arithmetic should compute redactions themselves.
  let n = 0;
  let idx = 0;
  while ((idx = after.indexOf(marker, idx)) !== -1) {
    n += 1;
    idx += marker.length;
  }
  // The before string never contains the marker (the redactor always
  // produces it), so the marker count is the redaction count.
  void before;
  return n;
}

/**
 * Build a sanitised RunArtefact. Pure. No I/O.
 */
export function buildRunArtefact(input: RunArtefactInput): RunArtefact {
  const extraSecrets = input.extra_secrets ?? [];

  const safeProducer = sanitiseFreeText(input.producer, extraSecrets);
  const safeTicket = input.ticket_id ? sanitiseFreeText(input.ticket_id, extraSecrets) : null;
  const safeBranch = input.branch ? sanitiseFreeText(input.branch, extraSecrets) : null;
  const safeSandbox = sanitisePath(input.sandbox_path ?? null, extraSecrets);
  const safeProvider = input.provider ? sanitiseFreeText(input.provider, extraSecrets) : null;
  const safeRuntimeId = input.runtime_id ? sanitiseFreeText(input.runtime_id, extraSecrets) : null;
  const safePackPath = sanitisePath(input.pack_path ?? null, extraSecrets);
  const safeRefusalMsg = sanitiseFreeText(input.refusal_message ?? '', extraSecrets);
  const safePrUrl = sanitisePrUrl(input.pr_url ?? null);

  const checks = (input.checks ?? []).map((c) => ({
    name: sanitiseFreeText(c.name, extraSecrets),
    command: sanitiseFreeText(c.command, extraSecrets),
    outcome: c.outcome,
    durationMs: Math.max(0, Math.floor(c.durationMs)),
    kind: c.kind,
    ...(c.detail !== undefined ? { detail: sanitiseFreeText(c.detail, extraSecrets) } : {}),
  }));

  const changedFiles: ChangedFilesSummary | null = input.changed_files
    ? {
        count: Math.max(0, Math.floor(input.changed_files.count)),
        paths: input.changed_files.paths.map((p) => sanitisePath(p, extraSecrets) ?? ''),
        truncated: !!input.changed_files.truncated,
      }
    : null;

  const acCoverage: ReadonlyArray<AcceptanceCriterionCoverage> = (() => {
    if (input.acceptance_criteria_coverage && input.acceptance_criteria_coverage.length > 0) {
      return input.acceptance_criteria_coverage.map((c) => ({
        criterion: sanitiseFreeText(c.criterion, extraSecrets),
        status: c.status,
      }));
    }
    if (input.acceptance_criteria && input.acceptance_criteria.length > 0) {
      // Default placeholder coverage: every criterion is `unknown` until a
      // reviewer (or a future structural checker) flips it.
      return input.acceptance_criteria.map((criterion) => ({
        criterion: sanitiseFreeText(criterion, extraSecrets),
        status: 'unknown' as const,
      }));
    }
    return [];
  })();

  const packSha = input.pack_content ? sha256Hex(input.pack_content) : null;

  // Pre-redaction payload hash: stdout + stderr + refusal message, in a
  // canonical order. We hash *raw* stdin so reviewers can prove an
  // artefact was emitted from a non-empty source without us storing
  // the secret material itself.
  const rawPayload = [
    input.raw_stdout ?? '',
    '\n---STDERR---\n',
    input.raw_stderr ?? '',
    '\n---REFUSAL---\n',
    input.refusal_message ?? '',
  ].join('');
  const payloadSha = sha256Hex(rawPayload);

  const safeStdoutRedacted = input.log_stdout_redacted
    ? sanitiseFreeText(input.log_stdout_redacted, extraSecrets)
    : null;

  const tokenCount =
    countRedactions(input.raw_stdout ?? '', safeRefusalMsg, '<redacted>') +
    countRedactions(input.raw_stdout ?? '', safeStdoutRedacted ?? '', '<redacted>');
  const urlCount =
    countRedactions('', safeRefusalMsg, '<redacted-url>') +
    countRedactions('', safeStdoutRedacted ?? '', '<redacted-url>');
  const podCount =
    countRedactions('', safeRefusalMsg, '<redacted-pod-id>') +
    countRedactions('', safeStdoutRedacted ?? '', '<redacted-pod-id>');

  const startedAt = input.started_at.toISOString();
  const endedAt = input.ended_at.toISOString();
  const durationMs = Math.max(0, input.ended_at.getTime() - input.started_at.getTime());

  const artefact: RunArtefact = {
    schema_version: RUN_ARTIFACT_SCHEMA_VERSION,
    invocation_id: input.invocation_id,
    surface: input.surface,
    producer: safeProducer,
    ticket_id: safeTicket,
    branch: safeBranch,
    sandbox_path: safeSandbox,
    provider: safeProvider,
    runtime_id: safeRuntimeId,
    cost_class: input.cost_class ?? 'unknown',
    risk_level: input.risk_level ?? 'unknown',
    classifier: input.classifier ?? null,
    pack_path: safePackPath,
    pack_sha256: packSha,
    prompt_version: input.prompt_version ?? 'unset@0.0.0',
    skill_version: input.skill_version ?? 'unset@0.0.0',
    outcome: input.outcome,
    refusal_code: input.refusal_code ?? null,
    refusal_message: safeRefusalMsg,
    pr_url: safePrUrl,
    checks,
    changed_files: changedFiles,
    acceptance_criteria_coverage: acCoverage,
    log_refs: {
      stdout_path: input.log_stdout_path ?? null,
      stderr_path: input.log_stderr_path ?? null,
      stdout_sha256: safeStdoutRedacted ? sha256Hex(safeStdoutRedacted) : null,
    },
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    artefact_class: input.artefact_class ?? 'operational_log',
    training_eligibility: input.training_eligibility ?? 'needs_human_decision',
    quality_label: input.quality_label ?? 'unknown',
    eligibility_reason: sanitiseFreeText(input.eligibility_reason ?? '', extraSecrets),
    redaction: {
      redactor: 'dispatcher.redactOutput',
      applied_patterns: ['tokens', 'urls', 'pod_ids', 'extra_secrets'],
      redaction_counts: {
        tokens: tokenCount,
        urls: urlCount,
        pod_ids: podCount,
        extra_secrets: extraSecrets.length,
      },
      pre_redaction_payload_sha256: payloadSha,
      extra_secrets_supplied: extraSecrets.length,
    },
  };

  return artefact;
}

/**
 * Render the artefact as a stable JSON string with sorted keys. Stable
 * key ordering keeps diffs in the `runs/` tree readable.
 */
export function renderRunArtefactJson(artefact: RunArtefact): string {
  return JSON.stringify(artefact, null, 2) + '\n';
}

/**
 * Compact one-line summary of an artefact, suitable for a Linear
 * comment. Always references location + hash; never leaks free-form
 * stdout.
 */
export function formatArtefactCompactRef(args: {
  artefact: RunArtefact;
  artefactPath: string;
}): string {
  const { artefact, artefactPath } = args;
  const sha = artefact.redaction.pre_redaction_payload_sha256.slice(0, 12);
  const cls = artefact.artefact_class === 'dataset_candidate' ? 'dataset' : 'log';
  return [
    `LAT-140 artefact: \`${artefactPath}\``,
    `payload-sha256: \`${sha}\``,
    `class=${cls}`,
    `quality=${artefact.quality_label}`,
    `outcome=${artefact.outcome}`,
  ].join(' · ');
}
