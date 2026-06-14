# Risk & Open-Questions Register

> Living register of unresolved decisions, known risks, and revisit triggers for the Agentic Development Flywheel MVP. Entries link back to canonical tickets/ADRs/PRDs rather than duplicating discussions. Reviewed during each retro/refinement loop and before first-run readiness gates.

**Status:** Active  
**Owner:** Benjamin Elliott (@ben)  
**Last updated:** 2026-06-14  
**Next review:** Next retro cycle or first-run readiness gate

## How to use this register

- Every entry has a unique id, a category, severity, status, and a source ticket.
- **Blocker** = must be resolved before first-run readiness. **Watch** = worth tracking, resolve when convenient. **Resolved** = decision made or condition passed.
- Each entry links to the source Linear ticket, ADR, PRD, or live-run log.
- Update `latest_note` and `next_action` on each review. Delete resolved entries after confirming the fix landed.
- Add entries freely as new risks surface during runs or retros.

## Severity scale

| Level | Meaning |
|---|---|
| **Critical** | Blocks first-run readiness or causes silent data loss/corruption |
| **High** | Causes repeated failure mode or noticeable cost overrun |
| **Medium** | Impairs diagnosis, review quality, or future eval use |
| **Low** | Cosmetic, convenience, or known limitation with no operational impact |

---

## Entries

### R-001 — Dispatcher eligibility: keyword-only rules are safe but brittle

- **Category:** dispatch / eligibility
- **Question/Risk:** LAT-129's dispatcher uses keyword-only rules (e.g., `LAT-` prefix, `agent-ready` label) for ticket eligibility. This is safe (no false positives after LAT-131) but brittle — any agent-created ticket that misses a keyword slips through undetected.
- **Owner:** Benjamin Elliott
- **Severity:** High
- **Status:** Watch
- **Source:** LAT-132 (ADR-0021), LAT-133 (PRD)
- **Decision deadline:** Before first-run readiness gate
- **Latest note:** LAT-131 fixed eligibility false positives; keyword rules confirmed safe across live runs. Still relies on correct labelling discipline.
- **Next action:** Define a canonical "agent-ready" checklist that is auto-enforced (e.g., pack exists, forbidden paths clear, AC present) rather than purely keyword-based.

### R-002 — Complexity/reasoning tags affect dispatch eligibility

- **Category:** dispatch / classification
- **Question/Risk:** Local agents may pick up architect/PM reasoning work if complexity/reasoning tags (from LAT-134) are not explicitly consumed during dispatch. Need to define how `implementation`, `synthesis`, and `architecture` tags gate which lanes a ticket enters.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Open
- **Source:** LAT-132, LAT-133 (both reference LAT-134 tags)
- **Decision deadline:** Before first-run readiness gate
- **Latest note:** Both LAT-132 and LAT-133 explicitly request consuming complexity/reasoning tags. LAT-134 ticket exists but not yet implemented.
- **Next action:** Implement LAT-134 tag consumption in dispatch pre-flight; update ADR-0021 eligibility matrix.

### R-003 — Classifier schema and evidence requirements not yet formalized

- **Category:** dispatch / observability
- **Question/Risk:** LAT-132 defines that a bounded classifier should distinguish risk context from risky scope, but the classifier output schema and validation boundary are still being defined in ADR-0021. Evidence requirements per dispatch decision need a canonical format.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Open
- **Source:** LAT-132 (ADR-0021), LAT-140 (observability)
- **Decision deadline:** Before first-run readiness gate
- **Latest note:** LAT-140's structured run artifact partially covers this; ADR-0021 defines the boundary. Schema still needs formalization.
- **Next action:** Formalize classifier output schema in ADR-0021; add validation in dispatch pre-flight.

### R-004 — Concurrency isolation: worktree-first model needs cleanup/prune policy

