/**
 * Eligibility check for one Linear issue under the LAT-129 MVP rules.
 *
 * The MVP is conservative: only obviously-safe coding work is eligible,
 * and an explicit per-invocation override (`LAT_DISPATCH_ISSUE`) is the
 * only way to actually dispatch in this slice. Label-driven polling is
 * the documented next step (see README) — exposing the same eligibility
 * shape now keeps the next iteration small.
 *
 * Risky work is excluded by keyword scan over title + description. The
 * scan is intentionally crude; the goal is "fail safe and surface the
 * reason" rather than "perfect classification."
 */

import type { DispatchIssue, EligibilityOutcome } from "./types.js";

const RISK_KEYWORDS: ReadonlyArray<string> = [
  "deploy",
  "deployment",
  "production",
  "merge to main",
  "auto-merge",
  "autoMerge",
  "secret",
  "credential",
  "token rotation",
  "rotate token",
  "rotate key",
  "architecture decision",
  "broad refactor",
  "rewrite",
];

const VAGUE_TITLE_PATTERNS: ReadonlyArray<RegExp> = [
  /^investigate\b/i,
  /^explore\b/i,
  /^think about\b/i,
  /^discuss\b/i,
  /^plan\b/i,
];

const ACCEPTANCE_HEADINGS: ReadonlyArray<RegExp> = [
  /^#{1,6}\s+acceptance criteria\b/im,
  /^#{1,6}\s+acceptance\b/im,
  /^acceptance criteria\s*[:\-]/im,
];

export interface EligibilityOptions {
  /**
   * When true, treat the issue as the operator-approved explicit
   * dispatch target. The eligibility scan still runs (so risky work is
   * still refused), but the absence of an explicit-readiness label or
   * status no longer disqualifies the issue.
   */
  explicitOverride: boolean;
}

export function evaluateEligibility(
  issue: DispatchIssue,
  opts: EligibilityOptions,
): EligibilityOutcome {
  if (!opts.explicitOverride) {
    return {
      eligible: false,
      reason:
        "no explicit dispatch target. Set LAT_DISPATCH_ISSUE=LAT-NN to opt in (label-driven polling is a documented follow-up).",
    };
  }

  if (typeof issue.identifier !== "string" || issue.identifier.length === 0) {
    return { eligible: false, reason: "issue has no identifier" };
  }
  if (typeof issue.uuid !== "string" || issue.uuid.length === 0) {
    return { eligible: false, reason: "issue has no internal UUID" };
  }

  const title = issue.title ?? "";
  const description = issue.description ?? "";

  if (title.trim().length === 0) {
    return { eligible: false, reason: "issue title is empty" };
  }

  for (const pat of VAGUE_TITLE_PATTERNS) {
    if (pat.test(title)) {
      return {
        eligible: false,
        reason: `title looks like a vague planning task: ${title.slice(0, 80)}`,
      };
    }
  }

  const haystack = (title + "\n" + description).toLowerCase();
  for (const kw of RISK_KEYWORDS) {
    if (haystack.includes(kw.toLowerCase())) {
      return {
        eligible: false,
        reason: `description references risky scope keyword: "${kw}"`,
      };
    }
  }

  if (!ACCEPTANCE_HEADINGS.some((p) => p.test(description))) {
    return {
      eligible: false,
      reason:
        "issue description has no Acceptance Criteria section; refuse rather than guess scope",
    };
  }

  if (description.trim().length < 80) {
    return {
      eligible: false,
      reason: "issue description is too short to bound dispatch scope safely",
    };
  }

  return {
    eligible: true,
    reason: `explicit override accepted for ${issue.identifier}`,
  };
}
