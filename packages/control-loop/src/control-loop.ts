/**
 * Sandboxed agent control loop (LAT-117).
 *
 * One bounded dispatch at a time. The shape is intentionally linear:
 *
 *   1. Run the LAT-105 dry-run harness against the ticket pack.
 *      - If it refuses, we refuse (no adapter contacted).
 *   2. Run guardrails on the parsed pack (secrets, dep policy, cost class).
 *      - If they refuse, we refuse (no adapter contacted).
 *   3. Resolve the adapter from `mode` + env.
 *      - If `prepare()` throws `MissingConfigError`, refuse with
 *        `missing_runtime_config`. Never silently fall back.
 *   4. If `mode === "plan"`, return a `planned` summary without calling
 *      `adapter.run()`. This is what an operator uses to preview a
 *      dispatch end-to-end without spending sandbox cost.
 *   5. Otherwise call `adapter.run()` once. The adapter is the only thing
 *      allowed to talk to opencode/the sandbox.
 *   6. Translate the adapter result into a `RunSummary`.
 *
 * The loop never opens a PR, never auto-merges, and never deploys. Those
 * are explicit non-goals for this MVP slice.
 */

import { dryRun } from "@latentspacelabs/opencode-harness";
import type {
  CostBand,
  RiskLevel,
  TicketPack,
} from "@latentspacelabs/opencode-harness";

import { runAllGuardrails } from "./guardrails.js";
import type {
  AdapterRequest,
  BranchEvidence,
  CheckResult,
  RefusalEvidence,
  RunEvidence,
  RunMode,
  RunState,
  RunSummary,
  RuntimeAdapter,
} from "./types.js";
import { MissingConfigError } from "./types.js";
import { selectAdapter } from "./adapters.js";

export interface RunControlLoopOptions {
  packPath: string;
  mode: RunMode;
  /**
   * Inject an adapter to bypass `selectAdapter`. Tests use this to drive
   * specific outcomes; production callers leave it unset and the loop
   * picks one based on `mode` + env.
   */
  adapter?: RuntimeAdapter;
  /** Env source for the live adapter selection. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Stable clock for tests. */
  now?: () => Date;
}

function nextActionFor(state: RunState, refusals: ReadonlyArray<RefusalEvidence>): string {
  switch (state) {
    case "ready_for_review":
      return "Human reviewer: open the planned branch, inspect the diff, and decide whether to merge.";
    case "checks_failed":
      return "Human reviewer: inspect failed checks; fix the pack or the implementation, then re-run.";
    case "failed":
      return "Operator: read adapter logs, address the failure cause, then re-run. Do not retry blindly.";
    case "refused": {
      const codes = refusals.map((r) => r.code).join(", ");
      return `Author: address the refusal (${codes || "see refusals"}) and resubmit a corrected pack.`;
    }
    case "planned":
      return "Operator: re-run with mode=mock or mode=live to actually dispatch.";
    case "running":
      // Should never be observed in a final summary.
      return "Adapter is still running; this should not appear in a final summary.";
  }
}

function buildAdapterRequest(pack: TicketPack, requiredChecks: ReadonlyArray<{ name: string; command: string }>): AdapterRequest {
  return {
    ticket: pack.header.linearId,
    packPath: pack.rawPath,
    packRaw: pack.raw,
    costBand: pack.header.costBand,
    riskLevel: pack.header.riskLevel,
    branch: pack.branchRules.branch,
    prTitlePrefix: pack.branchRules.prTitlePrefix,
    prBase: pack.branchRules.prBase.length > 0 ? pack.branchRules.prBase : "main",
    filesInScope: pack.filesInScope,
    filesForbidden: pack.filesForbidden,
    requiredChecks,
  };
}

function emptyBranchEvidence(): BranchEvidence | null {
  return null;
}

function refusedSummary(args: {
  ticket: string;
  packPath: string;
  mode: RunMode;
  costBand: CostBand | "unknown";
  riskLevel: RiskLevel | "unknown";
  refusals: ReadonlyArray<RefusalEvidence>;
  startedAt: string;
  finishedAt: string;
  preflight: RunSummary["preflight"];
  branch: BranchEvidence | null;
}): RunSummary {
  const evidence: RunEvidence = {
    ticket: args.ticket,
    packPath: args.packPath,
    state: "refused",
    mode: args.mode,
    costBand: args.costBand,
    riskLevel: args.riskLevel,
    provider: null,
    branch: args.branch,
    checks: [],
    refusals: [...args.refusals],
    logs: null,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    nextHumanAction: nextActionFor("refused", args.refusals),
  };
  return {
    schemaVersion: "1.0.0",
    evidence,
    preflight: args.preflight,
  };
}

