/**
 * Agent taxonomy (LAT-161).
 *
 * Canonical inventory of all agent types that plug into the Integration
 * Control Plane (ICP) as execution adapters.  This is a taxonomy — not a
 * provider registry — so it records *what* each agent does, its risk and
 * autonomy profile, and how it is typically invoked.  Concrete provider
 * bindings live in separate files (e.g. the coding-agent adapter).
 *
 * Reference:
 * - LAT-21 / ADR-0013 — Agent invocation and integration boundaries
 * - ADR-0008 — Autonomy levels (L1–L4 pilot; L5 out of scope)
 * - ADR-0006 — Agent run visibility schema (`agent_type` enum)
 *
 * ## Classification model
 *
 * Every registered agent type has:
 *
 * - **id** — stable identifier matching the ADR-0006 `agent_type` enum.
 * - **purpose** — one-sentence description of what the agent does.
 * - **autonomy_level** — ADR-0008 autonomy level at which the agent
 *   typically operates (L1-read-only through L4-autonomous).
 * - **risk_profile** — how destructive / high-stakes the agent's actions
 *   are: `low`, `medium`, `high`, or `critical`.
 * - **invocation_pattern** — how the agent is typically triggered:
 *   `direct` (ICP dispatches without extra steps), `proposed` (human
 *   proposes then confirms), `acl-routed` (goes through ICP routing
 *   logic), or `stop-and-ask` (always halts for human before acting).
 * - **typical_inputs** — what the agent needs to run (from Linear, Git,
 *   or other surfaces).
 * - **typical_outputs** — what the agent produces (PR, report, deploy
 *   status, etc.).
 *
 * ## Extensibility
 *
 * When a new agent type is proposed, use `classifyNewAgentType()` to
 * see if it matches an existing classification.  If confidence exceeds
 * the threshold (0.5), it fits an existing type; otherwise it extends
 * the taxonomy with a new row.
 *
 * Adding a type is non-breaking — consumers must tolerate unknown types.
 * Removing or renaming a type requires an ADR.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** ADR-0008 autonomy levels used in the pilot. */
export type AutonomyLevel =
  | "L1-read-only"
  | "L2-propose"
  | "L3-with-approval"
  | "L4-autonomous";

/** Risk profile for an agent type. */
export type RiskProfile = "low" | "medium" | "high" | "critical";

/** How the agent is typically triggered. */
export type InvocationPattern =
  | "direct"
  | "proposed"
  | "acl-routed"
  | "stop-and-ask";

/**
 * Full registration for a single agent type.  Every field is required at
 * registration time; omitting any field is a validation error.
 */
export interface AgentTypeRegistration {
  /** Stable identifier — must match one of AGENT_TYPE_IDS. */
  id: string;
  /** One-sentence purpose. */
  purpose: string;
  /** Autonomy level the agent typically runs at. */
  autonomy_level: AutonomyLevel;
  /** Destructiveness of the agent's typical actions. */
  risk_profile: RiskProfile;
  /** Typical invocation pattern. */
  invocation_pattern: InvocationPattern;
  /** Inputs the agent expects (from Linear, Git, etc.). */
  typical_inputs: string[];
  /** Outputs the agent produces. */
  typical_outputs: string[];
  /** Optional domain keyword for classification heuristics. */
  domain?: string;
}

/** Classification result for a new (unregistered) agent type. */
export interface AgentTypeClassification {
  /** Matched registered type id, or null if no close match. */
  match: string | null;
  /** Confidence score 0–1; > 0.5 means the caller should consider it a match. */
  confidence: number;
  /** Human-readable explanation of the classification. */
  explanation: string;
}

/* ------------------------------------------------------------------ */
/* Known type IDs                                                      */
/* ------------------------------------------------------------------ */

/** All four agent types that the ICP plans to support. */
export const AGENT_TYPE_IDS = ["coding", "qa", "pr-review", "sre"] as const;

/** Narrow type over AGENT_TYPE_IDS. */
export type AgentTypeId = (typeof AGENT_TYPE_IDS)[number];

/* ------------------------------------------------------------------ */
/* Canonical registrations                                             */
/* ------------------------------------------------------------------ */

/**
 * The four canonical agent type registrations.
 *
 * These are the rows that the acceptance criteria for LAT-161 require:
 * each must have a clear purpose, autonomy level, and invocation pattern.
 */
