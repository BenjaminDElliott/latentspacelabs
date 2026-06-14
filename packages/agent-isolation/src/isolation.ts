import { z } from "zod";

// ---------------------------------------------------------------------------
// Agent type
// ---------------------------------------------------------------------------

/**
 * Canonical agent types used across the ICP.
 * Must stay in sync with ADR-0006 / ADR-0013 agent_type enum.
 */
export const AgentTypeSchema = z.enum([
  "coding",
  "sre",
  "qa",
  "review",
  "pm",
  "research",
  "observability",
]);

export type AgentType = z.infer<typeof AgentTypeSchema>;

// ---------------------------------------------------------------------------
// Forbidden action
// ---------------------------------------------------------------------------

/**
 * All actions that can be forbidden for an agent type.
 * Maps to ADR-0008 Stop / ICP-Routed categories.
 */
export const ForbiddenActionSchema = z.enum([
  // Branch operations
  "delete_branch",
  "merge_to_protected",
  "force_push",
  // Deployment
  "deploy_to_prod",
  "deploy_to_staging",
  "rollback",
  // Shell
  "run_arbitrary_shell",
  "run_docker",
  // Notifications
  "send_external_notification",
  "post_to_slack",
  "send_email",
  // Destructive
  "delete_linear_issue",
  "revoke_credentials",
  "edit_approval_rules",
]);

export type ForbiddenAction = z.infer<typeof ForbiddenActionSchema>;

// ---------------------------------------------------------------------------
// Approval requirement
// ---------------------------------------------------------------------------

/**
 * Autonomy levels from ADR-0008 / approval-gates-and-autonomy-rules.md.
 */
export const AutonomyLevelSchema = z.enum([
  "L0",
  "L1",
  "L2-with-approval",
  "L3-with-approval",
  "L4",
]);

export const ApprovalSchema = z.object({
  action: ForbiddenActionSchema,
  level: AutonomyLevelSchema,
  approver: z.enum(["human", "human_or_thread_approved"]),
  reason: z.string().min(1),
});

export type ApprovalRequirement = z.infer<typeof ApprovalSchema>;

// ---------------------------------------------------------------------------
// Side effect scope
// ---------------------------------------------------------------------------

export const SideEffectScopeSchema = z.object({
  files: z.boolean(),
  linear: z.boolean(),
  github: z.boolean(),
  notifications: z.boolean(),
});

export type SideEffectScope = z.infer<typeof SideEffectScopeSchema>;

/**
 * Log entry for a side-effect-producing action.
 * Always produced when an agent performs a non-trivial action.
 */
export const SideEffectLogSchema = z.object({
  agentType: AgentTypeSchema,
  action: z.string(),
  outcome: z.enum(["succeeded", "failed", "skipped"]),
  timestamp: z.string(),
  details: z.record(z.unknown()),
  evidence: z.string(),
});

export type SideEffectLog = z.infer<typeof SideEffectLogSchema>;

// ---------------------------------------------------------------------------
// Isolation config per agent type
// ---------------------------------------------------------------------------

/**
 * Complete isolation configuration for a single agent type.
 * This is the policy surface consumed by the skill runner at invocation.
 */
export const IsolationConfigSchema = z.object({
  type: AgentTypeSchema,
  secrets: z.array(z.string()),
  fsScope: z.array(z.string()),
  networkScope: z.array(z.string()),
  forbiddenActions: z.array(
    z.object({
      action: ForbiddenActionSchema,
      reason: z.string(),
    }),
  ),
  approvalRequirements: z.array(ApprovalSchema),
  sideEffectScope: SideEffectScopeSchema,
});

export type IsolationConfig = z.infer<typeof IsolationConfigSchema>;

// ---------------------------------------------------------------------------
// Per-agent-type definitions
// ---------------------------------------------------------------------------

/**
 * Coding agent — reads/writes code, opens PRs, comments on Linear.
 *
 * Rules:
 * - Cannot delete branches (branch deletion is human-only).
 * - Cannot merge to protected branches (PR review required).
 * - Cannot deploy to prod (SRE-only).
 * - Cannot send external notifications without approval.
 * - Can run arbitrary shell within the worktree (lint, build, test).
 */
