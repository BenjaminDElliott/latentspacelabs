---
id: ADR-0025
title: Provider-neutral adapter interface contract
status: accepted
date: 2026-06-14
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-162
  - LAT-161
  - ADR-0022
supersedes:
superseded_by:
revisit_trigger:
  - A new provider type is added that cannot map cleanly to ProviderType
  - A provider requires a lifecycle method beyond the six defined here
---

# ADR-0025: Provider-neutral adapter interface contract

> File name: `docs/decisions/0025-provider-neutral-adapter-interface-contract.md`

## Context

LAT-161 identified seven agent types (coding, qa, review, sre, pm, research,
observability) that the ICP dispatches to. Each type had its own invocation
shape: the coding agent used `AgentInvocationAdapter.invoke()`, the Linear
adapter used `readIssue()` / `postComment()`, and the dispatcher used
`ControlLoopRunResult`.

LAT-170 drafted an `OperationAdapter` interface with `init`, `invoke`,
`getStatus`, `pollForResult`, `cancel`, `dispose` — but it was generic
(`OperationInput` / `OperationResult` with untyped `payload` / `data`).
There was no single interface that all providers implement with a
structured request and result.

This ADR defines the provider-neutral adapter interface that every agent
provider implements.

## Decision Drivers

- **Uniform invocation:** ICP must invoke any provider through the same
  call pattern regardless of provider type or implementation language.
- **Structured requests:** `RunRequest` must capture ticket, repo, branch,
  autonomy level, and evidence requirements — the context every provider
  needs to operate.
- **Structured results:** `RunResult` must return status, evidence,
  artifacts, timing, cost band, and errors — the information every
  consumer needs to process a run.
- **Error consistency:** A single `RunError` type with a closed set of
  error codes and a `retryable` flag simplifies error handling across
  all providers.
- **Backwards compatibility:** Existing `OperationAdapter` (ADR-0022),
  `AgentInvocationAdapter`, and `AdapterErrorType` must continue working.
- **Language agnostic:** The interface is defined as TypeScript types
  that map cleanly to Python `TypedDict` / `dataclass` and other
  languages via analogous definitions.

## Considered Options

1. **Single unified interface** (`ProviderAdapter`) that all providers implement,
   with `RunRequest` and `RunResult` as the request/result types.

2. **Separate interfaces per agent type** (e.g., `CodingProvider`, `QAProvider`),
   each with its own request/result shapes, unified only by a common base.

3. **Generic `OperationAdapter`** (ADR-0022) with untyped `payload`/`data`,
   keeping the current approach and adding provider-specific wrappers.

## Decision

**Chosen option: 1 — single unified interface.**

The `ProviderAdapter` interface defines six lifecycle methods:

```
init(providerType, config) → void
invoke(request: RunRequest) → OperationHandle
getStatus(handle: OperationHandle) → OperationStatus
pollForResult(handle: OperationHandle, timeoutMs?) → RunResult
cancel(handle: OperationHandle) → void
dispose() → void
```

Every provider implements all six methods. The `providerType` parameter in
`init()` communicates the agent type (coding, qa, review, sre, pm,
research, observability). The `RunRequest` carries all invocation context.
The `RunResult` carries all outcome information.

### `RunRequest` shape

```
ticket: string          // Linear issue identifier (e.g., "LAT-162")
repo: string            // "owner/name" repository
branch: string          // Source branch for work
autonomyLevel: string   // "L1-read-only" … "L4-autonomous"
providerType: string    // One of the seven ProviderType values
evidenceRequirements:   // Which evidence categories must be produced
  acceptanceCriteria: boolean
  build: boolean
  tests: boolean
  lint: boolean
  coverage: boolean
  risks: boolean
  regressions: boolean
  securityConcerns: boolean
  recommendation: boolean
providerConfig?: object // Provider-specific configuration
budgetCapUsd?: number   // Optional ADR-0009 budget cap
approve?: boolean       // Approval flag for side-effecting runs
dryRun?: boolean        // Dry-run flag
runId?: string          // Stable run identifier for correlation
```

### `RunResult` shape

