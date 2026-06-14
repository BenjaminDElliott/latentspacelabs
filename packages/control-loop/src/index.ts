/**
 * Public surface of `@latentspacelabs/control-loop` (LAT-117).
 */

export type {
  RunMode,
  RunState,
  RunSummary,
  RunEvidence,
  CheckOutcome,
  CheckResult,
  RefusalEvidence,
  ProviderEvidence,
  BranchEvidence,
  LogsLocation,
  RuntimeAdapter,
  AdapterRequest,
  AdapterRunResult,
} from './types.js';

export { MissingConfigError } from './types.js';
export { runControlLoop } from './control-loop.js';
export type { RunControlLoopOptions } from './control-loop.js';
export { MockRuntimeAdapter, LiveOpencodeAdapter, selectAdapter } from './adapters.js';
export type {
  MockAdapterOptions,
  LiveAdapterEnv,
  LiveOpencodeAdapterOptions,
  RunPodFetcher,
  RunPodFetchOptions,
  RunPodMetadata,
  ProcessRunner,
  ProcessSpawnOptions,
  ProcessResult,
  SelectAdapterOptions,
} from './adapters.js';
export { formatRunSummaryJson, formatRunSummaryMarkdown } from './format.js';
export { runAllGuardrails } from './guardrails.js';
