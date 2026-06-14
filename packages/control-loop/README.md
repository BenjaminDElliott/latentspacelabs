# `@latentspacelabs/control-loop`

LAT-117 — sandboxed agent control loop MVP.

A small TypeScript/Node entrypoint that:

1. Reads a ticket pack (per LAT-104 / `docs/templates/opencode-ticket-pack.md`).
2. Runs the LAT-105 dry-run harness to gate dispatch.
3. Runs extra guardrails (secret-shaped strings, dependency policy).
4. Selects a runtime adapter based on `--mode`:
   - `mock` (default) — deterministic, offline, free.
   - `plan` — runs guardrails but does NOT contact the adapter.
   - `live` — invokes the local `opencode` CLI against a configured
     RunPod-hosted vLLM runtime (LAT-121). Requires
     `CONTROL_LOOP_LIVE_ENABLED=1`, `CONTROL_LOOP_PROVIDER`,
     `CONTROL_LOOP_WORKDIR`, `RUNPOD_API_KEY` (RunPod **console** API key
     for `rest.runpod.io` only), and `RUNPOD_POD_ID`. Optional:
     `RUNPOD_VLLM_API_KEY` (vLLM / inference bearer for opencode — **not**
     sent to RunPod’s management API), `CONTROL_LOOP_OPENCODE_BIN` (default `opencode`),
     `CONTROL_LOOP_OPENCODE_MODEL`, and `CONTROL_LOOP_TIMEOUT_MS`
     (default 300000). Any missing or invalid value, or a non-running
     pod, refuses with `missing_runtime_config` before opencode is
     invoked.
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

## Live mode (LAT-121)

The live adapter spawns the local `opencode` CLI inside a per-run
sandbox directory, passes the ticket pack on disk (never on argv),
forwards `RUNPOD_POD_ID` and, if set, `RUNPOD_VLLM_API_KEY` to the child
via env (never forwards `RUNPOD_API_KEY`), and runs the pack's required
checks once opencode exits cleanly.

Before running, the adapter calls `GET https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID`
with **`Authorization: Bearer $RUNPOD_API_KEY`** (RunPod account key from
the console — not your vLLM inference key) to confirm the pod's
`desiredStatus === "RUNNING"`. If the API call fails or the pod is
stopped, the adapter refuses without invoking opencode.

The adapter never opens a PR, never auto-merges, never deploys, and
never returns the token, pod id, or RunPod URL in any field of the
`RunSummary`. Stdout/stderr from opencode and from each check are
redacted before being written to the log file or surfaced as
refusal/check `detail`.

Local smoke test (env names only — fill values from your local
`.env`, never commit them):

```sh
export CONTROL_LOOP_LIVE_ENABLED=1
export CONTROL_LOOP_PROVIDER=opencode-runpod
export CONTROL_LOOP_WORKDIR=/path/to/sandbox/checkout
export CONTROL_LOOP_OPENCODE_BIN=opencode    # or absolute path
export CONTROL_LOOP_OPENCODE_MODEL=qwen3-coder-30b
export CONTROL_LOOP_TIMEOUT_MS=600000
export RUNPOD_API_KEY=...                   # RunPod console API key — never commit
export RUNPOD_POD_ID=...                     # never commit
export RUNPOD_VLLM_API_KEY=...              # optional: inference key for opencode — never commit

npm run --workspace=@latentspacelabs/control-loop run-loop -- \
  path/to/ticket-pack.md --mode live --format json
```

## Library

```ts
import { runControlLoop } from '@latentspacelabs/control-loop';

const summary = await runControlLoop({
  packPath: 'path/to/ticket-pack.md',
  mode: 'mock',
});
console.log(summary.evidence.state);
```

See `src/types.ts` for the full evidence shape.
