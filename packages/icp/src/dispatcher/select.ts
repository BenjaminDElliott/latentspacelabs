/**
 * Eligibility check for one Linear issue.
 *
 * The original LAT-129 keyword scan flagged a few false positives
 * because it could not tell *risky scope* (e.g. "rotate the production
 * secret") from *risk context* (e.g. "do not touch secrets" or "see
 * existing architecture decision ADR-0012"). LAT-131 replaces the scan
 * with a structured classifier (see `classifier.ts`). The classifier
 * emits a validated `ClassifierOutput`; the dispatcher then asks this
 * thin wrapper for a yes/no plus a sanitised reason.
 *
 * The wrapper still exists so callers that only care about
 * dispatchability (e.g. the dispatcher orchestration) do not have to
 * destructure the full classifier output.
 */

import {
  classifyIssue,
  validateClassifierOutput,
  type ClassifierOptions,
  type ClassifierOutput,
} from './classifier.js';
import type { DispatchIssue, EligibilityOutcome } from './types.js';

export type EligibilityOptions = ClassifierOptions;

export function evaluateEligibility(
  issue: DispatchIssue,
  opts: EligibilityOptions,
): EligibilityOutcome {
  const raw = classifyIssue(issue, opts);
  const validated = validateClassifierOutput(raw);
  if (!validated.ok) {
    // Defensive: if the classifier ever returns a non-conforming shape,
    // refuse rather than dispatch. Surfaces the schema error to the
    // operator so the bug is visible.
    return {
      eligible: false,
      reason: `classifier output failed schema validation: ${validated.errors.join('; ')}`,
    };
  }
  return classifierToEligibility(validated.value);
}

/**
 * Project a full ClassifierOutput onto the legacy yes/no shape used by
 * the dispatcher orchestration. Exported so callers (and tests) that
 * already have a ClassifierOutput can avoid re-running the classifier.
 */
export function classifierToEligibility(output: ClassifierOutput): EligibilityOutcome {
  if (output.dispatchable) {
    return { eligible: true, reason: output.reason };
  }
  return { eligible: false, reason: output.reason };
}
