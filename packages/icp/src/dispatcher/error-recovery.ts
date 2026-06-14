/**
 * Error recovery engine for the cron job runner (LAT-322).
 *
 * Wraps retryable async functions with automatic retry and exponential
 * backoff for transient failures. Integrated into the dispatcher (the
 * cron job runner), not per-skill.
 *
 * Key design decisions:
 *   - Detects transient failures by examining error types, status codes,
 *     and message patterns — not by guessing.
 *   - Uses exponential backoff with configurable base/max delay and
 *     optional jitter to reduce thundering herd on rate-limited services.
 *   - Returns structured retry results so callers can distinguish
 *     transient failures from permanent ones.
 *   - Never sleeps during the first attempt; delays occur between retries.
 */

import type {
  ErrorRecoveryConfig,
  RetryableFn,
  RetryResult,
  TransientErrorInfo,
  TransientErrorKind,
} from "./types.js";
import { DispatcherLinearError } from "./linear-client.js";

// ─── Default configuration ────────────────────────────────────────────────

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_DELAY_MULTIPLIER = 1.0;
const DEFAULT_JITTER = true;

/** Build a config with explicit bounds. */
export function defaultErrorRecoveryConfig(): Required<ErrorRecoveryConfig> {
  return {
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    baseDelayMs: DEFAULT_BASE_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
    delayMultiplier: DEFAULT_DELAY_MULTIPLIER,
    jitter: DEFAULT_JITTER,
  };
}

// ─── Transient error detection ────────────────────────────────────────────

/**
 * Classify an error to determine if it is transient (retryable).
 *
 * A transient error is one that may resolve without intervention:
 *   - Network errors (connection refused, DNS failure, socket timeout)
 *   - Timeouts (the operation took too long, the server may recover)
 *   - Rate limits (HTTP 429, Linear rate limit messages)
 *   - Server errors (HTTP 5xx — the service may recover)
 *
 * Non-transient errors include:
 *   - 400 Bad Request, 401 Unauthorized, 403 Forbidden
 *   - 404 Not Found
 *   - Application errors (e.g. missing config, validation failures)
 *   - Structured errors from Linear (missing credentials, etc.)
 */
export function classifyError(
  err: unknown,
): TransientErrorInfo | null {
  // 1. Check for DispatcherLinearError with transient kinds.
  if (err instanceof DispatcherLinearError) {
    switch (err.kind) {
      case "network_error":
        return {
          kind: "network_error",
          message: err.message,
          httpStatus: err.status,
          retryAfterSeconds: null,
        };
      case "rate_limited":
        return {
          kind: "rate_limit",
          message: err.message,
          httpStatus: err.status,
          retryAfterSeconds: null,
        };
      case "api_error":
        if (err.status !== null && err.status >= 500 && err.status < 600) {
          return {
            kind: "server_error",
            message: err.message,
            httpStatus: err.status,
            retryAfterSeconds: null,
          };
        }
        // 4xx non-rate-limit: not transient.
        return null;
      case "missing_credentials":
      case "issue_not_found":
      case "unauthorized":
        return null; /* Permanent. */
    }
  }

  // 2. Check for generic Error with transient patterns.
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();

    // Network errors (various patterns).
    if (
      /network|socket|econnrefused|econnreset|enotfound|enotreach|etimedout|eai_again|connection refused|connection reset|connection timeout|dns|socket hang up|fetch failed/i.test(
        msg,
      )
    ) {
      return {
        kind: "network_error",
        message: err.message,
        httpStatus: null,
        retryAfterSeconds: null,
      };
    }

    // Timeout errors.
    if (
      /timeout|timed? ?out|deadline exceeded/i.test(msg)
    ) {
      return {
        kind: "timeout",
        message: err.message,
        httpStatus: null,
        retryAfterSeconds: null,
      };
    }

    // Rate limit patterns.
    if (
      /rate.?limit|too many requests|429/i.test(msg)
    ) {
      return {
        kind: "rate_limit",
        message: err.message,
        httpStatus: 429,
        retryAfterSeconds: null,
      };
    }

    // Generic server errors (5xx in message).
    if (/5\d{2}/.test(msg) && /server|status|http|error/i.test(msg)) {
      const match = msg.match(/5\d{2}/);
      const status = match ? parseInt(match[0], 10) : 500;
      return {
        kind: "server_error",
        message: err.message,
        httpStatus: status,
        retryAfterSeconds: null,
      };
    }

    // Generic transient errors — best effort classification.
    if (
      /transient|intermittent|flaky|backoff|retry/i.test(msg)
    ) {
      return {
        kind: "server_error",
        message: err.message,
        httpStatus: null,
        retryAfterSeconds: null,
      };
    }

    // 5xx exit codes are server errors.
    const exitMatch = msg.match(/exit\s+(\d+)/i);
    if (exitMatch) {
      const code = parseInt(exitMatch[1] ?? "0", 10);
      if (code >= 500 && code < 600) {
        return {
          kind: "server_error",
          message: err.message,
          httpStatus: code,
          retryAfterSeconds: null,
        };
      }
      if (code === 429) {
        return {
          kind: "rate_limit",
          message: err.message,
          httpStatus: 429,
          retryAfterSeconds: null,
        };
      }
    }
  }

  // 3. Unknown errors: treat as transient if they have no clear permanent
  //    signal. This is conservative — only network/timeout/rate-limit errors
  //    are classified; everything else returns null (no retry).
  return null;
}

