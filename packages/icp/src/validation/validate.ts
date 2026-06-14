/**
 * ICP run-contract schema validation module (LAT-183).
 *
 * Validates output from ICP components (RunReport, RunArtefact,
 * AgentInvocationRequest/Result, ControlLoopJsonSummary) against their
 * schemas. Errors are logged with field-level detail including the full
 * path to the offending field.
 *
 * Schema versioning is supported: each validator carries a `schemaVersion`
 * that can be bumped on breaking changes. Consumers may assert on the
 * version to enforce forward-compatible validation.
 *
 * Design principles:
 * - Pure functions: no I/O, no side effects.
 * - Field-level paths: e.g. `"cost.band_unavailable_reason"` so callers
 *   can programmatically highlight exactly which field failed.
 * - Aggregating errors: validates the full object and returns all
 *   violations, not just the first one found.
 * - Non-breaking additions: adding optional fields or extending unions
 *   never invalidates previously valid objects.
 */

import {
  RUN_REPORT_SCHEMA_VERSION,
  type RunReport,
  type RunReportStatus,
  type AgentType,
  type TriggeredBy,
  type AutonomyLevel,
  type CostBand,
  type SkillStatus,
  type AgentInvocationRequest,
  type AgentInvocationResult,
  type TicketInvocationContext,
  type PolicyEvaluation,
  type PolicyVerdict,
} from "../runtime/contract.js";

import {
  RUN_ARTIFACT_SCHEMA_VERSION,
  type RunArtefact,
  type RunArtefactInput,
  type RunArtefactOutcome,
  type RunSurface,
  type ArtefactClass,
  type QualityLabel,
  type TrainingEligibility,
  type CostClass,
  type RiskClass,
  type ArtefactCheck,
  type ChangedFilesSummary,
  type ClassifierEvidence,
  type AcceptanceCriterionCoverage,
} from "../observability/run-artifact.js";

import { type ControlLoopJsonSummary } from "../dispatcher/types.js";

/* ------------------------------------------------------------------ */
/* Schema version tracking                                            */
/* ------------------------------------------------------------------ */

/**
 * Version registry for every validated output schema.
 * Bump when a breaking change lands (required field added, enum value
 * removed, type changed). Additions to existing unions or new optional
 * fields are non-breaking and do not require a version bump.
 */
export const SCHEMA_VERSIONS = {
  /** ICP Run Report schema version (must match RUN_REPORT_SCHEMA_VERSION). */
  runReport: RUN_REPORT_SCHEMA_VERSION,
  /** Structured run artefact schema version (must match RUN_ARTIFACT_SCHEMA_VERSION). */
  runArtefact: RUN_ARTIFACT_SCHEMA_VERSION,
  /** Agent invocation request schema version. */
  agentInvocationRequest: "1.0.0",
  /** Agent invocation result schema version. */
  agentInvocationResult: "1.0.0",
  /** Control-loop JSON summary schema version. */
  controlLoopSummary: "1.0.0",
  /** Policy evaluation schema version. */
  policyEvaluation: "1.0.0",
} as const;

/**
 * Asserts that a version string matches the expected schema version.
 * Throws a VersionMismatchError if they differ.
 */
export class VersionMismatchError extends Error {
  readonly kind = "VersionMismatch";

  constructor({
    schemaName,
    expected,
    actual,
  }: {
    schemaName: string;
    expected: string;
    actual: string;
  }) {
    super(
      `Schema version mismatch for ${schemaName}: expected ${expected}, got ${actual}`,
    );
  }
}

/**
 * Validate that an object carries the expected schema version in its
 * `schema_version` field. Useful when consumers want to enforce that
 * incoming data matches the current schema version.
 */
export function assertSchemaVersion(
  schemaName: string,
  expectedVersion: string,
  object: { schema_version?: string },
): void {
  const actual = object.schema_version;
  if (actual === undefined) return; // unversioned objects are allowed
  if (actual === expectedVersion) return;

  throw new VersionMismatchError({
    schemaName,
    expected: expectedVersion,
    actual,
  });
}

/* ------------------------------------------------------------------ */
/* Validation error types                                             */
/* ------------------------------------------------------------------ */

/**
 * A single validation error pointing to a field path with an explanation.
 */
