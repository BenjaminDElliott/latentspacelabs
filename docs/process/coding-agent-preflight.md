# Coding-agent preflight guardrails

This document is the **preflight contract** a coding or documentation agent must satisfy *before it edits any file in this repo*. It is the runtime companion to `approval-gates-and-autonomy-rules.md`: that doc governs *whether* an agent may act; this doc governs *how* the agent must check its own instructions against repo policy *before* acting.

Preflight runs on the agent side — inside the agent harness, before the first write — not on the ticket-refinement side. The ticket-refinement preflight lives in [`../templates/agent-ready-ticket.md`](../templates/agent-ready-ticket.md) → *Pre-flight: refuse to mark agent-ready*. The two preflights are complementary:

| Preflight | Runs | Owner | Purpose |
|---|---|---|---|
| Ticket preflight (agent-ready) | Before a ticket is labelled `agent-ready` and dispatched | Dispatcher / refinement | Is this ticket fit to dispatch? |
| **Coding-agent preflight (this doc)** | **After dispatch, before the agent's first edit** | **The running agent** | **Do my instructions conflict with repo policy?** |

If either preflight fails, the agent does **not** proceed. Refusal behaviour is defined below (§ *Refusal and warn behaviour*).

## Why this exists

Prior coding-agent runs drifted from architecturally significant decisions already landed in `docs/decisions/` and from process rules landed in `docs/process/`. Typical failure modes observed:

- A ticket asked for a Python implementation in a TypeScript/Node/npm repo. ADR-0011 picks TypeScript on Node.js with npm workspaces; ignoring that locks the pilot into a parallel toolchain.
- A ticket used legacy terminology (e.g. "ACL" / "Agent Control Layer") that ADR-0012 has renamed to **ICP / Integration Control Plane**.
- A docs-only PR proposed adding a sibling link to `docs/README.md` or a row to a Markdown table the PR did not own. ADR-0004 and the `docs/decisions/README.md` / `docs/prds/README.md` anti-drift notes explicitly deprecate hand-maintained indexes.
- Run reports omitted `cost.band`, in violation of ADR-0009 / `cost-controls.md`.

These are not code-style nits. They are places where the agent's local instructions (a ticket body, a slash-command prompt, a user message) silently conflicted with a higher-order doc or ADR, and the agent chose the local instruction. The preflight exists to make those conflicts *visible and actionable* at the last safe moment before the first write.

## Scope

**In scope.** Any run by a coding, documentation, QA, review, or research agent that might:

- create or edit files in this repo;
- open a PR or push a branch;
- choose a language, runtime, package manager, or dependency;
- touch shared / cross-cutting Markdown surfaces (`docs/README.md`, `docs/process/README.md`, `docs/decisions/README.md`, `docs/prds/README.md`, or any table/list/index inside those files);
- write an ADR, PRD, run report, or Linear write-back.

**Out of scope.** Pure read-only research spikes that produce no durable artefact (a draft comment in a Perplexity thread, an in-memory summary back to the user). If the run ends without a write, preflight is informational only.

## How to run preflight

The agent performs these checks, in order, before the first file edit. Each check is concrete, pass/fail, and names the artefact that would falsify it.

At minimum the agent must read:

- the ticket body (inputs, constraints, acceptance criteria);
- this document;
- [`approval-gates-and-autonomy-rules.md`](approval-gates-and-autonomy-rules.md);
- [`cost-controls.md`](cost-controls.md);
- [`operating-model.md`](operating-model.md) (for the PR ↔ Linear linking convention);
- any ADR or PRD the ticket links to;
- the README of any directory the ticket plans to touch.

`ls docs/decisions/` and `ls docs/prds/` are the authoritative indexes. Do not rely on a hand-maintained table anywhere — read the files directly.

## Preflight checks

### A. Architecture-policy checks

The agent must confirm each of the following before writing code or docs. A failure is a **refuse** unless the ticket or a linked approval explicitly overrides it in writing (§ *Explicit override*).