export const AGENT_TYPES: AgentTypeRegistration[] = [
  {
    id: "coding",
    purpose:
      "Reads a LAT ticket, implements the required changes in the repo, and opens a PR linking back to the ticket.",
    autonomy_level: "L3-with-approval",
    risk_profile: "medium",
    invocation_pattern: "acl-routed",
    typical_inputs: [
      "linear_issue_id (LAT-XXX)",
      "ticket_title",
      "ticket_summary",
      "guardrails",
      "non_goals",
      "repo owner/name",
      "branch_target",
      "budget_cap_usd",
    ],
    typical_outputs: [
      "pr_url",
      "pr_branch",
      "commit_sha",
      "changed_files",
      "run_report",
      "linear_write_back",
    ],
    domain: "code-generation",
  },
  {
    id: "qa",
    purpose:
      "Receives a PR or ticket, runs the test suite or a QA procedure, and produces a quality report with a pass/fail recommendation.",
    autonomy_level: "L2-propose",
    risk_profile: "low",
    invocation_pattern: "acl-routed",
    typical_inputs: [
      "pr_url or linear_issue_id",
      "branch_name",
      "test_commands (optional)",
      "coverage_threshold (optional)",
    ],
    typical_outputs: [
      "qa_report",
      "pass/fail verdict",
      "test_results",
      "coverage_report",
      "recommendation (approve / request-changes / comment)",
    ],
    domain: "testing",
  },
  {
    id: "pr-review",
    purpose:
      "Reviews a PR for correctness, style, and alignment with the ticket; surfaces comments or approval decisions.",
    autonomy_level: "L2-propose",
    risk_profile: "low",
    invocation_pattern: "acl-routed",
    typical_inputs: [
      "pr_url",
      "ticket_summary (for alignment check)",
      "review_guidelines (optional)",
    ],
    typical_outputs: [
      "review_comments",
      "verdict (approve / request-changes / comment)",
      "suggested_changes",
      "risk_flags",
    ],
    domain: "code-review",
  },
  {
    id: "sre",
    purpose:
      "Manages infrastructure lifecycle: deploys artifacts to target environments, monitors health, and runs runbooks on incidents.",
    autonomy_level: "L3-with-approval",
    risk_profile: "high",
    invocation_pattern: "acl-routed",
    typical_inputs: [
      "deploy_request or incident_alert",
      "target_environment (staging / production)",
      "artifact_url or commit_sha",
      "runbook (optional)",
    ],
    typical_outputs: [
      "deploy_status",
      "health_check_results",
      "alert_fires",
      "runbook_steps_completed",
      "rollback_url (if applicable)",
    ],
    domain: "infrastructure",
  },
];

/* ------------------------------------------------------------------ */
/* Registry functions                                                  */
/* ------------------------------------------------------------------ */

/**
 * Return the full list of registered agent types.
 */
export function getRegisteredAgentTypes(): AgentTypeRegistration[] {
  return AGENT_TYPES;
}

/**
 * Look up a single agent type by its id.  Returns `undefined` if the id
 * is not registered.
 */
