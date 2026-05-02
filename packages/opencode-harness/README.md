# @latentspacelabs/opencode-harness

LAT-105 dry-run harness for the opencode + local Qwen implementation runtime
defined in [ADR-0019](../../docs/decisions/0019-opencode-local-qwen-implementation-runtime.md).

This package validates a [ticket pack](../../docs/templates/opencode-ticket-pack.md)
(the LAT-104 contract) and produces a Linear-ready run summary **without
invoking opencode, the local Qwen endpoint, GitHub, or Linear**. It is the
"fail before you run" gate that ADR-0019's *Confirmation* section calls for.

## What it does

1. Reads a ticket pack file from disk.
2. Validates the pack against the LAT-104 contract (header, goal, acceptance
   criteria, allowlist, branch/PR rules, expected checks, no embedded secrets).
3. Decides whether the runtime would *start* a real opencode + Qwen run, or
   refuse it as `blocked` / `needs_clarification` / `too_large`.
4. Emits a structured summary (markdown or JSON) suitable for pasting into a
   Linear comment as the implementation dry-run artifact.

## What it does not do

- It **never** invokes `opencode` or any other implementation CLI.
- It **never** contacts the local Qwen endpoint and does not require an
  endpoint URL, token, or hostname to operate.
- It **never** creates a branch, edits any file, runs `git`, or opens a PR.
- It **never** writes back to Linear.
- It does not require any environment variable beyond the standard Node
  runtime — no `OPENCODE_*`, `QWEN_*`, `ANTHROPIC_*`, `GH_*`, or `LINEAR_*`.

## Usage

```sh
# From the repo root
npx tsx packages/opencode-harness/src/cli.ts <path-to-ticket-pack.md>

# Built form (after `npm run build --workspace @latentspacelabs/opencode-harness`)
node packages/opencode-harness/dist/cli.js <path-to-ticket-pack.md>

# JSON output, written to a file
opencode-dry-run /tmp/lat-200-pack.md --format json --out /tmp/run-summary.json
```

### Exit codes

| Code | Meaning                                              |
| ---: | ---------------------------------------------------- |
|    0 | `ready` — dry-run pass, the runtime would proceed    |
|    2 | `blocked` / `needs_clarification` / `too_large`      |
|    3 | harness internal error (e.g. unreadable pack file)   |
|   64 | invalid CLI arguments                                |

## Refusal modes

The harness refuses a pack in several explicit cases:

- **Malformed contract.** Missing or malformed header (e.g. Linear ID does not
  match `^LAT-\d+$`), empty allowlist, missing repo gate check, or a branch
  name that does not match the Linear ID. Status: `needs_clarification`.
- **Forbidden-root allowlist.** A `Files in scope` path under
  `.github/workflows/`, `docs/decisions/`, or `docs/prds/`. Status:
  `needs_clarification`.
- **Secret-shaped values inside the pack.** Any of: a local-endpoint URL
  (`http://127.0.0.1`, `http://localhost`, RFC 1918 ranges), a Bearer token,
  an `Authorization:` header, or an obvious API-key shape. Status:
  `needs_clarification` with the matching `secret_*` code in `refusals`.
- **Too large for the small-model surface.** File count, acceptance criteria
  count, or pack byte size exceeds the configured `SizeLimits`. Status:
  `too_large`.
- **Pack declares its own non-ready readiness.** If the pack's
  `Readiness status` is `blocked`, `needs_clarification`, or `too_large`,
  the harness echoes that status back rather than starting a run.

## Operator handoff (real run vs dry run)

This harness deliberately stops at the dry-run line. It is the only piece of
LAT-105 the repo can land while honouring the project's guardrails: no
endpoint URL, no auth token, no live local endpoint, no GitHub side-effects.

When an operator wants to take a pack from a green dry run to a real opencode
+ Qwen run, the runtime they hand off to is **owned by LAT-103** (opencode
agents/skills/commands and the self-hosted-runner workflow). The handoff is:

1. Run the dry run on the pack: `opencode-dry-run path/to/pack.md`.
2. Confirm the harness reports `status: ready` and exit code 0.
3. Confirm the markdown summary contains `Endpoint invoked: no`,
   `PR opened: no`, `Linear write-back: no`. Paste it into the Linear ticket
   as the dry-run artifact.
4. Hand the pack to the LAT-103 `/lat-implement` command (or the equivalent
   self-hosted-runner workflow input). The endpoint URL, runner token, and
   GitHub token are injected at the runner host, **never** committed and
   never read by this harness.

If the dry run reports any other status, the pack returns to the planner —
the runtime never starts.

## Why no live-endpoint mode here

ADR-0019 *Endpoint and credential model* forbids committing the local Qwen
endpoint URL or any auth token, and forbids exposing the endpoint publicly.
A live-endpoint dry-run mode would either need an endpoint URL in this repo
(forbidden) or an endpoint URL pulled from operator-side configuration (which
is exactly the LAT-103 self-hosted-runner surface, not this harness's). The
clean separation is: this harness is offline-only; LAT-103 owns the live path.

## Files

- `src/types.ts` — pure type contract, no I/O.
- `src/parser.ts` — markdown → `TicketPack` reader.
- `src/validate.ts` — contract enforcement and secret-shape checks.
- `src/dry-run.ts` — the offline dry-run engine.
- `src/format.ts` — markdown / JSON summary formatters.
- `src/cli.ts` — `opencode-dry-run` CLI entrypoint.
- `src/__fixtures__/lat-999-noop-pack.md` — bundled fake/no-op pack used in
  tests and as a smoke fixture for operators.
