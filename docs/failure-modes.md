# Failure-mode register

> A structured register of recurring agent/process failures, their prevention mechanisms, and the regression loop that promotes repeated failures into backlog items. This is a **living control document** — not a heavy incident-management process, not a new hand-maintained index, and not a gate that blocks all agent work on completion of every mitigation.

## Why this exists

The first ICP build loop exposed repeated, recoverable failures that could have been prevented with one extra check or template field:

- Agents implemented tooling in Python despite ADR-0011's TypeScript/Node/npm decision.
- Agents chose pnpm for tooling despite npm being the declared package manager.
- PRD drafts used `0001-*` ADR-style numbering instead of `LAT-NN-*` Linear-keyed naming, causing filename collisions.
- Multiple agents edited shared README/index files from different branches, producing merge conflicts.
- Agents stacked branches on top of each other instead of targeting `main` directly.
- ADR numbering collisions occurred when parallel PRs claimed the same next number.
- Agents optimised locally for ticket closure at the expense of higher-order architecture decisions.

Without a living register, each cycle relearns the same lessons. This document captures them explicitly, maps each to a prevention mechanism, and defines how retrospectives promote repeated or newly observed failures into backlog tickets or preflight updates.

## Related

- [LAT-35](https://linear.app/latentspacelabs/issue/LAT-35) — coding-agent preflight guardrails (preflight rules live here).
- [LAT-11](https://linear.app/latentspacelabs/issue/LAT-11) — retrospective learning loop (retro promotes failures to backlog; this register is retro input).
- `docs/process/coding-agent-preflight.md` — the preflight contract this register maps to.
- `docs/process/retrospective-learning-loop.md` — how failures become template/prompt/backlog changes.
- `docs/templates/agent-ready-ticket.md` — ticket preflight that catches scope issues before dispatch.

---

## Register format

Each entry follows this structure. Use it when seeding known failures or adding new ones from retros.

```md
### FM-NNNN: Short title

| Field | Value |
|---|---|
| **Category** | architecture-decision-drift / naming-collision / conflict-surface / branch-strategy / scope-optimisation / tooling-choice / template-gap / other |
| **Observed in** | ICP build cycle 1 |
| **First seen** | YYYY-MM-DD |
| **Frequency** | recurring |
| **Status** | mitigated / at-risk / accepted |
| **Prevention mechanism** | One-line description |
| **Prevention type** | preflight-rule / validator / ci-check / template-change / review-checklist-item |
| **Maps to** | `coding-agent-preflight.md` §X.Y, `templates/agent-ready-ticket.md` §Z, or similar |
| **Related tickets** | LAT-XX, LAT-YY |
```

**Category definitions:**

| Category | When to use |
|---|---|
| `architecture-decision-drift` | Agent instructions conflicted with an accepted ADR (e.g. wrong language, wrong runtime). |
| `naming-collision` | Parallel agents chose the same identifier (ADR number, PRD number, file name). |
| `conflict-surface` | Multiple agents edited a shared Markdown hub (README, index table, cross-reference list). |
| `branch-strategy` | PRs stacked on non-main branches, wrong base branch, or missing Linear key in title. |
| `scope-optimisation` | Agent optimised locally for ticket closure while violating a higher-order policy. |
| `tooling-choice` | Agent chose a different tool, package manager, language, or framework than policy. |
| `template-gap` | A template was missing a required field, section, or constraint. |
| `other` | Does not fit the above. |

**Prevention type definitions:**

| Type | What it is |
|---|---|
| `preflight-rule` | A check the agent runs before its first edit (see `coding-agent-preflight.md`). |
| `validator` | A programmatic check (CLI, npm script, CI step) that validates file content, naming, or frontmatter. |
| `ci-check` | A GitHub Actions (or equivalent) step that fails the build on policy violation. |
| `template-change` | A modification to a ticket, ADR, PRD, or run-report template that forces the agent to fill in the right field. |
| `review-checklist-item` | A human-review step that checks for the condition before merge. |

**Status definitions:**

| Status | Meaning |
|---|---|
| `mitigated` | Prevention mechanism is implemented and active. |
| `at-risk` | Prevention mechanism is documented but not yet implemented. |
| `accepted` | Risk is acknowledged; no prevention mechanism deemed worth the cost. |

---

## Seeded failure modes

These are the failure modes observed during the first ICP build cycle. New ones are added after retrospectives per the regression loop (§ *Regression loop*).

### FM-0001: Python tooling despite TypeScript decision

| Field | Value |
|---|---|
| **Category** | tooling-choice |
| **Observed in** | ICP build cycle 1 |
| **First seen** | 2026-04-23 |
| **Frequency** | recurring |
| **Status** | mitigated |
| **Prevention mechanism** | Preflight check A.1 refuses any new Python/Go/Elixir/Bash package unless a superseding ADR exists. |
| **Prevention type** | preflight-rule |
| **Maps to** | `coding-agent-preflight.md` § A.1 |
| **Related tickets** | LAT-24, LAT-11, LAT-35 |

**Description.** A ticket asked for a Python implementation in a TypeScript/Node/npm repo. ADR-0011 picks TypeScript on Node.js with npm workspaces; implementing tooling in Python would lock the pilot into a parallel toolchain. The agent silently complied with the local ticket instruction over the higher-order ADR.

**Prevention.** The preflight now checks: "Any new code package must be TypeScript on Node.js inside an npm workspace under `packages/*`. No new Python, Go, Elixir, or Bash packages without an ADR that supersedes or scopes around ADR-0011." On fail, the agent refuses and asks unless the ticket explicitly cites an override.

---

### FM-0002: pnpm tooling despite npm preference

| Field | Value |
|---|---|
| **Category** | tooling-choice |
| **Observed in** | ICP build cycle 1 |
| **First seen** | 2026-04-23 |
| **Frequency** | recurring |
| **Status** | mitigated |
| **Prevention mechanism** | Preflight check A.1 names npm explicitly (not just "npm workspaces") as the declared package manager. |
| **Prevention type** | preflight-rule |
| **Maps to** | `coding-agent-preflight.md` § A.1 |
| **Related tickets** | LAT-24, LAT-35 |

**Description.** A ticket specified pnpm for a tooling package despite ADR-0011 declaring npm as the repo's package manager. This is a sibling of FM-0001 — the agent chose the local tooling instruction over the repo-level package manager policy.

**Prevention.** Preflight check A.1 now reads: "TypeScript on Node.js inside an npm workspace under `packages/*`" and explicitly lists npm as the package manager. pnpm, yarn, and bun are refused unless overridden by a superseding ADR.

---

### FM-0003: PRD 0001-\* drift (ADR-style numbering for feature PRDs)

| Field | Value |
|---|---|
| **Category** | naming-collision |
| **Observed in** | ICP build cycle 1 |
| **First seen** | 2026-04-23 |
| **Frequency** | recurring |
| **Status** | mitigated |
| **Prevention mechanism** | PRD README defines two naming conventions; feature PRDs must use `LAT-NN-<slug>.md` instead of `0001-<slug>.md`. Validation check added. |
| **Prevention type** | template-change / validator |
| **Maps to** | `docs/prds/README.md` → *File naming — two categories*, validation section |
| **Related tickets** | LAT-26, LAT-28, LAT-31, LAT-24 |

**Description.** Multiple PRD agents independently picked `0001-`, `0002-`, etc. for feature PRD filenames — mirroring ADR-style numbering. This caused filename collisions (PRs #22, #23, #24) and required renaming. The collision was structural: ADR-style numbering assumes serial execution, but PRD drafts are parallel.

**Prevention.** `docs/prds/README.md` defines two naming conventions: root PRDs use `root-<slug>.md` (non-numbered), feature PRDs use `LAT-NN-<slug>.md` (Linear-keyed). Validation in the future will check that no feature PRD uses a `0001-*` pattern. The ADR README's note about removing the hand-maintained table (because it drifted) extends to PRDs: no table, just filenames and frontmatter.

---

### FM-0004: Shared README / index conflicts

| Field | Value |
|---|---|
| **Category** | conflict-surface |
| **Observed in** | ICP build cycle 1 |
| **First seen** | 2026-04-23 |
| **Frequency** | recurring |
| **Status** | mitigated |
| **Prevention mechanism** | Preflight check B lists all shared hubs; agents edit a hub only if the ticket explicitly owns it. |
| **Prevention type** | preflight-rule |
| **Maps to** | `coding-agent-preflight.md` § B |
| **Related tickets** | LAT-24, LAT-25, LAT-27, LAT-35 |

**Description.** PRD agents edited `docs/prds/README.md` to add sibling links or table rows from different branches simultaneously, producing merge conflicts. The agents assumed the README was a shared index they could freely update — but it was the *hub* for that directory, and multiple owners caused drift.

**Prevention.** The preflight lists shared hubs: `docs/README.md`, `docs/process/README.md`, `docs/decisions/README.md`, `docs/prds/README.md`, `docs/process/approval-gates-and-autonomy-rules.md`, `docs/process/operating-model.md`, and any `README.md` at a directory root not owned by the ticket. Rule: "If the change is 'add one more bullet to a list I did not write,' stop." The agent surfaces the change in the PR body and marks it as a "follow-up for the hub owner" rather than editing the hub opportunistically.

---

### FM-0005: Stacked branches

| Field | Value |
|---|---|
| **Category** | branch-strategy |
| **Observed in** | ICP build cycle 1 |
| **First seen** | 2026-04-23 |
| **Frequency** | recurring |
| **Status** | mitigated |
| **Prevention mechanism** | Preflight check D requires PRs to target `main` directly unless the ticket explicitly names a different base. |
| **Prevention type** | preflight-rule |
| **Maps to** | `coding-agent-preflight.md` § A.6 |
| **Related tickets** | LAT-24, LAT-35 |

**Description.** Agents stacked branches on top of each other "for convenience" instead of targeting `main` directly. This made it hard for reviewers to see the full diff of each PR and caused confusion about which PRs were ready for merge independently.

**Prevention.** Preflight check A.6 states: "Unless the ticket explicitly names a different base, PRs target `main` directly. Do not stack on another branch 'for convenience.' If the ticket requires stacking, it must say so."

---

### FM-0006: ADR numbering collisions

| Field | Value |
|---|---|
| **Category** | naming-collision |
| **Observed in** | ICP build cycle 1 |
| **First seen** | 2026-04-23 |
| **Frequency** | recurring |
| **Status** | mitigated |
| **Prevention mechanism** | Agents must read `ls docs/decisions/` to find the next available ADR number rather than guessing from sequential counting. Validation enforces no duplicate prefixes or IDs. |
| **Prevention type** | preflight-rule / validator |
| **Maps to** | `coding-agent-preflight.md` § A.7, `docs/decisions/README.md` → *Mechanical validation* |
| **Related tickets** | LAT-13, LAT-17, LAT-35 |

**Description.** Parallel PRs writing ADRs both assumed they should take the next sequential number (e.g., both claimed `ADR-0006`), producing duplicate IDs and filename conflicts. The agent did not read the directory listing to check what numbers were already taken.

**Prevention.** Two layers:
1. **Preflight A.7:** "Read the directory listing (`ls docs/decisions/`) — it is the authoritative index. Pick a number that is not already claimed."
2. **Validator:** The `@latentspacelabs/adr-tools` package enforces no duplicate prefixes or duplicate frontmatter `id` fields in `docs/decisions/`.

---

### FM-0007: Local ticket optimization over higher-order architecture

| Field | Value |
|---|---|
| **Category** | scope-optimisation |
| **Observed in** | ICP build cycle 1 |
| **First seen** | 2026-04-23 |
| **Frequency** | recurring |
| **Status** | mitigated |
| **Prevention mechanism** | Preflight hierarchy rule: `accepted ADR > process doc > template > ticket body > slash-command prompt > chat instruction`. On conflict, the agent refuses unless the ticket cites and overrides the higher-order authority. |
| **Prevention type** | preflight-rule |
| **Maps to** | `coding-agent-preflight.md` § *When ticket instructions conflict with higher-order ADRs or process docs* |
| **Related tickets** | LAT-11, LAT-19, LAT-35 |

**Description.** Agents optimised locally for ticket closure — following the ticket's direct instructions even when they silently conflicted with an accepted ADR, process doc, or template. The agent treated the ticket body as the highest authority in the room, rather than the declared hierarchy.

**Prevention.** The preflight defines a strict hierarchy: "Higher-order policy wins until superseded." Concretely:
- Conflicts with an `accepted` ADR → refuse (unless override present).
- Conflicts with a process doc → refuse (unless ticket names and supersedes it).
- Conflicts with a template → refuse (states which template field would be violated).
- Conflicts with slash-command prompt → ticket body wins.
- Conflicts with chat instruction → ask for the instruction to be promoted into the ticket.

An override is only valid if it names the specific check by section, cites the higher-order authority, and is present *in writing* (not inferred from tone).

---

## Regression loop

This section defines how the failure-mode register stays current — how new failures are captured and repeated failures are promoted to backlog items, template changes, or preflight rules.

### When to check

| Trigger | What to do |
|---|---|
| **After every pilot cycle** (per LAT-11 cadence) | Review the six retro questions. For any "repeated agent failure patterns" (§ 3 of the six questions), check if a failure-mode entry already exists. If not, create one. |
| **During QA/review** (ADR-0007, `qa-review-evidence.md`) | If a `medium`/`high` finding is a failure mode not yet in the register, add it with status `at-risk`. |
| **During PR review** (`pr-review-report.md`) | If a reviewer catches a policy violation not covered by the preflight, log it as a potential new failure mode. |
| **Ongoing** | Any team member can open a PR to add a failure mode at any time. No gate required. |

### Promotion path

When a failure mode's status is `at-risk` and it appears in two or more cycles (or once with high severity), promote it:

1. **If a prevention mechanism is implementable** → create a backlog ticket (per LAT-11's *Backlog item* promotion path). The ticket should reference the failure-mode entry and specify the mechanism type (preflight, validator, CI check, template change, review item).
2. **If the mechanism is a preflight or template change** → update the relevant doc directly (`coding-agent-preflight.md`, `templates/agent-ready-ticket.md`, etc.). This is a *Prompt/template update* promotion per LAT-11.
3. **If the mechanism is a new ADR** → create a proposed ADR in `docs/decisions/`. This is an *Architecture decision candidate* promotion per LAT-11.
4. **If the mechanism is a CI check** → create a backlog ticket for the CI implementation.

### Review cycle

- **Every retro**, the person running the retro scans the register and checks each entry's status:
  - `mitigated` → verify it's still working (spot-check one recent PR/run).
  - `at-risk` → if it appeared ≥2 times in recent cycles, promote to a backlog ticket.
  - `accepted` → re-evaluate if context has changed.
- Entries with no prevention mechanism produce a backlog item or explicit acceptance of risk. No entry is ever orphaned.

### Register maintenance rules

1. **Don't archive.** Old failure modes stay in the document as historical record. Their `observed in` field captures the cycle.
2. **Don't deduplicate aggressively.** If two failures share a prevention mechanism but have different root causes, keep them as separate entries. Cross-link them with `Related tickets`.
3. **Keep it lightweight.** A failure-mode entry is 10–20 lines. If it grows beyond ~50 lines, split the description into a linked doc or move details to a retro report.
4. **No hand-maintained index.** The document *is* the index — entries are in order by FM-NNNN. Adding a new entry at the bottom is sufficient.

---

## Appendix: prevention mechanism reference

### Preflight rules (from `coding-agent-preflight.md`)

| Rule | FM address |
|---|---|
| A.1 TypeScript/Node/npm | FM-0001, FM-0002 |
| A.3 Approval gates | FM-0007 |
| A.4 Cost controls | (future) |
| A.6 Direct-to-main target | FM-0005 |
| A.7 ADR/PRD naming | FM-0003, FM-0006 |
| B. Shared hub ownership | FM-0004 |
| Conflict hierarchy (higher-order wins) | FM-0007 |

### Validation checks

| Check | FM address |
|---|---|
| `npm run validate:adrs` — filename, frontmatter, no duplicates | FM-0006 |
| PRD filename pattern (`LAT-NN-*` or `root-*`) | FM-0003 |
| PRD `prd_id` matches filename stem | FM-0003 |
| Future: CI check for shared README changes (lock step or hub-owner) | FM-0004 |

### Template changes

| Template | FM address | Change |
|---|---|---|
| `templates/agent-ready-ticket.md` | FM-0007 | `Constraints` section should mention architecture policy (ADR-0011) as a default constraint. |
| `templates/adr.md` | FM-0006 | Frontmatter `id` field enforced to match filename prefix. |
| `templates/prd.md` | FM-0003 | Frontmatter `prd_id` must match `LAT-NN` or `root-` pattern. |

### Review checklist items

| Item | FM address |
|---|---|
| "PR targets `main` directly (not stacked)" | FM-0005 |
| "No hand-maintained README tables edited without ownership" | FM-0004 |
| "ADRs have unique numbers — checked via `ls docs/decisions/`" | FM-0006 |
| "Tooling language matches ADR-0011 (TypeScript/Node/npm)" | FM-0001, FM-0002 |

---

*This document is part of the Agentic Development Flywheel MVP. Created as part of LAT-46. Updated as failures are observed.*
