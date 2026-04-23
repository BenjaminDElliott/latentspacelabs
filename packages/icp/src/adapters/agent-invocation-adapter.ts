/**
 * Agent invocation adapter (ADR-0012 § "Agent invocation adapter").
 *
 * The real coding-agent invocation path (spawning a Claude Code harness or
 * similar) is out of scope for this slice — LAT-52 deliberately stays behind
 * stubs until the credential / sandbox story lands. This module defines the
 * adapter boundary and ships a stub runner so the dispatch skill can be
 * exercised end-to-end in tests.
 */
import type {
  AgentInvocationAdapter,
  AgentInvocationRequest,
  AgentInvocationResult,
} from "../runtime/contract.js";

export interface StubAgentResponse {
  exit_signal?: AgentInvocationResult["exit_signal"];
  pr_url?: string | null;
  pr_branch?: string | null;
  commit_sha?: string | null;
  cost_band?: AgentInvocationResult["cost_band"];
  spent_usd?: number | null;
  notes?: ReadonlyArray<string>;
}

export interface StubAgentAdapterOptions {
  /** Canned responses per linear_issue_id. Missing ids get a default success. */
  responses?: Readonly<Record<string, StubAgentResponse>>;
  /** Records every invocation so tests can assert the adapter was (or was not) called. */
  invocationSink?: (req: AgentInvocationRequest) => void;
}

export function createStubAgentAdapter(
  opts: StubAgentAdapterOptions = {},
): AgentInvocationAdapter {
  return {
    async invoke(req: AgentInvocationRequest): Promise<AgentInvocationResult> {
      opts.invocationSink?.(req);
      const canned = opts.responses?.[req.linear_issue_id];
      return {
        exit_signal: canned?.exit_signal ?? "succeeded",
        pr_url:
          canned?.pr_url ??
          `https://github.com/stub/repo/pull/${req.linear_issue_id.toLowerCase()}`,
        pr_branch: canned?.pr_branch ?? `${req.linear_issue_id.toLowerCase()}-stub`,
        commit_sha: canned?.commit_sha ?? "0000000",
        cost_band: canned?.cost_band ?? "normal",
        spent_usd: canned?.spent_usd ?? null,
        notes: canned?.notes ?? [`stub agent invocation for ${req.linear_issue_id}`],
      };
    },
  };
}
