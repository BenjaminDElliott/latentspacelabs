/**
 * LAT-131 dispatch eligibility classifier.
 *
 * Distinguishes *risky scope* (the issue is asking the agent to do
 * something dangerous) from *risk context* (the issue mentions risky
 * topics only as guardrails or background). The original LAT-129 keyword
 * scan flagged both equally and produced false positives such as:
 *
 * - LAT-126 mentioning `architecture decision` purely as background
 *   context for an existing ADR.
 * - LAT-127 saying `do not touch secrets` as a guardrail directive.
 *
 * The classifier emits a structured `ClassifierOutput` that the
 * dispatcher consumes after schema validation. The MVP is fully
 * deterministic — pattern-based, context-aware — so it runs in CI
 * without any LLM/API dependency. The shape is designed so a future
 * LLM-backed implementation can drop in behind the same schema.
 *
 * Hard safety gates are unchanged: anything that names actually-risky
 * scope (rotate/revoke creds, deploy/release, auto-merge, primary-work
 * ADR, vague spike) still blocks dispatch.
 */

import type { DispatchIssue } from "./types.js";

/** Coarse risk class assigned by the classifier. */
export type RiskClass = "low" | "medium" | "high";

/** Coarse work-type bucket. Used for downstream routing decisions. */
export type WorkType =
  | "code_change"
  | "docs_change"
  | "test_change"
  | "research_spike"
  | "decision"
  | "ops"
  | "unknown";

/** Hard-blocker codes the classifier emits. Stable strings for tests. */
export type HardBlockerCode =
  | "no_explicit_dispatch_target"
  | "missing_identifier"
  | "missing_uuid"
  | "empty_title"
  | "vague_planning_title"
  | "missing_acceptance_criteria"
  | "description_too_short"
  | "risky_scope_secret_rotation"
  | "risky_scope_credential_handling"
  | "risky_scope_deploy_release"
  | "risky_scope_auto_merge"
  | "risky_scope_primary_decision"
  | "risky_scope_vague_spike";

export interface HardBlocker {
  code: HardBlockerCode;
  /** Human-readable explanation, secret-safe. */
  message: string;
}

/**
 * Structured classifier output. Stable schema; the dispatcher validates
 * an unknown payload against this shape before acting.
 */
export interface ClassifierOutput {
  /** True iff the dispatcher may proceed without further human approval. */
  dispatchable: boolean;
  /** Coarse risk class. `high` always implies `dispatchable=false`. */
  risk_class: RiskClass;
  /** Coarse work bucket; `unknown` is allowed but should be rare. */
  work_type: WorkType;
  /** One-line, secret-safe rationale shown to operators / Linear. */
  reason: string;
  /**
   * True when human approval is required even though no hard blocker
   * fired (e.g. medium-risk work types that we don't yet automate).
   */
  required_human_approval: boolean;
  /** Ordered list of hard blockers; empty when dispatchable. */
  hard_blockers: ReadonlyArray<HardBlocker>;
  /**
   * Optional pack-builder overrides the classifier wants to suggest.
   * The dispatcher MAY honour these; today it just records them.
   */
  pack_overrides?: {
    /** Cap turns/iterations for this dispatch. */
    max_turns?: number;
    /** Force a specific cost class regardless of routing defaults. */
    cost_class?: "small" | "medium" | "large";
    /** Extra deny-listed paths to forbid the agent from touching. */
    extra_path_denies?: ReadonlyArray<string>;
  };
}

export interface ClassifierOptions {
  /**
   * When true, treat the issue as the operator-approved explicit
   * dispatch target. Without it the classifier emits the
   * `no_explicit_dispatch_target` hard blocker (current LAT-129 MVP
   * gate; label-driven polling is a documented follow-up).
   */
  explicitOverride: boolean;
}

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

/**
 * Phrases that indicate the issue is talking about a risky topic *as
 * context*, not asking the agent to do it. When a sentence matches one
 * of these, the risky-scope keyword inside it is downgraded.
 *
 * These are checked per-sentence: a single sentence saying "do not
 * touch secrets" is safe context, but a separate sentence saying "we
 * also rotate the production credential" is still risky scope.
 */
