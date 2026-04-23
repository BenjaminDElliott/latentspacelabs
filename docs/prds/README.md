# Product Requirements Documents (PRDs)

This directory is the canonical, durable home for PRDs supporting the **Agentic Development Flywheel / Integration Control Plane (ICP)**.

PRDs describe **what** we're building and **why**; ADRs (`docs/decisions/`) record load-bearing architectural decisions; process docs (`docs/process/`) describe **how** we work.

## Where PRDs live

- **Canonical location:** this directory (`docs/prds/`).
- **Linear:** tracks scope, status, and child tickets for each PRD. Each PRD file links back to its Linear issue(s); each Linear issue should link forward to the merged PRD file URL.
- **Perplexity / workspace drafts:** working drafts only. Promote to this directory via PR when a PRD is ready for durable review.

Perplexity threads are ephemeral reasoning surfaces. A PRD that lives only in Perplexity or a shared chat is **not** a source of truth — it must be landed here to govern work.

## File naming — two categories, deliberately different

PRDs in this repo come in two shapes. They use different naming conventions on purpose.

### 1. Root PRDs — stable slug, non-numbered

The **root PRD** describes the product at its widest level (the Agentic Development Flywheel / ICP itself) and is the parent conceptual document every feature PRD descends from.

- Filename: `root-<stable-slug>.md`.
- Canonical root PRD today: [`root-agentic-development-flywheel.md`](root-agentic-development-flywheel.md).
- Root PRDs are **not** numbered. There is expected to be a very small number of them (today: one). Numbering them would imply a sequence that doesn't exist and invite collision.
- A new root PRD is added only when the product itself forks (e.g., a second product line). This requires ADR-level approval.

### 2. Feature PRDs — keyed by Linear issue

Every PRD that scopes a specific feature, surface, or subsystem is **keyed by the Linear issue that motivates it**.

- Filename: `LAT-NN-<short-kebab-slug>.md` — e.g. `LAT-29-low-friction-intake.md`.
- The `LAT-NN` prefix MUST be the Linear issue that owns the PRD (the "PRD ticket"), not a related epic or downstream implementation ticket.
- The short slug after `LAT-NN-` should be ≤ ~6 words, lowercase, kebab-cased, and stable — rename only if the PRD's scope materially changes.
- The slug is a readability aid; the `LAT-NN` prefix is what makes the filename unique.

**Why not `0001-`, `0002-`, … like ADRs?** Parallel PRD drafts (three agents, three PRDs at once) all take "the next number" and collide — exactly the `0001-*` drift currently sitting in PRs #22 / #23 / #24. Linear issue IDs are globally unique, immutable, and assigned before the PRD is drafted, so they are collision-free by construction.

**Why not a pure slug?** Slugs drift — PRD agents often pick different slugs for the same concept ("intake-ux" vs "intake-triage" vs "low-friction-intake"). Anchoring on the Linear ID makes the mapping PRD ↔ Linear work graph unambiguous.

**Why not generated from frontmatter?** No generator exists yet. When one lands, the `prd_id` in frontmatter becomes authoritative and filenames can be checked against it; until then, the filename is the ID.

### Examples

| OK | Not OK | Why |
|---|---|---|
| `root-agentic-development-flywheel.md` | `root.md`, `0000-root.md` | Root needs a stable descriptive slug; no number. |
| `LAT-29-low-friction-intake.md` | `0001-low-friction-intake.md` | Feature PRDs are keyed by Linear issue, not a counter. |
| `LAT-26-agent-evaluation-qa-harness.md` | `0002-agent-evaluation-and-qa-harness.md` | Same. |
| `LAT-28-icp-observability-cockpit.md` | `0001-icp-observability-cockpit.md` | Same. |

## Frontmatter — required fields

Every PRD MUST start with YAML frontmatter carrying at minimum:

```yaml
---
prd_id: root-agentic-development-flywheel   # root PRDs: the slug; feature PRDs: LAT-NN
title: Agentic Development Flywheel (root PRD)
status: draft                                # draft | in-review | approved | superseded | archived
owner: Ben Elliott
date: YYYY-MM-DD
related_linear:                              # all Linear issues that scope or derive from this PRD
  - LAT-NN
related_adrs:                                # ADRs that encode decisions from or feeding this PRD
  - ADR-NNNN
derived_from:                                # parent PRD for feature PRDs; blank for root PRDs
  - root-agentic-development-flywheel
supersedes:                                  # prior PRD file this one replaces, if any
superseded_by:
---
```

