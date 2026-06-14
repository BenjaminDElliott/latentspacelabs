/**
 * Types for the LAT-129 polling dispatcher MVP.
 *
 * The dispatcher is the first ICP-owned harness that closes the loop from
 * "agent-ready Linear ticket" to "control-loop run with sanitised evidence
 * back on the Linear issue." It deliberately does *one* thing per
 * invocation: select one ticket, generate one bounded pack, invoke the
 * existing control loop once, write back evidence, and (only on
 * READY_FOR_REVIEW) move the issue to In Review.
 *
 * Pure types — no I/O. Network and process I/O live behind seam interfaces
 * implemented in sibling modules so the orchestration is fully testable
 * without real Linear or RunPod credentials (LAT-129 acceptance: CI must
 * not require real Linear/RunPod/opencode credentials).
 */

import type { RunArtefact } from "../observability/run-artifact.js";

/** Eligibility outcome for one Linear issue against the MVP rules. */
export type EligibilityOutcome =
  | { eligible: true; reason: string }
  | { eligible: false; reason: string };

/**
 * LAT-134: parsed complexity tag extracted from the issue's Linear labels.
 * `unknown` is the default when no `complexity/*` label is present — the
 * dispatcher must not silently dispatch to local agents when this is
 * `unknown` unless the explicit-override gate is also active (LAT-129
 * MVP gate).
 */
export type ComplexityTag = "small" | "medium" | "large" | "unknown";

/**
 * LAT-134: parsed reasoning tag extracted from the issue's Linear labels.
 * `unknown` is the default when no `reasoning/*` label is present. The
 * routing policy maps:
 *  - `implementation` → local/RunPod implementation lane
 *  - `synthesis`      → frontier reasoning or human review
 *  - `architecture`   → frontier reasoning or human review
 *  - `unknown`        → requires human approval; do not silently dispatch
 */
export type ReasoningTag = "implementation" | "synthesis" | "architecture" | "unknown";

/** Linear issue fields the dispatcher reads. */
export interface DispatchIssue {
  /** Linear identifier in human form, e.g. `LAT-126`. */
  identifier: string;
  /** Internal Linear UUID; required for state transitions and comments. */
  uuid: string;
  title: string;
  description: string;
  /** Current workflow state name, e.g. `Backlog`, `In Progress`. */
  stateName: string;
  /** Current workflow state UUID, useful when promoting. */
  stateId: string;
  /** Label names attached to this issue; lowercased by the client. */
  labels: ReadonlyArray<string>;
  /**
   * LAT-134: parsed complexity tag from Linear labels (e.g. `complexity/small`).
   * `unknown` when no `complexity/*` label is present.
   */
  complexityTag: ComplexityTag;
  /**
   * LAT-134: parsed reasoning tag from Linear labels (e.g. `reasoning/implementation`).
   * `unknown` when no `reasoning/*` label is present.
   */
  reasoningTag: ReasoningTag;
}

/** Final terminal outcome of a dispatcher invocation. */
export type DispatchOutcome =
  | "no_eligible_issue"
  | "ready_for_review"
  | "checks_failed"
  | "failed"
  | "refused"
  | "planned"
  | "config_error"
  /**
   * LAT-143: control-loop reported `ready_for_review` but the run produced
   * no actionable review artifact (no branch, no PR, no patch path, no
   * explicit local diff path). The dispatcher refuses to promote such
   * runs because there is nothing for a reviewer to look at.
   */
  | "no_review_artifact"
  /** LAT-138: same ticket already in flight in this process. */
  | "duplicate_in_flight";

