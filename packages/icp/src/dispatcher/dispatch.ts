/**
 * LAT-129 polling dispatcher orchestration.
 *
 * One invocation = one selected ticket = one control-loop run = one
 * Linear write-back. The orchestration is deliberately straight-line so
 * the unit tests can pin every branch without an event loop.
 *
 * Boundary responsibilities:
 *
 * - Reads dispatcher config from `process.env` exactly once at the
 *   entry point and never afterwards. Adapters and helpers receive the
 *   resolved config; secrets stay closed over a single closure.
 * - Posts a sanitised Linear comment on every terminal outcome where
 *   the control loop ran (success, refusal, failure).
 * - Promotes the issue to `In Review` only when the control-loop JSON
 *   summary reports `state === "ready_for_review"` AND the run produced
 *   an actionable review artifact (branch, PR, patch, or explicit local
 *   diff path — see LAT-143). All other outcomes — including
 *   `no_review_artifact` for ready runs with nothing to review — leave
 *   the issue unpromoted, with a comment explaining why.
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runControlLoopCli, type RunControlLoopOptions } from './control-loop-runner.js';
import { evaluateEligibility } from './select.js';
import { buildTicketPack } from './ticket-pack.js';
import { redactOutput } from './redact.js';
import { createDispatcherLinearClient, DispatcherLinearError } from './linear-client.js';
import {
  buildRunArtefact,
  formatArtefactCompactRef,
  renderRunArtefactJson,
  type RunArtefact,
  type RunArtefactOutcome,
} from '../observability/run-artifact.js';
import { buildRunRecord } from '../observability/run-record.js';
import { WorktreeAllocator, type WorktreeAllocation } from './worktree.js';
import type {
  ControlLoopJsonSummary,
  DispatchOutcome,
  DispatchReport,
  DispatcherLinearClient,
  DispatcherSpawn,
  ReviewArtifact,
} from './types.js';

export interface DispatcherConfig {
  /** Linear personal API key. Never logged. */
  linearApiKey: string;
  /** Explicit dispatch target identifier (LAT-NN). Required for MVP. */
  dispatchIssueId: string | null;
  /** UUID of the Linear "In Review" workflow state. */
  inReviewStateId: string;
  /** Optional override for control-loop CLI path. */
  controlLoopCliPath: string;
  /** Repo root the dispatcher operates from. */
  repoRoot: string;
  /** Mode forwarded to control-loop. Defaults to `mock` for safety. */
  mode: 'mock' | 'plan' | 'live';
  /** Extra literal secret values to scrub from captured output. */
  extraSecrets: ReadonlyArray<string>;
  /** Subset of process.env to forward to the child. */
  childEnv: Record<string, string>;
}

export interface DispatcherDeps {
  linear: DispatcherLinearClient;
  spawn?: DispatcherSpawn;
  /**
   * LAT-138 worktree allocator. Required for live dispatches; tests
   * inject one with a fake git runner so two simulated invocations
   * can exercise distinct branches and scratch dirs without real git.
   */
  worktree: WorktreeAllocator;
  /** `now` injection for deterministic comment bodies in tests. */
  now?: () => Date;
}

export interface RunDispatcherInput {
  config: DispatcherConfig;
  deps: DispatcherDeps;
}

/**
 * Names of env vars whose *values* should be treated as secrets to
 * scrub from any output the dispatcher echoes. The dispatcher only
 * looks up these names; missing values are simply not added to the
 * scrub list.
 */
const SECRET_ENV_NAMES: ReadonlyArray<string> = [
  'LINEAR_API_KEY',
  'RUNPOD_API_KEY',
  'RUNPOD_VLLM_API_KEY',
  'AUTH_TOKEN',
  'GITHUB_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
];

export async function runDispatcher(input: RunDispatcherInput): Promise<DispatchReport> {
  const { config, deps } = input;
  const { worktree } = deps;

  if (!config.dispatchIssueId) {
    return makeReport({
      outcome: 'no_eligible_issue',
      message:
        'No eligible issue: LAT_DISPATCH_ISSUE is unset (label-driven polling is a documented follow-up).',
    });
  }

  // LAT-138: refuse a concurrent re-dispatch of the same ticket in the
  // same process. The reservation is cleared in the finally block
  // below so a successful or failed run frees the slot for the next
  // invocation.
  if (!worktree.tryReserve(config.dispatchIssueId)) {
    return makeReport({
      outcome: 'duplicate_in_flight',
      issueIdentifier: config.dispatchIssueId,
      message: `Refused: ${config.dispatchIssueId} is already in flight in this process.`,
    });
  }

  try {
    return await runDispatcherInner({ config, deps });
  } finally {
    worktree.release(config.dispatchIssueId);
  }
}

