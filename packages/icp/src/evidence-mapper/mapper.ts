/**
 * LAT-182 evidence mapper — core mapping logic.
 *
 * Takes a `ProviderOutput` envelope, validates required fields, maps
 * them onto `RunArtefactInput`, and produces a `MappedRunArtefact` (or
 * `FailedMap` if hard constraints are unmet).
 *
 * Design decisions:
 * - Missing non-critical fields produce `PartialEvidence` entries with
 *   conservative defaults. No exceptions are thrown for missing data.
 * - Missing `state` is the only hard requirement; the mapper cannot
 *   determine outcome without it.
 * - Missing timestamps default to a single-point window (started = ended)
 *   to keep `duration_ms` = 0 and avoid NaN.
 * - The mapper is a thin adapter: it delegates the actual
 *   `RunArtefact` construction to `buildRunArtefact` from
 *   `observability/run-artifact.js`.
 */

import { randomUUID } from "node:crypto";

import { buildRunArtefact, type RunArtefact, type RunArtefactInput } from "../observability/run-artifact.js";

import type {
  MapArgs,
  MapResult,
  MappedRunArtefact,
  FailedMap,
  ProviderOutput,
  PartialEvidence,
  ValidationWarning,
} from "./contract.js";

/* ------------------------------------------------------------------ */
/* Required (hard) fields                                             */
/* ------------------------------------------------------------------ */

/**
 * Fields that must be present (truthy, non-empty) for a successful map.
 * If `state` is missing, the mapper cannot determine outcome and fails
 * immediately.
 */
const HARD_REQUIRED = ["state"] as const;

/**
 * Fields that are required but have safe defaults when missing.
 * Missing entries produce `PartialEvidence` records rather than
 * validation failures.
 */
const OPTIONAL_WITH_DEFAULTS = [
  "ticket_id",
  "pack_path",
  "pack_sha256",
  "cost_class",
  "risk_level",
  "adapter",
  "runtime_id",
  "branch",
  "pr_url",
  "checks",
  "acceptance_criteria",
  "refusals",
  "started_at",
  "ended_at",
  "raw_stdout",
  "raw_stderr",
  "extra_secrets",
] as const;

/* ------------------------------------------------------------------ */
/* State → outcome mapping                                            */
/* ------------------------------------------------------------------ */

/**
 * Map provider state strings onto the artefact outcome enum.
 * Unknown states default to `failed` (conservative).
 */