Rules:

- `prd_id` MUST equal the filename stem (without `.md`). This is the load-bearing uniqueness key once validation lands.
- For feature PRDs: `prd_id` starts with `LAT-NN` and the `LAT-NN` appears in `related_linear`.
- `derived_from` on a feature PRD MUST point at a root PRD that exists in this directory. The root PRD's `derived_from` is empty.
- `status` values match the PRD template's lifecycle (`draft`, `in-review`, `approved`, `superseded`, `archived`).

See the PRD template at [`../templates/prd.md`](../templates/prd.md) for the full body structure.

## Status lifecycle

| Status | Meaning | Allowed changes |
|---|---|---|
| `draft` | Being written | Edit freely |
| `in-review` | Ready for review, not yet approved | Edit in response to review |
| `approved` | Active PRD governing work | Do not materially edit; supersede instead |
| `superseded` | Replaced by a newer PRD | Set `superseded_by` |
| `archived` | No longer relevant; not superseded | Keep for history; do not edit |

Approved PRDs are immutable in spirit: if scope materially changes, write a new PRD and link `supersedes` / `superseded_by`, same as ADRs.

## Source of truth

**PRD files and their frontmatter are authoritative.** To find or check the status of PRDs, `ls docs/prds/` and read the frontmatter directly. This README intentionally does **not** maintain a hand-edited index table of PRD IDs and statuses. A prior version of the ADR README kept such a table, it drifted under parallel PRs, and the same failure mode applies here. Until a generated/validated index exists, the files in this directory are the answer.

## Validation — current state

No automated PRD validator exists on `main` today. LAT-24 proposes ADR-specific validation in Python; a companion PRD validator is explicit follow-up work (see below). Until that lands, treat the following as **review-time checks** for every PRD PR:

- [ ] Filename matches one of the two patterns: `root-<slug>.md` or `LAT-NN-<slug>.md`.
- [ ] `prd_id` in frontmatter equals the filename stem.
- [ ] For feature PRDs: the `LAT-NN` in the filename is the Linear "PRD ticket" and appears in `related_linear`.
- [ ] `derived_from` points at an existing PRD file (or is empty for root PRDs).
- [ ] `status` is one of the values in the lifecycle table.
- [ ] No other PRD file in the directory has the same `prd_id`.
- [ ] Cross-links in the PRD body resolve to files that exist (ADRs, process docs, sibling PRDs).

## Future validation (follow-up)

Explicit follow-ups, **not implemented in LAT-31**:

- **Duplicate `prd_id` / filename detection.** Fail the build if two files under `docs/prds/` share the same `prd_id` or filename stem.
- **Filename / `prd_id` consistency.** Fail the build if the filename stem does not match `prd_id`.
- **Root-PRD singleton guard.** Warn if more than one `root-*.md` file exists without an ADR justifying the fork.
- **`derived_from` resolution.** Fail the build if `derived_from` on a feature PRD does not name an existing root PRD in this directory.
- **Linear-issue prefix check.** Warn if a feature PRD's `LAT-NN` filename prefix does not appear in `related_linear`.

If and when a generator/validator lands, this section is where it should be described.

## When to write a PRD

Write a PRD when the decision about **what** to build is wide enough that it cannot live on a single Linear ticket without losing coherence. Concretely:

- A new surface or subsystem (intake, QA harness, observability cockpit).
- A meaningful shift in scope of an existing product area.
- A cross-cutting product requirement that multiple tickets/epics will implement.

Do **not** write a PRD for:

- A single ticket's implementation detail — use the agent-ready-ticket template.
- A pure architectural decision — use an ADR.
- A process change — use `docs/process/`.

## Anti-astronautics guardrail

> No PRD is landed unless it either unblocks a real piece of work, closes a real scope question, or canonicalizes a product decision already being relied on. PRDs are **durable scope artifacts**, not speculative roadmaps.

## Related

- Template: [`../templates/prd.md`](../templates/prd.md).
- Root PRD: [`root-agentic-development-flywheel.md`](root-agentic-development-flywheel.md).
- ADR directory: [`../decisions/`](../decisions/).
- Linear: `LAT-31` (this governance policy), `LAT-23` (canonical root PRD), `LAT-24` (ADR validation — PRD validation is a follow-up sibling).