async function runDispatcherInner(input: RunDispatcherInput): Promise<DispatchReport> {
  const { config, deps } = input;
  const { linear, worktree } = deps;
  // dispatchIssueId was checked non-null in `runDispatcher`.
  const dispatchIssueId = config.dispatchIssueId as string;

  let issue;
  try {
    issue = await linear.readIssue(dispatchIssueId);
  } catch (err) {
    return makeReport({
      outcome: err instanceof DispatcherLinearError ? 'refused' : 'failed',
      issueIdentifier: dispatchIssueId,
      message: `Failed to read Linear issue: ${shortMessage(err, config.extraSecrets)}`,
    });
  }

  const elig = evaluateEligibility(issue, { explicitOverride: true });
  if (!elig.eligible) {
    return makeReport({
      outcome: 'no_eligible_issue',
      issueIdentifier: issue.identifier,
      message: `Skipped ${issue.identifier}: ${elig.reason}`,
    });
  }

  // LAT-138: allocate a per-invocation git worktree + scratch dir.
  // The pack, logs, and any control-loop evidence go in the
  // invocation dir; the control loop runs with cwd = worktree path so
  // it never mutates the operator's main checkout.
  let allocation: WorktreeAllocation;
  try {
    allocation = await worktree.allocate(issue.identifier);
  } catch (err) {
    return makeReport({
      outcome: 'failed',
      issueIdentifier: issue.identifier,
      message: `Failed to allocate worktree: ${shortMessage(err, config.extraSecrets)}`,
    });
  }

  try {
    const pack = buildTicketPack({ issue });
    await mkdir(allocation.invocationDir, { recursive: true });
    const packPath = join(allocation.invocationDir, pack.filename);
    await writeFile(packPath, pack.content, 'utf8');

    // Forward the invocation's worktree to the control loop as the
    // operator workdir. The live opencode adapter reads
    // CONTROL_LOOP_WORKDIR; mock/plan modes ignore it.
    const childEnv: Record<string, string> = {
      ...config.childEnv,
      CONTROL_LOOP_WORKDIR: allocation.worktreePath,
    };

    const runOpts: RunControlLoopOptions = {
      cliPath: config.controlLoopCliPath,
      packPath,
      mode: config.mode,
      cwd: allocation.worktreePath,
      env: childEnv,
      extraSecrets: config.extraSecrets,
      ...(deps.spawn ? { spawn: deps.spawn } : {}),
    };

    const startedAt = (deps.now ?? (() => new Date()))();
    const invocationId = `run_${randomUUID()}`;

    let runResult;
    try {
      runResult = await runControlLoopCli(runOpts);
    } catch (err) {
      const endedAt = (deps.now ?? (() => new Date()))();
      const artefact = buildRunArtefact({
        invocation_id: invocationId,
        surface: 'dispatcher',
        producer: 'lat129-dispatcher',
        outcome: 'failed',
        started_at: startedAt,
        ended_at: endedAt,
        ticket_id: issue.identifier,
        pack_path: packPath,
        pack_content: pack.content,
        refusal_code: 'control_loop_invocation_error',
        refusal_message: shortMessage(err, config.extraSecrets),
        extra_secrets: config.extraSecrets,
      });
      const artefactPath = await writeArtefact(allocation.invocationDir, invocationId, artefact);
      // LAT-184: also write a run-record sub-issue for failed invocations.
      try {
        const { title, description } = buildRunRecord(artefact);
        await linear.createRunRecord({
          title,
          description,
          parentId: issue.identifier,
        });
      } catch {
        // Best-effort; artefact file remains traceable.
      }
      return makeReport({
        outcome: 'failed',
        issueIdentifier: issue.identifier,
        packPath,
        artefactPath,
        artefact,
        worktreeBranch: allocation.branch,
        worktreePath: allocation.worktreePath,
        message: `Control loop invocation errored before exit: ${shortMessage(err, config.extraSecrets)}`,
      });
    }

    const summaryState = runResult.jsonSummary?.evidence?.state ?? null;
    const mappedOutcome = mapStateToOutcome(summaryState, runResult.exitCode);

    // LAT-143: a `ready_for_review` run is only actionable when it produced
    // something a reviewer can look at — a branch, a PR, a patch artifact,
    // or an explicit local diff path. Without one of those, promotion to
    // In Review would create a Linear issue that points at nothing, so we
    // downgrade the outcome to `no_review_artifact` and refuse to promote.
    // Regression coverage for the LAT-127 ready-with-no-branch/PR shape.
    const reviewArtifact: ReviewArtifact | null =
      mappedOutcome === 'ready_for_review' ? extractReviewArtifact(runResult.jsonSummary) : null;
    const outcome: DispatchOutcome =
      mappedOutcome === 'ready_for_review' && reviewArtifact === null
        ? 'no_review_artifact'
        : mappedOutcome;
    const endedAt = (deps.now ?? (() => new Date()))();

    const artefact = buildRunArtefact({
      invocation_id: invocationId,
      surface: 'dispatcher',
      producer: 'lat129-dispatcher',
      outcome: outcomeToArtefactOutcome(outcome),
      started_at: startedAt,
      ended_at: endedAt,
      ticket_id: issue.identifier,
      pack_path: packPath,
      pack_content: pack.content,
      refusal_code: refusalCodeForOutcome(outcome, runResult),
      refusal_message: refusalMessageForOutcome(outcome, runResult),
      raw_stdout: runResult.stdout,
      raw_stderr: runResult.stderr,
      log_stdout_redacted: runResult.stdout,
      extra_secrets: config.extraSecrets,
    });
    const artefactPath = await writeArtefact(allocation.invocationDir, invocationId, artefact);

    // LAT-184: write evidence to Linear as a queryable run-record sub-issue.
    let runRecordUrl: string | null = null;
    let runRecordCreated = false;
    try {
      const { title, description } = buildRunRecord(artefact);
      const created = await linear.createRunRecord({
        title,
        description,
        parentId: issue.identifier,
      });
      runRecordUrl = created.url;
      runRecordCreated = true;
    } catch (err) {
      // Best-effort: a failed run-record creation does not break dispatch.
      // The artefact file and comment remain available for traceability.
    }

    const commentBody = buildCommentBody({
      issueIdentifier: issue.identifier,
      packPath,
      runResult,
      outcome,
      mode: config.mode,
      reviewArtifact,
      now: deps.now ?? (() => new Date()),
      artefact,
      artefactPath,
      worktreeBranch: allocation.branch,
    });

    let commented = false;
    try {
      await linear.postComment(issue.uuid, commentBody);
      commented = true;
    } catch (err) {
      return makeReport({
        outcome,
        issueIdentifier: issue.identifier,
        packPath,
        artefactPath,
        artefact,
        controlLoopExitCode: runResult.exitCode,
        worktreeBranch: allocation.branch,
        worktreePath: allocation.worktreePath,
        message: `Run terminated as ${outcome}; failed to post Linear comment: ${shortMessage(err, config.extraSecrets)}`,
      });
    }

    let promoted = false;
    if (outcome === 'ready_for_review') {
      try {
        await linear.setIssueState(issue.uuid, config.inReviewStateId);
        promoted = true;
      } catch (err) {
        return makeReport({
          outcome,
          issueIdentifier: issue.identifier,
          packPath,
          artefactPath,
          artefact,
          controlLoopExitCode: runResult.exitCode,
          commented,
          promoted: false,
          worktreeBranch: allocation.branch,
          worktreePath: allocation.worktreePath,
          message: `READY_FOR_REVIEW achieved; failed to promote issue: ${shortMessage(err, config.extraSecrets)}`,
        });
      }
    }

    return makeReport({
      outcome,
      issueIdentifier: issue.identifier,
      packPath,
      artefactPath,
      artefact,
      controlLoopExitCode: runResult.exitCode,
      commented,
      promoted,
      worktreeBranch: allocation.branch,
      worktreePath: allocation.worktreePath,
      message:
        outcome === 'ready_for_review'
          ? `Promoted ${issue.identifier} to In Review (${describeArtifact(reviewArtifact)}).`
          : outcome === 'no_review_artifact'
            ? `Control loop reported READY_FOR_REVIEW but produced no actionable review artifact (no branch, PR, patch, or diff path); ${issue.identifier} left unpromoted.`
            : `Run terminated as ${outcome}; issue left unpromoted.`,
    });
  } finally {
    // LAT-138: best-effort cleanup. We swallow cleanup errors; the
    // worktree path is in the report so the operator can still
    // inspect it if anything is left behind.
    try {
      await worktree.cleanup(allocation);
    } catch {
      // intentionally ignored
    }
  }
}