export interface ValidationError {
  /**
   * Dot-separated path to the offending field.
   * Examples: `"status"`, `"cost.band"`, `"correlation.pr_url"`.
   */
  field: string;
  /** Human-readable explanation of what went wrong. */
  message: string;
}

/**
 * Aggregated validation result. `isValid` is true when no errors were found.
 */
export interface ValidationResult<T = unknown> {
  isValid: boolean;
  errors: ReadonlyArray<ValidationError>;
  /** The original object that was validated. */
  object: T;
}

/**
 * Convert a ValidationResult to a human-readable string with one error
 * per line, each prefixed with the field path.
 */
export function formatValidationErrors(errors: ReadonlyArray<ValidationError>): string {
  if (errors.length === 0) return "(no errors)";
  return errors.map((e) => `  ✖ ${e.field}: ${e.message}`).join("\n");
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                 */
/* ------------------------------------------------------------------ */

/** Collect a validation error into the errors array. */
function addError(
  errors: ValidationError[],
  field: string,
  message: string,
): void {
  errors.push({ field, message });
}

/** Check that a value is a non-empty string. */
function requireString(
  errors: ValidationError[],
  value: unknown,
  fieldPath: string,
): string | null {
  if (typeof value !== "string" || value.length === 0) {
    addError(errors, fieldPath, `must be a non-empty string, got ${value === undefined ? "undefined" : typeof value}`);
    return null;
  }
  return value;
}

/** Check that a value is a valid ISO-8601 date string. */
function requireIsoDate(
  errors: ValidationError[],
  value: unknown,
  fieldPath: string,
): string | null {
  const s = requireString(errors, value, fieldPath);
  if (s === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) {
    addError(errors, fieldPath, `must be an ISO-8601 date string, got "${s}"`);
    return null;
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    addError(errors, fieldPath, `invalid ISO-8601 date: "${s}"`);
    return null;
  }
  return s;
}

/** Check that a value is a non-negative number. */
function requireNonNegative(
  errors: ValidationError[],
  value: unknown,
  fieldPath: string,
): number | null {
  if (typeof value !== "number" || value < 0) {
    addError(errors, fieldPath, `must be a non-negative number, got ${value === undefined ? "undefined" : typeof value}`);
    return null;
  }
  return value;
}

/** Check that a value is a positive number. */
function requirePositive(
  errors: ValidationError[],
  value: unknown,
  fieldPath: string,
): number | null {
  if (typeof value !== "number" || value <= 0) {
    addError(errors, fieldPath, `must be a positive number, got ${value === undefined ? "undefined" : typeof value}`);
    return null;
  }
  return value;
}

/** Validate that a value matches one of the allowed enum values. */
function requireEnum(
  errors: ValidationError[],
  value: unknown,
  fieldPath: string,
  allowed: ReadonlyArray<string>,
): string | null {
  if (!allowed.includes(value as string)) {
    addError(errors, fieldPath, `must be one of [${allowed.join(", ")}], got "${value === undefined ? "undefined" : String(value)}"`);
    return null;
  }
  return value as string;
}

/** Check that a value is a non-empty string or null/undefined. */
function requireNullableString(
  errors: ValidationError[],
  value: unknown,
  fieldPath: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0) {
    addError(errors, fieldPath, `must be a non-empty string or null/undefined, got ${typeof value}`);
    return null;
  }
  return value;
}

/** Check that a value is a non-empty array of strings. */
function requireStringArray(
  errors: ValidationError[],
  value: unknown,
  fieldPath: string,
): ReadonlyArray<string> | null {
  if (!Array.isArray(value)) {
    addError(errors, fieldPath, `must be an array of strings, got ${value === undefined ? "undefined" : typeof value}`);
    return null;
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      addError(errors, `${fieldPath}[${i}]`, `must be a string, got ${typeof value[i]}`);
    }
  }
  return value as ReadonlyArray<string>;
}

/** Check that a value is a non-empty array of non-empty strings. */
function requireNonEmptyStringArray(
  errors: ValidationError[],
  value: unknown,
  fieldPath: string,
): ReadonlyArray<string> | null {
  if (!Array.isArray(value) || value.length === 0) {
    addError(errors, fieldPath, `must be a non-empty array of strings, got ${value === undefined ? "undefined" : `array of ${value.length}`}`);
    return null;
  }
  return requireStringArray(errors, value, fieldPath) as ReadonlyArray<string>;
}