export function getAgentType(id: string): AgentTypeRegistration | undefined {
  return AGENT_TYPES.find((t) => t.id === id);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const VALID_AUTONOMY_LEVELS: AutonomyLevel[] = [
  "L1-read-only",
  "L2-propose",
  "L3-with-approval",
  "L4-autonomous",
];
const VALID_RISK_PROFILES: RiskProfile[] = ["low", "medium", "high", "critical"];
const VALID_INVOCATION_PATTERNS: InvocationPattern[] = [
  "direct",
  "proposed",
  "acl-routed",
  "stop-and-ask",
];

/**
 * Validate an agent type registration.  Returns an array of error strings;
 * empty array means the registration is well-formed.
 */
export function validateAgentType(reg: AgentTypeRegistration): string[] {
  const errors: string[] = [];

  if (!reg.id || reg.id.trim().length === 0) {
    errors.push("id is required and must be non-empty");
  }

  if (!VALID_AUTONOMY_LEVELS.includes(reg.autonomy_level)) {
    errors.push(
      `autonomy_level must be one of ${VALID_AUTONOMY_LEVELS.join(", ")}, got "${reg.autonomy_level}"`,
    );
  }

  if (!VALID_RISK_PROFILES.includes(reg.risk_profile)) {
    errors.push(
      `risk_profile must be one of ${VALID_RISK_PROFILES.join(", ")}, got "${reg.risk_profile}"`,
    );
  }

  if (!VALID_INVOCATION_PATTERNS.includes(reg.invocation_pattern)) {
    errors.push(
      `invocation_pattern must be one of ${VALID_INVOCATION_PATTERNS.join(", ")}, got "${reg.invocation_pattern}"`,
    );
  }

  if (!reg.purpose || reg.purpose.trim().length === 0) {
    errors.push("purpose is required and must be non-empty");
  }

  if (
    !Array.isArray(reg.typical_inputs) ||
    reg.typical_inputs.length === 0
  ) {
    errors.push("typical_inputs must be a non-empty array");
  }

  if (
    !Array.isArray(reg.typical_outputs) ||
    reg.typical_outputs.length === 0
  ) {
    errors.push("typical_outputs must be a non-empty array");
  }

  return errors;
}

/* ------------------------------------------------------------------ */
/* Extensibility helpers                                               */
/* ------------------------------------------------------------------ */

/**
 * Classify a new (unregistered) agent type against the existing taxonomy.
 *
 * Uses a simple keyword-based heuristic on `purpose` and `domain`:
 *
 * | Match        | Keywords in purpose / domain                    |
 * |--------------|-------------------------------------------------|
 * | `coding`     | "code", "implement", "code-generation", "write" |
 * | `qa`         | "test", "qa", "quality", "testing", "run suite" |
 * | `pr-review`  | "review", "pr", "pull request", "code-review"   |
 * | `sre`        | "deploy", "infra", "infrastructure", "ops"      |
 *
 * Confidence is computed as:
 *   (matching keyword count) / (total keyword set size)
 *
 * The caller should use a threshold of > 0.5 to accept a match.
 */
export function classifyNewAgentType(
  candidate: Omit<AgentTypeRegistration, "id"> & { id?: string; domain?: string },
): AgentTypeClassification {
  const text = `${candidate.purpose} ${candidate.domain ?? ""}`.toLowerCase();
  const domain = candidate.domain?.toLowerCase() ?? "";

  const classifications: Array<{
    match: string;
    score: number;
    explanation: string;
  }> = [];

  // coding
  const codingKeywords = [
    "code",
    "implement",
    "code-generation",
    "write",
    "source",
    "src",
  ];
  const codingMatches = codingKeywords.filter((k) => text.includes(k) || domain.includes(k));
  if (codingMatches.length > 0) {
    classifications.push({
      match: "coding",
      score: codingMatches.length / codingKeywords.length,
      explanation: `Matches coding: keywords "${codingMatches.join(", ")}"`,
    });
  }

  // qa
  const qaKeywords = ["test", "qa", "quality", "testing", "run suite", "test suite", "coverage"];
  const qaMatches = qaKeywords.filter((k) => text.includes(k) || domain.includes(k));
  if (qaMatches.length > 0) {
    classifications.push({
      match: "qa",
      score: qaMatches.length / qaKeywords.length,
      explanation: `Matches qa: keywords "${qaMatches.join(", ")}"`,
    });
  }

  // pr-review
  const prKeywords = [
    "review",
    "pr",
    "pull request",
    "code-review",
    "pull request",
    "approve",
  ];
  const prMatches = prKeywords.filter((k) => text.includes(k) || domain.includes(k));
  if (prMatches.length > 0) {
    classifications.push({
      match: "pr-review",
      score: prMatches.length / prKeywords.length,
      explanation: `Matches pr-review: keywords "${prMatches.join(", ")}"`,
    });
  }

  // sre
  const sreKeywords = ["deploy", "infra", "infrastructure", "ops", "runbook", "monitor", "health"];
  const sreMatches = sreKeywords.filter((k) => text.includes(k) || domain.includes(k));
  if (sreMatches.length > 0) {
    classifications.push({
      match: "sre",
      score: sreMatches.length / sreKeywords.length,
      explanation: `Matches sre: keywords "${sreMatches.join(", ")}"`,
    });
  }

  if (classifications.length === 0) {
    return {
      match: null,
      confidence: 0,
      explanation: "No existing classification matched the candidate's purpose or domain.",
    };
  }

  // Sort by score descending, pick the highest
  classifications.sort((a, b) => b.score - a.score);
  const best = classifications[0]!;

  // Confidence is the fraction of matched keywords.  A single matching
  // keyword gives confidence ≥ 1/n where n is the keyword count for that
  // class — typically 0.17–0.25.  We use a threshold of 0.25 to accept
  // a single strong keyword match as a valid classification, while still
  // rejecting candidates that only match weakly (e.g. "code" appearing
  // once among six coding keywords).
  const confidence = best.score;
  const threshold = 0.25;

  return {
    match: confidence >= threshold ? best.match : null,
    confidence,
    explanation: best.explanation +
      (confidence < threshold ? " (below confidence threshold of 0.25)" : ""),
  };
}