async function writeArtefact(
  dir: string,
  invocationId: string,
  artefact: RunArtefact,
): Promise<string> {
  const path = join(dir, `${invocationId}.artefact.json`);
  await writeFile(path, renderRunArtefactJson(artefact), 'utf8');
  return path;
}

function outcomeToArtefactOutcome(o: DispatchOutcome): RunArtefactOutcome {
  switch (o) {
    case 'ready_for_review':
      return 'ready_for_review';
    case 'checks_failed':
      return 'checks_failed';
    case 'failed':
      return 'failed';
    case 'refused':
      return 'refused';
    case 'planned':
      return 'planned';
    case 'no_eligible_issue':
      return 'no_eligible_issue';
    case 'config_error':
      return 'config_error';
    case 'no_review_artifact':
      // LAT-143: treat non-actionable ready_for_review as a failure for
      // observability — the producer reported success but the run has no
      // reviewable output.
      return 'failed';
    case 'duplicate_in_flight':
      return 'refused';
  }
}

function refusalCodeForOutcome(
  outcome: DispatchOutcome,
  runResult: { jsonSummary: { evidence: { refusals?: ReadonlyArray<{ code: string }> } } | null },
): string | null {
  if (outcome === 'ready_for_review' || outcome === 'planned') return null;
  if (outcome === 'no_review_artifact') return 'no_review_artifact';
  const refusal = runResult.jsonSummary?.evidence?.refusals?.[0];
  if (refusal && typeof refusal.code === 'string') return refusal.code;
  if (outcome === 'refused') return 'control_loop_refused';
  if (outcome === 'checks_failed') return 'control_loop_checks_failed';
  if (outcome === 'failed') return 'control_loop_failed';
  return null;
}