- **Category:** concurrency / sandboxing
- **Question/Risk:** ADR-0022 (LAT-139) chose a worktree-first MVP model. Without a cleanup/prune policy for stale worktrees, orphan branches, and abandoned locks, disk and branch namespace can accumulate noise.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Watch
- **Source:** LAT-139 (ADR-0022)
- **Decision deadline:** After 3+ concurrent runs or 2 weeks of concurrent use
- **Latest note:** ADR-0022 defines the MVP model. Fast-follow includes container-per-agent for higher-risk work.
- **Next action:** Define and document a prune policy (e.g., discard worktrees older than N days without PRs). Test with 3+ concurrent agents.

### R-005 — Shared dependency/cache directory safety under concurrent runs

- **Category:** concurrency / sandboxing
- **Question/Risk:** Multiple concurrent local agents may clobber shared `node_modules`, build caches, or npm lock files. ADR-0022 mentions this but the MVP worktree model alone may not fully isolate dependency state.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Watch
- **Source:** LAT-139 (ADR-0022)
- **Decision deadline:** Before concurrent runs in production
- **Latest note:** Worktree isolation covers branches/files; dependency isolation covers `package-lock.json` + isolated installs. npm workspaces may need per-worktree `node_modules` or `--prefix` flags.
- **Next action:** Test 2+ concurrent agents against shared workspace. If clobbering observed, add `--prefix` or workspace-scoped installs.

### R-006 — RunPod cold-start handling: no double-dispatch while initializing

- **Category:** execution / runpod
- **Question/Risk:** RunPod pods take time to initialize. Without explicit state management, a pod could receive a second dispatch while still initializing, causing garbled output or lost state.
- **Owner:** Benjamin Elliott
- **Severity:** High
- **Status:** Open
- **Source:** LAT-133 (PRD)
- **Decision deadline:** Before first-run readiness gate
- **Latest note:** LAT-133 defines cold-start handling states (initializing/running/done/failed). Need implementation of lease/lock during `initializing` phase.
- **Next action:** Implement pod lease in control loop; refuse dispatch for pods in `initializing` state; add timeout policy (e.g., 10-minute cap).

### R-007 — Research vs implementation routing: spike tickets must not reach implementation lane

- **Category:** dispatch / routing
- **Question/Risk:** LAT-119 research/spike tickets must not be sent to implementation-mode opencode unless graduated to implementation work. Without a routing rule, research tickets could receive shallow implementation output.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Watch
- **Source:** LAT-133 (PRD)
- **Decision deadline:** Before first-run readiness gate
- **Latest note:** LAT-133 specifies this routing. LAT-137 (Done) optimized local-agent prompts to distinguish implementation from research work.
- **Next action:** Add dispatch pre-flight check: if ticket is labelled `research` or `spike`, route to synthesis lane unless marked `graduated`.

### R-008 — `--artefact-out` CLI flag and runs/persistence root

- **Category:** observability / tooling
- **Question/Risk:** LAT-140's structured run artifacts are emitted but lack a `--artefact-out` CLI flag for explicit output path. ADR-0014 defines a `runs/` persistence root but it is not yet implemented. Without these, artifacts are ephemeral and harder to review.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Open
- **Source:** LAT-140 (observability)
- **Decision deadline:** Before first-run readiness gate
- **Latest note:** LAT-140 PR merged with structured artifacts. Follow-ups identified: `--artefact-out` flag and ADR-0014 persistence root.
- **Next action:** Add `--artefact-out` flag to dispatcher CLI. Draft ADR-0014 for `runs/` persistence root.

### R-009 — Real prompt/skill version and per-AC verdict tracking

- **Category:** observability / evaluation
- **Question/Risk:** Run artifacts need real prompt/skill version numbers and per-acceptance-criterion verdicts (not just a pass/fail summary). Without these, prompt tuning and eval/dataset creation are harder.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Open
- **Source:** LAT-140 (observability)
- **Decision deadline:** Before first-run readiness gate
- **Latest note:** LAT-140 added artifact schema. Real version tracking and per-AC threading are follow-ups.
- **Next action:** Add `prompt_version` and `skill_version` fields to preflight. Thread per-AC verdicts in run artifact.