/** Sanitised summary the dispatcher prints / persists. */
export interface DispatchReport {
  outcome: DispatchOutcome;
  /** Linear issue identifier (LAT-NN) or null when no issue was selected. */
  issueIdentifier: string | null;
  /** Whether the Linear issue was promoted to In Review. */
  promoted: boolean;
  /** Whether a Linear comment was posted. */
  commented: boolean;
  /** Path to the generated ticket pack on disk, when one was generated. */
  packPath: string | null;
  /**
   * LAT-140: path to the sanitised structured run artefact JSON the
   * dispatcher emitted, when one was emitted (any outcome where a pack
   * was generated). `null` for early aborts (no eligible issue, config
   * error before any work was done).
   */
  artefactPath: string | null;
  /**
   * LAT-140: the in-memory structured run artefact, when one was built.
   * Carries sanitised fields only; never raw stdout/stderr. Useful for
   * tests asserting on the emission shape without reading the JSON.
   */
  artefact: RunArtefact | null;
  /** Exit code of the control-loop child process when invoked, else null. */
  controlLoopExitCode: number | null;
  /** One-line, secret-safe explanation suitable for stdout / Linear. */
  message: string;
  /**
   * LAT-138: worktree branch this run was sandboxed in, when one was
   * allocated. `null` when no worktree was allocated (e.g. config
   * errors that abort before ticket selection).
   */
  worktreeBranch?: string | null;
  /** LAT-138: absolute path to the worktree directory, when allocated. */
  worktreePath?: string | null;
}

/** Result of running the control loop child process. */
export interface ControlLoopRunResult {
  exitCode: number;
  /** Already redacted. */
  stdout: string;
  /** Already redacted. */
  stderr: string;
  /** Resolved control-loop --format=json output if it parsed, else null. */
  jsonSummary: ControlLoopJsonSummary | null;
}

/**
 * Subset of the control-loop JSON summary the dispatcher relies on.
 *
 * The full schema lives in `@latentspacelabs/control-loop` (`RunSummary`).
 * The dispatcher uses an intentionally narrow view so a backwards-
 * compatible schema bump there does not silently change behaviour here.
 */
export interface ControlLoopJsonSummary {
  schemaVersion: string;
  evidence: {
    state: string;
    ticket?: string;
    mode?: string;
    refusals?: ReadonlyArray<{ code: string; message: string }>;
    /**
     * Branch / PR evidence. The dispatcher reads this to decide whether a
     * `ready_for_review` run actually has something a reviewer can look
     * at (LAT-143). Mirrors `BranchEvidence` from
     * `@latentspacelabs/control-loop`; redeclared narrowly here so a
     * forward-compatible schema bump there does not silently change
     * dispatcher behaviour.
     */
    branch?: {
      branch?: string | null;
      prUrl?: string | null;
      /** Optional path to a patch file the adapter wrote. */
      patchPath?: string | null;
      /** Optional explicit local diff path the adapter recorded. */
      diffPath?: string | null;
    } | null;
  };
}

/**
 * LAT-143: shape of the actionable review artifact found on a
 * `ready_for_review` run. At least one of these fields must be populated
 * for the dispatcher to promote the issue. The kind tag tells reviewers
 * exactly where to look.
 */
export type ReviewArtifact =
  | { kind: "branch"; ref: string; prUrl: string | null }
  | { kind: "pr"; prUrl: string }
  | { kind: "patch"; path: string }
  | { kind: "diff"; path: string };

/**
 * Linear client surface the dispatcher uses. Implemented for real by the
 * sibling `linear-client.ts`; tests inject an in-memory fake.
 */
export interface DispatcherLinearClient {
  readIssue(identifier: string): Promise<DispatchIssue>;
  postComment(uuid: string, body: string): Promise<{ url: string }>;
  /**
   * Move the issue to the workflow state with the given UUID. The In Review
   * state UUID is supplied by the caller via configuration so the
   * dispatcher never hard-codes Linear UUIDs in its source.
   */
  setIssueState(uuid: string, stateId: string): Promise<void>;
  /**
   * Create a run-record sub-issue under the parent issue. The title and
   * description carry the full structured run evidence. The sub-issue is
   * queryable in Linear (filter by parent, by label, by state).
   */
  createRunRecord(issue: import("./linear-client.js").RunRecordIssue): Promise<{ id: string; url: string }>;
}

/** Spawn surface the dispatcher uses to run the control-loop CLI. */
export type DispatcherSpawn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd?: string; env?: Record<string, string> },
) => DispatcherSpawnedProcess;

export interface DispatcherSpawnedProcess {
  readonly stdout: { on(event: "data", cb: (chunk: Buffer | string) => void): void };
  readonly stderr: { on(event: "data", cb: (chunk: Buffer | string) => void): void };
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "close", cb: (code: number | null) => void): void;
  kill(signal?: NodeJS.Signals | number): boolean;
}