function refusalMessageForOutcome(
  outcome: DispatchOutcome,
  runResult: {
    jsonSummary: {
      evidence: { refusals?: ReadonlyArray<{ code: string; message: string }> };
    } | null;
    exitCode: number;
  },
): string {
  if (outcome === 'ready_for_review' || outcome === 'planned') return '';
  if (outcome === 'no_review_artifact') {
    return 'control loop reported ready_for_review but produced no actionable review artifact (no branch, PR, patch, or diff path)';
  }
  const refusal = runResult.jsonSummary?.evidence?.refusals?.[0];
  if (refusal && typeof refusal.message === 'string') return refusal.message;
  return `control-loop exit ${runResult.exitCode}`;
}

/**
 * Resolve dispatcher config from a typed env snapshot. The CLI is the
 * single caller of process.env; tests build an explicit env object.
 */
export function resolveDispatcherConfig(
  env: Readonly<Record<string, string | undefined>>,
  defaults: { repoRoot: string; controlLoopCliPath: string },
): { ok: true; config: DispatcherConfig } | { ok: false; missing: string[]; message: string } {
  const missing: string[] = [];
  const linearApiKey = env['LINEAR_API_KEY'];
  if (!linearApiKey) missing.push('LINEAR_API_KEY');

  const inReviewStateId =
    env['LAT_LINEAR_IN_REVIEW_STATE_ID'] ?? '616670f8-b117-48a4-8210-2dd6574260a9';

  const dispatchIssueId = env['LAT_DISPATCH_ISSUE'] ?? null;

  const modeRaw = (env['LAT_DISPATCH_MODE'] ?? 'mock').toLowerCase();
  const mode: 'mock' | 'plan' | 'live' =
    modeRaw === 'plan' ? 'plan' : modeRaw === 'live' ? 'live' : 'mock';

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message: `Missing required env: ${missing.join(', ')}.`,
    };
  }

  const extraSecrets: string[] = [];
  for (const name of SECRET_ENV_NAMES) {
    const v = env[name];
    if (typeof v === 'string' && v.length > 0) extraSecrets.push(v);
  }

  // Forward only the env entries the control loop legitimately needs.
  // Notably we do NOT forward LINEAR_API_KEY: the control loop never
  // talks to Linear directly and forwarding it would broaden the secret's
  // exposure.
  const childEnv: Record<string, string> = {};
  const FORWARD: ReadonlyArray<string> = [
    'PATH',
    'HOME',
    'NODE_OPTIONS',
    'CONTROL_LOOP_LIVE_ENABLED',
    'CONTROL_LOOP_PROVIDER',
    'CONTROL_LOOP_WORKDIR',
    'CONTROL_LOOP_OPENCODE_BIN',
    'CONTROL_LOOP_OPENCODE_MODEL',
    'CONTROL_LOOP_TIMEOUT_MS',
    'RUNPOD_API_KEY',
    'RUNPOD_POD_ID',
    'RUNPOD_VLLM_API_KEY',
  ];
  for (const k of FORWARD) {
    const v = env[k];
    if (typeof v === 'string') childEnv[k] = v;
  }

  return {
    ok: true,
    config: {
      linearApiKey: linearApiKey as string,
      dispatchIssueId,
      inReviewStateId,
      controlLoopCliPath: defaults.controlLoopCliPath,
      repoRoot: defaults.repoRoot,
      mode,
      extraSecrets,
      childEnv,
    },
  };
}