const SAFE_CONTEXT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bdo(?:es)?\s+not\s+touch\s+(?:the\s+)?(?:secret|credential|token|api\s+keys?)/i,
  /\bdon'?t\s+touch\s+(?:the\s+)?(?:secret|credential|token|api\s+keys?)/i,
  /\bno\s+(?:secret|credential|token|api\s+keys?)\b/i,
  /\bnever\s+(?:touch|expose|log|leak)\s+(?:the\s+)?(?:secret|credential|token|api\s+keys?)/i,
  /\bwithout\s+(?:exposing|leaking|logging|touching)\s+(?:the\s+)?(?:secret|credential|token|api\s+keys?)/i,
  /\bmust\s+not\s+(?:touch|expose|log|leak|rotate)\s+(?:the\s+)?(?:secret|credential|token|api\s+keys?)/i,
  /\bshould\s+not\s+(?:touch|expose|log|leak|rotate)\s+(?:the\s+)?(?:secret|credential|token|api\s+keys?)/i,
  /\bavoid\s+(?:touching|exposing|leaking|logging|rotating)\s+(?:the\s+)?(?:secret|credential|token|api\s+keys?)/i,
  // Existing ADR / decision references — context, not the work.
  /\bsee\s+(?:adr|architecture decision)\b/i,
  /\bper\s+(?:adr|architecture decision)\b/i,
  /\bbased\s+on\s+(?:adr|architecture decision)\b/i,
  /\bexisting\s+architecture\s+decision\b/i,
  /\barchitecture\s+decision\s+\(adr-\d+\)/i,
  /\badr-\d+\b/i,
];

/** Risky-scope detectors: each emits a hard blocker when matched in non-safe-context. */
interface ScopeDetector {
  code: HardBlockerCode;
  /** Pattern that, if matched in a non-safe-context sentence, triggers the block. */
  pattern: RegExp;
  message: string;
}

/**
 * Optional adjective stack between a verb and the noun. Allows phrasing
 * like "rotate the production credential", "revoke our prod api keys",
 * "introduce new leaked credentials".
 */
const SECRET_NOUN = "(?:secrets?|credentials?|tokens?|api\\s+keys?|passwords?)";
const ADJ_STACK =
  "(?:(?:the|our|new|leaked|production|prod|stale|old|expired)\\s+){0,3}";

const SECRET_ROTATION: ScopeDetector = {
  code: "risky_scope_secret_rotation",
  pattern: new RegExp(
    `\\b(?:rotate|revoke|reset|regenerate|reissue|replace|cycle)\\s+${ADJ_STACK}${SECRET_NOUN}`,
    "i",
  ),
  message: "issue scope includes rotating or changing secrets/credentials/tokens",
};

const CREDENTIAL_HANDLING: ScopeDetector = {
  code: "risky_scope_credential_handling",
  pattern: new RegExp(
    `\\b(?:handle|store|persist|write|introduce|add|copy|move|migrate)\\s+${ADJ_STACK}${SECRET_NOUN}`,
    "i",
  ),
  message: "issue scope includes handling production credentials",
};

const DEPLOY_RELEASE: ScopeDetector = {
  code: "risky_scope_deploy_release",
  pattern:
    /\b(?:deploy(?:ing)?|release(?:ing)?|publish(?:ing)?|ship(?:ping)?|roll\s*out|cut\s+a\s+release)\b/i,
  message: "issue scope includes deploy/release/publish actions",
};

const AUTO_MERGE: ScopeDetector = {
  code: "risky_scope_auto_merge",
  pattern:
    /\b(?:auto[-\s]?merge|automerge|merge\s+(?:the\s+)?(?:pr|pull\s+request|to\s+main|to\s+master|into\s+main|into\s+master)|merging\s+prs?)\b/i,
  message: "issue scope includes merging PRs or auto-merge",
};

const PRIMARY_DECISION: ScopeDetector = {
  code: "risky_scope_primary_decision",
  // Matches "write/draft/author/decide/make a (new) ADR / architecture decision"
  // but NOT "see ADR-0001" or "per architecture decision" (handled by safe context).
  pattern:
    /\b(?:write|draft|author|propose|decide|make|create|new)\s+(?:an?\s+|the\s+)?(?:new\s+)?(?:adr|architecture\s+decision)\b/i,
  message:
    "issue primary work is making a new ADR / architecture decision; that decision must be human-owned",
};

const RISKY_DETECTORS: ReadonlyArray<ScopeDetector> = [
  SECRET_ROTATION,
  CREDENTIAL_HANDLING,
  DEPLOY_RELEASE,
  AUTO_MERGE,
  PRIMARY_DECISION,
];