1. **TypeScript / Node / npm.** Any new code package must be TypeScript on Node.js inside an npm workspace under `packages/*`. No new Python, Go, Elixir, or Bash packages without an ADR that supersedes or scopes around ADR-0011. A ticket that asks for "a small Python script" in repo tooling is a refuse — ask, do not silently comply.
2. **ICP terminology.** New docs, run reports, and Linear write-backs use **ICP / Integration Control Plane**, not ACL / Agent Control Layer, per ADR-0012. Existing ADR-0008 and older text keeps its original wording when quoted; the preflight applies to *new* prose the agent writes.
3. **Approval gates.** The action's category (P-Direct, P-Propose, ICP-Routed, Stop) and minimum autonomy level are identified in `approval-gates-and-autonomy-rules.md` → *Rule matrix*. If the action is Stop or requires a level the run does not have, the agent refuses.
4. **Cost controls.** The ticket has a numeric `Budget cap`. The agent's run report will carry `cost.band` per ADR-0009. If the cap is missing or non-numeric, refuse; the runaway-cost interrupt applies regardless of autonomy level.
5. **PR title Linear key.** The PR title will start with the ticket's `LAT-NN:` prefix per `operating-model.md` → *PR ↔ Linear linking convention*. Multi-ticket PRs follow the same convention's multi-issue rule. A PR title without the `LAT-NN:` prefix is a refuse (except for the narrow *no-Linear-issue* escape clause in `operating-model.md`, which must be cited explicitly).
6. **Direct-to-main PR target.** Unless the ticket explicitly names a different base, PRs target `main` directly. Do not stack on another branch "for convenience." If the ticket requires stacking, it must say so.
7. **ADR / PRD naming and frontmatter.** If the run produces or edits an ADR or PRD, the filename and frontmatter must match the policies in [`../decisions/README.md`](../decisions/README.md) and [`../prds/README.md`](../prds/README.md):
   - ADR filename: `NNNN-title-with-dashes.md`, frontmatter `id: ADR-NNNN` matches the prefix, required fields present.
   - Feature PRD filename: `LAT-NN-<slug>.md`, frontmatter `prd_id` equals the filename stem, `LAT-NN` appears in `related_linear`, `derived_from` points at an existing root PRD.
   - Root PRD filename: `root-<stable-slug>.md`, no number. A new root PRD needs ADR approval.
   - Do **not** add the new file to a hand-maintained table in a README. The READMEs in `docs/decisions/` and `docs/prds/` have both explicitly removed index tables because they drifted under parallel PRs.

### B. Conflict-surface checks (shared / cross-cutting Markdown)

The following files and surfaces are **shared hubs**. A ticket edits them only if it *explicitly owns that hub* — i.e. the ticket body names the file and describes the policy change, not merely a content addition. A ticket that reaches for a shared hub just to add a sibling link, a row, or a bullet is a refuse/warn.

Shared hubs to treat as conflict surfaces:

- `docs/README.md` (top-level docs index and canonical-sources table).
- `docs/process/README.md` (process directory index).
- `docs/decisions/README.md` (ADR index policy; the table was removed deliberately — do not re-add).
- `docs/prds/README.md` (PRD index policy; the table was removed deliberately — do not re-add).
- `docs/process/approval-gates-and-autonomy-rules.md` (rule matrix — any edit is an ADR-level decision).
- `docs/process/operating-model.md` (PR-linking and role boundaries).
- Any `README.md` at a directory root that is not the directory the ticket scopes.
- Any hand-maintained Markdown table, bulleted list of related issues, or index inside those files.

Rule of thumb: **if the change is "add one more bullet to a list I did not write," stop.** Surface it in the PR body and the Linear write-back as a *follow-up for the hub owner* instead of editing the hub opportunistically.

Additions to *this* ticket's own new/edited file are not conflict-surface edits; the restriction applies to hubs owned by other tickets or by the repo's baseline policy.

### C. ADR / PRD / run-report content checks

- **ADRs.** If writing a new ADR, the file follows [`../templates/adr.md`](../templates/adr.md); the `revisit_trigger` is concrete (names the condition, not a date); status begins as `proposed` unless the ticket explicitly authorises `accepted`.
- **PRDs.** If writing a new PRD, the file follows [`../templates/prd.md`](../templates/prd.md); frontmatter matches the rules in [`../prds/README.md`](../prds/README.md); `status` begins as `draft`.
- **Run reports.** Every code-producing run emits a run report per [`../templates/agent-run-report.md`](../templates/agent-run-report.md) with `cost.band` set per ADR-0009 / `cost-controls.md`. A missing `cost.band` is a refuse at write-back time.
- **Write-backs.** Linear write-backs follow the five-element contract in ADR-0003 / `operating-model.md` (outcome, evidence, risk flags, PR link, next action).

## Refusal and warn behaviour

When a preflight check fails, the agent's first action is to **stop writing files** and produce a structured refusal. The shape mirrors the ticket-preflight refusal shape so the refinement loop has a durable record.

### Refuse — halt and ask

Any of the following triggers a hard refuse:

- An architecture-policy check in § A fails and no written override is present.
- A Stop-category action per `approval-gates-and-autonomy-rules.md`.
- A conflict-surface edit in § B without explicit hub ownership in the ticket.
- Missing numeric `Budget cap` or absent `cost.band` plan (ADR-0009).
- The ticket's instructions *directly contradict* an `accepted` ADR or a process doc, without citing and overriding it.

On refuse, the agent:

1. Opens no PR and pushes no branch.
2. Writes a short refusal block (shape below) into a run-report draft and into the Linear write-back as a comment.
3. Routes the ticket to `needs-human`.

