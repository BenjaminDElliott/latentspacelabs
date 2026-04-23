/**
 * Narrow re-exports for the evaluation module.
 *
 * Kept as a shim so the evaluation module depends on *published* adapter /
 * runtime contract types rather than reaching into adapter internals. If
 * the adapter boundary moves in a future ADR, only this file changes.
 */
export type { AgentInvocationResult } from "../runtime/contract.js";
export type { CodingAgentRefusalKind } from "../adapters/agent-invocation-adapter.js";