const CODING_CONFIG: IsolationConfig = {
  type: "coding",
  secrets: [
    "LINEAR_API_KEY",
    "GITHUB_TOKEN",
    "AGENT_RUNNER_TOKEN",
  ],
  fsScope: [
    "packages/",
    "docs/",
    "scripts/",
    ".github/workflows/",
    ".gitignore",
    "package.json",
    "package-lock.json",
  ],
  networkScope: [
    "github.com",
    "api.github.com",
    "api.linear.app",
    "registry.npmjs.org",
  ],
  forbiddenActions: [
    { action: "delete_branch", reason: "Branch deletion requires human approval (per branch-protection-policy.md)" },
    { action: "merge_to_protected", reason: "Coding agents open PRs; merge is human or Perplexity action (LAT-47)" },
    { action: "force_push", reason: "Force push on shared branches is Stop (approval-gates-and-autonomy-rules.md)" },
    { action: "deploy_to_prod", reason: "Production deploy is SRE responsibility" },
    { action: "send_external_notification", reason: "External comms are Stop per ADR-0008" },
    { action: "delete_linear_issue", reason: "Deleting issues is a Stop action" },
    { action: "revoke_credentials", reason: "Credential revocation is Stop per ADR-0008" },
    { action: "edit_approval_rules", reason: "Approval rule edits are Stop" },
  ],
  approvalRequirements: [
    {
      action: "delete_branch",
      level: "L2-with-approval",
      approver: "human",
      reason: "Deleting a branch removes its work from the history",
    },
    {
      action: "merge_to_protected",
      level: "L3-with-approval",
      approver: "human_or_thread_approved",
      reason: "Merging to protected branch requires review (LAT-47)",
    },
    {
      action: "force_push",
      level: "L2-with-approval",
      approver: "human",
      reason: "Force push overwrites shared history",
    },
    {
      action: "send_external_notification",
      level: "L3-with-approval",
      approver: "human",
      reason: "External communication is Stop per ADR-0008",
    },
  ],
  sideEffectScope: {
    files: true,
    linear: true,
    github: true,
    notifications: false,
  },
};

/**
 * SRE agent — monitors, deploys, runs runbooks, manages infrastructure.
 *
 * Rules:
 * - Can deploy to prod (but requires approval during pilot).
 * - Cannot run arbitrary shell commands without approval (risk of unintended side effects).
 * - Has access to cloud credentials.
 * - Can send notifications (Slack page, email alert).
 */
const SRE_CONFIG: IsolationConfig = {
  type: "sre",
  secrets: [
    "LINEAR_API_KEY",
    "GITHUB_TOKEN",
    "AGENT_RUNNER_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "DOCKER_REGISTRY_TOKEN",
  ],
  fsScope: [
    "packages/",
    "docs/",
    "logs/",
    "config/",
    ".github/workflows/",
  ],
  networkScope: [
    "api.linear.app",
    "github.com",
    "api.github.com",
    "monitoring.",
    "*.amazonaws.com",
    "registry.docker.io",
  ],
  forbiddenActions: [
    { action: "delete_branch", reason: "Branch deletion is human-only" },
    { action: "merge_to_protected", reason: "SRE agents can trigger merges but not to protected branches directly" },
    { action: "force_push", reason: "Force push on shared branches is Stop" },
    { action: "deploy_to_prod", reason: "Production deploy requires approval during pilot (ADR-0013)" },
    { action: "send_external_notification", reason: "External comms are Stop per ADR-0008" },
    { action: "delete_linear_issue", reason: "Deleting issues is a Stop action" },
    { action: "run_arbitrary_shell", reason: "SRE agents run runbooks; arbitrary shell requires approval to avoid side effects" },
    { action: "send_email", reason: "Email notifications require approval (external comms Stop per ADR-0008)" },
    { action: "revoke_credentials", reason: "Credential revocation is Stop" },
    { action: "edit_approval_rules", reason: "Approval rule edits are Stop" },
  ],
  approvalRequirements: [
    {
      action: "deploy_to_prod",
      level: "L3-with-approval",
      approver: "human",
      reason: "Production deploy requires human approval during pilot (ADR-0013)",
    },
    {
      action: "deploy_to_staging",
      level: "L2-with-approval",
      approver: "human_or_thread_approved",
      reason: "Staging deploy requires approval to catch regressions",
    },
    {
      action: "run_arbitrary_shell",
      level: "L2-with-approval",
      approver: "human",
      reason: "Arbitrary shell commands may have unintended side effects",
    },
    {
      action: "send_external_notification",
      level: "L3-with-approval",
      approver: "human",
      reason: "External comms are Stop per ADR-0008",
    },
  ],
  sideEffectScope: {
    files: true,
    linear: true,
    github: false,
    notifications: true,
  },
};

