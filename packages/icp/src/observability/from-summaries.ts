/**
 * LAT-140 helpers that translate the structured outputs of the
 * `@latentspacelabs/control-loop` and `@latentspacelabs/opencode-harness`
 * surfaces into `RunArtefactInput` payloads.
 *
 * Kept separate from the artefact builder so the builder stays a pure
 * leaf and so the dispatcher / future direct-invocation paths can choose
 * whether to consume it. The shape of the inputs here is intentionally
 * structural (duck-typed): we depend on the *fields we actually read*,
 * not on the upstream packages' full surface, which keeps this module
 * compilable without forcing a typecheck-time edge from `@latentspacelabs/icp`
 * back to the control-loop / opencode-harness packages.
 */

import type {
  AcceptanceCriterionCoverage,
  ArtefactCheck,
  RunArtefactInput,
  RunArtefactOutcome,
} from './run-artifact.js';

/* ------------------------------------------------------------------ */
/* Control-loop summary projection                                     */
/* ------------------------------------------------------------------ */

/**
 * Minimum shape of a control-loop run summary the artefact builder
 * needs. This mirrors `@latentspacelabs/control-loop`'s `RunSummary`
 * but is duck-typed so this module does not need a TS-level dependency
 * on that package.
 */
export interface ControlLoopSummaryLike {
  schemaVersion: string;
  evidence: {
    ticket: string;
    packPath: string;
    state: string;
    mode: string;
    costBand: 'low' | 'medium' | 'high' | 'unknown';
    riskLevel: 'low' | 'medium' | 'high' | 'unknown';
    provider: {
      adapter: string;
      runtimeId: string;
      costClass: 'low' | 'medium' | 'high';
    } | null;
    branch: {
      branch: string;
      prTitlePrefix: string;
      prBase: string;
      prUrl: string | null;
    } | null;
    checks: ReadonlyArray<{
      name: string;
      command: string;
      outcome: 'passed' | 'failed' | 'skipped' | 'manual';
      durationMs: number;
      kind?: 'shell' | 'policy' | 'manual';
      detail?: string;
    }>;
    refusals: ReadonlyArray<{ code: string; message: string }>;
    logs: { type: string; path: string } | null;
    startedAt: string;
    finishedAt: string;
  };
  preflight: {
    acceptanceCriteria: ReadonlyArray<string>;
  };
}

/**
 * Map the control-loop's `RunState` onto the artefact outcome enum.
 */
function controlLoopStateToOutcome(state: string): RunArtefactOutcome {
  switch (state) {
    case 'ready_for_review':
      return 'ready_for_review';
    case 'checks_failed':
      return 'checks_failed';
    case 'refused':
      return 'refused';
    case 'failed':
      return 'failed';
    case 'planned':
      return 'planned';
    default:
      return 'failed';
  }
}

export interface FromControlLoopSummaryArgs {
  invocation_id: string;
  producer?: string;
  summary: ControlLoopSummaryLike;
  pack_content?: string | null;
  raw_stdout?: string;
  raw_stderr?: string;
  log_stdout_redacted?: string;
  extra_secrets?: ReadonlyArray<string>;
  /** When the producer already knows where the sandbox lived. */
  sandbox_path?: string | null;
  prompt_version?: string;
  skill_version?: string;
}

/**
 * Build a `RunArtefactInput` from a control-loop run summary. The output
 * is pure data — the caller decides which fields to override before
 * passing it to `buildRunArtefact`.
 */
