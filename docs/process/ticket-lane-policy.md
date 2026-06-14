# Ticket Lane Policy

> This document defines the **four lanes** into which agent-ready tickets may be dispatched. Each lane has a fixed scope, allowed/forbidden file paths, acceptance-criteria format rules, and executable vs. policy checks. The dispatcher (LAT-129), classifier (LAT-131), ticket-pack generator (LAT-104), and implementer prompt (LAT-137) all reference this policy.
>
> If this doc and an `accepted` ADR disagree, the ADR wins. If this doc and `agent-ready-ticket.md` disagree, update the one that's wrong in the same PR that flagged the conflict.

## Why lanes exist

Without lanes, tickets are promoted to `agent-ready` against a single, undifferentiated scope. This causes two failure modes:

1. **Over-acceptance.** Vague research tasks or ADR drafts are dispatched to the bounded implementer, which either invents an answer or stalls.
2. **Under-refusal.** Tickets that should be escalated (e.g., secret rotation in the `implementation` lane) are silently dispatched and run past budget.

Lanes give each ticket a **bounded identity** — what it is allowed to do, what files it may touch, and what checks must pass.

## The four lanes

### Lane 1: `docs/adr/prd` — Documentation & Architecture Decisions

**Purpose:** Write or update ADRs, PRDs, process docs, templates, or README files that belong to the docs hub.

**Allowed files (allowlist):**
- `docs/decisions/` — ADR files and their README
- `docs/prds/` — PRD files and their README
- `docs/process/` — Process docs and their README
- `docs/templates/` — Template files and their README
- Any `docs/` file explicitly named in the ticket

**Forbidden files (forbid-list):**
- `packages/**` — code packages
- `src/**` — source code
- `test/**` or `*.test.ts` — tests
- `package.json`, `package-lock.json` — package manager files
- `.github/**` — CI/CD workflows
- Any file not under `docs/`

**Acceptance criteria format:**
- Each criterion must be verifiable by reading the resulting file.
- Examples: `"ADR-0023 exists at docs/decisions/0023-agent-ready-ticket-contract.md"`, `"frontmatter contains status: proposed"`.
- No "reads well" or "is clear" — only observable file state.

**Executable checks:**
- `npm run validate:adrs` — validates ADR filename/frontmatter consistency.
- `npm run validate:prds` — validates PRD frontmatter and derivation.
- `npm run policy-scan` — checks for Markdown index hotspots in shared hubs.
- File-existence checks (verified against the diff, not executed as shell).

**Policy/manual validations:**
- ADR `revisit_trigger` is concrete (names a condition, not a date).
- PRD `derived_from` points at an existing root PRD.
- Process doc cites relevant ADRs.

**Risk level:** low to medium (medium if it changes a shared hub like `docs/README.md`).

### Lane 2: `implementation` — Bounded Code Implementation

**Purpose:** Mechanical edits driven by a ticket pack — implement a bounded feature, fix a bug, add a test, or extend an existing module.

**Allowed files (allowlist):**
- Paths explicitly listed in the ticket's `Files in scope` allowlist.
- `packages/*` — npm workspace packages.
- `test/**` — test files (if the ticket adds tests).
- `*.test.ts` — inline test files.

**Forbidden files (forbid-list):**
- `docs/decisions/**` — ADR files.
- `docs/prds/**` — PRD files.
- `.github/workflows/**` — CI/CD workflows.
- `package-lock.json` — lockfile (unless the ticket adds deps).
- `node_modules/**` — dependencies.
- Any file not in the explicit allowlist.

**Acceptance criteria format:**
- Each criterion must be objectively checkable after the run.
- Examples: `"GET /healthz returns 200 with body {\"status\":\"ok\"}"`, `"packages/api-server/test/healthz.test.ts exists and exports a test"`.
- No "works correctly" or "is clean" — only observable conditions.

**Executable checks:**
- `npm run check` — typecheck, build, ADR/PRD validators, policy scan, tests.
- `npm run typecheck` — TypeScript type checking.
- `npm run test` — test suite.
- Any ticket-specific test command (e.g., `npm test --workspace packages/api-server`).

**Policy/manual validations:**
- No edits under forbidden paths (verified against the diff).
- PR title prefixes with `LAT-NN:`.
- PR base is `main`.
- No new runtime deps without justification (checked in the ticket pack).

**Risk level:** low to medium (low for single-file changes, medium for multi-file changes touching public APIs).

### Lane 3: `harness/meta` — Tooling, Scripts, CI/CD

**Purpose:** Update tooling packages, scripts, CI/CD configs, or repository infrastructure that affects how agents run but does not implement user-facing functionality.