### R-010 — Dataset-candidate vs operational-log distinction and training eligibility

- **Category:** observability / eval
- **Question/Risk:** LAT-140 designed run artifacts to support future fine-tuning. Need to formally separate `operational_log` from `dataset_candidate` and record training/export eligibility, redaction provenance, and consent gating.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Open
- **Source:** LAT-140 (observability)
- **Decision deadline:** Before first fine-tuning dataset is assembled
- **Latest note:** LAT-140 PR merged with artifact schema. Follow-ups: operational vs dataset shape, redaction provenance, consent gating.
- **Next action:** Add `dataset_candidate` flag, `redaction_provenance`, and `training_eligible` fields to run artifact schema.

### R-011 — Redaction provenance: tracking what was removed and why

- **Category:** observability / security
- **Question/Risk:** Run artifacts contain sanitized data, but without provenance tracking (what was removed, why, and whether the artifact is safe for training), we cannot reliably reuse artifacts for fine-tuning or external sharing.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Watch
- **Source:** LAT-140 (observability)
- **Decision deadline:** Before first dataset assembly
- **Latest note:** LAT-140 includes redaction rules but not provenance tracking.
- **Next action:** Add `redaction_log` field to run artifacts: list of redacted fields, reason (e.g., `endpoint_url`, `token`, `local_path`), and post-redaction hash.

### R-012 — OTEL export: MVP emits OTEL-shaped artifact, not direct exporter

- **Category:** observability / standards
- **Question/Risk:** LAT-140 evaluated OpenTelemetry compatibility. The decision was to emit OTEL-shaped local artifacts as MVP (no collector/exporter required), with OTEL export as optional fast-follow. This needs to be codified.
- **Owner:** Benjamin Elliott
- **Severity:** Low
- **Status:** Resolved
- **Source:** LAT-140 (observability)
- **Decision deadline:** 2026-05-03 (resolved in PR)
- **Latest note:** Decision codified in LAT-140 PR: MVP = OTEL-shaped local artifacts. No collector/exporter required. OTEL export is optional fast-follow.
- **Next action:** Add ADR entry for OTEL compatibility decision. Track fast-follow implementation.

### R-013 — Forbidden path check was malformed (`No: command not found`)

- **Category:** execution / checks
- **Question/Risk:** During the live LAT-127 run, the forbidden-path guardrail check failed with `/bin/sh: No: command not found` because the check command was the literal string `"No edits under forbidden paths."` rather than an executable command. This was fixed by LAT-135.
- **Owner:** Benjamin Elliott
- **Severity:** High
- **Status:** Resolved
- **Source:** LAT-127 (live run), LAT-135 (fix)
- **Decision deadline:** 2026-05-03 (resolved in PR)
- **Latest note:** LAT-135 distinguished executable checks from policy validations. The fix separated shell-executable checks from policy checks.
- **Next action:** Ensure all future policy checks have explicit `kind: policy` and `outcome: manual` or are executable commands.

### R-014 — Local agent output quality: shallow README-only changes

- **Category:** implementation / quality
- **Question/Risk:** LAT-127's live run produced a shallow README-style entry instead of meaningful cross-doc deduplication. Without quality gates, agents may satisfy tickets with superficial changes.
- **Owner:** Benjamin Elliott
- **Severity:** High
- **Status:** Watch
- **Source:** LAT-127 (live run), LAT-136 (quality gates), LAT-137 (prompt optimization)
- **Decision deadline:** Before first-run readiness gate
- **Latest note:** LAT-136 (In Review) adds output-quality gates. LAT-137 (Done) optimized local-agent prompts for useful implementation work. Risk mitigated but not fully closed — need to verify gates catch shallow output.
- **Next action:** After LAT-136 merges, run a regression against LAT-127 to confirm shallow output is caught. Define `insufficient_change` refusal code.

