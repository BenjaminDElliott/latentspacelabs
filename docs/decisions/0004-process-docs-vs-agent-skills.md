---
id: ADR-0004
title: Process docs vs agent skills and commands
status: accepted
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-10
  - LAT-13
  - LAT-14
supersedes:
superseded_by:
revisit_trigger: Revisit when the first executable adapter is proposed without a clean upstream canonical doc, when provenance drift is detected in practice, or when the adapter count exceeds ~5 and hand maintenance becomes the bottleneck.
---

# ADR-0004: Process docs vs agent skills and commands

## Context

This repo currently holds human-readable process docs (`docs/process/`), ADRs (`docs/decisions/`), and artifact templates (`docs/templates/`). It does not yet hold agent-operational artifacts — skill files or slash commands that an agent harness (Claude Code and similar) would load at runtime to execute a procedure.

Review feedback on PR #1 raised the question directly: should process docs just be skill files instead? The concern is that maintaining both a human-readable policy doc and a parallel agent-executable procedure risks silent drift, and that the agent is the primary reader of much of this content anyway.

Deciding this now — before any skill or command is committed — prevents us from accidentally picking a split by accretion.

## Decision Drivers

- **Single source of truth.** Drift between "what the doc says" and "what the agent actually runs" is the failure mode we most want to avoid.
- **Human readability.** Ben, future collaborators, and auditors need to read policy without a skill runner in hand.
- **Agent ergonomics.** Skills and slash commands have format constraints (frontmatter, token budget, trigger patterns) that pure prose docs do not satisfy.
- **Reviewability.** Both docs and skills must be diff-reviewable in PRs; ADRs govern their evolution.
- **Low custom-tooling cost during the pilot.** We prefer a regime that works with a few Markdown files and no build step, and can later graduate to generation or CI validation.
- **Separation of concerns.** Policy ("what and why") vs procedure ("how to execute") vs artifact shape ("what the output looks like") are different things with different change cadences.

## Considered Options

1. **Docs only.** Keep everything as Markdown docs in `docs/`. Skills and commands are not committed; the agent reads the docs directly.
2. **Skills only.** Replace process docs with skill files under `.claude/skills/` (and `.claude/commands/` for slash commands). Humans read the skill files directly.
3. **Docs canonical, skills as operational adapters (accepted).** Keep `docs/` as the canonical, human-readable source of truth. Build skills and slash commands as operational adapters — either hand-maintained with an explicit "derived from `<doc>`" header, or mechanically generated from the docs by a future build step. A skill that disagrees with its source doc is a bug in the skill.
4. **Skills canonical, docs as navigation.** Invert option 3: skills are the source of truth; docs are auto-generated summaries for humans.
5. **Parallel, independently maintained.** Keep both, no canonical relationship. (Rejected on sight — this is the drift failure mode.)

## Decision

**Accepted: Option 3.** Docs are canonical. Skills and slash commands are operational adapters downstream of the docs.

Why the other defensible options were not chosen:

- **Option 1 (docs only)** collapses into option 3 the moment the agent needs a skill. It works today only because we have zero skills committed; it does not answer what happens when the first one lands.
- **Option 2 (skills only)** trades human readability for agent ergonomics. Auditors, new collaborators, and ADR review all need to read policy without a skill runner, and Linear/Perplexity threads link to docs, not skills. Inversion is available later if skill edits consistently lead doc edits (see open questions).
- **Option 4 (skills canonical)** makes the same trade-off as option 2 and additionally requires a generator on day one to keep docs readable. That is framework astronautics for a pilot with no skills yet.

### Rules that follow from the decision

- `docs/process/` and `docs/decisions/` are the source of truth for what the system does and why.
- `docs/templates/` defines artifact schemas consumed by both humans and skills.
- `.claude/skills/` and `.claude/commands/` are operational adapters. Each such file **must** declare the doc(s) it derives from in its frontmatter (see *Provenance header* below). Hand-maintained is acceptable until a generator exists.
- A PR that changes a canonical doc **must** list the skills or commands that may need to be regenerated or re-reviewed, in a `Affected adapters:` line of the PR description. Until CI enforces this, it is a manual checklist item. `none` is an acceptable value.
- A PR that adds or changes a skill without touching the doc it derives from is a design smell and must be challenged in review, unless the skill PR explicitly declares itself an *adapter-only* change (formatting, trigger pattern, token-budget tuning) that does not change policy.
- If an adapter and its source doc disagree, the doc wins. The fix is to update the adapter, not the doc — unless a separate PR first updates the doc with ADR backing where required.

### Provenance header (required)

Every file under `.claude/skills/` and `.claude/commands/` must include, in its YAML frontmatter, a `derived_from:` key listing one or more repo-relative paths to the canonical doc(s) it adapts. Example:

```yaml
---
name: intake-triage
description: Execute the intake triage procedure on a raw input blob.
derived_from:
  - docs/process/intake-triage.md
derived_at: 2026-04-23
---
```

Rules:

- `derived_from:` is a list of one or more repo-relative paths. An empty list is not allowed; an adapter with no canonical upstream is either (a) infrastructure config, which is out of scope of this ADR, or (b) a signal that a canonical doc is missing and should be written before the adapter lands.
- `derived_at:` is the ISO date of the last sync between adapter and doc. It is a human-readable freshness hint, not a cryptographic proof. A future CI check may upgrade this to a commit SHA; until then, the date is sufficient.
- Adapters may add other frontmatter fields required by the harness (`name`, `description`, trigger patterns, token budget). Those are adapter-layer concerns and do not need to appear in the canonical doc.

Executable adapters must not silently become a divergent source of truth. The provenance header is the structural mechanism that makes drift detectable — without it, this ADR's central claim is unenforceable.

### Minimum near-term adapter set

No adapters are required to land as part of this ADR. Adapters should be built when a concrete, repeated procedure is painful to run from prose alone. The near-term candidates, in priority order:

1. **`commit-push-pr` command.** Wraps the PR ↔ Linear linking convention (`docs/process/operating-model.md`) so agents cannot forget the `LAT-*:` title prefix or the Linear back-reference in the body. Highest leverage because every coding agent hits this path.
2. **`intake-triage` skill.** Wraps `docs/process/intake-triage.md` so Perplexity-style intake runs deterministically end-to-end. Second priority because it is run often but by fewer agent types.
3. **`adr-new` command.** Wraps `docs/templates/adr.md` and the status lifecycle in `docs/decisions/README.md`. Third priority because ADR creation is infrequent and the template is already short.

Anything beyond this list must justify itself against the anti-astronautics guardrail in `docs/decisions/README.md`. "We might need it" is not justification; "the last three runs failed this step" is.

### Scope: what this ADR does and does not govern

- **In scope:** Files under `.claude/skills/` and `.claude/commands/`, and any equivalent artifacts a future harness treats as agent-executable procedure.
- **Out of scope:** MCP server configs, `settings.json` hooks, keybindings, and other infrastructure configuration. Those are harness wiring, not procedure, and are governed by ADR-0001 and operational docs rather than this one.

## Consequences

Good:

- One place to go for policy; humans are not required to read skill frontmatter to understand how we work.
- Agents get crisp, bounded operational adapters rather than free-text policy docs.
- Drift becomes a detectable condition (adapter header references a doc; CI can diff them) rather than an invisible one.
- ADRs retain their role as the place to decide *what* — adapters just encode *how*.
- A `derived_from:`-less adapter is now a review-time smell, not a silent policy inversion.

Bad / open:

- Until a generator or CI drift check lands, drift is still possible; it is merely structurally easier to catch. The `Affected adapters:` PR line is the human fallback.
- Two artifacts per procedure is more maintenance than one, pre-automation. We accept this cost until adapter count exceeds ~5 or doc/adapter edit ratios invert.
- If skill runtimes evolve quickly (new frontmatter fields, new trigger mechanisms), the adapter layer absorbs that churn — which is the point, but it means adapter files will change more often than docs.
- The provenance convention is a new rule that reviewers must enforce manually until automation lands.

## Open Questions

1. Where exactly do skill and command files live? Working assumption: `.claude/skills/` and `.claude/commands/` at the repo root, matching the Claude Code convention. Confirm before the first adapter lands; a later ADR may relocate them.
2. Do we want a doc → adapter generator now, or stay hand-maintained with CI drift checks? Leaning hand-maintained until adapter count exceeds ~3. Tracked as a follow-up.
3. When the Agent Control Layer (see ADR-0001 and the LAT-16 follow-up) begins to own some procedure execution directly, does the adapter layer shrink, move, or stay in-repo? Deferred until the control-layer boundary is clearer; this ADR does not presume an answer.
4. Should the `derived_at:` field graduate to a commit SHA with CI enforcement? Leaning yes, but not until at least one adapter exists to test the check against.
5. What signal would trigger re-evaluating option 4 (skills canonical)? Working answer: doc edits consistently lagging adapter edits across a month of activity, i.e. adapters are where real thinking happens and docs are retroactive summaries. Until then, this ADR stands.

## Confirmation

Working if, six months in:

- Every committed skill or command under `.claude/skills/` and `.claude/commands/` has a `derived_from:` header pointing at a real doc path.
- No adapter disagrees with its source doc without either CI flagging it or the disagreement being recorded as an intentional adapter override in the PR that introduced it.
- PRs that change canonical docs routinely include an `Affected adapters:` line (including `none`), without reviewers having to ask.
- Nobody is surprised by the location of the source of truth for a given policy.

## Links

- PR thread that raised this: <https://github.com/BenjaminDElliott/latentspacelabs/pull/1>.
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0002-store-process-docs-and-adrs-in-the-monorepo.md`, `0003-linear-persistence-boundary.md`, `0005-linear-dependency-and-sequencing-model.md`.
- Linear: `LAT-10` (operating model), `LAT-13` (ADR process), `LAT-14` (this decision).