/**
 * QA agent — runs tests, produces reports, validates acceptance criteria.
 *
 * Rules:
 * - Read-only on most surfaces.
 * - Can post to Linear (test reports).
 * - Cannot deploy or modify code.
 */
const QA_CONFIG: IsolationConfig = {
  type: "qa",
  secrets: [
    "LINEAR_API_KEY",
    "GITHUB_TOKEN",
    "AGENT_RUNNER_TOKEN",
  ],
  fsScope: [
    "packages/",
    "docs/",
    "tests/",
  ],
  networkScope: [
    "api.linear.app",
    "github.com",
    "api.github.com",
    "registry.npmjs.org",
  ],
  forbiddenActions: [
    { action: "delete_branch", reason: "QA agents are read-only on branches" },
    { action: "merge_to_protected", reason: "QA agents do not merge" },
    { action: "deploy_to_prod", reason: "QA agents do not deploy" },
    { action: "deploy_to_staging", reason: "QA agents do not deploy" },
    { action: "send_external_notification", reason: "External comms are Stop per ADR-0008" },
    { action: "delete_linear_issue", reason: "Deleting issues is a Stop action" },
    { action: "revoke_credentials", reason: "Credential revocation is Stop" },
    { action: "edit_approval_rules", reason: "Approval rule edits are Stop" },
  ],
  approvalRequirements: [
    {
      action: "deploy_to_staging",
      level: "L2-with-approval",
      approver: "human_or_thread_approved",
      reason: "QA-triggered staging deploy needs approval",
    },
    {
      action: "send_external_notification",
      level: "L3-with-approval",
      approver: "human",
      reason: "External comms are Stop per ADR-0008",
    },
  ],
  sideEffectScope: {
    files: true,
    linear: true,
    github: false,
    notifications: false,
  },
};

/**
 * PR review agent — reviews PRs, comments, suggests changes.
 *
 * Rules:
 * - Read-only on code.
 * - Can post comments on GitHub PRs.
 * - Can write to Linear (review reports).
 */
const REVIEW_CONFIG: IsolationConfig = {
  type: "review",
  secrets: [
    "LINEAR_API_KEY",
    "GITHUB_TOKEN",
    "AGENT_RUNNER_TOKEN",
  ],
  fsScope: [
    "packages/",
    "docs/",
  ],
  networkScope: [
    "api.linear.app",
    "github.com",
    "api.github.com",
  ],
  forbiddenActions: [
    { action: "delete_branch", reason: "Review agents are read-only" },
    { action: "merge_to_protected", reason: "Review agents never approve merges (approval-gates-and-autonomy-rules.md)" },
    { action: "deploy_to_prod", reason: "Review agents do not deploy" },
    { action: "send_external_notification", reason: "External comms are Stop per ADR-0008" },
    { action: "delete_linear_issue", reason: "Deleting issues is a Stop action" },
    { action: "revoke_credentials", reason: "Credential revocation is Stop" },
    { action: "edit_approval_rules", reason: "Approval rule edits are Stop" },
  ],
  approvalRequirements: [
    {
      action: "send_external_notification",
      level: "L3-with-approval",
      approver: "human",
      reason: "External comms are Stop per ADR-0008",
    },
  ],
  sideEffectScope: {
    files: false,
    linear: true,
    github: true,
    notifications: false,
  },
};