### Warn — proceed with a visible flag

Some failures are not refuses but still must surface. A warn is used when:

- The ticket is internally fine but touches a borderline shared surface the agent is *not* adding to (only reading).
- A check passed but required interpretation (e.g. the ticket names a `LAT-NN` prefix that is valid but unusual).
- The run is in the `elevated` cost band per ADR-0009.

On warn, the agent proceeds but records the warn in the run report's `Risks:` line and in the Linear write-back so a reviewer sees it without having to dig.

### Refusal output shape

```md
## Preflight: REFUSED

Failed checks:
- (A.1) Ticket asks for a Python helper; repo policy per ADR-0011 is TypeScript/Node/npm.
- (B)   Ticket proposes adding a link to `docs/README.md` but does not own that hub.

Cited policy:
- ADR-0011 — `docs/decisions/0011-integration-control-plane-language-and-runtime.md`
- docs/process/coding-agent-preflight.md § A.1, § B

Action: stop. Route ticket to `needs-human`. Do not edit files.
```

### Explicit override

An override is only valid if it:

- names the specific check by section (e.g. "override A.1"),
- cites the higher-order authority that justifies the override (a newer accepted ADR, a direct instruction from Ben recorded in the ticket body or a linked Linear comment), and
- is present *in writing*, not inferred from user tone.

"Do it anyway" in a chat bubble is not an override. The agent asks for the override to be recorded in the ticket, then re-runs preflight.

## When ticket instructions conflict with higher-order ADRs or process docs

This is the class of conflict preflight is most sensitive to. The resolution rule is simple and always the same:

> **Higher-order policy wins until superseded.** The hierarchy is: `accepted` ADR > process doc > template > ticket body > slash-command prompt > chat instruction.

Concretely:

- If the ticket conflicts with an `accepted` ADR, the agent **refuses** and asks for either (a) an override per § *Explicit override*, or (b) a superseding ADR drafted first.
- If the ticket conflicts with a process doc, the agent **refuses** unless the ticket explicitly names and supersedes that policy. "Update `docs/process/X`" as a goal is legitimate; silently acting against `docs/process/X` while doing something else is not.
- If the ticket conflicts with a template (e.g. skipping a required section of a run report), the agent **refuses** and states which template field would be violated.
- If a slash-command prompt conflicts with the ticket body, the ticket body wins.
- If a chat instruction conflicts with any of the above, the agent asks for the instruction to be promoted into the ticket before acting.

A superseding ADR can sit at `proposed` status while the conflict is being resolved, but the agent does not act against an `accepted` ADR on the strength of a `proposed` one alone. The merge of the superseding ADR (or an explicit override) is what unblocks the run.

## Skill-contract alignment

ADR-0012 accepts a skill framework as the ICP's primary runtime shape: every skill carries a typed contract, an approval/autonomy level, an evidence contract, and a `derived_from:` provenance header. The checks in this document are the **contract requirements** future ICP coding skills must satisfy:

- The skill-runner's load-time check (the `derived_from:` files exist and are readable) is the runtime enforcement of § A.7 and § C.
- The skill-runner's policy evaluator is the runtime enforcement of § A.3 and § A.4 (`approval-gates-and-autonomy-rules.md` + `cost-controls.md`).
- The skill-runner's write-back formatter is the runtime enforcement of § C's write-back rule.
- The skill-runner's refusal path maps 1:1 to § *Refusal and warn behaviour*.

Until the skill framework lands (LAT-19 et al.), this document is executed by the agent harness as a manual checklist. After it lands, the same rules become structural: a skill that would violate them fails to load or fails its runner gate. The doc does not change; the enforcement layer does.

## Scope boundary with other preflights

- **Ticket-readiness preflight** — see [`../templates/agent-ready-ticket.md`](../templates/agent-ready-ticket.md). Runs before dispatch. If that preflight failed, this one does not run because the agent should not have been dispatched.
- **Cost-band interrupt** — see [`cost-controls.md`](cost-controls.md). Runs continuously during execution. Preflight checks the *setup* (cap present, band planned); cost-controls handles the *runtime* trigger.
- **QA / review** — see [`qa-review-evidence.md`](qa-review-evidence.md). Runs after the agent's work is produced. Preflight does not pre-empt QA; it prevents work that QA would reject on sight.

## Related

- ADR-0004 — process docs vs agent skills / commands (provenance contract).
- ADR-0005 — dispatch readiness and the `## Sequencing` block.
- ADR-0008 — Perplexity / ICP boundary and the four action categories.
- ADR-0009 — cost bands and runaway-cost interrupt.
- ADR-0011 — ICP language and runtime (TypeScript / Node / npm).
- ADR-0012 — ICP software architecture and skill framework.
- Linear: `LAT-35` (this guardrail).