/** Check that a value is a valid URL string (throws on parse failure). */
function requireUrl(
  errors: ValidationError[],
  value: unknown,
  fieldPath: string,
): string | null {
  const s = requireNullableString(errors, value, fieldPath);
  if (s === null) return null;
  if (s.length === 0) return null;
  try {
    new URL(s);
  } catch {
    addError(errors, fieldPath, `must be a valid URL, got "${s}"`);
    return null;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* RunReport validator                                                */
/* ------------------------------------------------------------------ */

/**
 * Validate a RunReport against the ICP run contract schema.
 */
export function validateRunReport(
  report: unknown,
): ValidationResult<RunReport> {
  const errors: ValidationError[] = [];

  if (report === null || report === undefined || typeof report !== "object") {
    return {
      isValid: false,
      errors: [{ field: "", message: "must be an object" }],
      object: report as RunReport,
    };
  }

  const r = report as Record<string, unknown>;

  // schema_version
  requireEnum(errors, r.schema_version, "schema_version", [RUN_REPORT_SCHEMA_VERSION]);

  // run_id
  requireString(errors, r.run_id, "run_id");

  // agent_type
  requireEnum(
    errors,
    r.agent_type,
    "agent_type",
    ["coding", "qa", "review", "sre", "pm", "research", "observability"],
  );

  // status
  requireEnum(
    errors,
    r.status,
    "status",
    ["started", "succeeded", "failed", "cancelled", "needs_human"],
  );

  // triggered_by
  requireEnum(
    errors,
    r.triggered_by,
    "triggered_by",
    [
      "user",
      "linear_status",
      "schedule",
      "webhook",
      "agent",
      "github_comment",
      "hook",
      "mcp",
    ],
  );

  // linear_issue_id
  requireString(errors, r.linear_issue_id, "linear_issue_id");

  // autonomy_level
  requireEnum(
    errors,
    r.autonomy_level,
    "autonomy_level",
    ["L1-read-only", "L2-propose", "L3-with-approval", "L4-autonomous"],
  );

  // started_at / ended_at
  requireIsoDate(errors, r.started_at, "started_at");
  requireIsoDate(errors, r.ended_at, "ended_at");

  // summary
  requireString(errors, r.summary, "summary");

  // decisions / next_actions / errors
  requireStringArray(errors, r.decisions, "decisions");
  requireStringArray(errors, r.next_actions, "next_actions");
  requireStringArray(errors, r.errors, "errors");

  // cost
  const cost = r.cost;
  if (cost === null || cost === undefined || typeof cost !== "object") {
    addError(errors, "cost", "must be an object");
  } else {
    const c = cost as Record<string, unknown>;
    requireEnum(
      errors,
      c.band,
      "cost.band",
      ["normal", "elevated", "runaway_risk", "unknown"],
    );
    // budget_cap_usd: number or null
    if (c.budget_cap_usd !== null && c.budget_cap_usd !== undefined) {
      if (typeof c.budget_cap_usd !== "number") {
        addError(errors, "cost.budget_cap_usd", "must be a number or null");
      }
    }
    // spent_usd: number or null
    if (c.spent_usd !== null && c.spent_usd !== undefined) {
      if (typeof c.spent_usd !== "number") {
        addError(errors, "cost.spent_usd", "must be a number or null");
      }
    }
    // band_unavailable_reason: string or null
    if (c.band_unavailable_reason !== null && c.band_unavailable_reason !== undefined) {
      if (typeof c.band_unavailable_reason !== "string") {
        addError(errors, "cost.band_unavailable_reason", "must be a string or null");
      }
    }
  }

  // correlation
  const correlation = r.correlation;
  if (correlation === null || correlation === undefined || typeof correlation !== "object") {
    addError(errors, "correlation", "must be an object");
  } else {
    const co = correlation as Record<string, unknown>;
    requireNullableString(errors, co.pr_url, "correlation.pr_url");
    requireNullableString(errors, co.pr_branch, "correlation.pr_branch");
    requireNullableString(errors, co.commit_sha, "correlation.commit_sha");
    requireNullableString(errors, co.linear_comment_url, "correlation.linear_comment_url");
  }

  const isValid = errors.length === 0;
  return { isValid, errors, object: report as RunReport };
}

/* ------------------------------------------------------------------ */
/* RunArtefact validator                                              */
/* ------------------------------------------------------------------ */

/**
 * Validate a RunArtefact against the observability schema.
 */
export function validateRunArtefact(
  artefact: unknown,
): ValidationResult<RunArtefact> {
  const errors: ValidationError[] = [];

  if (artefact === null || artefact === undefined || typeof artefact !== "object") {
    return {
      isValid: false,
      errors: [{ field: "", message: "must be an object" }],
      object: artefact as RunArtefact,
    };
  }

  const a = artefact as Record<string, unknown>;

  // schema_version
  requireEnum(errors, a.schema_version, "schema_version", [RUN_ARTIFACT_SCHEMA_VERSION]);

  // invocation_id
  requireString(errors, a.invocation_id, "invocation_id");

  // surface
  requireEnum(errors, a.surface, "surface", ["dispatcher", "control-loop", "opencode-harness"]);

  // producer
  requireString(errors, a.producer, "producer");

  // ticket_id / branch / sandbox_path / provider / runtime_id
  requireNullableString(errors, a.ticket_id, "ticket_id");
  requireNullableString(errors, a.branch, "branch");
  requireNullableString(errors, a.sandbox_path, "sandbox_path");
  requireNullableString(errors, a.provider, "provider");
  requireNullableString(errors, a.runtime_id, "runtime_id");

  // cost_class / risk_level
  requireEnum(errors, a.cost_class, "cost_class", ["low", "medium", "high", "unknown"]);
  requireEnum(errors, a.risk_level, "risk_level", ["low", "medium", "high", "unknown"]);

  // classifier
  if (a.classifier !== null && a.classifier !== undefined) {
    if (typeof a.classifier !== "object") {
      addError(errors, "classifier", "must be an object or null");
    } else {
      const cl = a.classifier as Record<string, unknown>;
      requireEnum(errors, cl.dispatchable, "classifier.dispatchable", [true, false]);
      requireEnum(errors, cl.risk_class, "classifier.risk_class", ["low", "medium", "high", "unknown"]);
      if (typeof cl.work_type !== "string") {
        addError(errors, "classifier.work_type", "must be a string");
      }
      if (typeof cl.reason !== "string") {
        addError(errors, "classifier.reason", "must be a string");
      }
      requireEnum(errors, cl.required_human_approval, "classifier.required_human_approval", [true, false]);
      requireStringArray(errors, cl.hard_blocker_codes, "classifier.hard_blocker_codes");
    }
  }

  // pack_path / pack_sha256
  requireNullableString(errors, a.pack_path, "pack_path");
  requireNullableString(errors, a.pack_sha256, "pack_sha256");

  // prompt_version / skill_version
  requireString(errors, a.prompt_version, "prompt_version");
  requireString(errors, a.skill_version, "skill_version");

  // outcome
  requireEnum(
    errors,
    a.outcome,
    "outcome",
    [
      "succeeded",
      "ready_for_review",
      "checks_failed",
      "refused",
      "failed",
      "cancelled",
      "needs_human",
      "planned",
      "no_eligible_issue",
      "config_error",
    ],
  );

  // refusal_code / refusal_message
  requireNullableString(errors, a.refusal_code, "refusal_code");
  if (typeof a.refusal_message !== "string") {
    addError(errors, "refusal_message", "must be a string");
  }

  // pr_url
  requireNullableString(errors, a.pr_url, "pr_url");

  // checks
  const checks = a.checks;
  if (!Array.isArray(checks)) {
    addError(errors, "checks", "must be an array");
  } else {
    for (let i = 0; i < checks.length; i++) {
      const check = checks[i];
      if (typeof check !== "object" || check === null) {
        addError(errors, `checks[${i}]`, "must be an object");
        continue;
      }
      const ck = check as Record<string, unknown>;
      requireString(errors, ck.name, `checks[${i}].name`);
      requireString(errors, ck.command, `checks[${i}].command`);
      requireEnum(
        errors,
        ck.outcome,
        `checks[${i}].outcome`,
        ["passed", "failed", "skipped", "manual"],
      );
      requireNonNegative(errors, ck.durationMs, `checks[${i}].durationMs`);
      requireEnum(errors, ck.kind, `checks[${i}].kind`, ["shell", "policy", "manual"]);
      if (ck.detail !== undefined && typeof ck.detail !== "string") {
        addError(errors, `checks[${i}].detail`, "must be a string");
      }
    }
  }

  // changed_files
  if (a.changed_files !== null && a.changed_files !== undefined) {
    if (typeof a.changed_files !== "object") {
      addError(errors, "changed_files", "must be an object or null");
    } else {
      const cf = a.changed_files as Record<string, unknown>;
      requireNonNegative(errors, cf.count, "changed_files.count");
      if (!Array.isArray(cf.paths)) {
        addError(errors, "changed_files.paths", "must be an array");
      } else {
        for (let i = 0; i < (cf.paths as unknown[]).length; i++) {
          if (typeof (cf.paths as unknown[])[i] !== "string") {
            addError(errors, `changed_files.paths[${i}]`, "must be a string");
          }
        }
      }
      if (typeof cf.truncated !== "boolean") {
        addError(errors, "changed_files.truncated", "must be a boolean");
      }
    }
  }

  // acceptance_criteria_coverage
  const accCov = a.acceptance_criteria_coverage;
  if (!Array.isArray(accCov)) {
    addError(errors, "acceptance_criteria_coverage", "must be an array");
  } else {
    for (let i = 0; i < accCov.length; i++) {
      const item = accCov[i];
      if (typeof item !== "object" || item === null) {
        addError(errors, `acceptance_criteria_coverage[${i}]`, "must be an object");
        continue;
      }
      const ac = item as Record<string, unknown>;
      if (typeof ac.criterion !== "string") {
        addError(errors, `acceptance_criteria_coverage[${i}].criterion`, "must be a string");
      }
      requireEnum(
        errors,
        ac.status,
        `acceptance_criteria_coverage[${i}].status`,
        ["covered", "partial", "uncovered", "unknown"],
      );
    }
  }

  // log_refs
  const logRefs = a.log_refs;
  if (logRefs === null || logRefs === undefined || typeof logRefs !== "object") {
    addError(errors, "log_refs", "must be an object");
  } else {
    const lr = logRefs as Record<string, unknown>;
    requireNullableString(errors, lr.stdout_path, "log_refs.stdout_path");
    requireNullableString(errors, lr.stderr_path, "log_refs.stderr_path");
    requireNullableString(errors, lr.stdout_sha256, "log_refs.stdout_sha256");
  }

  // started_at / ended_at / duration_ms
  requireIsoDate(errors, a.started_at, "started_at");
  requireIsoDate(errors, a.ended_at, "ended_at");
  requireNonNegative(errors, a.duration_ms, "duration_ms");

  // artefact_class / training_eligibility / quality_label
  requireEnum(errors, a.artefact_class, "artefact_class", ["operational_log", "dataset_candidate"]);
  requireEnum(errors, a.training_eligibility, "training_eligibility", ["eligible", "ineligible", "needs_human_decision"]);
  requireEnum(errors, a.quality_label, "quality_label", ["ready_for_review", "needs_review", "low_quality", "unknown"]);

  // eligibility_reason
  if (typeof a.eligibility_reason !== "string") {
    addError(errors, "eligibility_reason", "must be a string");
  }

  // redaction
  const redaction = a.redaction;
  if (redaction === null || redaction === undefined || typeof redaction !== "object") {
    addError(errors, "redaction", "must be an object");
  } else {
    const rd = redaction as Record<string, unknown>;
    if (typeof rd.redactor !== "string") {
      addError(errors, "redaction.redactor", "must be a string");
    }
    if (!Array.isArray(rd.applied_patterns)) {
      addError(errors, "redaction.applied_patterns", "must be an array");
    }
    if (typeof rd.redaction_counts !== "object" || rd.redaction_counts === null) {
      addError(errors, "redaction.redaction_counts", "must be an object");
    } else {
      const rc = rd.redaction_counts as Record<string, unknown>;
      for (const key of ["tokens", "urls", "pod_ids", "extra_secrets"] as const) {
        if (typeof rc[key] !== "number") {
          addError(errors, `redaction.redaction_counts.${key}`, "must be a number");
        }
      }
    }
    if (typeof rd.pre_redaction_payload_sha256 !== "string") {
      addError(errors, "redaction.pre_redaction_payload_sha256", "must be a string");
    }
    if (typeof rd.extra_secrets_supplied !== "number") {
      addError(errors, "redaction.extra_secrets_supplied", "must be a number");
    }
  }

  const isValid = errors.length === 0;
  return { isValid, errors, object: artefact as RunArtefact };
}

/* ------------------------------------------------------------------ */
/* AgentInvocationRequest validator                                   */
/* ------------------------------------------------------------------ */

/**
 * Validate an AgentInvocationRequest against the ICP run contract schema.
 */
export function validateAgentInvocationRequest(
  req: unknown,
): ValidationResult<AgentInvocationRequest> {
  const errors: ValidationError[] = [];

  if (req === null || req === undefined || typeof req !== "object") {
    return {
      isValid: false,
      errors: [{ field: "", message: "must be an object" }],
      object: req as AgentInvocationRequest,
    };
  }

  const r = req as Record<string, unknown>;

  // agent_type (must be "coding" for the interface)
  requireEnum(errors, r.agent_type, "agent_type", ["coding"]);

  // linear_issue_id
  requireString(errors, r.linear_issue_id, "linear_issue_id");

  // autonomy_level
  requireEnum(
    errors,
    r.autonomy_level,
    "autonomy_level",
    ["L1-read-only", "L2-propose", "L3-with-approval", "L4-autonomous"],
  );

  // approve
  if (typeof r.approve !== "boolean") {
    addError(errors, "approve", "must be a boolean");
  }

  // dry_run
  if (typeof r.dry_run !== "boolean") {
    addError(errors, "dry_run", "must be a boolean");
  }

  // Optional fields
  requireNullableString(errors, r.repo, "repo");
  requireNullableString(errors, r.branch_target, "branch_target");
  requireNullableString(errors, r.branch_naming, "branch_naming");

  // ticket_context
  if (r.ticket_context !== null && r.ticket_context !== undefined) {
    if (typeof r.ticket_context !== "object") {
      addError(errors, "ticket_context", "must be an object or null/undefined");
    } else {
      const tc = r.ticket_context as Record<string, unknown>;
      requireString(errors, tc.title, "ticket_context.title");
      requireString(errors, tc.summary, "ticket_context.summary");
      requireStringArray(errors, tc.guardrails, "ticket_context.guardrails");
      // non_goals must be an array of strings (empty allowed)
      if (!Array.isArray(tc.non_goals)) {
        addError(errors, "ticket_context.non_goals", "must be an array of strings");
      } else {
        for (let i = 0; i < tc.non_goals.length; i++) {
          if (typeof tc.non_goals[i] !== "string") {
            addError(errors, `ticket_context.non_goals[${i}]`, "must be a string");
          }
        }
      }
    }
  }

  // budget_cap_usd: number or null
  if (r.budget_cap_usd !== null && r.budget_cap_usd !== undefined) {
    if (typeof r.budget_cap_usd !== "number") {
      addError(errors, "budget_cap_usd", "must be a number or null");
    }
  }

  // cost_band_observed
  requireEnum(
    errors,
    r.cost_band_observed,
    "cost_band_observed",
    ["normal", "elevated", "runaway_risk", "unknown"],
  );

  // skill_name_and_version
  if (typeof r.skill_name_and_version !== "undefined" && typeof r.skill_name_and_version !== "string") {
    addError(errors, "skill_name_and_version", "must be a string");
  }

  // run_id
  if (typeof r.run_id !== "undefined" && typeof r.run_id !== "string") {
    addError(errors, "run_id", "must be a string");
  }

  const isValid = errors.length === 0;
  return { isValid, errors, object: req as AgentInvocationRequest };
}

/* ------------------------------------------------------------------ */
/* AgentInvocationResult validator                                    */
/* ------------------------------------------------------------------ */

/**
 * Validate an AgentInvocationResult against the ICP run contract schema.
 */
export function validateAgentInvocationResult(
  result: unknown,
): ValidationResult<AgentInvocationResult> {
  const errors: ValidationError[] = [];

  if (result === null || result === undefined || typeof result !== "object") {
    return {
      isValid: false,
      errors: [{ field: "", message: "must be an object" }],
      object: result as AgentInvocationResult,
    };
  }

  const r = result as Record<string, unknown>;

  // exit_signal
  requireEnum(
    errors,
    r.exit_signal,
    "exit_signal",
    ["succeeded", "failed", "cancelled", "needs_human"],
  );

  // pr_url / pr_branch / commit_sha
  requireNullableString(errors, r.pr_url, "pr_url");
  requireNullableString(errors, r.pr_branch, "pr_branch");
  requireNullableString(errors, r.commit_sha, "commit_sha");

  // cost_band
  requireEnum(errors, r.cost_band, "cost_band", ["normal", "elevated", "runaway_risk", "unknown"]);

  // spent_usd: number or null
  if (r.spent_usd !== null && r.spent_usd !== undefined) {
    if (typeof r.spent_usd !== "number") {
      addError(errors, "spent_usd", "must be a number or null");
    }
  }

  // cost_band_unavailable_reason: string or null
  if (r.cost_band_unavailable_reason !== null && r.cost_band_unavailable_reason !== undefined) {
    if (typeof r.cost_band_unavailable_reason !== "string") {
      addError(errors, "cost_band_unavailable_reason", "must be a string or null");
    }
  }

  // notes: array of strings
  requireStringArray(errors, r.notes, "notes");

  const isValid = errors.length === 0;
  return { isValid, errors, object: result as AgentInvocationResult };
}

/* ------------------------------------------------------------------ */
/* TicketInvocationContext validator                                  */
/* ------------------------------------------------------------------ */

/**
 * Validate a TicketInvocationContext against the ICP run contract schema.
 */
export function validateTicketInvocationContext(
  ctx: unknown,
): ValidationResult<TicketInvocationContext> {
  const errors: ValidationError[] = [];

  if (ctx === null || ctx === undefined || typeof ctx !== "object") {
    return {
      isValid: false,
      errors: [{ field: "", message: "must be an object" }],
      object: ctx as TicketInvocationContext,
    };
  }

  const c = ctx as Record<string, unknown>;

  requireString(errors, c.title, "title");
  requireString(errors, c.summary, "summary");
  requireNonEmptyStringArray(errors, c.guardrails, "guardrails");
  // non_goals: array of strings (empty array is valid per contract)
  if (!Array.isArray(c.non_goals)) {
    addError(errors, "non_goals", "must be an array of strings");
  } else {
    for (let i = 0; i < c.non_goals.length; i++) {
      if (typeof c.non_goals[i] !== "string") {
        addError(errors, `non_goals[${i}]`, "must be a string");
      }
    }
  }

  const isValid = errors.length === 0;
  return { isValid, errors, object: ctx as TicketInvocationContext };
}

/* ------------------------------------------------------------------ */
/* PolicyEvaluation validator                                         */
/* ------------------------------------------------------------------ */

/**
 * Validate a PolicyEvaluation against the ICP run contract schema.
 */
export function validatePolicyEvaluation(
  eval_: unknown,
): ValidationResult<PolicyEvaluation> {
  const errors: ValidationError[] = [];

  if (eval_ === null || eval_ === undefined || typeof eval_ !== "object") {
    return {
      isValid: false,
      errors: [{ field: "", message: "must be an object" }],
      object: eval_ as PolicyEvaluation,
    };
  }

  const e = eval_ as Record<string, unknown>;

  // verdict
  requireEnum(errors, e.verdict, "verdict", ["ready", "caution", "blocked", "stop"]);

  // reasons
  requireStringArray(errors, e.reasons, "reasons");

  // requires_approval
  if (typeof e.requires_approval !== "boolean") {
    addError(errors, "requires_approval", "must be a boolean");
  }

  const isValid = errors.length === 0;
  return { isValid, errors, object: eval_ as PolicyEvaluation };
}

/* ------------------------------------------------------------------ */
/* ControlLoopJsonSummary validator                                   */
/* ------------------------------------------------------------------ */

/**
 * Validate a ControlLoopJsonSummary against the dispatcher types schema.
 */
export function validateControlLoopSummary(
  summary: unknown,
): ValidationResult<ControlLoopJsonSummary> {
  const errors: ValidationError[] = [];

  if (summary === null || summary === undefined || typeof summary !== "object") {
    return {
      isValid: false,
      errors: [{ field: "", message: "must be an object" }],
      object: summary as ControlLoopJsonSummary,
    };
  }

  const s = summary as Record<string, unknown>;

  // schemaVersion
  requireString(errors, s.schemaVersion, "schemaVersion");

  // evidence
  if (s.evidence === null || s.evidence === undefined || typeof s.evidence !== "object") {
    addError(errors, "evidence", "must be an object");
  } else {
    const ev = s.evidence as Record<string, unknown>;
    requireString(errors, ev.state, "evidence.state");

    // ticket, mode: optional strings
    requireNullableString(errors, ev.ticket, "evidence.ticket");
    requireNullableString(errors, ev.mode, "evidence.mode");

    // refusals
    const refusals = ev.refusals;
    if (refusals !== undefined && !Array.isArray(refusals)) {
      addError(errors, "evidence.refusals", "must be an array");
    } else if (Array.isArray(refusals)) {
      for (let i = 0; i < refusals.length; i++) {
        const ref = refusals[i];
        if (typeof ref !== "object" || ref === null) {
          addError(errors, `evidence.refusals[${i}]`, "must be an object");
          continue;
        }
        const rf = ref as Record<string, unknown>;
        requireString(errors, rf.code, `evidence.refusals[${i}].code`);
        requireString(errors, rf.message, `evidence.refusals[${i}].message`);
      }
    }

    // branch
    const branch = ev.branch;
    if (branch !== null && branch !== undefined) {
      if (typeof branch !== "object") {
        addError(errors, "evidence.branch", "must be an object or null");
      } else {
        const br = branch as Record<string, unknown>;
        requireNullableString(errors, br.branch, "evidence.branch.branch");
        requireNullableString(errors, br.prUrl, "evidence.branch.prUrl");
        requireNullableString(errors, br.patchPath, "evidence.branch.patchPath");
        requireNullableString(errors, br.diffPath, "evidence.branch.diffPath");
      }
    }
  }

  const isValid = errors.length === 0;
  return { isValid, errors, object: summary as ControlLoopJsonSummary };
}

/* ------------------------------------------------------------------ */
/* Convenience: validate any known schema type                        */
/* ------------------------------------------------------------------ */

/**
 * Union of all validated types. Used for the generic `validateOutput` dispatcher.
 */
export type ValidatableOutput =
  | RunReport
  | RunArtefact
  | AgentInvocationRequest
  | AgentInvocationResult
  | TicketInvocationContext
  | PolicyEvaluation
  | ControlLoopJsonSummary;

/**
 * Validate any ICP output object against its schema. The function inspects
 * the object's shape to determine which validator to apply.
 */
export function validateOutput(
  output: unknown,
): ValidationResult {
  if (output === null || output === undefined || typeof output !== "object") {
    return {
      isValid: false,
      errors: [{ field: "", message: "must be an object" }],
      object: output,
    };
  }

  const obj = output as Record<string, unknown>;

  // RunReport: has schema_version matching RUN_REPORT_SCHEMA_VERSION and a `status` field
  if (
    typeof obj.schema_version === "string" &&
    obj.schema_version === RUN_REPORT_SCHEMA_VERSION &&
    typeof obj.status === "string"
  ) {
    return validateRunReport(output);
  }

  // RunArtefact: has schema_version matching RUN_ARTIFACT_SCHEMA_VERSION
  if (
    typeof obj.schema_version === "string" &&
    obj.schema_version === RUN_ARTIFACT_SCHEMA_VERSION
  ) {
    return validateRunArtefact(output);
  }

  // ControlLoopJsonSummary: has schemaVersion and evidence
  if (
    typeof obj.schemaVersion === "string" &&
    typeof obj.evidence === "object" &&
    obj.evidence !== null
  ) {
    return validateControlLoopSummary(output);
  }

  // AgentInvocationResult: has exit_signal, cost_band
  if (
    typeof obj.exit_signal === "string" &&
    typeof obj.cost_band === "string"
  ) {
    return validateAgentInvocationResult(output);
  }

  // TicketInvocationContext: has title, summary, guardrails, non_goals
  if (
    typeof obj.title === "string" &&
    typeof obj.summary === "string" &&
    Array.isArray(obj.guardrails)
  ) {
    return validateTicketInvocationContext(output);
  }

  // PolicyEvaluation: has verdict, reasons, requires_approval
  if (
    typeof obj.verdict === "string" &&
    Array.isArray(obj.reasons) &&
    typeof obj.requires_approval === "boolean"
  ) {
    return validatePolicyEvaluation(output);
  }

  // AgentInvocationRequest: has agent_type="coding" and approve
  if (
    typeof obj.agent_type === "string" &&
    typeof obj.approve === "boolean"
  ) {
    return validateAgentInvocationRequest(output);
  }

  // Unknown schema
  return {
    isValid: false,
    errors: [{ field: "", message: "unknown schema: cannot determine type" }],
    object: output,
  };
}