/** Cheap sentence splitter; deliberately not Unicode-aware. */
function splitSentences(text: string): string[] {
  if (text.trim().length === 0) return [];
  // Split on sentence terminators *and* on newlines so list items are
  // treated as their own sentence. Markdown list bullets count too.
  const parts = text
    .split(/(?<=[.!?])\s+|\n+|(?:^|\s)[-*]\s+/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts;
}

function sentenceIsSafeContext(sentence: string): boolean {
  return SAFE_CONTEXT_PATTERNS.some((p) => p.test(sentence));
}

function inferWorkType(title: string, description: string): WorkType {
  const t = (title + "\n" + description).toLowerCase();
  if (/\b(spike|investigate|explore|research)\b/.test(t)) return "research_spike";
  if (/\bdeploy|release|rollout|publish\b/.test(t)) return "ops";
  if (/\bauto[-\s]?merge|merge\s+the\s+pr\b/.test(t)) return "ops";
  if (/\bdocs?|readme|adr-\d+|architecture decision\b/.test(t) && !/\b(implement|fix|refactor|add)\b/.test(t)) {
    return "docs_change";
  }
  if (/\b(test|spec|coverage)\b/.test(t) && !/\b(implement|fix|add)\b/.test(t)) {
    return "test_change";
  }
  if (/\b(implement|fix|refactor|add|wire|extract|extend|update)\b/.test(t)) {
    return "code_change";
  }
  return "unknown";
}

/**
 * Classify a Linear issue for dispatch eligibility.
 *
 * Pure function. Deterministic. No I/O.
 */
export function classifyIssue(
  issue: DispatchIssue,
  opts: ClassifierOptions,
): ClassifierOutput {
  const blockers: HardBlocker[] = [];

  if (!opts.explicitOverride) {
    blockers.push({
      code: "no_explicit_dispatch_target",
      message:
        "no explicit dispatch target. Set LAT_DISPATCH_ISSUE=LAT-NN to opt in (label-driven polling is a documented follow-up).",
    });
    return refused(blockers, "unknown", "low");
  }

  if (typeof issue.identifier !== "string" || issue.identifier.length === 0) {
    blockers.push({ code: "missing_identifier", message: "issue has no identifier" });
  }
  if (typeof issue.uuid !== "string" || issue.uuid.length === 0) {
    blockers.push({ code: "missing_uuid", message: "issue has no internal UUID" });
  }

  const title = issue.title ?? "";
  const description = issue.description ?? "";

  if (title.trim().length === 0) {
    blockers.push({ code: "empty_title", message: "issue title is empty" });
  }

  for (const pat of VAGUE_TITLE_PATTERNS) {
    if (pat.test(title)) {
      blockers.push({
        code: "vague_planning_title",
        message: `title looks like a vague planning task: ${title.slice(0, 80)}`,
      });
      break;
    }
  }

  // Risky-scope detection runs per sentence, with safe-context phrasings
  // downgrading risky keywords inside the same sentence.
  const sentences = splitSentences(title + "\n" + description);
  for (const detector of RISKY_DETECTORS) {
    let matched = false;
    for (const sentence of sentences) {
      if (!detector.pattern.test(sentence)) continue;
      if (sentenceIsSafeContext(sentence)) continue;
      matched = true;
      break;
    }
    if (matched) {
      blockers.push({ code: detector.code, message: detector.message });
    }
  }

  // Acceptance + size checks only when nothing structural already blocks.
  // We still report them; vague-spike means missing AC for a vague title.
  const hasAcceptance = ACCEPTANCE_HEADINGS.some((p) => p.test(description));
  const titleLooksVague = VAGUE_TITLE_PATTERNS.some((p) => p.test(title));
  if (!hasAcceptance) {
    if (titleLooksVague) {
      blockers.push({
        code: "risky_scope_vague_spike",
        message:
          "vague investigate/spike with no Acceptance Criteria: refuse rather than guess scope",
      });
    } else {
      blockers.push({
        code: "missing_acceptance_criteria",
        message:
          "issue description has no Acceptance Criteria section; refuse rather than guess scope",
      });
    }
  }

  if (description.trim().length < 80) {
    blockers.push({
      code: "description_too_short",
      message: "issue description is too short to bound dispatch scope safely",
    });
  }

  const workType = inferWorkType(title, description);

  if (blockers.length > 0) {
    const risk: RiskClass = riskFromBlockers(blockers);
    return refused(blockers, workType, risk);
  }

  return {
    dispatchable: true,
    risk_class: "low",
    work_type: workType,
    reason: `explicit override accepted for ${issue.identifier}`,
    required_human_approval: false,
    hard_blockers: [],
  };
}

function riskFromBlockers(blockers: ReadonlyArray<HardBlocker>): RiskClass {
  for (const b of blockers) {
    if (b.code.startsWith("risky_scope_")) return "high";
  }
  return "medium";
}

function refused(
  blockers: ReadonlyArray<HardBlocker>,
  workType: WorkType,
  risk: RiskClass,
): ClassifierOutput {
  const reason =
    blockers.length === 0
      ? "refused"
      : (blockers[0]?.message ?? "refused");
  return {
    dispatchable: false,
    risk_class: risk,
    work_type: workType,
    reason,
    required_human_approval: true,
    hard_blockers: blockers,
  };
}

/**
 * Validate an unknown payload against the classifier schema.
 *
 * Returned tagged result keeps the call-site terse: dispatcher only
 * acts on `ok: true`. Validation is structural: required fields,
 * correct primitive types, allowed enum members. Unknown fields are
 * tolerated (forward-compat) but the known fields must match exactly.
 */
export function validateClassifierOutput(
  raw: unknown,
): { ok: true; value: ClassifierOutput } | { ok: false; errors: ReadonlyArray<string> } {
  const errors: string[] = [];
  if (raw === null || typeof raw !== "object") {
    return { ok: false, errors: ["classifier output is not an object"] };
  }
  const o = raw as Record<string, unknown>;

  if (typeof o["dispatchable"] !== "boolean") errors.push("dispatchable: not a boolean");
  if (!isRiskClass(o["risk_class"])) errors.push("risk_class: not a valid RiskClass");
  if (!isWorkType(o["work_type"])) errors.push("work_type: not a valid WorkType");
  if (typeof o["reason"] !== "string" || (o["reason"] as string).length === 0) {
    errors.push("reason: must be a non-empty string");
  }
  if (typeof o["required_human_approval"] !== "boolean") {
    errors.push("required_human_approval: not a boolean");
  }
  const blockersRaw = o["hard_blockers"];
  if (!Array.isArray(blockersRaw)) {
    errors.push("hard_blockers: not an array");
  } else {
    blockersRaw.forEach((b, i) => {
      if (b === null || typeof b !== "object") {
        errors.push(`hard_blockers[${i}]: not an object`);
        return;
      }
      const br = b as Record<string, unknown>;
      if (!isHardBlockerCode(br["code"])) errors.push(`hard_blockers[${i}].code: invalid code`);
      if (typeof br["message"] !== "string") errors.push(`hard_blockers[${i}].message: not a string`);
    });
  }

  // Cross-field invariant: dispatchable=true must have no hard blockers.
  if (o["dispatchable"] === true && Array.isArray(blockersRaw) && blockersRaw.length > 0) {
    errors.push("dispatchable=true but hard_blockers is non-empty");
  }
  // Cross-field invariant: high risk must not be dispatchable.
  if (o["risk_class"] === "high" && o["dispatchable"] === true) {
    errors.push("risk_class=high is incompatible with dispatchable=true");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: raw as ClassifierOutput };
}

function isRiskClass(v: unknown): v is RiskClass {
  return v === "low" || v === "medium" || v === "high";
}

function isWorkType(v: unknown): v is WorkType {
  return (
    v === "code_change" ||
    v === "docs_change" ||
    v === "test_change" ||
    v === "research_spike" ||
    v === "decision" ||
    v === "ops" ||
    v === "unknown"
  );
}

function isHardBlockerCode(v: unknown): v is HardBlockerCode {
  return (
    v === "no_explicit_dispatch_target" ||
    v === "missing_identifier" ||
    v === "missing_uuid" ||
    v === "empty_title" ||
    v === "vague_planning_title" ||
    v === "missing_acceptance_criteria" ||
    v === "description_too_short" ||
    v === "risky_scope_secret_rotation" ||
    v === "risky_scope_credential_handling" ||
    v === "risky_scope_deploy_release" ||
    v === "risky_scope_auto_merge" ||
    v === "risky_scope_primary_decision" ||
    v === "risky_scope_vague_spike"
  );
}