/**
 * PM / research agent — analysis, drafting, documentation.
 *
 * Rules:
 * - Read-mostly, drafts content.
 * - Can post to Linear and docs/.
 */
const PM_CONFIG: IsolationConfig = {
  type: "pm",
  secrets: [
    "LINEAR_API_KEY",
    "AGENT_RUNNER_TOKEN",
  ],
  fsScope: [
    "docs/",
    "docs/decisions/",
    "docs/prds/",
    "docs/process/",
    "docs/templates/",
  ],
  networkScope: [
    "api.linear.app",
  ],
  forbiddenActions: [
    { action: "delete_branch", reason: "PM agents are read-only on branches" },
    { action: "merge_to_protected", reason: "PM agents do not merge" },
    { action: "deploy_to_prod", reason: "PM agents do not deploy" },
    { action: "send_external_notification", reason: "External comms are Stop per ADR-0008" },
    { action: "delete_linear_issue", reason: "Deleting issues is a Stop action" },
    { action: "revoke_credentials", reason: "Credential revocation is Stop" },
    { action: "edit_approval_rules", reason: "Approval rule edits are Stop" },
  ],
  approvalRequirements: [
    {
      action: "send_external_notification",
      level: "L3-with-approval",
      approver: "human",
      reason: "External comms are Stop per ADR-0008",
    },
  ],
  sideEffectScope: {
    files: true,
    linear: true,
    github: false,
    notifications: false,
  },
};

/**
 * Research agent — literature review, benchmarking, analysis.
 * Read-only.
 */
const RESEARCH_CONFIG: IsolationConfig = {
  type: "research",
  secrets: [
    "LINEAR_API_KEY",
    "AGENT_RUNNER_TOKEN",
  ],
  fsScope: [
    "docs/",
    "docs/decisions/",
    "docs/prds/",
  ],
  networkScope: [
    "api.linear.app",
  ],
  forbiddenActions: [
    { action: "delete_branch", reason: "Research agents are read-only" },
    { action: "merge_to_protected", reason: "Research agents do not merge" },
    { action: "deploy_to_prod", reason: "Research agents do not deploy" },
    { action: "send_external_notification", reason: "External comms are Stop per ADR-0008" },
    { action: "delete_linear_issue", reason: "Deleting issues is a Stop action" },
    { action: "revoke_credentials", reason: "Credential revocation is Stop" },
    { action: "edit_approval_rules", reason: "Approval rule edits are Stop" },
  ],
  approvalRequirements: [],
  sideEffectScope: {
    files: true,
    linear: true,
    github: false,
    notifications: false,
  },
};

/**
 * Observability agent — dashboards, metrics, logs.
 * Read-only on most surfaces.
 */
