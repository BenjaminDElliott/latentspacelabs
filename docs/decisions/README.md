# Architecture Decision Records

This directory is the canonical log of architecturally significant decisions for the Agentic Development Flywheel MVP.

## Where ADRs live

- **Canonical:** this directory (`docs/decisions/`).
- **File naming:** `NNNN-title-with-dashes.md`, zero-padded 4-digit sequence, MADR-style.
- **Linear:** tracks summaries, status, and follow-up work. Each ADR should link back to the relevant `LAT-*` issue(s); each Linear issue should link forward to the merged ADR file URL.
- **Perplexity / workspace drafts:** working drafts only. Promote to this directory via PR when ready.

## When to write an ADR

Write an ADR when a decision materially affects **autonomy, persistence, observability, security, cost, integration boundaries, or future reversibility**. Concretely:

- Where durable state lives (Linear vs repo vs telemetry substrate).
- Whether a system becomes custom-built or delegated to Perplexity/Linear/GitHub.
- Human approval boundaries and autonomy progression.
- Connector permissions and least-privilege policy.
- Agent run event storage and query surface.

## When *not* to write an ADR

- Variable names, template wording, UI copy.
- Ordinary refactors with no strategic impact.
- One-off implementation conveniences.
- Anything that can be decided, reversed, and re-decided without structural cost.

## Status lifecycle

| Status | Meaning | Allowed changes |
|---|---|---|
| `proposed` | Under discussion | Edit freely |
| `accepted` | Active decision governing work | Do not materially edit; supersede instead |
| `rejected` | Considered and explicitly not chosen | Do not reopen; new ADR if context changes |
| `superseded` | Replaced by a newer ADR | Add `superseded_by` link |
| `revisit-by` | Accepted for now, requires review at a trigger | Minor metadata only |

Accepted ADRs are immutable in spirit: if the decision changes, write a new ADR and link `supersedes` / `superseded_by`.

## Source of truth

Each ADR file is the sole source of truth for its own status, decision makers, and supersession links. The file's frontmatter is authoritative; anything outside the file (this index, Linear labels, PR descriptions) is a navigation aid only and may lag.

If this index and an ADR file disagree, **trust the file**. Fix the index in the same PR that changed the file's status.

## Index (navigation aid — not authoritative)

The table below is for scanning. Status is copied from each ADR's frontmatter at write time and will drift if not updated alongside the ADR. We accept that risk for now; a future CI check should validate that the index matches each file's frontmatter and fail the build on drift (tracked as a follow-up; see ADR-0004 for the broader docs-vs-skills automation question).

| ID | Title | Status (see file) |
|---|---|---|
| [0001](0001-use-perplexity-linear-and-github-as-control-plane.md) | Use Perplexity, Linear, and GitHub as the control plane | accepted |
| [0002](0002-store-process-docs-and-adrs-in-the-monorepo.md) | Store process docs and ADRs in the monorepo | accepted |
| [0003](0003-linear-persistence-boundary.md) | Linear persistence boundary | accepted |
| [0004](0004-process-docs-vs-agent-skills.md) | Process docs vs agent skills and commands | proposed |
| [0006](0006-agent-run-visibility-schema.md) | Agent run visibility schema (pilot) | accepted |

## Anti-astronautics guardrail

> No architecture decision is accepted unless it either unblocks the next pilot slice, prevents a known risk, or records a decision already being relied on.

## Related

- Template: `docs/templates/adr.md`.
- Linear: `LAT-13` (this ADR process).