**Allowed files (allowlist):**
- `packages/icp/**` — ICP dispatcher, classifier, ticket-pack.
- `packages/policy-scanner/**` — policy scanning tools.
- `packages/secret-guard/**` — secret guard tools.
- `packages/prd-tools/**` — PRD validation tools.
- `packages/adr-tools/**` — ADR validation tools.
- `packages/control-loop/**` — control loop runner.
- `packages/opencode-harness/**` — opencode harness.
- `package.json` at root (dependencies, scripts).
- `tsconfig.json` and other build configs.

**Forbidden files (forbid-list):**
- `docs/decisions/**` — ADR files (except for referencing policy changes).
- `docs/prds/**` — PRD files.
- `packages/*/src/**` — user-facing package source code (unless the ticket is specifically about that package).

**Acceptance criteria format:**
- Each criterion must be verifiable by running a command or checking file state.
- Examples: `"npm run validate:adrs exits 0"`, `"packages/icp/dist/dispatcher/cli.js exists and is executable"`.
- No "tooling is robust" — only observable pass/fail conditions.

**Executable checks:**
- `npm run check` — full repo gate.
- `npm run build` — builds all packages.
- `npm run test` — runs all package tests.
- Package-specific test commands.

**Policy/manual validations:**
- No breaking changes to the dispatcher contract (`packages/icp/src/dispatcher/types.ts`).
- No changes to the run artifact schema (`packages/icp/src/observability/run-artifact.ts`) without an ADR.
- CLI exit codes are preserved (per dispatcher contract).

**Risk level:** medium (changes affect the agent runtime, but are reversible via revert PR).

### Lane 4: `research/spike` — Bounded Investigation

**Purpose:** Time- and cost-bounded investigation whose output is structured findings, not a shipped change. A spike must produce findings that graduate into a PRD, ADR, or planned implementation work.

**Allowed files (allowlist):**
- `docs/prds/` — draft PRDs (for spikes that produce a PRD candidate).
- `docs/decisions/` — draft ADRs (for spikes that produce an ADR candidate).
- `packages/*/src/**` — prototype or exploration code (only if explicitly allowed in the spike intake packet).
- Any file under `docs/` or `packages/` explicitly named in the spike intake.

**Forbidden files (forbid-list):**
- `package.json` (root) — no new dependencies unless the spike intake permits.
- `package-lock.json` — no lockfile changes unless deps are allowed.
- Any file not explicitly named in the spike intake packet.

**Acceptance criteria format:**
- Each criterion must verify that a finding or draft artifact exists.
- Examples: `"PRD draft exists at docs/prds/LAT-XXX-spike-findings.md"`, `"ADR-NNNN contains three considered options"`.
- No "the findings are actionable" — only observable file existence and required fields.

**Executable checks:**
- `npm run validate:adrs` — if an ADR was produced.
- `npm run validate:prds` — if a PRD was produced.
- File-existence checks (verified against the diff, not executed as shell).

**Policy/manual validations:**
- Spike intake packet has all required fields (goal, timebox, budget cap, sources allowed, stop conditions).
- Stop conditions are enumerated and evaluated at loop boundaries.
- Findings graduate into a named decision (ADR, PRD, or `LAT-*` ticket) — no orphan spikes.
- Spike terminal state: either `findings promoted` or `explicitly archived` (ADR-0015 Rule 4).

**Risk level:** low (spikes are bounded by time and cost; they produce no persistent changes unless explicitly promoted).

## Required fields for agent-ready tickets

Every ticket promoted to `agent-ready` **must** have the following fields populated. Missing fields cause refusal per the refusal policy below.

| Field | Required? | Format | Example |
|-------|-----------|--------|---------|
| `Linear ID` | Yes | `LAT-\d+` | `LAT-142` |
| `Title` | Yes | One sentence, imperative | `Add /healthz endpoint` |
| `Agent type` | Yes | `coding` \| `qa` \| `review` \| `research` \| `sre` \| `pm` \| `observability` | `coding` |
| `Lane` | Yes | `docs/adr/prd` \| `implementation` \| `harness/meta` \| `research/spike` | `implementation` |
| `Risk level` | Yes | `low` \| `medium` \| `high` | `low` |
| `Budget cap` | Yes | Numeric, with units | `100k tokens`, `$5`, `10 min` |
| `Approval required` | Yes | `yes` \| `no` | `yes` |
| `Goal` | Yes | One sentence, concrete outcome | `Add a GET /healthz endpoint returning 200` |
| `Context` | Yes | Links to PRD/ADR/prior ticket | `See ADR-0019, LAT-104` |
| `Inputs` | Yes | Files, Linear issues, external refs | `packages/api-server/src/routes/index.ts` |
| `Constraints` | Yes | Non-negotiables the agent must respect | `must not modify apps/foo/` |
| `Sequencing` | Yes | Hard blockers, predecessors, related context | `Hard blockers: none` |
| `In scope` | Yes | At least one concrete item | `packages/api-server/src/routes/healthz.ts` |
| `Out of scope` | Yes | At least one concrete item | `packages/api-server/src/middleware/**` |
| `Acceptance criteria` | Yes | Checkbox-prefixed, objectively checkable | `- [ ] GET /healthz returns 200` |
| `Tests` | Yes | Verification path for each AC | `unit test in healthz.test.ts` |
| `Required evidence` | Yes | PR link, files changed, test results | `- [ ] PR link` |
| `Quality gate checklist` | Yes | All items checked before agent-ready | `- [ ] Scope is bounded` |
| `Rollback plan` | Yes | How to undo if it goes wrong | `revert PR` |
| `Definition of Done` | Yes | Final verification criteria | `- [ ] All acceptance criteria checked` |
| `Links` | Yes | PRD, ADR(s), related Linear | `See ADR-0019` |