### R-015 — English guardrails executed as shell commands

- **Category:** execution / checks
- **Question/Risk:** During LAT-127's live run, English-language guardrail text (e.g., `"No edits under forbidden paths."`) was passed as a shell command instead of being recognized as a policy check.
- **Owner:** Benjamin Elliott
- **Severity:** High
- **Status:** Resolved
- **Source:** LAT-127 (live run), LAT-135 (fix)
- **Decision deadline:** 2026-05-03 (resolved in PR)
- **Latest note:** Fixed by LAT-135 which added `kind` field to distinguish `shell` vs `policy` checks.
- **Next action:** Monitor new checks for `kind` correctness during implementation.

### R-016 — Hidden autonomy creep from frontier model synthesis

- **Category:** dispatch / autonomy
- **Question/Risk:** LAT-132 defines that synthesis may recommend/classify but deterministic gates enforce. Need to define where future Perplexity/frontier model synthesis may plug in without causing hidden autonomy creep (e.g., agents making architecture decisions via synthesis).
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Watch
- **Source:** LAT-132 (ADR-0021)
- **Decision deadline:** Before frontier model plug-in is enabled
- **Latest note:** ADR-0021 defines the boundary: synthesis recommends, gates enforce. Classifier schema and evidence requirements need formalization.
- **Next action:** Add a `synthesis_model` field to run artifacts. Add approval gate when synthesis model differs from the baseline local model.

### R-017 — MVP vs fast-follow split is under-specified

- **Category:** planning / roadmap
- **Question/Risk:** LAT-133 defines MVP vs fast-follow areas (label-driven polling, queue/concurrency, daemon/scheduler, dashboard, auto-review) but the split is not codified into actionable items. Without explicit MVP boundaries, scope can creep.
- **Owner:** Benjamin Elliott
- **Severity:** Low
- **Status:** Watch
- **Source:** LAT-133 (PRD)
- **Decision deadline:** Before planning next sprint/milestone
- **Latest note:** LAT-133 PRD documents MVP vs fast-follow. Not yet tracked as backlog items.
- **Next action:** Convert fast-follow items into LAT-* backlog items. Prioritize queue/concurrency and dashboard.

### R-018 — Linear evidence comment not sufficient for diagnosing run quality

- **Category:** observability / workflow
- **Question/Risk:** The Linear write-back comment provides high-level status but not enough detail to diagnose run quality. Structured local artifacts (LAT-140) address this, but the mapping between Linear comment and local artifact needs to be enforced.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Watch
- **Source:** LAT-140 (observability), ADR-0003 (Linear write-back)
- **Decision deadline:** Before first-run readiness gate
- **Latest note:** LAT-140 adds structured artifacts and compact Linear projections. Mapping between the two is partially implemented.
- **Next action:** Enforce that every Linear write-back includes a stable artifact reference (file path or URL) and a compact summary.

### R-019 — Stale worktrees and orphan branches accumulate

- **Category:** concurrency / hygiene
- **Question/Risk:** Without cleanup, failed or abandoned agent runs leave stale worktrees, orphan branches, and failed PRs. This wastes disk space and confuses future dispatch.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Watch
- **Source:** LAT-139 (ADR-0022)
- **Decision deadline:** After 3+ concurrent runs or 2 weeks of use
- **Latest note:** ADR-0022 defines failure cleanup concepts but not a specific policy.
- **Next action:** Define a cron job or manual command to prune worktrees older than N days without PRs. Add cleanup to agent preflight.

### R-020 — Cost band divergence: estimates may be wrong