export async function runControlLoop(options: RunControlLoopOptions): Promise<RunSummary> {
  const now = options.now ?? (() => new Date());
  const env = options.env ?? process.env;
  const startedAt = now().toISOString();

  const dry = await dryRun(options.packPath, { now });
  const preflight = dry.summary;

  // Step 1: harness refusal short-circuits us before any adapter runs.
  if (preflight.status !== "ready") {
    return refusedSummary({
      ticket: preflight.ticket,
      packPath: preflight.packPath,
      mode: options.mode,
      costBand: preflight.costBand,
      riskLevel: preflight.riskLevel,
      refusals: preflight.refusals,
      startedAt,
      finishedAt: now().toISOString(),
      preflight,
      branch: emptyBranchEvidence(),
    });
  }

  const pack = dry.pack;
  if (pack === null) {
    // Defensive: harness said ready but didn't return a pack — refuse.
    return refusedSummary({
      ticket: preflight.ticket,
      packPath: preflight.packPath,
      mode: options.mode,
      costBand: preflight.costBand,
      riskLevel: preflight.riskLevel,
      refusals: [
        {
          code: "harness_inconsistent",
          message: "harness reported ready but did not return a parsed pack; refusing.",
        },
      ],
      startedAt,
      finishedAt: now().toISOString(),
      preflight,
      branch: emptyBranchEvidence(),
    });
  }

  // Step 2: extra guardrails on the parsed pack.
  const guardrailRefusals = runAllGuardrails(pack);
  if (guardrailRefusals.length > 0) {
    return refusedSummary({
      ticket: pack.header.linearId,
      packPath: pack.rawPath,
      mode: options.mode,
      costBand: pack.header.costBand,
      riskLevel: pack.header.riskLevel,
      refusals: guardrailRefusals,
      startedAt,
      finishedAt: now().toISOString(),
      preflight,
      branch: emptyBranchEvidence(),
    });
  }

  // Step 3: resolve adapter and prepare it.
  const adapter = options.adapter ?? selectAdapter({ mode: options.mode, env });
  try {
    await adapter.prepare();
  } catch (err) {
    if (err instanceof MissingConfigError) {
      return refusedSummary({
        ticket: pack.header.linearId,
        packPath: pack.rawPath,
        mode: options.mode,
        costBand: pack.header.costBand,
        riskLevel: pack.header.riskLevel,
        refusals: [
          {
            code: "missing_runtime_config",
            message: err.message,
          },
        ],
        startedAt,
        finishedAt: now().toISOString(),
        preflight,
        branch: emptyBranchEvidence(),
      });
    }
    throw err;
  }

  // Step 4: plan mode does not dispatch.
  if (options.mode === "plan") {
    const branch: BranchEvidence = {
      branch: pack.branchRules.branch,
      prTitlePrefix: pack.branchRules.prTitlePrefix,
      prBase: pack.branchRules.prBase.length > 0 ? pack.branchRules.prBase : "main",
      prUrl: null,
    };
    const finishedAt = now().toISOString();
    const evidence: RunEvidence = {
      ticket: pack.header.linearId,
      packPath: pack.rawPath,
      state: "planned",
      mode: options.mode,
      costBand: pack.header.costBand,
      riskLevel: pack.header.riskLevel,
      provider: null,
      branch,
      checks: [],
      refusals: [],
      logs: null,
      startedAt,
      finishedAt,
      nextHumanAction: nextActionFor("planned", []),
    };
    return { schemaVersion: "1.0.0", evidence, preflight };
  }

  // Step 5: dispatch.
  const requiredChecks = preflight.checkPlan.map((c) => ({ name: c.name, command: c.command }));
  const request = buildAdapterRequest(pack, requiredChecks);

  let result;
  try {
    result = await adapter.run(request);
  } catch (err) {
    if (err instanceof MissingConfigError) {
      return refusedSummary({
        ticket: pack.header.linearId,
        packPath: pack.rawPath,
        mode: options.mode,
        costBand: pack.header.costBand,
        riskLevel: pack.header.riskLevel,
        refusals: [
          {
            code: "missing_runtime_config",
            message: err.message,
          },
        ],
        startedAt,
        finishedAt: now().toISOString(),
        preflight,
        branch: emptyBranchEvidence(),
      });
    }
    // Non-config error: report as `failed` with the adapter id we tried.
    const finishedAt = now().toISOString();
    const message = err instanceof Error ? err.message : String(err);
    const evidence: RunEvidence = {
      ticket: pack.header.linearId,
      packPath: pack.rawPath,
      state: "failed",
      mode: options.mode,
      costBand: pack.header.costBand,
      riskLevel: pack.header.riskLevel,
      provider: { adapter: adapter.id, runtimeId: "unknown", costClass: pack.header.costBand },
      branch: null,
      checks: [],
      refusals: [
        {
          code: "adapter_threw",
          message: `adapter ${adapter.id} threw: ${message}`,
        },
      ],
      logs: null,
      startedAt,
      finishedAt,
      nextHumanAction: nextActionFor("failed", []),
    };
    return { schemaVersion: "1.0.0", evidence, preflight };
  }

  // Step 6: translate adapter result.
  const checks: CheckResult[] = result.checks;
  const finishedAt = now().toISOString();
  const evidence: RunEvidence = {
    ticket: pack.header.linearId,
    packPath: pack.rawPath,
    state: result.state,
    mode: options.mode,
    costBand: pack.header.costBand,
    riskLevel: pack.header.riskLevel,
    provider: result.provider,
    branch: result.branch,
    checks,
    refusals: result.refusals ?? [],
    logs: result.logs,
    startedAt,
    finishedAt,
    nextHumanAction: nextActionFor(result.state, result.refusals ?? []),
  };
  return { schemaVersion: "1.0.0", evidence, preflight };
}
