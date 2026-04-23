import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SkillRegistry } from "../runtime/registry.js";
import { SkillRunner } from "../runtime/runner.js";
import type {
  AgentInvocationRequest,
  LinearIssueSnapshot,
  ResolvedTools,
} from "../runtime/contract.js";
import { createPolicyEvaluator } from "../adapters/policy-evaluator.js";
import { createRunRecorder } from "../adapters/run-recorder.js";
import { createWriteBackFormatter } from "../adapters/write-back-formatter.js";
import { createStubLinearAdapter } from "../adapters/linear-adapter.js";
import { createStubAgentAdapter } from "../adapters/agent-invocation-adapter.js";
import {
  dispatchTicketSkill,
  type DispatchTicketOutputs,
} from "./dispatch-ticket.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

function readyIssue(
  overrides: Partial<LinearIssueSnapshot> = {},
): LinearIssueSnapshot {
  return {
    id: "LAT-999",
    status: "todo",
    sequencing: {
      hard_blockers: [],
      recommended_predecessors: [],
      dispatch_status: "ready",
      dispatch_note: "",
    },
    blocker_statuses: {},
    budget_cap_usd: 5,
    ...overrides,
  };
}

interface Harness {
  runner: SkillRunner;
  comments: Array<{ issueId: string; body: string; url: string }>;
  agentCalls: AgentInvocationRequest[];
}

async function buildHarness(
  issues: Record<string, LinearIssueSnapshot>,
): Promise<Harness> {
  const comments: Array<{ issueId: string; body: string; url: string }> = [];
  const agentCalls: AgentInvocationRequest[] = [];
  const resolved: ResolvedTools = {
    linear: createStubLinearAdapter({
      issues,
      commentSink: (c) => comments.push(c),
    }),
    policy: createPolicyEvaluator(),
    agents: createStubAgentAdapter({
      invocationSink: (req) => agentCalls.push(req),
    }),
    runRecorder: createRunRecorder(),
    writeBack: createWriteBackFormatter(),
  };
  const reg = new SkillRegistry({
    repoRoot: REPO_ROOT,
    availableTools: [
      "linear-adapter",
      "policy-evaluator",
      "agent-invocation-adapter",
      "run-recorder",
      "write-back-formatter",
    ],
  });
  await reg.register(dispatchTicketSkill);
  const runner = new SkillRunner({
    registry: reg,
    tools: resolved,
    autonomyCap: "L2-propose",
  });
  return { runner, comments, agentCalls };
}

test("dispatch-ticket: refuses without approval on L3 skill", async () => {
  const issue = readyIssue();
  const h = await buildHarness({ [issue.id]: issue });
  const res = await h.runner.run({
    skill: "dispatch-ticket",
    inputs: { linear_issue_id: issue.id, approve: false, dry_run: false },
    approve: false,
    dry_run: false,
  });
  assert.equal(res.status, "needs_human");
  assert.equal(h.agentCalls.length, 0);
  assert.equal(h.comments.length, 0);
});

test("dispatch-ticket: dry-run records policy and posts nothing", async () => {
  const issue = readyIssue();
  const h = await buildHarness({ [issue.id]: issue });
  const res = await h.runner.run({
    skill: "dispatch-ticket",
    inputs: { linear_issue_id: issue.id, approve: false, dry_run: true },
    approve: false,
    dry_run: true,
  });
  assert.equal(res.status, "succeeded");
  assert.equal(h.agentCalls.length, 0);
  assert.equal(h.comments.length, 0);
  const outputs = res.outputs as DispatchTicketOutputs;
  assert.ok(outputs.run_report_path?.startsWith("runs/"));
  assert.ok(outputs.run_report_markdown?.includes("Dry-run"));
});

test("dispatch-ticket: refuses dispatch when a hard blocker is open", async () => {
  const issue = readyIssue({
    sequencing: {
      hard_blockers: ["LAT-100"],
      recommended_predecessors: [],
      dispatch_status: "ready",
      dispatch_note: "",
    },
    blocker_statuses: { "LAT-100": "In Progress" },
  });
  const h = await buildHarness({ [issue.id]: issue });
  const res = await h.runner.run({
    skill: "dispatch-ticket",
    inputs: { linear_issue_id: issue.id, approve: true, dry_run: false },
    approve: true,
    dry_run: false,
  });
  assert.equal(res.status, "blocked");
  assert.equal(h.agentCalls.length, 0);
  assert.equal(h.comments.length, 0);
  assert.match(res.reasons.join(" "), /hard blocker LAT-100/);
});

test("dispatch-ticket: refuses when budget cap is missing (ADR-0009)", async () => {
  const issue = readyIssue({ budget_cap_usd: null });
  const h = await buildHarness({ [issue.id]: issue });
  const res = await h.runner.run({
    skill: "dispatch-ticket",
    inputs: { linear_issue_id: issue.id, approve: true, dry_run: true },
    approve: true,
    dry_run: true,
  });
  assert.equal(res.status, "caution");
  assert.match(res.reasons.join(" "), /Budget cap/);
});

test("dispatch-ticket: approved + ready invokes agent and posts write-back", async () => {
  const issue = readyIssue();
  const h = await buildHarness({ [issue.id]: issue });
  const res = await h.runner.run({
    skill: "dispatch-ticket",
    inputs: { linear_issue_id: issue.id, approve: true, dry_run: false },
    approve: true,
    dry_run: false,
  });
  assert.equal(res.status, "succeeded");
  assert.equal(h.agentCalls.length, 1);
  assert.equal(h.agentCalls[0]!.linear_issue_id, issue.id);
  assert.equal(h.comments.length, 1);
  assert.match(h.comments[0]!.body, /\*\*Outcome:\*\*/);
  assert.match(h.comments[0]!.body, /\*\*Evidence:\*\*/);
  assert.match(h.comments[0]!.body, /\*\*PR:\*\*/);
  const outputs = res.outputs as DispatchTicketOutputs;
  assert.ok(outputs.run_id);
  assert.ok(outputs.pr_url);
  assert.ok(outputs.linear_comment_url);
});

test("dispatch-ticket: caution verdict with approval still dispatches", async () => {
  // Caution is not the same as blocked; an approver can acknowledge a
  // `dispatch_status: caution` ticket and proceed. This proves the runner
  // does not silently upgrade caution to blocked.
  const issue = readyIssue({
    sequencing: {
      hard_blockers: [],
      recommended_predecessors: [],
      dispatch_status: "caution",
      dispatch_note: "reviewer asked for a smaller scope",
    },
  });
  const h = await buildHarness({ [issue.id]: issue });
  const res = await h.runner.run({
    skill: "dispatch-ticket",
    inputs: { linear_issue_id: issue.id, approve: true, dry_run: false },
    approve: true,
    dry_run: false,
  });
  assert.equal(res.status, "succeeded");
  assert.equal(h.agentCalls.length, 1);
});

test("dispatch-ticket: missing linear_issue_id input fails fast", async () => {
  const h = await buildHarness({});
  const res = await h.runner.run({
    skill: "dispatch-ticket",
    inputs: { approve: true, dry_run: true } as Record<string, unknown>,
    approve: true,
    dry_run: true,
  });
  assert.equal(res.status, "failed");
  assert.match(res.reasons.join(" "), /linear_issue_id/);
});
