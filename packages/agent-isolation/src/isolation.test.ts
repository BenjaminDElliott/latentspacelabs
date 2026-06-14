import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AgentType,
  ForbiddenAction,
  IsolationConfig,
  getAgentType,
  getForbiddenActions,
  getApprovalRequirements,
  validateAgentType,
  agentTypeSchema,
  forbiddenActionSchema,
  approvalSchema,
  isDangerousAction,
  requiresApproval,
  sideEffectScope,
  createSideEffectLog,
  type ApprovalRequirement,
  type SideEffectLog,
} from "./isolation.js";

// ---------------------------------------------------------------------------
// Helpers — minimal schema checks
// ---------------------------------------------------------------------------

test("agentTypeSchema validates 'coding' as a known type", () => {
  const result = agentTypeSchema.safeParse("coding");
  assert.ok(result.success, `expected 'coding' to pass, got: ${JSON.stringify(result.error)}`);
});

test("agentTypeSchema validates 'sre' as a known type", () => {
  const result = agentTypeSchema.safeParse("sre");
  assert.ok(result.success, `expected 'sre' to pass, got: ${JSON.stringify(result.error)}`);
});

test("agentTypeSchema rejects unknown types", () => {
  const result = agentTypeSchema.safeParse("unknown_type");
  assert.ok(!result.success);
});

// ---------------------------------------------------------------------------
// getAgentType — type lookup
// ---------------------------------------------------------------------------

test("getAgentType returns coding config with expected isolation", () => {
  const cfg = getAgentType("coding");
  assert.equal(cfg.type, "coding");
  assert.ok(cfg.forbiddenActions.some((a) => a.action === "delete_branch"));
  assert.ok(cfg.forbiddenActions.some((a) => a.action === "merge_to_protected"));
});

test("getAgentType returns sre config with expected isolation", () => {
  const cfg = getAgentType("sre");
  assert.equal(cfg.type, "sre");
  assert.ok(cfg.forbiddenActions.some((a) => a.action === "run_arbitrary_shell"));
});

test("getAgentType returns qa config", () => {
  const cfg = getAgentType("qa");
  assert.equal(cfg.type, "qa");
  assert.ok(cfg.forbiddenActions.length > 0);
});

test("getAgentType returns review config", () => {
  const cfg = getAgentType("review");
  assert.equal(cfg.type, "review");
  assert.ok(cfg.forbiddenActions.length > 0);
});

test("getAgentType rejects unknown type", () => {
  assert.throws(() => getAgentType("unknown"), /Unknown agent type/);
});

// ---------------------------------------------------------------------------
// Forbidden actions — acceptance criteria: coding cannot delete/merge
// ---------------------------------------------------------------------------

test("coding agent forbids delete_branch", () => {
  const forbidden = getForbiddenActions("coding");
  const deleteBranch = forbidden.find((a) => a.action === "delete_branch");
  assert.ok(deleteBranch, "coding must forbid delete_branch");
});

test("coding agent forbids merge_to_protected", () => {
  const forbidden = getForbiddenActions("coding");
  const merge = forbidden.find((a) => a.action === "merge_to_protected");
  assert.ok(merge, "coding must forbid merge_to_protected");
});

test("SRE agent forbids run_arbitrary_shell without approval", () => {
  const forbidden = getForbiddenActions("sre");
  const shell = forbidden.find((a) => a.action === "run_arbitrary_shell");
  assert.ok(shell, "SRE must forbid run_arbitrary_shell");
});

test("all agent types forbid deploy_to_prod without approval", () => {
  const types: AgentType[] = ["coding", "sre", "qa", "review", "pm"];
  for (const t of types) {
    const forbidden = getForbiddenActions(t);
    const deploy = forbidden.find((a) => a.action === "deploy_to_prod");
    if (t === "sre") {
      assert.ok(deploy, `${t} must forbid deploy_to_prod`);
    } else {
      // coding agents can deploy to staging but not prod
      assert.ok(deploy, `${t} must forbid deploy_to_prod`);
    }
  }
});

test("all agent types forbid send_external_notification without approval", () => {
  const types: AgentType[] = ["coding", "sre", "qa", "review", "pm"];
  for (const t of types) {
    const forbidden = getForbiddenActions(t);
    const notif = forbidden.find((a) => a.action === "send_external_notification");
    assert.ok(notif, `${t} must forbid send_external_notification`);
  }
});

