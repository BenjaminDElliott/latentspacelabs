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

/** Eligibility outcome for one Linear issue against the MVP rules. */
export type EligibilityOutcome =
  | { eligible: true; reason: string }
  | { eligible: false; reason: string };

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
}

/** Final terminal outcome of a dispatcher invocation. */
export type DispatchOutcome =
  | "no_eligible_issue"
  | "ready_for_review"
  | "checks_failed"
  | "failed"
  | "refused"
  | "planned"
  | "config_error";

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
  /** Exit code of the control-loop child process when invoked, else null. */
  controlLoopExitCode: number | null;
  /** One-line, secret-safe explanation suitable for stdout / Linear. */
  message: string;
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
  };
}

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