export function fromControlLoopSummary(args: FromControlLoopSummaryArgs): RunArtefactInput {
  const { summary } = args;
  const ev = summary.evidence;

  const checks: ArtefactCheck[] = ev.checks.map((c) => ({
    name: c.name,
    command: c.command,
    outcome: c.outcome,
    durationMs: c.durationMs,
    kind: c.kind ?? 'shell',
    ...(c.detail !== undefined ? { detail: c.detail } : {}),
  }));

  const acceptance: ReadonlyArray<AcceptanceCriterionCoverage> =
    summary.preflight.acceptanceCriteria.map((criterion) => ({
      criterion,
      status: 'unknown' as const,
    }));

  const refusalCode = ev.refusals[0]?.code ?? null;
  const refusalMessage = ev.refusals[0]?.message ?? '';

  return {
    invocation_id: args.invocation_id,
    surface: 'control-loop',
    producer: args.producer ?? 'control-loop-runner',
    outcome: controlLoopStateToOutcome(ev.state),
    started_at: new Date(ev.startedAt),
    ended_at: new Date(ev.finishedAt),
    ticket_id: ev.ticket,
    branch: ev.branch?.branch ?? null,
    sandbox_path: args.sandbox_path ?? ev.logs?.path ?? null,
    provider: ev.provider?.adapter ?? null,
    runtime_id: ev.provider?.runtimeId ?? null,
    cost_class: ev.costBand,
    risk_level: ev.riskLevel,
    classifier: null,
    pack_path: ev.packPath,
    ...(args.pack_content !== undefined && args.pack_content !== null
      ? { pack_content: args.pack_content }
      : {}),
    ...(args.prompt_version !== undefined ? { prompt_version: args.prompt_version } : {}),
    ...(args.skill_version !== undefined ? { skill_version: args.skill_version } : {}),
    refusal_code: refusalCode,
    refusal_message: refusalMessage,
    pr_url: ev.branch?.prUrl ?? null,
    checks,
    changed_files: null,
    acceptance_criteria_coverage: acceptance,
    ...(args.raw_stdout !== undefined ? { raw_stdout: args.raw_stdout } : {}),
    ...(args.raw_stderr !== undefined ? { raw_stderr: args.raw_stderr } : {}),
    ...(args.log_stdout_redacted !== undefined
      ? { log_stdout_redacted: args.log_stdout_redacted }
      : {}),
    ...(args.extra_secrets !== undefined ? { extra_secrets: args.extra_secrets } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Opencode harness dry-run summary projection                         */
/* ------------------------------------------------------------------ */

export interface OpencodeDryRunSummaryLike {
  schemaVersion: string;
  ticket: string;
  packPath: string;
  status: string;
  generatedAt: string;
  packReadinessStatus: string;
  costBand: 'low' | 'medium' | 'high' | 'unknown';
  riskLevel: 'low' | 'medium' | 'high' | 'unknown';
  filesInScope: ReadonlyArray<string>;
  filesForbidden: ReadonlyArray<string>;
  acceptanceCriteria: ReadonlyArray<string>;
  branchPlan: { branch: string; prTitlePrefix: string; prBase: string } | null;
  checkPlan: ReadonlyArray<{
    name: string;
    command: string;
    source: 'ticket-pack' | 'repo-gate';
    kind: 'shell' | 'policy' | 'manual';
  }>;
  refusals: ReadonlyArray<{ code: string; message: string }>;
}

function harnessStatusToOutcome(status: string): RunArtefactOutcome {
  switch (status) {
    case 'ready':
      // The harness never dispatches; "ready" means a real run *would*
      // start. From the artefact's view that maps to `planned`.
      return 'planned';
    case 'blocked':
    case 'needs_clarification':
    case 'too_large':
      return 'refused';
    case 'harness_error':
    default:
      return 'failed';
  }
}

export interface FromOpencodeDryRunArgs {
  invocation_id: string;
  producer?: string;
  summary: OpencodeDryRunSummaryLike;
  /** The dry run is instantaneous; the caller supplies wall clocks. */
  started_at: Date;
  ended_at: Date;
  pack_content?: string | null;
  extra_secrets?: ReadonlyArray<string>;
  prompt_version?: string;
  skill_version?: string;
}

export function fromOpencodeDryRunSummary(args: FromOpencodeDryRunArgs): RunArtefactInput {
  const { summary } = args;
  const refusal = summary.refusals[0];

  const acceptance: ReadonlyArray<AcceptanceCriterionCoverage> = summary.acceptanceCriteria.map(
    (criterion) => ({
      criterion,
      status: 'unknown' as const,
    }),
  );

  const checks: ArtefactCheck[] = summary.checkPlan.map((c) => ({
    name: c.name,
    command: c.command,
    outcome: 'skipped' as const,
    durationMs: 0,
    kind: c.kind,
  }));

  return {
    invocation_id: args.invocation_id,
    surface: 'opencode-harness',
    producer: args.producer ?? 'opencode-harness:dry-run',
    outcome: harnessStatusToOutcome(summary.status),
    started_at: args.started_at,
    ended_at: args.ended_at,
    ticket_id: summary.ticket,
    branch: summary.branchPlan?.branch ?? null,
    sandbox_path: null,
    provider: null,
    runtime_id: null,
    cost_class: summary.costBand,
    risk_level: summary.riskLevel,
    classifier: null,
    pack_path: summary.packPath,
    ...(args.pack_content !== undefined && args.pack_content !== null
      ? { pack_content: args.pack_content }
      : {}),
    ...(args.prompt_version !== undefined ? { prompt_version: args.prompt_version } : {}),
    ...(args.skill_version !== undefined ? { skill_version: args.skill_version } : {}),
    refusal_code: refusal?.code ?? null,
    refusal_message: refusal?.message ?? '',
    pr_url: null,
    checks,
    changed_files: null,
    acceptance_criteria_coverage: acceptance,
    ...(args.extra_secrets !== undefined ? { extra_secrets: args.extra_secrets } : {}),
  };
}
