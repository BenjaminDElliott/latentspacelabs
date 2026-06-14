---
id: ADR-0022
title: Adapter interface specification
status: proposed
date: 2026-06-14
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-170
  - LAT-162
supersedes:
superseded_by:
revisit_trigger: >-
  When a new adapter category requires a method beyond init/invoke/pollForResult/cancel/getStatus/dispose
  or when a language-agnostic implementation surface (e.g. Python, Rust) becomes
  the dominant caller outside TypeScript.
---

# ADR-0022: Adapter interface specification

## Context

The ICP already ships several adapter implementations (`LinearAdapter`,
`AgentInvocationAdapter`) that live under `packages/icp/src/adapters/` and are
declared as interfaces in `packages/icp/src/runtime/contract.ts`.  Each adapter
is a TypeScript interface, and the current `AgentInvocationAdapter` exposes a
single method — `invoke` — that runs a synchronous fire-and-forget operation.

As the agent-dispatch system matures (LAT-162), callers need a **standardised
lifecycle** for any async operation an adapter can produce:

- **Init**: one-time setup with configuration and credentials.
- **Invoke**: fire an operation and return an operation handle immediately.
- **GetStatus**: check the current state of a running operation without blocking.
- **PollForResult**: wait (with timeout) until the operation completes, then return the result.
- **Cancel**: interrupt a running operation.
- **Dispose**: release all resources held by the adapter.

The interface must be **language-agnostic** so that future Python (or other
language) harnesses can implement it, while remaining **type-safe** so that
callers can pattern-match on states and errors without runtime surprises.

This ADR defines that interface.

## Decision

**Accept the six-method lifecycle interface below, with explicit enum/union types
for every return-value category.**

### Method signatures (neutral / language-agnostic form)

Each method is described with:

- A **neutral name and purpose**.
- A **parameter description** (what goes in).
- A **return description** (what comes out).
- **Invariants** (guarantees the implementation must honour).

#### `init(config: Record<string, any>) → void`

- **Purpose.** Prepare the adapter for use.  Called once before any other
  method.  Sets up connections, resolves credentials, validates configuration.
- **Parameters.** `config` — a flat key-value map.  Keys are opaque strings;
  values are strings, numbers, booleans, or null.
- **Return.** `void` (synchronous).
- **Invariants.**
  - Must be idempotent: calling `init` twice with the same config is a no-op
    (or overwrites cleanly).
  - Must throw (or reject) only on fatal configuration errors (missing API key,
    unreachable endpoint).  Transient errors are deferred to the first
    operation call.
  - After `init` returns, the adapter is in the `ready` state.

#### `invoke(input: OperationInput) → OperationHandle`

- **Purpose.** Submit an operation and return an opaque handle immediately.
- **Parameters.** `input` — an object with fields defined below.
- **Return.** `OperationHandle` — an opaque identifier (string) that the
  caller passes to `getStatus`, `pollForResult`, and `cancel`.
- **Invariants.**
  - Must call `init` first; throws if the adapter is not initialised.
  - Must be idempotent with the same `input.operation_id`: re-invoking with an
    existing ID returns the same handle (not a duplicate operation).
  - Must produce an `OperationState.running` status.

#### `getStatus(handle: OperationHandle) → OperationStatus`

- **Purpose.** Check the current state of an operation without blocking.
- **Parameters.** `handle` — the operation handle returned by `invoke`.
- **Return.** `OperationStatus` object defined below.
- **Invariants.**
  - Returns the latest known state.  If the operation completed while the
    caller waited, the terminal state is returned.
  - Must not throw for unknown handles — returns `unknown` state instead.
  - Must not block: returns immediately.

#### `pollForResult(handle: OperationHandle, timeoutMs?: number) → OperationResult`

- **Purpose.** Block until the operation reaches a terminal state, then return
  the result.  If `timeoutMs` is provided and the operation has not completed,
  returns a timeout result.
- **Parameters.**
  - `handle` — the operation handle.
  - `timeoutMs` — optional maximum wait time in milliseconds.  If omitted,
    the adapter uses its configured default or blocks indefinitely.
- **Return.** `OperationResult` object defined below.
- **Invariants.**
  - If the operation is already terminal when called, returns immediately.
  - If `timeoutMs` elapses, returns a result with `status === "timeout"`.
  - Must be safe to call concurrently on the same handle — the adapter deduplicates.
  - Must throw (or reject) only on fatal errors (e.g. adapter disconnected).

#### `cancel(handle: OperationHandle) → void`

- **Purpose.** Request that the adapter cancel the running operation.
- **Parameters.** `handle` — the operation handle.
- **Return.** `void` (synchronous).
- **Invariants.**
  - A no-op if the operation is already terminal.
  - Does not wait for cancellation to complete — that is observable via
    `getStatus` / `pollForResult`.
  - After cancel is called, `getStatus` must eventually return a terminal state.

#### `dispose() → void`

- **Purpose.** Release all resources held by the adapter (connections, threads,
  timers).  The adapter must not be used after `dispose`.
- **Parameters.** None.
- **Return.** `void` (synchronous).
- **Invariants.**
  - Idempotent: calling dispose twice is safe.
  - After dispose, any method (except `init`) throws or rejects.

### Type definitions

All types are **open unions** (new values may be added in follow-up tickets
without breaking existing callers, as long as they check for known cases).

#### `OperationState` — strict enum

