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

**ADR files and their frontmatter are authoritative.** To find, list, or check the status of ADRs, read the files in this directory directly — their filenames carry the zero-padded ID and their frontmatter carries the canonical `status`, `supersedes`, and `superseded_by` fields.

This README intentionally does **not** maintain a hand-edited table of ADR IDs, titles, or statuses. A prior version of this file kept such a table, and it drifted under parallel PRs: multiple branches claimed the same next ADR number (e.g. two PRs both taking `ADR-0006`) and the status column fell out of sync with the underlying files. Removing the table eliminates that drift surface. Until a generated/validated index exists, `ls docs/decisions/` and the file frontmatter are the answer.

## Future validation (tracked under LAT-17)

The following are explicit follow-ups, not implemented here:

- **Duplicate ID detection.** Fail the build if two files under `docs/decisions/` share the same `NNNN-` prefix or the same `id:` in frontmatter.
- **Filename / frontmatter consistency.** Fail the build if the `NNNN-` prefix in the filename does not match the `id:` field in the file's frontmatter.
- **Generated or validated index.** If a navigation index is reintroduced, it must be generated from the ADR files (not hand-edited) and validated in CI against each file's frontmatter, so it cannot drift.

Until those checks land, treat collisions as a process risk to watch for during review of parallel ADR PRs.

## Anti-astronautics guardrail

> No architecture decision is accepted unless it either unblocks the next pilot slice, prevents a known risk, or records a decision already being relied on.

## Related

- Template: `docs/templates/adr.md`.
- Linear: `LAT-13` (this ADR process), `LAT-17` (automation follow-ups).
