# `@latentspacelabs/control-loop`

LAT-117 — sandboxed agent control loop MVP.

A small TypeScript/Node entrypoint that:

1. Reads a ticket pack (per LAT-104 / `docs/templates/opencode-ticket-pack.md`).
2. Runs the LAT-105 dry-run harness to gate dispatch.
3. Runs extra guardrails (secret-shaped strings, dependency policy).
4. Selects a runtime adapter based on `--mode`:
   - `mock` (default) — deterministic, offline, free.
   - `plan` — runs guardrails but does NOT contact the adapter.
   - `live` — refuses unless `CONTROL_LOOP_PROVIDER`,
     `CONTROL_LOOP_RUNTIME_ID`, and `CONTROL_LOOP_LIVE_ENABLED=1` are set.
     The live adapter itself is a placeholder until follow-up work wires
     opencode behind the seam.
5. Dispatches one bounded run.
6. Returns a structured `RunSummary` (JSON or Markdown) with evidence:
   ticket, branch/PR plan, provider/runtime id, cost class, checks, refusal
   reasons, logs location, timestamps, and the next human action.

## What this package does NOT do

- It never opens a PR.
- It never auto-merges or deploys.
- It never holds, prints, or persists endpoint URLs, tokens, or RunPod
  instance details. Live adapters resolve those at the boundary; this
  package never sees them.
- It does not implement multi-agent queueing. The seam is designed for
  later concurrency, but the MVP runs exactly one dispatch.

## CLI

```
control-loop <ticket-pack.md> [--mode mock|plan|live] [--format markdown|json] [--out <path>]
```

Exit codes:

- `0` — `ready_for_review` or `planned`
- `2` — `refused`
- `3` — `failed` or `checks_failed`
- `64` — bad arguments

## Library

```ts
import { runControlLoop } from "@latentspacelabs/control-loop";

const summary = await runControlLoop({
  packPath: "path/to/ticket-pack.md",
  mode: "mock",
});
console.log(summary.evidence.state);
```

See `src/types.ts` for the full evidence shape.
