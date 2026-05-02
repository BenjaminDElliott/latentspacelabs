---
name: small-model-decomposition
description: Heuristics for the planner agent to decide whether a ticket fits the small-model implementer or must be split, refused, or escalated. Does not implement.
---

# small-model-decomposition

The implementer is a small local model with bounded context and tool surface. Tickets that exceed that surface must be **split or refused** before they reach the implementer, not discovered mid-run.

## When to use

- Inside `ticket-planner` when reviewing a draft pack.
- During `lat-fix-review` if a reviewer's request would expand scope past the original pack.

## Sizing heuristics (rough, not exact)

A ticket is a candidate for the small-model implementer when **all** are true:

- Allowlist contains **≤ ~5 files** the implementer must edit, plus a small number of read-only references.
- Total expected diff is **on the order of a few hundred lines**, not thousands.
- The change is **mechanical or local**: a function added, a route registered, a constant changed, a small test added, a flag plumbed through one call site.
- No new architectural surface (no new package, no new public API, no new abstraction layer).
- No multi-package coordination (a refactor touching three packages is not one ticket).
- No repo-wide migration (renames, codemod-style sweeps).
- Reference snippets cover what the implementer needs without grepping.

If any of those fail, do not pack the ticket as-is.

## Failure modes and responses

- **Too many files.** Split by feature seam: one ticket per package, or one ticket per layer (data → service → route).
- **Architecture missing.** Hand back to the human / planner for a design pass; do not let the implementer choose.
- **Ambiguous acceptance criteria.** Rewrite as objectively checkable bullets ("returns 200 with `{...}`") before packing.
- **Cross-cutting concern (logging, config, error shape).** Land the cross-cutting change in its own ticket first; downstream tickets follow.
- **Genuinely too large.** Mark `too_large` and escalate to ADR-0018's runtime (Claude Code Action) per ADR-0019's fall-back path.

## Output

The planner's deliverable is either:

- A valid ticket pack with `Readiness status: ready`, or
- A refusal with status `needs_clarification` / `too_large` and a one-paragraph reason naming the offending dimension (file count, change span, missing architecture, ambiguity).

The planner does not implement. It does not open a PR. It does not write to Linear from the run.