// ---------------------------------------------------------------------------
// Approval requirements — acceptance criteria: risky actions need approval
// ---------------------------------------------------------------------------

test("SRE deploy requires human approval", () => {
  const approvals = getApprovalRequirements("sre");
  const deploy = approvals.find((a) => a.action === "deploy_to_prod");
  assert.ok(deploy, "SRE must have approval for deploy_to_prod");
  assert.equal(deploy.level, "L3-with-approval");
});

test("coding merge to main requires human approval", () => {
  const approvals = getApprovalRequirements("coding");
  const merge = approvals.find((a) => a.action === "merge_to_protected");
  assert.ok(merge, "coding must have approval for merge_to_protected");
  assert.equal(merge.level, "L3-with-approval");
});

test("SRE arbitrary shell requires L2 approval", () => {
  const approvals = getApprovalRequirements("sre");
  const shell = approvals.find((a) => a.action === "run_arbitrary_shell");
  assert.ok(shell, "SRE must have approval for run_arbitrary_shell");
  assert.equal(shell.level, "L2-with-approval");
});

test("isDangerousAction returns true for merge actions", () => {
  assert.equal(isDangerousAction("merge_to_protected"), true);
});

test("isDangerousAction returns true for deploy_to_prod", () => {
  assert.equal(isDangerousAction("deploy_to_prod"), true);
});

test("isDangerousAction returns false for read operations", () => {
  assert.equal(isDangerousAction("read_file"), false);
});

test("requiresApproval returns true for Stop-category actions", () => {
  assert.equal(requiresApproval("merge_to_protected"), true);
});

test("requiresApproval returns false for non-stop actions", () => {
  assert.equal(requiresApproval("read_file"), false);
});

// ---------------------------------------------------------------------------
// Secret scope
// ---------------------------------------------------------------------------

test("coding agent has read-only secret scope for linear and github", () => {
  const cfg = getAgentType("coding");
  const secrets = cfg.secrets;
  assert.ok(secrets.includes("LINEAR_API_KEY"));
  assert.ok(secrets.includes("GITHUB_TOKEN"));
  // coding agents should NOT have deploy secrets
  assert.ok(!secrets.includes("AWS_ACCESS_KEY_ID"));
});

test("SRE agent has broader secret scope including cloud credentials", () => {
  const cfg = getAgentType("sre");
  const secrets = cfg.secrets;
  assert.ok(secrets.includes("LINEAR_API_KEY"));
  assert.ok(secrets.includes("GITHUB_TOKEN"));
  assert.ok(secrets.includes("AWS_ACCESS_KEY_ID"));
});

test("all agents have AGENT_RUNNER_TOKEN", () => {
  const types: AgentType[] = ["coding", "sre", "qa", "review", "pm"];
  for (const t of types) {
    const cfg = getAgentType(t);
    assert.ok(cfg.secrets.includes("AGENT_RUNNER_TOKEN"), `${t} must have AGENT_RUNNER_TOKEN`);
  }
});

// ---------------------------------------------------------------------------
// Filesystem scope
// ---------------------------------------------------------------------------

test("coding agent has write access to packages and docs", () => {
  const cfg = getAgentType("coding");
  assert.ok(cfg.fsScope.includes("packages/"));
  assert.ok(cfg.fsScope.includes("docs/"));
});

test("SRE agent has read access to logs and config", () => {
  const cfg = getAgentType("sre");
  assert.ok(cfg.fsScope.includes("logs/"));
  assert.ok(cfg.fsScope.includes("config/"));
});

// ---------------------------------------------------------------------------
// Network scope
// ---------------------------------------------------------------------------

test("coding agent can reach github and linear APIs", () => {
  const cfg = getAgentType("coding");
  assert.ok(cfg.networkScope.includes("github.com"));
  assert.ok(cfg.networkScope.includes("api.linear.app"));
});

test("SRE agent can reach monitoring APIs", () => {
  const cfg = getAgentType("sre");
  assert.ok(cfg.networkScope.includes("api.linear.app"));
  assert.ok(cfg.networkScope.includes("github.com"));
  assert.ok(cfg.networkScope.includes("monitoring."));
});