/**
 * Best-effort probe for the built control-loop CLI. The dispatcher
 * refuses (rather than rebuilding) when the dist bundle is missing so a
 * human notices the broken build before any Linear write-back happens.
 */
export async function ensureControlLoopBuilt(cliPath: string): Promise<boolean> {
  try {
    const data = await readFile(cliPath, 'utf8');
    return data.length > 0;
  } catch {
    return false;
  }
}

export function defaultControlLoopCliPath(repoRoot: string): string {
  return resolve(repoRoot, 'packages/control-loop/dist/cli.js');
}

export function defaultRepoRoot(fromUrl: string): string {
  // packages/icp/src/dispatcher/dispatch.ts → repo root is four levels up.
  const here = fileURLToPath(fromUrl);
  return resolve(dirname(here), '..', '..', '..', '..');
}

interface MakeReportInput {
  outcome: DispatchOutcome;
  issueIdentifier?: string | null;
  packPath?: string | null;
  artefactPath?: string | null;
  artefact?: RunArtefact | null;
  controlLoopExitCode?: number | null;
  commented?: boolean;
  promoted?: boolean;
  worktreeBranch?: string | null;
  worktreePath?: string | null;
  message: string;
}

function makeReport(input: MakeReportInput): DispatchReport {
  return {
    outcome: input.outcome,
    issueIdentifier: input.issueIdentifier ?? null,
    promoted: input.promoted ?? false,
    commented: input.commented ?? false,
    packPath: input.packPath ?? null,
    artefactPath: input.artefactPath ?? null,
    artefact: input.artefact ?? null,
    controlLoopExitCode: input.controlLoopExitCode ?? null,
    worktreeBranch: input.worktreeBranch ?? null,
    worktreePath: input.worktreePath ?? null,
    message: input.message,
  };
}

function mapStateToOutcome(state: string | null, exitCode: number): DispatchOutcome {
  if (state === 'ready_for_review') return 'ready_for_review';
  if (state === 'checks_failed') return 'checks_failed';
  if (state === 'failed') return 'failed';
  if (state === 'refused') return 'refused';
  if (state === 'planned') return 'planned';
  // No JSON summary or unknown state: project the exit code.
  if (exitCode === 0) return 'ready_for_review';
  if (exitCode === 2) return 'refused';
  return 'failed';
}

/**
 * LAT-143: pick the most reviewer-actionable artifact available, in
 * priority order. A non-empty PR URL is the strongest signal; otherwise
 * a branch ref is enough; otherwise an explicit patch / diff path. If
 * all are empty / null / whitespace the run has no review target.
 */
export function extractReviewArtifact(
  summary: ControlLoopJsonSummary | null,
): ReviewArtifact | null {
  const branch = summary?.evidence?.branch ?? null;
  if (branch === null || typeof branch !== 'object') return null;
  const prUrl = nonEmpty(branch.prUrl);
  const branchRef = nonEmpty(branch.branch);
  const patchPath = nonEmpty(branch.patchPath);
  const diffPath = nonEmpty(branch.diffPath);
  if (prUrl !== null && branchRef !== null) {
    return { kind: 'branch', ref: branchRef, prUrl };
  }
  if (prUrl !== null) return { kind: 'pr', prUrl };
  if (branchRef !== null) return { kind: 'branch', ref: branchRef, prUrl: null };
  if (patchPath !== null) return { kind: 'patch', path: patchPath };
  if (diffPath !== null) return { kind: 'diff', path: diffPath };
  return null;
}

