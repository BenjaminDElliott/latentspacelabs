/**
 * Output-quality gate (LAT-136).
 *
 * Runs on the final diff / evidence from a completed agent run and produces
 * a structured verdict. The gate catches three failure modes:
 *
 * 1. **README-only / doc-only changes** when the ticket's acceptance criteria
 *    imply broader cleanup (e.g. "update docs and code", "cross-doc dedup").
 * 2. **Missing implementation plan** — the agent skipped the plan step.
 * 3. **Missing AC-to-change mapping** — the agent produced changes but did not
 *    map them back to acceptance criteria.
 *
 * The gate is a pure function over a structured input envelope. It produces a
 * `QualityGateVerdict` that the dispatcher reads to decide whether to promote,
 * refuse, or request a re-dispatch.
 */

import type { QualityGateVerdict } from "../dispatcher/types.js";

/** Input the quality gate reads. Pure, no I/O. */
export interface QualityGateInput {
  /** Linear issue identifier for tracing. */
  ticketId: string;
  /** Acceptance criteria from the ticket pack. */
  acceptanceCriteria: ReadonlyArray<string>;
  /** Files changed by the agent, relative paths. */
  changedFiles: ReadonlyArray<string>;
  /** Whether the agent produced an implementation plan file. */
  hasImplementationPlan: boolean;
  /** Whether the AC-to-change mapping was produced. */
  hasAcToChangeMapping: boolean;
  /**
   * Whether the ticket pack requested cross-doc or cross-file changes.
   * Derived from the pack or ticket description.
   */
  asksForCrossDocChanges: boolean;
  /**
   * Whether the ticket pack requested cross-file changes (code + docs).
   */
  asksForCrossFileChanges: boolean;
  /**
   * The final state the control loop reported. Gate only runs on
   * `ready_for_review` outcomes.
   */
  reportedState: string;
  /**
   * Optional: specific files the ticket pack identified as target files.
   * If provided and empty, the gate is more strict about non-churn.
   */
  declaredTargetFiles?: ReadonlyArray<string>;
}

/**
 * Acceptance-criterion-to-change mapping entry for the evidence.
 */
export interface AcChangeMappingEntry {
  acIndex: number;
  acText: string;
  changedFiles: string[];
  satisfied: boolean;
}

/**
 * Run the output-quality gate over a completed run's evidence.
 *
 * Returns a `QualityGateVerdict` that is either:
 * - `passed: true` — the gate is satisfied, `ready_for_review` stands.
 * - `passed: false` — the gate caught a quality issue. The `code` field
 *   maps to a dispatcher outcome (`insufficient_change` or `needs_better_pack`).
 */
export function runQualityGate(input: QualityGateInput): QualityGateVerdict {
  // 1) Guard: gate only runs on ready_for_review (or planned).
  if (input.reportedState !== "ready_for_review" && input.reportedState !== "planned") {
    return {
      passed: true,
      code: "skipped",
      message: `Gate skipped: reported state is "${input.reportedState}", not ready_for_review.`,
    };
  }

  const findings: string[] = [];

  // 2) Check implementation plan.
  if (!input.hasImplementationPlan) {
    findings.push("implementation_plan_missing");
  }

  // 3) Check AC-to-change mapping.
  if (!input.hasAcToChangeMapping) {
    findings.push("ac_mapping_missing");
  }

  // 4) README-only / doc-only gate.
  if (
    input.asksForCrossDocChanges ||
    input.asksForCrossFileChanges
  ) {
    const nonReadmeFiles = input.changedFiles.filter(
      (f) => !isReadmeOrDocOnly(f),
    );
    if (nonReadmeFiles.length === 0) {
      findings.push("trivial_readme_only");
    }
  }

  // 5) Cross-doc dedup gate: if the ticket asks for cross-doc dedup,
  //    at least two distinct non-README files must be changed.
  if (input.asksForCrossDocChanges && !input.asksForCrossFileChanges) {
    const nonReadmeFiles = input.changedFiles.filter(
      (f) => !isReadmeOrDocOnly(f),
    );
    if (nonReadmeFiles.length < 2) {
      findings.push("cross_doc_dedup_trivial");
    }
  }

  // 6) If declared target files were provided and none were touched,
  //    flag it as a non-churn violation.
  if (
    input.declaredTargetFiles &&
    input.declaredTargetFiles.length > 0
  ) {
    const touchedTarget = input.declaredTargetFiles.some((target) =>
      input.changedFiles.some((changed) =>
        pathIncludes(changed, target),
      ),
    );
    if (!touchedTarget) {
      findings.push("no_declared_target_files_touched");
    }
  }

  // 7) Check that every acceptance criterion has at least one file mapped.
  //    This is checked by the caller populating the mapping; here we just
  //    verify the input is non-empty when there are criteria.
  if (
    input.acceptanceCriteria.length > 0 &&
    input.hasAcToChangeMapping &&
    input.changedFiles.length === 0
  ) {
    findings.push("empty_diff_with_criteria");
  }

  if (findings.length === 0) {
    return {
      passed: true,
      code: "pass",
      message: "All quality gates passed.",
    };
  }

  // 8) Determine the outcome code from the worst finding.
  const outcome = determineOutcome(findings);
  const message = [
    `Quality gate failed for ${input.ticketId}:`,
    ...findings.map((f) => `  - ${findingLabel(f)}`),
    "",
    "Action: " + actionForOutcome(outcome.code),
  ].join("\n");

  return {
    passed: false,
    code: outcome.code,
    message,
  };
}

