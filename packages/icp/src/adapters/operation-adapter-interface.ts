/**
 * Adapter interface specification (ADR-0022).
 *
 * A language-agnostic, type-safe interface for the full lifecycle of an async
 * operation produced by any ICP tool adapter (agent runner, Linear client,
 * code reviewer, cost estimator, etc.).
 *
 * Languages implement this as:
 * - TypeScript: exported interfaces + enums in this file.
 * - Python: `TypedDict` / `dataclass` stubs in `packages/icp/src/adapters/`
 *   matching the same field names and enum values.
 * - Other: analogous type definitions in the target language.
 *
 * Methods: init, invoke, getStatus, pollForResult, cancel, dispose.
 *
 * LAT-170: Task 1 — Draft adapter interface specification.
 */

/* ------------------------------------------------------------------ */
/* Core enums                                                          */
/* ------------------------------------------------------------------ */

/**
 * Terminal and non-terminal states for an operation.
 *
 * This is a closed enum: any switch / match on OperationState must handle
 * every member.  Additions are non-breaking only when callers check for
 * known states and fall through to a default.
 */
export type OperationState =
  | "unknown"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout";

/* ------------------------------------------------------------------ */
/* OperationError — discriminated union                                */
/* ------------------------------------------------------------------ */

/**
 * Machine-readable error categories.  New kinds may be added by follow-up
 * tickets; existing callers must handle unknown kinds gracefully (e.g. by
 * falling through to a default case in a switch).
 */
export type OperationErrorCode =
  | "not_found"
  | "timeout"
  | "cancelled"
  | "failed"
  | "disconnected"
  | "unknown";

/**
 * An error returned by an operation.  Secret-safe by contract: no field
 * contains raw API keys, tokens, or credential values.
 */
export interface OperationError {
  /** Machine-readable error category. */
  kind: OperationErrorCode;
  /** Human-readable, secret-safe description. */
  message: string;
  /** Optional machine-readable error code (e.g. "HTTP_429"). */
  code?: string;
  /** Optional structured details; never contains secrets. */
  details?: unknown;
}

/* ------------------------------------------------------------------ */
/* OperationHandle                                                     */
/* ------------------------------------------------------------------ */

/**
 * Opaque string handle returned by `invoke` and accepted by
 * `getStatus`, `pollForResult`, and `cancel`.  The adapter owns the
 * mapping from handle to internal operation state.
 */
export type OperationHandle = string;

/* ------------------------------------------------------------------ */
/* OperationInput — invocation payload                                 */
/* ------------------------------------------------------------------ */

/**
 * Data required to submit an operation.
 *
 * - `operation_id` is an idempotency key chosen by the caller; invoking with
 *   the same ID returns the existing handle instead of creating a duplicate.
 * - `operation_type` is a semantic tag (e.g. `"agent_invoke"`, `"pr_review"`)
 *   that the adapter may use for routing or logging.
 * - `payload` carries operation-specific data; its shape is defined by the
 *   caller, not by this interface.
 * - `metadata` is optional free-form string-keyed tags (e.g. tracing IDs,
 *   caller identifiers).
 */
export interface OperationInput {
  operation_id: string;
  operation_type: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* OperationStatus — current state snapshot                            */
/* ------------------------------------------------------------------ */

/**
 * Non-blocking snapshot of an operation's current state.
 *
 * `started_at` and `completed_at` are ISO-8601 strings when available,
 * or `null` when the timestamp has not been recorded yet.
 */
export interface OperationStatus {
  handle: OperationHandle;
  state: OperationState;
  started_at: string | null;
  completed_at: string | null;
  /** Present when `state` is `failed`, `cancelled`, or `timeout`. */
  error?: OperationError;
}

/* ------------------------------------------------------------------ */
/* OperationResult — final outcome                                     */
/* ------------------------------------------------------------------ */

/**
 * The result returned by `pollForResult` (or by a synchronous invoke).
 *
 * `state` is always terminal.  Either `data` (success) or `error`
 * (failure) is present — never both.
 */
export interface OperationResult {
  handle: OperationHandle;
  /** Always a terminal state. */
  state: OperationState;
  /** Operation-specific success data; absent when `state !== "succeeded"`. */
  data?: Record<string, unknown>;
  /** Present when `state` is `failed`, `cancelled`, or `timeout`. */
  error?: OperationError;
  /** Wall-clock duration from invoke to terminal state, in milliseconds. */
  duration_ms: number;
}

/* ------------------------------------------------------------------ */
/* OperationAdapter — the interface                                    */
/* ------------------------------------------------------------------ */

/**
 * The adapter interface (ADR-0022).  Every tool adapter implements these six
 * methods to expose a uniform async-operation lifecycle.
 *
 * Implementations:
 * - TypeScript: implement this interface directly.
 * - Python: define the matching `TypedDict` / `dataclass` types and a base
 *   class or ABC with the same method signatures.
 * - Other languages: analogous type definitions and an interface/protocol.
 *
 * Lifecycle invariants:
 * 1. `init` must be called before any other method.
 * 2. `invoke` may be called multiple times with the same `operation_id` to
 *    produce idempotent results.
 * 3. `pollForResult` is idempotent — calling it twice on the same handle
 *    returns the same result if the operation has already completed.
 * 4. `cancel` is a best-effort request; the caller must check status to
 *    confirm cancellation.
 * 5. `dispose` releases all resources; the adapter is unusable afterwards.
 */
export interface OperationAdapter {
  /**
   * Initialise the adapter with configuration.  Called once before any other
   * method.  Idempotent: calling twice with the same config is a no-op.
   *
   * @param config — flat key-value map of configuration.  Keys are strings;
   *   values are strings, numbers, booleans, or null.
   * @throws on fatal configuration errors (missing API key, unreachable
   *   endpoint, etc.).
   */
  init(config: Record<string, unknown>): void;