- **Category:** cost / budget
- **Question/Risk:** ADR-0009 defines cost controls and runaway cost interrupts, but run estimates may systematically diverge from actual costs. Without tracking and adjusting, cost bands may be unreliable.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Watch
- **Source:** LAT-133 (PRD), LAT-140 (observability), ADR-0009
- **Decision deadline:** After 5+ runs or 1 week of operation
- **Latest note:** LAT-140 captures cost data in run artifacts. Retro loop reads cost band from evidence. No systematic tracking yet.
- **Next action:** Add cost tracking dashboard (spreadsheet or Linear view). Compare estimated vs actual cost per run. Adjust estimates quarterly.

### R-021 — No secrets in run artifacts

- **Category:** security / observability
- **Question/Risk:** Run artifacts may contain secrets, local tokens, endpoint URLs, or raw credentials. Redaction rules exist but must be tested against real data.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Watch
- **Source:** LAT-140 (observability), LAT-127 (live run)
- **Decision deadline:** Before first-run readiness gate
- **Latest note:** LAT-140 defines redaction rules and `redaction_provenance`. Testing against real artifacts is a follow-up.
- **Next action:** Add a test that runs redaction against a sample artifact and asserts no secrets remain. Verify with LAT-127 live run artifacts.

### R-022 — Run logs must be versioned alongside prompts/skills

- **Category:** observability / reproducibility
- **Question/Risk:** Without versioned prompt/skill references, run artifacts cannot be reliably reproduced or compared across time. LAT-140 mentions this as a follow-up.
- **Owner:** Benjamin Elliott
- **Severity:** Medium
- **Status:** Open
- **Source:** LAT-140 (observability)
- **Decision deadline:** Before first-run readiness gate
- **Latest note:** Run artifacts need `prompt_version` and `skill_version` fields. Versioning strategy not yet defined.
- **Next action:** Define versioning strategy (e.g., git SHA of prompt template, skill file hash). Add to run artifact schema.

---

## Review history

| Date | Reviewer | Entries reviewed | Changes | Next action |
|---|---|---|---|---|
| 2026-06-14 | Hermes Agent | All (initial seed) | Created register with 22 entries | Review before first-run readiness gate |

---

## Cadence and integration

This register is referenced by:

1. **Retro/refinement loop** — `docs/process/retrospective-learning-loop.md` reads this register as an input surface. Every retro checks for new entries and reviews `Open`/`Watch` items.
2. **First-run readiness gate** — Before the flywheel is marked ready for production runs, all `Critical` entries must be `Resolved` and all `High` entries must be `Resolved` or `Watch` with a `next_action` assigned.
3. **Monthly minimum cadence** — At least monthly, the owner reviews and updates all `Open` and `Watch` entries. Resolved entries older than 30 days are archived.

## Related

- [ADR-0010](../decisions/0010-retrospective-learning-loop.md): Retrospective learning loop (cadence, promotion paths)
- [ADR-0009](../decisions/0009-cost-controls-and-runaway-cost-interrupts.md): Cost controls
- [ADR-0021](../decisions/0021-dispatcher-synthesis-boundary-and-deterministic-hard-stops.md): Dispatcher synthesis boundary
- [ADR-0022](../decisions/0022-concurrent-local-agent-sandboxing-model.md): Concurrent sandboxing model
- [LAT-132](https://linear.app/latentspacelabs/issue/LAT-132): Dispatcher synthesis boundary ADR
- [LAT-133](https://linear.app/latentspacelabs/issue/LAT-133): Useful local agent dispatch loop MVP PRD
- [LAT-139](https://linear.app/latentspacelabs/issue/LAT-139): Concurrent local agent sandboxing ADR
- [LAT-140](https://linear.app/latentspacelabs/issue/LAT-140): Structured observability for local agent runs
- [LAT-127](https://linear.app/latentspacelabs/issue/LAT-127): Deduplicate MCP and opencode hygiene guidance (live-run findings)
- [LAT-136](https://linear.app/latentspacelabs/issue/LAT-136): Output quality gates for shallow agent output
- [LAT-137](https://linear.app/latentspacelabs/issue/LAT-137): Local agent prompt and skill optimization
