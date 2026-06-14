/**
 * LAT-182 evidence mapper — contract types.
 *
 * The evidence mapper sits between raw provider outputs (control-loop
 * summaries, opencode-harness dry-run summaries, or any future provider
 * format) and the ICP run contract (`RunArtefact`). Its job is to:
 *
 * 1. Accept a provider output envelope (duck-typed, wide interface).
 * 2. Validate required fields and surface warnings for missing ones.
 * 3. Map the provider's domain model onto the `RunArtefactInput` shape.
 * 4. Produce a `MappedRunArtefact` that carries both the artefact and
 *    metadata about which fields were partial / defaulted.
 *
 * This is intentionally a **new** module on the evidence pipeline. It
 * does *not* replace `fromControlLoopSummary` / `fromOpencodeDryRunSummary`
 * in `observability/from-summaries.js`; instead it provides a higher-level
 * façade that calls those helpers under the hood and adds validation +
 * partial-evidence tracking.
 */

/* ------------------------------------------------------------------ */
/* Provider output envelope                                            */
/* ------------------------------------------------------------------ */

/**
 * Minimum shape the mapper expects from a provider. This is deliberately
 * broad and duck-typed so any provider can pass through, even if it
 * doesn't fill every field.
 *
 * The mapper treats unknown / extra fields as pass-through (stored in
 * `metadata.provider_fingerprint` as a SHA-256 of the raw JSON) so that
 * future provider versions remain forward-compatible.
 */
export interface ProviderOutput {
  /** Provider's own schema version string. May be absent. */
  schemaVersion?: string;
  /** Human-readable provider name / id, e.g. `control-loop`, `opencode-harness`. */
  provider?: string;
  /** Ticket identifier the run was about, e.g. `LAT-127`. */
  ticket_id?: string | null;
  /** Path to the ticket pack on disk. */
  pack_path?: string | null;
  /** Content hash (SHA-256) of the ticket pack. */
  pack_sha256?: string | null;
  /** Run state / status string from the provider. */
  state?: string;
  /** Cost class consumed. */
  cost_class?: 'low' | 'medium' | 'high' | 'unknown';
  /** Risk class of the run. */
  risk_level?: 'low' | 'medium' | 'high' | 'unknown';
  /** Provider adapter identifier. */
  adapter?: string | null;
  /** Runtime identifier assigned by the provider. */
  runtime_id?: string | null;
  /** Branch the run created, if any. */
  branch?: string | null;
  /** PR URL, if opened. */
  pr_url?: string | null;
  /** Checks that were run. */
  checks?: ReadonlyArray<{
    name: string;
    command: string;
    outcome: 'passed' | 'failed' | 'skipped' | 'manual';
    durationMs: number;
    kind?: 'shell' | 'policy' | 'manual';
    detail?: string;
  }>;
  /** Acceptance criteria the run was measured against. */
  acceptance_criteria?: ReadonlyArray<string>;
  /** Refusals / early exits. */
  refusals?: ReadonlyArray<{ code: string; message: string }>;
  /** Start timestamp (ISO-8601). */
  started_at?: string;
  /** End timestamp (ISO-8601). */
  ended_at?: string;
  /** Sanitised stdout payload (optional; may be large). */
  raw_stdout?: string;
  /** Sanitised stderr payload (optional; may be large). */
  raw_stderr?: string;
  /** Extra secret values the caller wants redacted. */
  extra_secrets?: ReadonlyArray<string>;
  /** Prompt template version used by the provider (may be absent). */
  prompt_version?: string;
  /** Skill version used by the provider (may be absent). */
  skill_version?: string;
  /** Arbitrary provider metadata the mapper forwards verbatim. */
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Partial evidence tracking                                           */
/* ------------------------------------------------------------------ */

/**
 * A single missing-or-defaulted field on the mapped artefact.
 * Carries the provider path (dot-separated), the kind of deficiency,
 * and a human-readable explanation.
 */
export interface PartialEvidence {
  /** Dot-separated path on the output artefact, e.g. `ticket_id`. */
  path: string;
  /** Why the field is considered partial. */
  reason: string;
  /** Default value the mapper used. Omitted if the value is null. */
  defaulted_value?: unknown;
}

/* ------------------------------------------------------------------ */
/* Validation warnings                                                 */
/* ------------------------------------------------------------------ */

/**
 * A validation warning produced by the mapper. Non-blocking — the
 * mapper still produces a result, but the caller can inspect `warnings`
 * to decide whether to reject or flag the artefact.
 */
export interface ValidationWarning {
  /** Severity level. `soft` means the artefact is still valid. */
  severity: 'soft' | 'hard';
  /** Short code for programmatic matching, e.g. `MISSING_TICKET_ID`. */
  code: string;
  /** Human-readable message. */
  message: string;
}

/* ------------------------------------------------------------------ */
/* Mapper result                                                       */
/* ------------------------------------------------------------------ */

/**
 * Result of a successful map call. Contains both the artefact and
 * metadata about completeness.
 */
export interface MappedRunArtefact {
  /** The mapped `RunArtefact`. */
  artefact: import('../observability/run-artifact.js').RunArtefact;
  /** Whether the artefact is complete (no hard-missing fields). */
  complete: boolean;
  /** Fields that were partial / defaulted. */
  partial_evidence: ReadonlyArray<PartialEvidence>;
  /** Validation warnings (empty when `complete` is true). */
  warnings: ReadonlyArray<ValidationWarning>;
}

/**
 * Result of a failed map call (e.g. missing `state`, unparseable
 * timestamps). The artefact is null and `warnings` carries the errors.
 */
export interface FailedMap {
  /** Always `false`. */
  complete: false;
  artefact: null;
  partial_evidence: [];
  warnings: ValidationWarning[];
  /** Human-readable summary of what went wrong. */
  error: string;
}

/** Union of successful and failed map results. */
export type MapResult = MappedRunArtefact | FailedMap;

/* ------------------------------------------------------------------ */
/* Mapper input                                                        */
/* ------------------------------------------------------------------ */

/**
 * Arguments to the mapper's `map` function.
 */
export interface MapArgs {
  /** Provider output to transform. */
  providerOutput: ProviderOutput;
  /** Invocation id to stamp on the artefact. Generated if omitted. */
  invocation_id?: string;
  /** Producer label to stamp on the artefact. Defaults to the provider name. */
  producer?: string;
  /** Whether the artefact should be classified as dataset_candidate. */
  artefact_class?: import('../observability/run-artifact.js').ArtefactClass;
  /** Training eligibility override. */
  training_eligibility?: import('../observability/run-artifact.js').TrainingEligibility;
  /** Quality label override. */
  quality_label?: import('../observability/run-artifact.js').QualityLabel;
}

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

export { mapProviderOutput } from './mapper.js';