// ---------------------------------------------------------------------------
// Side-effect logging — acceptance criteria: side effects logged with evidence
// ---------------------------------------------------------------------------

test("sideEffectScope returns the correct scope for coding agent", () => {
  const scope = sideEffectScope("coding");
  assert.equal(scope.files, true);
  assert.equal(scope.linear, true);
  assert.equal(scope.github, true);
  assert.equal(scope.notifications, false);
});

test("sideEffectScope returns the correct scope for SRE agent", () => {
  const scope = sideEffectScope("sre");
  assert.equal(scope.files, true);
  assert.equal(scope.linear, true);
  assert.equal(scope.github, false);
  assert.equal(scope.notifications, true);
});

test("createSideEffectLog produces a valid log entry", () => {
  const log = createSideEffectLog({
    agentType: "coding",
    action: "create_pull_request",
    outcome: "succeeded",
    details: { url: "https://github.com/example/pull/1" },
  });

  assert.equal(log.agentType, "coding");
  assert.equal(log.action, "create_pull_request");
  assert.equal(log.outcome, "succeeded");
  assert.ok(log.timestamp);
  assert.ok(log.evidence);
  assert.ok(log.evidence.includes("create_pull_request"));
  assert.ok(log.evidence.includes("succeeded"));
});

test("createSideEffectLog includes agent type in evidence", () => {
  const log = createSideEffectLog({
    agentType: "sre",
    action: "deploy_to_staging",
    outcome: "succeeded",
    details: {},
  });
  assert.ok(log.evidence.includes("agent_type=sre"));
});

// ---------------------------------------------------------------------------
// validateAgentType — schema validation
// ---------------------------------------------------------------------------

test("validateAgentType accepts a properly typed config", () => {
  const cfg: IsolationConfig = {
    type: "coding",
    secrets: ["LINEAR_API_KEY", "GITHUB_TOKEN", "AGENT_RUNNER_TOKEN"],
    fsScope: ["packages/", "docs/"],
    networkScope: ["github.com", "api.linear.app"],
    forbiddenActions: [
      { action: "delete_branch", reason: "Coding agents should not delete branches" },
      { action: "merge_to_protected", reason: "Coding agents must open PRs, not merge" },
    ],
    approvalRequirements: [
      {
        action: "merge_to_protected",
        level: "L3-with-approval",
        approver: "human_or_thread_approved",
        reason: "Merging to protected branch requires review (LAT-47)",
      },
    ],
    sideEffectScope: { files: true, linear: true, github: true, notifications: false },
  };

  const result = validateAgentType(cfg);
  assert.ok(result.success, `expected valid config, got: ${JSON.stringify(result.error)}`);
});

test("validateAgentType rejects unknown agent type", () => {
  const cfg: IsolationConfig = {
    type: "unknown_agent" as AgentType,
    secrets: [],
    fsScope: [],
    networkScope: [],
    forbiddenActions: [],
    approvalRequirements: [],
    sideEffectScope: { files: false, linear: false, github: false, notifications: false },
  };

  const result = validateAgentType(cfg);
  assert.ok(!result.success);
});

// ---------------------------------------------------------------------------
// Approval requirement schema
// ---------------------------------------------------------------------------

test("approvalSchema validates L3-with-approval level", () => {
  const result = approvalSchema.safeParse({
    action: "deploy_to_prod",
    level: "L3-with-approval",
    approver: "human",
    reason: "Production deploy requires human approval",
  });
  assert.ok(result.success);
});

test("approvalSchema validates L2-with-approval level", () => {
  const result = approvalSchema.safeParse({
    action: "run_arbitrary_shell",
    level: "L2-with-approval",
    approver: "human",
    reason: "Arbitrary shell commands may have unintended side effects",
  });
  assert.ok(result.success);
});

test("approvalSchema rejects unknown level", () => {
  const result = approvalSchema.safeParse({
    action: "read_file",
    level: "L99-invalid",
    approver: "human",
    reason: "Test",
  });
  assert.ok(!result.success);
});

test("forbiddenActionSchema validates delete_branch", () => {
  const result = forbiddenActionSchema.safeParse("delete_branch");
  assert.ok(result.success);
});

test("forbiddenActionSchema rejects unknown action", () => {
  const result = forbiddenActionSchema.safeParse("unknown_action");
  assert.ok(!result.success);
});