```
"unknown" | "running" | "succeeded" | "failed" | "cancelled" | "timeout"
```

- `unknown` — handle is recognised but its state is not yet known.
- `running` — the operation is in progress.
- `succeeded` — the operation completed successfully.
- `failed` — the operation completed with an error.
- `cancelled` — the operation was cancelled by the caller.
- `timeout` — the operation did not complete within the timeout.

#### `OperationError` — discriminated union

```typescript
interface OperationError {
  kind: string;       // machine-readable error category
  message: string;    // human-readable, secret-safe description
  code?: string;      // optional machine-readable error code
  details?: unknown;  // optional additional structured data
}
```

- `kind` is one of: `"not_found"`, `"timeout"`, `"cancelled"`, `"failed"`, `"disconnected"`, `"unknown"`.
- `message` is secret-safe (never contains API keys, tokens, or credential values).
- `details` is optional and may be any JSON-serialisable value.

#### `OperationInput` — invocation payload

```typescript
interface OperationInput {
  operation_id: string;    // caller-chosen unique ID (idempotency key)
  operation_type: string;  // semantic type, e.g. "agent_invoke", "pr_review"
  payload: Record<string, any>;   // operation-specific data
  metadata?: Record<string, string>;  // optional free-form tags
}
```

#### `OperationStatus` — current state snapshot

```typescript
interface OperationStatus {
  handle: OperationHandle;
  state: OperationState;
  started_at: string | null;      // ISO-8601 timestamp or null
  completed_at: string | null;    // ISO-8601 timestamp or null
  error?: OperationError;         // present when state is failed/cancelled/timeout
}
```

#### `OperationResult` — final outcome

```typescript
interface OperationResult {
  handle: OperationHandle;
  state: OperationState;           // always terminal
  data?: Record<string, any>;      // operation-specific success data
  error?: OperationError;          // present when state is failed/cancelled/timeout
  duration_ms: number;             // wall-clock duration from invoke to terminal
}
```

#### `OperationHandle`

A string identifier.  The adapter owns the mapping from handle → internal
operation; callers treat it as opaque.

## Considered Options

### (1) Six-method lifecycle (accepted)

The five methods required by LAT-170 (`init`, `invoke`, `pollForResult`,
`cancel`, `getStatus`) plus `dispose` for resource cleanup.  This covers the
full operation lifecycle from creation to termination.

### (2) Five-method lifecycle without `dispose`

Simpler but leaves resource cleanup to the garbage collector or finaliser.
Acceptable for short-lived processes but not for long-running ICP servers
that maintain persistent connections (e.g. to Linear or RunPod).

### (3) Event-driven instead of pollForResult

Replace `pollForResult` with an `onResult` callback.  Simpler for some
languages, harder for languages without first-class callbacks.  The polling
approach is more universal (works in TS, Python, Rust, Go).

### (4) Include `dispose` as part of `getStatus`

Add a `disposed` flag to `OperationStatus` instead of a separate method.
Saves one method but couples lifecycle to status semantics.  Rejected in
favour of clear separation of concerns.

## Consequences

### Good

- Every adapter implementation follows the same six-method pattern, making
  new adapters easier to write and review.
- The strict `OperationState` enum lets callers use exhaustive switch
  statements (TS) or match expressions (Python 3.10+) without missing cases.
- `OperationError` is a discriminated union, so callers can pattern-match on
  `kind` without string comparison bugs.
- `invoke` returns an opaque handle immediately — no blocking — which matches
  the async-first nature of agent operations.
- `pollForResult` with timeout is universal across languages and platforms.
- `dispose` ensures clean shutdown for long-running ICP instances.

### Bad / open

- The neutral `Record<string, any>` config and payload types trade type safety
  for language agnosticism.  Follow-up tickets can add per-adapter input/output
  interfaces that extend these base types.
- `OperationHandle` as a string means the adapter must maintain its own
  handle → operation mapping.  For distributed adapters (e.g. a remote
  service), the handle may need to be a UUID that the caller stores.
- Python 3.9 and earlier lack structural pattern matching; callers on older
  versions must use `if/elif` chains.  This is acceptable for the pilot.
- The spec is written in a neutral pseudo-code form; each language gets its
  own concrete typing (TypeScript interfaces, Python `dataclass` + `TypedDict`,
  etc.).  Maintaining parity across languages is a review-time concern.

## Confirmation

This decision is working if:

- New adapters implement all six methods without deviation.
- TypeScript callers can write exhaustive switch statements on `OperationState`
  without the compiler complaining about missing cases.
- Python callers can use `match` statements (3.10+) or equivalent `if/elif`
  chains (3.9-) to handle all state transitions.
- The `LinearAdapter` and `AgentInvocationAdapter` are refactored to conform
  to this interface (future ticket).

Signals to revisit:

- A new operation category needs a method beyond the six defined here.
- A non-TypeScript implementation surface becomes the dominant caller.
- Distributed adapters need handle semantics beyond opaque strings.

## Links

- Related Linear issue(s): LAT-170 (Task 1), LAT-162
- Related ADRs: ADR-0012 (nine components), ADR-0013 (agent invocation boundaries), ADR-0016 (adapter layering)
- Related code: `packages/icp/src/adapters/`, `packages/icp/src/runtime/contract.ts`
- Implementation: `packages/icp/src/adapters/operation-adapter-interface.ts`