function nonEmpty(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function describeArtifact(a: ReviewArtifact | null): string {
  if (a === null) return 'none (no branch, PR, patch, or diff path)';
  switch (a.kind) {
    case 'branch':
      return a.prUrl !== null
        ? `branch \`${a.ref}\` (PR ${a.prUrl})`
        : `branch \`${a.ref}\` (no PR)`;
    case 'pr':
      return `PR ${a.prUrl}`;
    case 'patch':
      return `patch artifact at \`${a.path}\``;
    case 'diff':
      return `local diff path \`${a.path}\``;
  }
}

function buildCommentBody(input: {
  issueIdentifier: string;
  packPath: string;
  runResult: { exitCode: number; stdout: string; stderr: string };
  outcome: DispatchOutcome;
  mode: string;
  reviewArtifact: ReviewArtifact | null;
  now: () => Date;
  artefact: RunArtefact;
  artefactPath: string;
  worktreeBranch?: string;
}): string {
  const { issueIdentifier, packPath, runResult, outcome, mode, reviewArtifact } = input;
  const ts = input.now().toISOString();
  const lines: string[] = [];
  lines.push(`### LAT-129 dispatcher run`);
  lines.push('');
  lines.push(`- **Issue:** ${issueIdentifier}`);
  lines.push(`- **Outcome:** ${outcome}`);
  lines.push(`- **Mode:** ${mode}`);
  lines.push(`- **Control-loop exit code:** ${runResult.exitCode}`);
  lines.push(`- **Pack:** \`${packPath}\` (local; not checked in)`);
  lines.push(`- **Review target:** ${describeArtifact(reviewArtifact)}`);
  if (input.worktreeBranch) {
    lines.push(
      `- **Worktree branch:** \`${input.worktreeBranch}\` (LAT-138 sandbox; cleaned up after run)`,
    );
  }
  lines.push(`- **Timestamp:** ${ts}`);
  lines.push(
    `- **Artefact (LAT-140):** ${formatArtefactCompactRef({ artefact: input.artefact, artefactPath: input.artefactPath })}`,
  );
  lines.push('');
  if (outcome === 'no_review_artifact') {
    lines.push(
      '> LAT-143: control loop reported `ready_for_review` but produced no' +
        ' branch, PR, patch artifact, or explicit local diff path. The' +
        ' dispatcher refused to promote this issue because there is' +
        ' nothing for a reviewer to look at.',
    );
    lines.push('');
  }
  lines.push('#### Control-loop stdout (sanitised)');
  lines.push('');
  lines.push('```');
  lines.push(truncate(runResult.stdout, 6000));
  lines.push('```');
  if (runResult.stderr.trim().length > 0) {
    lines.push('');
    lines.push('#### Control-loop stderr (sanitised)');
    lines.push('');
    lines.push('```');
    lines.push(truncate(runResult.stderr, 2000));
    lines.push('```');
  }
  lines.push('');
  lines.push(
    '_Posted by `@latentspacelabs/icp` LAT-129 dispatcher. No auto-merge. No deploy. Sanitised; secrets and endpoint URLs redacted._',
  );
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '\n[…truncated by dispatcher…]';
}

function shortMessage(err: unknown, extraSecrets: ReadonlyArray<string>): string {
  const raw = err instanceof Error ? err.message : String(err ?? 'unknown error');
  return redactOutput(raw, { extraSecrets });
}

/**
 * Convenience: build a real Linear client + run the dispatcher with
 * env-resolved config. Used by the CLI; tests bypass this and inject
 * their own client.
 */
export async function runDispatcherFromEnv(input: {
  env: Readonly<Record<string, string | undefined>>;
  repoRoot: string;
  controlLoopCliPath: string;
}): Promise<DispatchReport> {
  const resolved = resolveDispatcherConfig(input.env, {
    repoRoot: input.repoRoot,
    controlLoopCliPath: input.controlLoopCliPath,
  });
  if (!resolved.ok) {
    return makeReport({ outcome: 'config_error', message: resolved.message });
  }
  const built = await ensureControlLoopBuilt(input.controlLoopCliPath);
  if (!built) {
    return makeReport({
      outcome: 'config_error',
      message: `Control-loop CLI not built at ${input.controlLoopCliPath}. Run \`npm run build\` first.`,
    });
  }
  const client = createDispatcherLinearClient({ apiKey: resolved.config.linearApiKey });
  const worktree = new WorktreeAllocator({ repoRoot: resolved.config.repoRoot });
  return runDispatcher({
    config: resolved.config,
    deps: { linear: client, worktree },
  });
}