function stateToOutcome(state: string): import("../observability/run-artifact.js").RunArtefactOutcome {
  switch (state) {
    case "ready_for_review":
      return "ready_for_review";
    case "checks_failed":
      return "checks_failed";
    case "refused":
      return "refused";
    case "failed":
      return "failed";
    case "planned":
      return "planned";
    case "succeeded":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "needs_human":
      return "needs_human";
    case "no_eligible_issue":
      return "no_eligible_issue";
    case "config_error":
      return "config_error";
    default:
      return "failed";
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Validate the provider output. Returns a list of warnings.
 * An empty list means the output is valid (but possibly partial).
 */
function validate(providerOutput: ProviderOutput): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Hard required fields
  for (const field of HARD_REQUIRED) {
    const value = providerOutput[field as keyof ProviderOutput];
    if (value === undefined || value === null || value === "") {
      warnings.push({
        severity: "hard",
        code: `MISSING_${field.toUpperCase()}`,
        message: `Required field '${field}' is missing from provider output.`,
      });
    }
  }

  // Check that timestamps parse (soft warning if unparseable)
  if (providerOutput.started_at !== undefined && providerOutput.started_at !== null) {
    const startDate = new Date(providerOutput.started_at);
    if (Number.isNaN(startDate.getTime())) {
      warnings.push({
        severity: "soft",
        code: "INVALID_STARTED_AT",
        message: `started_at is not a valid ISO-8601 timestamp: '${providerOutput.started_at}'. Mapper will use current time.`,
      });
    }
  }

  if (providerOutput.ended_at !== undefined && providerOutput.ended_at !== null) {
    const endDate = new Date(providerOutput.ended_at);
    if (Number.isNaN(endDate.getTime())) {
      warnings.push({
        severity: "soft",
        code: "INVALID_ENDED_AT",
        message: `ended_at is not a valid ISO-8601 timestamp: '${providerOutput.ended_at}'. Mapper will use current time.`,
      });
    }
  }

  // Check that state is a known value (soft warning if not)
  const knownOutcomes = new Set([
    "succeeded", "ready_for_review", "checks_failed", "refused",
    "failed", "cancelled", "needs_human", "planned",
    "no_eligible_issue", "config_error",
  ]);
  if (typeof providerOutput.state === "string" && !knownOutcomes.has(providerOutput.state)) {
    warnings.push({
      severity: "soft",
      code: "UNKNOWN_STATE",
      message: `Provider state '${providerOutput.state}' is not a known outcome. Mapper will map it to 'failed'.`,
    });
  }

  return warnings;
}

/**
 * Check which optional fields are missing and produce partial evidence
 * records for them.
 */
function collectPartialEvidence(
  providerOutput: ProviderOutput,
  warnings: ValidationWarning[],
): PartialEvidence[] {
  const partials: PartialEvidence[] = [];

  for (const field of OPTIONAL_WITH_DEFAULTS) {
    const value = providerOutput[field as keyof ProviderOutput];
    if (value === undefined || value === null || value === "") {
      partials.push({
        path: field,
        reason: `Field '${field}' is missing from provider output; mapper applied a conservative default.`,
      });
    }
  }

  return partials;
}

/**
 * Check if any hard warnings exist.
 */
function hasHardWarnings(warnings: ValidationWarning[]): boolean {
  return warnings.some((w) => w.severity === "hard");
}

/* ------------------------------------------------------------------ */
/* Core mapping                                                       */
/* ------------------------------------------------------------------ */

/**
 * Map a `ProviderOutput` envelope to a `MappedRunArtefact`.
 *
 * This is the main entry point. It validates input, collects partial
 * evidence, builds the artefact input, constructs the artefact, and
 * returns the result with metadata.
 */
export function mapProviderOutput(args: MapArgs): MapResult {
  const { providerOutput } = args;

  // Validate
  const warnings = validate(providerOutput);

  // Check hard requirements
  if (hasHardWarnings(warnings)) {
    return {
      complete: false,
      artefact: null,
      partial_evidence: [],
      warnings,
      error: warnings
        .filter((w) => w.severity === "hard")
        .map((w) => w.message)
        .join("; "),
    };
  }

  // Collect partial evidence
  const partials = collectPartialEvidence(providerOutput, warnings);

  // Build timestamps
  const now = new Date();
  let startedAt: Date;
  let endedAt: Date;

  if (providerOutput.started_at) {
    startedAt = new Date(providerOutput.started_at);
    if (Number.isNaN(startedAt.getTime())) {
      startedAt = now;
      // Already warned above
    }
  } else {
    startedAt = now;
  }

  if (providerOutput.ended_at) {
    endedAt = new Date(providerOutput.ended_at);
    if (Number.isNaN(endedAt.getTime())) {
      endedAt = now;
      // Already warned above
    }
  } else {
    endedAt = now;
  }

  // Ensure ended_at >= started_at for valid duration
  if (endedAt < startedAt) {
    endedAt = startedAt;
  }

  // Map checks (null out undefined)
  const checks = providerOutput.checks?.map((c) => ({
    name: c.name,
    command: c.command,
    outcome: c.outcome,
    durationMs: Math.max(0, Math.floor(c.durationMs)),
    kind: c.kind ?? "shell",
    ...(c.detail !== undefined ? { detail: c.detail } : {}),
  })) ?? [];

  // Map acceptance criteria coverage
  const acCoverage = providerOutput.acceptance_criteria
    ? providerOutput.acceptance_criteria.map((criterion) => ({
        criterion,
        status: "unknown" as const,
      }))
    : [];

  // Map refusal
  const refusal = providerOutput.refusals?.[0] ?? null;

  // Build the RunArtefactInput
  const artefactInput: RunArtefactInput = {
    invocation_id: args.invocation_id ?? randomUUID(),
    surface: "dispatcher", // Default surface; can be overridden later
    producer: args.producer ?? providerOutput.provider ?? "unknown-provider",
    outcome: stateToOutcome(providerOutput.state ?? "failed"),
    started_at: startedAt,
    ended_at: endedAt,
    ticket_id: providerOutput.ticket_id ?? null,
    branch: providerOutput.branch ?? null,
    sandbox_path: null, // Not set by the mapper; caller may override
    provider: providerOutput.adapter ?? null,
    runtime_id: providerOutput.runtime_id ?? null,
    cost_class: providerOutput.cost_class ?? "unknown",
    risk_level: providerOutput.risk_level ?? "unknown",
    classifier: null, // Not set by the mapper
    pack_path: providerOutput.pack_path ?? null,
    pack_content: providerOutput.pack_sha256 ?? null,
    refusal_code: refusal?.code ?? null,
    refusal_message: refusal?.message ?? "",
    pr_url: providerOutput.pr_url ?? null,
    checks,
    changed_files: null,
    acceptance_criteria_coverage: acCoverage,
  };
  // Apply optional fields that are only set when the provider provides them
  if (providerOutput.prompt_version) artefactInput.prompt_version = providerOutput.prompt_version;
  if (providerOutput.skill_version) artefactInput.skill_version = providerOutput.skill_version;
  if (providerOutput.raw_stdout !== undefined) artefactInput.raw_stdout = providerOutput.raw_stdout;
  if (providerOutput.raw_stderr !== undefined) artefactInput.raw_stderr = providerOutput.raw_stderr;
  if (providerOutput.extra_secrets !== undefined) artefactInput.extra_secrets = providerOutput.extra_secrets;
  if (args.artefact_class !== undefined) artefactInput.artefact_class = args.artefact_class;
  if (args.training_eligibility !== undefined) artefactInput.training_eligibility = args.training_eligibility;
  if (args.quality_label !== undefined) artefactInput.quality_label = args.quality_label;
  // Build the artefact
  const artefact = buildRunArtefact(artefactInput);

  // Determine completeness
  const complete = partials.length === 0;

  return {
    artefact,
    complete,
    partial_evidence: partials,
    warnings,
  };
}