## Acceptance criteria format rules

Acceptance criteria follow these rules:

1. **Checkbox prefix.** Each criterion starts with `- [ ]` (Markdown checkbox).
2. **Objective and checkable.** "Returns X for input Y" passes; "works well" fails.
3. **One condition per criterion.** Do not combine multiple checks with "and" or "or" — split them.
4. **Mapped to a verification method.** Each criterion names *how* it will be verified (automated test, file-existence, manual step, shell command).
5. **No subjective adjectives.** Avoid "clean", "good", "robust", "intuitive" — use observable conditions.
6. **Lane-appropriate.** Docs lanes verify file state; implementation lanes verify runtime behavior; research lanes verify findings exist.

### Example: good acceptance criteria

```markdown
## Acceptance Criteria

- [ ] `GET /healthz` responds `200` with body matching `{\"status\":\"ok\",\"sha\":\"[0-9a-f]{7}\"}` (verified by unit test).
- [ ] Endpoint is registered in `packages/api-server/src/routes/index.ts` (verified by file diff).
- [ ] Unit test in `packages/api-server/test/healthz.test.ts` exists and covers the 200 response shape (verified by file existence + test suite).
```

### Example: bad acceptance criteria

```markdown
## Acceptance Criteria (BAD)

- [ ] The health check endpoint works correctly.
- [ ] Code is clean and follows conventions.
- [ ] Users are happy with the health check.
- [ ] It integrates well with the existing routes.
```

## File scope expectations by lane

| Lane | Allowlist | Forbid-list |
|------|-----------|-------------|
| `docs/adr/prd` | `docs/decisions/`, `docs/prds/`, `docs/process/`, `docs/templates/` | `packages/**`, `src/**`, `test/**`, `package.json`, `node_modules/**`, `.github/**` |
| `implementation` | Explicit allowlist (ticket-specific) | `docs/decisions/**`, `docs/prds/**`, `.github/workflows/**`, `package-lock.json` |
| `harness/meta` | `packages/icp/**`, `packages/policy-scanner/**`, `packages/secret-guard/**`, `packages/prd-tools/**`, `packages/adr-tools/**`, `packages/control-loop/**`, `packages/opencode-harness/**`, root `package.json`, build configs | `docs/decisions/**`, `docs/prds/**`, `packages/*/src/**` (unless specific) |
| `research/spike` | Spike intake packet allowlist (ticket-specific) | `package.json` (root), `package-lock.json`, files not in intake packet |

## Executable checks vs. policy/manual validations

The distinction matters because the dispatcher generates the ticket pack with both categories, and the implementer knows which to run as shell commands vs. which to verify against the diff.

| Category | What it is | Examples | How verified |
|----------|-----------|----------|-------------|
| **Executable check** | A shell command that runs and produces a pass/fail exit code | `npm run check`, `npm test`, `npm run typecheck` | Exit code of the command |
| **Policy validation** | A rule checked against file state or the diff | "No edits under `docs/decisions/**`", "PR title prefixes with `LAT-NN:`" | Diff inspection, file existence check |
| **Manual verification** | A human-readable step that cannot be automated | "Open the app and verify the health check shows in the dashboard" | Human observation (justified briefly) |

**Rule:** Every acceptance criterion must map to exactly one verification method. A criterion with no verification method is a refusal trigger.

## Refusal vs. clarification policy

When a ticket is missing fields or has malformed content, the dispatcher must decide: **refuse** (send back to refinement) or **clarify** (ask the author for the missing info).

### Hard refusal (refuse — do not dispatch)

A ticket is **refused** if any of the following are true:

1. **Missing required field.** `Linear ID`, `Title`, `Agent type`, `Lane`, `Risk level`, `Budget cap`, or `Goal` is blank or non-conforming.
2. **Vague spike without acceptance criteria.** Title matches `/^(investigate|explore|think about|discuss|plan)\b/i` AND no `Acceptance Criteria` section exists.
3. **Secret/deploy hard stop.** The ticket scope includes "rotate", "revoke", "reset" a secret/credential AND no safe-context phrasing applies (e.g., "do not touch secrets").
4. **Deploy/release scope in implementation lane.** The ticket scope includes "deploy", "release", "publish", "ship" AND the lane is `implementation` (deploy is a Stop action per ADR-0008).
5. **Auto-merge scope.** The ticket asks the agent to "auto-merge", "merge the PR", or "automerge".
6. **Primary ADR decision.** The ticket's primary work is writing a new ADR AND the lane is `implementation` (architecture decisions are human-owned).
7. **Description too short.** Description is fewer than 80 characters — not enough to bound dispatch scope safely.
8. **No acceptance criteria section.** Description has no `Acceptance Criteria` (or `Acceptance`) heading.
9. **Empty out-of-scope.** The `Out of scope` section is populated but contains zero items.

### Clarification (needs_clarification — do not refuse, ask)

A ticket is **clarified** (status: `needs_clarification`) if any of the following are true:

1. **Ambiguous lane.** The ticket content could belong to multiple lanes (e.g., a ticket that writes docs AND code). Ask the author to pick a primary lane.
2. **Budget cap present but non-numeric.** Budget cap is "reasonable" or "TBD" — ask for a numeric value.
3. **Acceptance criteria present but subjective.** ACs use "works well" or "is clean" — ask the author to restate as observable conditions.
4. **Missing verification method.** An acceptance criterion exists but does not name how it will be verified — ask the author to specify.
5. **Related context is stale.** A linked ADR or PRD has `status: superseded` — ask the author to update the link.

### Refusal output shape

When the dispatcher refuses a ticket, it posts this block to the Linear issue:

```markdown
## Pre-flight: REFUSED

Failed checks:
- (3) Vague spike — title "investigate streaming options" has no Acceptance Criteria.
- (6) Description too short (23 chars).

Cited policy:
- ADR-0023 — agent-ready ticket contract, § Required fields
- docs/process/ticket-lane-policy.md — Refusal vs. clarification policy

Action: return to `needs-refinement`. Do not mark `agent-ready` until all failed checks pass.
```

## Dispatcher / prompt guidance

The dispatcher consumes the contract via the `@latentspacelabs/ticket-contract` package (`packages/ticket-contract/src/validate.ts`). The implementer prompt (LAT-137) references the lane policy for scope discipline. The ticket-pack generator embeds lane-specific constraints.

### Dispatcher flow

1. Read the Linear issue.
2. Call `validateAgentReadyContract(issue)` — checks required fields, lane validity, acceptance-criteria format.
3. Call `classifyIssue(issue, { explicitOverride: true })` (LAT-131) — detects risky scope, hard blockers.
4. If either validation fails, refuse and post the refusal block.
5. If both pass, call `buildTicketPackFromContract(issue)` to generate lane-specific constraints.
6. Dispatch the pack to the control-loop runner.

### Implementer prompt guidance

The implementer (LAT-137 prompt) reads the lane from the ticket pack and applies lane-specific scope discipline:

- **`docs/adr/prd` lane:** Verify ADR/PRD filename and frontmatter rules. Do not edit code packages.
- **`implementation` lane:** Edit only files in the allowlist. Run `npm run check`. No architecture decisions.
- **`harness/meta` lane:** Update tooling packages. Preserve the dispatcher contract schema.
- **`research/spike` lane:** Produce findings, not implementations. Graduate to a named artifact.

## Related

- ADR-0005 — dispatch readiness and the `## Sequencing` block.
- ADR-0008 — agent control layer and Perplexity boundary (four action categories).
- ADR-0009 — cost controls and runaway-cost interrupts.
- ADR-0013 — agent invocation and integration boundaries.
- ADR-0014 — ICP state persistence and telemetry.
- ADR-0015 — context compaction and agent handoff policy.
- ADR-0019 — OpenCode local Qwen implementation runtime.
- ADR-0020 — cost-class inference routing policy.
- ADR-0021 — dispatcher synthesis boundary and deterministic hard stops.
- LAT-129 — polling dispatcher MVP.
- LAT-131 — dispatch eligibility classifier.
- LAT-133 — useful local agent dispatch loop MVP.
- LAT-134 — dispatcher tags (complexity / reasoning tags).
- LAT-135 — executable shell checks vs. policy validations.
- LAT-136 — quality gates for the dispatch loop.
- LAT-137 — agent prompts and skills.