  /**
   * Submit an operation and return an opaque handle immediately.
   *
   * @param input — invocation payload with operation_id, operation_type,
   *   payload, and optional metadata.
   * @returns an OperationHandle that can be passed to getStatus,
   *   pollForResult, and cancel.
   * @throws if the adapter has not been initialised.
   * @throws on fatal errors (e.g. internal state corruption).
   */
  invoke(input: OperationInput): OperationHandle;

  /**
   * Check the current state of an operation without blocking.
   *
   * @param handle — the operation handle returned by invoke.
   * @returns the latest known status, or an `unknown` status if the handle
   *   is not recognised.
   */
  getStatus(handle: OperationHandle): OperationStatus;

  /**
   * Block until the operation reaches a terminal state, then return the
   * result.  If timeoutMs is provided and the operation has not completed,
   * returns a result with state === "timeout".
   *
   * @param handle — the operation handle.
   * @param timeoutMs — optional maximum wait time in milliseconds.  If
   *   omitted, the adapter uses its configured default or blocks
   *   indefinitely.
   * @returns the operation result when the operation completes.
   * @throws if the adapter becomes disconnected or encounters a fatal error.
   */
  pollForResult(handle: OperationHandle, timeoutMs?: number): OperationResult;

  /**
   * Request cancellation of a running operation.  A no-op if the operation
   * is already terminal.
   *
   * @param handle — the operation handle.
   */
  cancel(handle: OperationHandle): void;

  /**
   * Release all resources held by the adapter.  The adapter must not be
   * used after dispose (except init, which re-initialises).
   *
   * Idempotent: calling dispose twice is safe.
   */
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Error constructors                                                  */
/* ------------------------------------------------------------------ */

/**
 * Build a typed OperationError from a kind and message.
 *
 * Utility for adapters that construct errors internally; ensures consistent
 * shape across implementations.
 */
export function createOperationError(
  kind: OperationErrorCode,
  message: string,
  opts?: { code?: string; details?: unknown },
): OperationError {
  const r: OperationError = { kind, message };
  const code = opts?.code;
  const details = opts?.details;
  if (code !== undefined) r.code = code;
  if (details !== undefined) r.details = details;
  return r;
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

/**
 * Type guard: is this an OperationError?
 *
 * Useful for runtime validation in languages with soft typing (Python, JS).
 * In TypeScript, the static type is usually sufficient, but this helps with
 * JSON deserialisation or cross-language FFI boundaries.
 */
export function isOperationError(val: unknown): val is OperationError {
  return (
    typeof val === "object" &&
    val !== null &&
    "kind" in val &&
    "message" in val &&
    typeof (val as Record<string, unknown>).kind === "string" &&
    typeof (val as Record<string, unknown>).message === "string"
  );
}

/**
 * Type guard: is this a valid OperationState?
 */
export function isOperationState(val: unknown): val is OperationState {
  return (
    typeof val === "string" &&
    (val === "unknown" ||
      val === "running" ||
      val === "succeeded" ||
      val === "failed" ||
      val === "cancelled" ||
      val === "timeout")
  );
}

/**
 * Type guard: is this a terminal OperationState?
 */
export function isTerminalState(
  state: OperationState,
): state is Exclude<OperationState, "unknown" | "running"> {
  return state !== "unknown" && state !== "running";
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Format an OperationStatus as a human-readable string.
 *
 * Utility for logging and debugging.  Not part of the interface contract.
 */
export function formatStatus(status: OperationStatus): string {
  const parts: string[] = [
    `handle=${status.handle}`,
    `state=${status.state}`,
  ];
  if (status.started_at) parts.push(`started=${status.started_at}`);
  if (status.completed_at) parts.push(`completed=${status.completed_at}`);
  if (status.error) parts.push(`error=${status.error.kind}: ${status.error.message}`);
  return parts.join(", ");
}
