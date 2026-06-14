// LAT-173: Error types, retry policy, and cancel semantics
export enum AdapterErrorType {
  NotFound = 'NotFound',
  Timeout = 'Timeout',
  PermissionDenied = 'PermissionDenied',
  InternalError = 'InternalError',
  InvalidInput = 'InvalidInput',
  NotImplemented = 'NotImplemented',
}

export interface RetryPolicy {
  maxRetries: number;
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  baseDelayMs: number;
  maxDelayMs: number;
  retryOn: AdapterErrorType[];
}

export interface CancelRequest {
  graceful: boolean;
  timeoutMs: number;
  inFlight: 'abort' | 'complete' | 'ignore';
}