const OBSERVABILITY_CONFIG: IsolationConfig = {
  type: "observability",
  secrets: [
    "LINEAR_API_KEY",
    "AGENT_RUNNER_TOKEN",
  ],
  fsScope: [
    "logs/",
    "config/",
  ],
  networkScope: [
    "api.linear.app",
    "monitoring.",
  ],
  forbiddenActions: [
    { action: "delete_branch", reason: "Observability agents are read-only" },
    { action: "merge_to_protected", reason: "Observability agents do not merge" },
    { action: "deploy_to_prod", reason: "Observability agents do not deploy" },
    { action: "send_external_notification", reason: "External comms are Stop per ADR-0008" },
    { action: "delete_linear_issue", reason: "Deleting issues is a Stop action" },
    { action: "revoke_credentials", reason: "Credential revocation is Stop" },
    { action: "edit_approval_rules", reason: "Approval rule edits are Stop" },
  ],
  approvalRequirements: [],
  sideEffectScope: {
    files: false,
    linear: true,
    github: false,
    notifications: false,
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const AGENT_REGISTRY: Record<string, IsolationConfig> = {
  coding: CODING_CONFIG,
  sre: SRE_CONFIG,
  qa: QA_CONFIG,
  review: REVIEW_CONFIG,
  pm: PM_CONFIG,
  research: RESEARCH_CONFIG,
  observability: OBSERVABILITY_CONFIG,
};

/**
 * Get the full isolation config for an agent type.
 * Throws if the type is not recognised.
 */
export function getAgentType(type: string): IsolationConfig {
  const cfg = AGENT_REGISTRY[type];
  if (!cfg) {
    throw new Error(`Unknown agent type: "${type}". Known types: ${Object.keys(AGENT_REGISTRY).join(", ")}`);
  }
  return cfg;
}

/**
 * Get the forbidden actions for a given agent type.
 */
export function getForbiddenActions(type: AgentType): Array<{ action: ForbiddenAction; reason: string }> {
  return getAgentType(type).forbiddenActions;
}

/**
 * Get the approval requirements for a given agent type.
 */
export function getApprovalRequirements(type: AgentType): ApprovalRequirement[] {
  return getAgentType(type).approvalRequirements;
}

// ---------------------------------------------------------------------------
// Utility predicates
// ---------------------------------------------------------------------------

/**
 * Check if an action is dangerous (side-effect-producing).
 * Dangerous = can modify state (files, Linear, GitHub, deployments).
 */
export function isDangerousAction(action: string): boolean {
  const dangerous = new Set([
    "delete_branch",
    "merge_to_protected",
    "force_push",
    "deploy_to_prod",
    "deploy_to_staging",
    "rollback",
    "run_arbitrary_shell",
    "run_docker",
    "send_external_notification",
    "post_to_slack",
    "send_email",
    "delete_linear_issue",
    "revoke_credentials",
    "edit_approval_rules",
  ]);
  return dangerous.has(action);
}

/**
 * Check if an action requires approval (is Stop or L3-with-approval+).
 * Non-dangerous read actions do not need approval.
 */
export function requiresApproval(action: string): boolean {
  const stopActions = new Set([
    "merge_to_protected",
    "deploy_to_prod",
    "delete_linear_issue",
    "revoke_credentials",
    "edit_approval_rules",
    "force_push",
    "send_external_notification",
  ]);
  return stopActions.has(action);
}

/**
 * Get the side-effect scope for an agent type.
 */
export function sideEffectScope(type: AgentType): SideEffectScope {
  return getAgentType(type).sideEffectScope;
}

// ---------------------------------------------------------------------------
// Side-effect logging
// ---------------------------------------------------------------------------

/**
 * Create a structured side-effect log entry.
 * Called after every non-trivial agent action to ensure auditability.
 *
 * Evidence is a human-readable string that captures the action and outcome,
 * suitable for embedding in Linear write-backs, PR comments, or run reports.
 */
export function createSideEffectLog(entry: {
  agentType: AgentType;
  action: string;
  outcome: "succeeded" | "failed" | "skipped";
  details?: Record<string, unknown>;
}): SideEffectLog {
  const timestamp = new Date().toISOString();
  const evidenceParts: string[] = [
    `agent_type=${entry.agentType}`,
    `action=${entry.action}`,
    `outcome=${entry.outcome}`,
    `ts=${timestamp}`,
  ];

  if (entry.details) {
    for (const [key, value] of Object.entries(entry.details)) {
      if (value !== undefined && value !== null) {
        evidenceParts.push(`${key}=${JSON.stringify(value)}`);
      }
    }
  }

  return {
    agentType: entry.agentType,
    action: entry.action,
    outcome: entry.outcome,
    timestamp,
    details: entry.details ?? {},
    evidence: evidenceParts.join(" | "),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an IsolationConfig against the schema.
 * Returns a Zod.SafeParseReturnType for programmatic checking.
 */
export function validateAgentType(cfg: unknown): z.SafeParseReturnType<IsolationConfig, IsolationConfig> {
  return IsolationConfigSchema.safeParse(cfg);
}

// ---------------------------------------------------------------------------
// Zod schemas — re-exported for external use (e.g. policy-scanner rules)
// ---------------------------------------------------------------------------

export { AgentTypeSchema as agentTypeSchema };
export { ForbiddenActionSchema as forbiddenActionSchema };
export { ApprovalSchema as approvalSchema };