/**
 * Build the AC-to-change mapping from the input.
 * Called by the adapter or dispatcher after the run.
 */
export function buildAcChangeMapping(
  acceptanceCriteria: ReadonlyArray<string>,
  changedFiles: ReadonlyArray<string>,
): AcChangeMappingEntry[] {
  return acceptanceCriteria.map((ac, index) => ({
    acIndex: index,
    acText: ac.length > 120 ? ac.slice(0, 120) + "…" : ac,
    changedFiles: changedFiles.length > 0 ? [...changedFiles] : [],
    satisfied: changedFiles.length > 0,
  }));
}

/**
 * Check whether a file path is README-only or doc-only.
 * Matches README files and files under docs/ (excluding docs/decisions/ and docs/prds/).
 */
function isReadmeOrDocOnly(path: string): boolean {
  const lower = path.toLowerCase();
  if (/^readme\./i.test(lower) || lower.endsWith("/readme.")) {
    return true;
  }
  if (/^docs\//.test(lower)) {
    // Exclude decisions/ and prds/ since those are forbidden
    if (/^docs\/(decisions|prds)\//.test(lower)) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Check if a path includes a target substring (for target file matching).
 */
function pathIncludes(path: string, target: string): boolean {
  return path.toLowerCase().includes(target.toLowerCase());
}

/**
 * Determine the dispatcher outcome from a list of finding codes.
 */
function determineOutcome(findings: string[]): { code: string } {
  // The worst finding determines the outcome.
  const hasTrivial = findings.some(
    (f) => f === "trivial_readme_only" || f === "cross_doc_dedup_trivial",
  );
  const hasInsufficient = findings.some(
    (f) =>
      f === "no_declared_target_files_touched" ||
      f === "empty_diff_with_criteria",
  );
  const hasPack = findings.some(
    (f) => f === "implementation_plan_missing" || f === "ac_mapping_missing",
  );

  if (hasTrivial) {
    return { code: "insufficient_change" };
  }
  if (hasInsufficient) {
    return { code: "insufficient_change" };
  }
  if (hasPack) {
    return { code: "needs_better_pack" };
  }
  return { code: "insufficient_change" };
}

/**
 * Human-readable label for a finding code.
 */
function findingLabel(code: string): string {
  const labels: Record<string, string> = {
    implementation_plan_missing: "Implementation plan was not produced.",
    ac_mapping_missing: "AC-to-change mapping was not produced.",
    trivial_readme_only:
      "Only README/doc files changed, but ticket asks for broader changes.",
    cross_doc_dedup_trivial:
      "Cross-doc dedup required ≥2 non-README files; fewer found.",
    no_declared_target_files_touched:
      "None of the declared target files were modified.",
    empty_diff_with_criteria:
      "Acceptance criteria exist but no files were changed.",
  };
  return labels[code] ?? `Unknown finding: ${code}`;
}

/**
 * Action suggestion for a given outcome code.
 */
function actionForOutcome(code: string): string {
  switch (code) {
    case "insufficient_change":
      return "The agent's output is too shallow. Re-dispatch with a tighter pack or ask the agent to expand the scope.";
    case "needs_better_pack":
      return "The ticket pack lacked concrete scope. Update the pack with target files and non-churn expectations, then re-dispatch.";
    default:
      return "Review findings and decide whether to refine the pack or re-dispatch.";
  }
}