/**
 * Check if an error is considered transient (retryable).
 */
export function isTransientError(err: unknown): boolean {
  return classifyError(err) !== null;
}

// ─── Backoff calculation ──────────────────────────────────────────────────

/**
 * Calculate the delay in ms for a given retry attempt using exponential
 * backoff with optional jitter.
 *
 * Formula: min(baseDelay * multiplier^(attempt-1), maxDelay) * jitter
 * where jitter adds 0-25% randomness to prevent thundering herd.
 */
export function calculateBackoffMs(
  attempt: number,
  config: Required<ErrorRecoveryConfig>,
): number {
  const exponentialDelay =
    config.baseDelayMs * config.delayMultiplier ** (attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  if (!config.jitter) {
    return cappedDelay;
  }

  // Add 0-25% jitter.
  const jitterRange = cappedDelay * 0.25;
  const jitter = Math.random() * jitterRange;
  return Math.round(cappedDelay + jitter);
}

// ─── Retry sleep helper ───────────────────────────────────────────────────

/**
 * Sleep for the specified number of milliseconds.
 * Used between retry attempts.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Core retry engine ────────────────────────────────────────────────────

/**
 * Execute a retryable function with automatic retry and exponential backoff.
 *
 * On each failure:
 *   1. Classify the error to determine if it is transient.
 *   2. If transient, calculate backoff delay and wait.
 *   3. If non-transient or max attempts reached, stop and return result.
 *
 * @returns A RetryResult with success/failure status, attempt count,
 *          and transient error classification.
 *
 * Example:
 * ```ts
 * const result = await retryWithBackoff(
 *   () => fetchSomeData(),
 *   defaultErrorRecoveryConfig(),
 * );
 * if (result.succeeded) {
 *   // use result.value
 * } else {
 *   // handle failure, check result.transientInfo
 * }
 * ```
 */
export async function retryWithBackoff<T>(
  fn: RetryableFn<T>,
  config: Partial<ErrorRecoveryConfig> = {},
): Promise<RetryResult<T>> {
  const rc = defaultErrorRecoveryConfig();
  // Merge with provided config (explicit values override defaults).
  if (config.maxAttempts !== undefined) rc.maxAttempts = config.maxAttempts;
  if (config.baseDelayMs !== undefined) rc.baseDelayMs = config.baseDelayMs;
  if (config.maxDelayMs !== undefined) rc.maxDelayMs = config.maxDelayMs;
  if (config.delayMultiplier !== undefined)
    rc.delayMultiplier = config.delayMultiplier;
  if (config.jitter !== undefined) rc.jitter = config.jitter;

  const result: RetryResult<T> = {
    succeeded: false,
    attempts: 0,
    totalDurationMs: 0,
    lastError: null,
    transientInfo: null,
  };

  const startTime = Date.now();

  for (let attempt = 1; attempt <= rc.maxAttempts; attempt++) {
    result.attempts = attempt;

    try {
      const value = await fn(attempt);
      // Success on this attempt.
      result.succeeded = true;
      result.value = value;
      result.totalDurationMs = Date.now() - startTime;
      return result;
    } catch (err) {
      result.lastError =
        err instanceof Error ? err : new Error(String(err));

      // Classify the error.
      const transient = classifyError(err);
      result.transientInfo = transient;

      // If this was the last attempt or the error is non-transient, stop.
      const isLastAttempt = attempt >= rc.maxAttempts;
      if (isLastAttempt || !transient) {
        result.totalDurationMs = Date.now() - startTime;
        return result;
      }

      // Calculate and sleep for the backoff delay.
      const delayMs = calculateBackoffMs(attempt, rc);
      await sleep(delayMs);
    }
  }

  // Should never reach here, but just in case.
  result.totalDurationMs = Date.now() - startTime;
  return result;
}

// ─── Control loop specific retry wrapper ───────────────────────────────────

import type { ControlLoopRunResult } from "./types.js";

/**
 * Retryable invocation of the control loop CLI.
 * Wraps `runControlLoopCli` with retry logic for transient errors.
 *
 * Returns the same ControlLoopRunResult on success or after exhausting retries.
 */
export interface ControlLoopRetryConfig extends Partial<ErrorRecoveryConfig> {
  /**
   * Whether to classify control-loop exit code 124 (timeout) as transient.
   * Useful when the timeout is due to a slow provider rather than a bug.
   */
  timeoutIsTransient?: boolean;
}

/**
 * Run the control loop with automatic retry on transient failures.
 *
 * This is the integration point between the error recovery engine and the
 * cron job runner (dispatcher). It wraps `runControlLoopCli` from
 * `control-loop-runner.ts` and retries on transient errors detected in
 * the control loop's output or spawn errors.
 */
export async function runControlLoopWithRetry(
  opts: import("./control-loop-runner.js").RunControlLoopOptions,
  retryConfig: ControlLoopRetryConfig = {},
): Promise<RetryResult<ControlLoopRunResult>> {
  const rc = { ...defaultErrorRecoveryConfig(), ...retryConfig };

  // Build a transient-classification function that also considers
  // the control-loop-specific timeout exit code.
  const isTransientFn = (err: unknown, attempt: number): TransientErrorInfo | null => {
    // 1. Check spawn errors (child process not found, etc.).
    const classified = classifyError(err);
    if (classified) return classified;

    // 2. Check for timeout (exit code 124) from the control loop runner.
    if (
      rc.timeoutIsTransient &&
      typeof err === "object" &&
      err !== null &&
      "exitCode" in err &&
      (err as { exitCode: unknown }).exitCode === 124
    ) {
      return {
        kind: "timeout",
        message: `Control loop timed out (attempt ${attempt}). This may be transient if the provider is slow.`,
        httpStatus: null,
        retryAfterSeconds: null,
      };
    }

    return null;
  };

  return retryWithBackoff<ControlLoopRunResult>(
    async (attempt) => {
      const { runControlLoopCli } = await import(
        "./control-loop-runner.js"
      );
      return runControlLoopCli(opts);
    },
    {
      maxAttempts: rc.maxAttempts,
      baseDelayMs: rc.baseDelayMs,
      maxDelayMs: rc.maxDelayMs,
      delayMultiplier: rc.delayMultiplier,
      jitter: rc.jitter,
    },
  );
}