```
handle: OperationHandle
status: "succeeded" | "failed" | "cancelled" | "timeout"
evidence: {               // Evidence sub-types per requirements
  acceptanceCriteria: AcceptanceCriterionResult[] | null
  build: BuildResult | null
  tests: TestResults | null
  lint: LintResults | null
  coverage: CoverageMetrics | null
  risks: string[]
  regressions: string[]
  securityConcerns: string[]
  recommendation: "approve" | "approve-with-nits" | "request-changes" | "block-merge" | "needs-human"
}
artifacts: object        // Provider-specific artifacts (diffs, PR URLs, etc.)
timing: {                 // ISO-8601 start/end + durationMs
  startedAt: string | null
  completedAt: string | null
  durationMs: number
}
costBand: "normal" | "elevated" | "runaway_risk" | "unknown" | null
costBandUnavailableReason: string | null
spentUsd: number | null
error: RunError | null
notes: string[]           // Sanitised provider notes
```

### Error types and retry semantics

```
RunErrorCode:
  "not_found" | "timeout" | "cancelled" | "failed"
  | "disconnected" | "permission_denied" | "invalid_input"
  | "internal_error" | "unknown"

RunError: {
  kind: RunErrorCode
  message: string      // Secret-safe
  code?: string        // Machine-readable code (e.g. "HTTP_429")
  details?: unknown    // Structured details (no secrets)
  retryable: boolean   // Whether retrying is likely to succeed
}
```

Retryable kinds: `timeout`, `disconnected`, `internal_error`, `unknown`.
Non-retryable kinds: `not_found`, `cancelled`, `failed`,
`permission_denied`, `invalid_input`.

### Lifecycle invariants

1. `init()` must be called before any other method.
2. `invoke()` is idempotent: same `runId` returns the existing handle.
3. `pollForResult()` is idempotent: multiple calls on the same handle
   return the same result if the operation already completed.
4. `cancel()` is best-effort; the caller must check status to confirm.
5. `dispose()` releases all resources; the adapter is unusable after
   (except `init()` which re-initialises).

## Consequences

### Good

- **Single invocation pattern:** ICP dispatch code invokes any provider
  through `adapter.invoke(request) → handle → adapter.pollForResult(handle)`.
  No provider-specific call paths.
- **Structured evidence:** Every `RunResult` carries the same evidence
  envelope, enabling uniform processing by the runner, Linear write-back,
  and observability systems.
- **Retry semantics:** The `retryable` flag on `RunError` enables
  automatic retry decisions without provider-specific logic.
- **Type safety:** All types are TypeScript-first with exhaustiveness
  checks, type guards, and factory functions (`createRunError`).
- **Backwards compatible:** Existing `OperationAdapter`,
  `AgentInvocationAdapter`, `AgentInvocationRequest`, `AdapterErrorType`,
  and `RetryPolicy` continue working. The `errors/index.ts` module
  re-exports the legacy types and provides `toRunErrorCode()` for
  mapping.
- **Provider types are extensible:** Adding a new `ProviderType` value
  requires updating the enum and a `switch` default case; existing
  callers continue working.

### Trade-offs

- **Broader surface area:** `ProviderAdapter` is more methods and types
  than the existing `AgentInvocationAdapter` (one method). Providers
  must implement `init`, `getStatus`, `pollForResult`, `cancel`, and
  `dispose` — not just `invoke`.
- **Tighter coupling to evidence shape:** Providers must populate
  `evidence.acceptanceCriteria`, `evidence.build`, etc. — providers
  that don't naturally produce these (e.g., SRE) return `null` but
  must still carry the field.

### Open questions

- How does the Linear adapter (currently `readIssue`/`postComment`)
  map to `ProviderAdapter`? Answer: it operates at a different level —
  as a data adapter, not a provider adapter. The `ProviderAdapter` is
  for agent providers that execute a task; the Linear adapter is for
  data access. This distinction is noted in the code comments.
- Should `dispose()` be called automatically when a provider goes out
  of scope? Answer: optional; ICP callers manage lifecycle explicitly.

## Confirmation

This decision is confirmed working when:

1. A new provider implementation (e.g., QA or review) implements
   `ProviderAdapter` and can be invoked through the same pattern.
2. All existing tests pass (the 46 adapter interface tests cover the
   type guards, error construction, formatting, and exhaustiveness).
3. The `ProviderType` exhaustiveness check (`switch` over all 7 values)
   catches a new type at compile time if a default case is added.

## Links

- Related Linear: LAT-162 (this ADR), LAT-161 (agent types)
- Related ADR: ADR-0022 (OperationAdapter draft)
- Code: `packages/icp/src/adapters/provider-adapter-interface.ts`
- Tests: `packages/icp/src/adapters/provider-adapter-interface.test.ts`
- Errors: `packages/icp/src/errors/index.ts` (backwards-compatible re-exports)
