// LAT-173: Legacy error types — re-exported for backwards compatibility.
// LAT-162: Provider-adapter interface consolidates error types into
// provider-adapter-interface.ts (RunError, RunErrorCode, RetryPolicy).
// This file provides thin re-exports for consumers that depend on the
// old names. New code should import from provider-adapter-interface.

import type {
  RunErrorCode as LegacyRunErrorCode,
  RunError as LegacyRunError,
} from "../adapters/provider-adapter-interface.js";

/* ------------------------------------------------------------------ */
/* Legacy AdapterErrorType enum (LAT-173, kept for backwards compat)   */
/* ------------------------------------------------------------------ */

export enum AdapterErrorType {
  NotFound = "NotFound",
  Timeout = "Timeout",
  PermissionDenied = "PermissionDenied",
  InternalError = "InternalError",
  InvalidInput = "InvalidInput",
  NotImplemented = "NotImplemented",
}

/* ------------------------------------------------------------------ */
/* Legacy RetryPolicy (LAT-173, kept for backwards compat)             */
/* ------------------------------------------------------------------ */

export interface RetryPolicy {
  maxRetries: number;
  backoffStrategy: "exponential" | "linear" | "fixed";
  baseDelayMs: number;
  maxDelayMs: number;
  retryOn: AdapterErrorType[];
}

/* ------------------------------------------------------------------ */
/* Legacy CancelRequest (LAT-173, kept for backwards compat)           */
/* ------------------------------------------------------------------ */

export interface CancelRequest {
  graceful: boolean;
  timeoutMs: number;
  inFlight: "abort" | "complete" | "ignore";
}

/* ------------------------------------------------------------------ */
/* Legacy mappings to LAT-162 types                                    */
/* ------------------------------------------------------------------ */

/**
 * Map a legacy AdapterErrorType to a LAT-162 RunErrorCode.
 *
 * Provides a bridge for existing retry policy configurations that use
 * AdapterErrorType to the new RunErrorCode-based model.
 */
export function toRunErrorCode(
  type: AdapterErrorType,
): LegacyRunErrorCode {
  switch (type) {
    case AdapterErrorType.NotFound:
      return "not_found";
    case AdapterErrorType.Timeout:
      return "timeout";
    case AdapterErrorType.PermissionDenied:
      return "permission_denied";
    case AdapterErrorType.InternalError:
      return "internal_error";
    case AdapterErrorType.InvalidInput:
      return "invalid_input";
    case AdapterErrorType.NotImplemented:
      return "unknown";
  }
}

/**
 * Re-export the primary LAT-162 error types for direct consumption.
 *
 * New code should prefer importing directly from
 * `provider-adapter-interface.ts`.
 */
export type { RunErrorCode, RunError } from "../adapters/provider-adapter-interface.js";
