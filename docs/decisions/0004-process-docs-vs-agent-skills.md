---
id: ADR-0004
title: Process docs vs agent skills and commands
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-10
  - LAT-13
supersedes:
superseded_by:
revisit_trigger: Decide before the first agent skill or slash command is committed to this repo.
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
3. **Docs canonical, skills as operational adapters (proposed).** Keep `docs/` as the canonical, human-readable source of truth. Build skills and slash commands as operational adapters — either hand-maintained with an explicit "generated from `<doc>`" header, or mechanically generated from the docs by a future build step. A skill that disagrees with its source doc is a bug in the skill.
4. **Skills canonical, docs as navigation.** Invert option 3: skills are the source of truth; docs are auto-generated summaries for humans.
5. **Parallel, independently maintained.** Keep both, no canonical relationship. (Rejected on sight — this is the drift failure mode.)

## Decision

*Proposed:* **Option 3.** Docs are canonical. Skills and slash commands are operational adapters downstream of the docs.

Concretely, under this proposal:

- `docs/process/` and `docs/decisions/` are the source of truth for what the system does and why.
- `docs/templates/` defines artifact schemas consumed by both humans and skills.
- Future `.claude/skills/` and `.claude/commands/` are operational adapters. Each such file must declare the doc(s) it derives from in its frontmatter. Hand-maintained is acceptable until a generator exists.
- A PR that changes a doc must note which skills/commands need to be regenerated or re-reviewed; until CI enforces this, it is a manual checklist item in the PR description.
- A PR that adds or changes a skill without a corresponding doc update is a design smell and should be challenged in review.

Not yet accepted — this proposal closes off option 2 and option 4 in particular, which are defensible and worth one more pass before we commit.

## Consequences (if accepted)

Good:

- One place to go for policy; humans are not required to read skill frontmatter to understand how we work.
- Agents get crisp, bounded operational adapters rather than free-text policy docs.
- Drift becomes a detectable condition (skill header references a doc; CI can diff them) rather than an invisible one.
- ADRs retain their role as the place to decide *what* — skills just encode *how*.

Bad / open:

- Until generation or CI lands, drift is still possible; it is merely structurally easier to catch.
- Two artifacts per procedure is more maintenance than one, pre-automation.
- If skill runtimes evolve quickly (new frontmatter fields, new trigger mechanisms), the adapter layer absorbs that churn — which is the point, but it means skill files will change more often than docs.
- Forces a convention for skill provenance headers that does not yet exist and must be designed.

## Open Questions

1. Where do skill files live? Most likely `.claude/skills/` and `.claude/commands/` at the repo root, matching the Claude Code convention. Confirm before the first skill lands.
2. What provenance header format do skills use? Minimal proposal: a `derived_from:` list in YAML frontmatter pointing at `docs/...` paths with a commit SHA or doc version.
3. Do we want a generator (doc → skill) now, or hand-maintained with CI drift checks? Leaning hand-maintained until we have more than ~3 skills.
4. Does this ADR apply to all skill-like artifacts, including MCP server configs and hooks in `settings.json`, or only to skills and slash commands? Leaning: skills and slash commands only; infrastructure config is out of scope.
5. If we later adopt option 4 (skills canonical), what would the migration look like and what signal would trigger it? Likely signal: doc edits consistently lag skill edits because all real work happens in skill files.

## Confirmation (draft)

Working if, six months in, no skill file disagrees with its source doc without that disagreement being either visible in CI or documented as an intentional adapter override; and nobody is surprised by the location of the source of truth for a given policy.

## Links

- PR thread that raised this: <https://github.com/BenjaminDElliott/latentspacelabs/pull/1>.
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0002-store-process-docs-and-adrs-in-the-monorepo.md`.
- Linear: `LAT-10` (operating model), `LAT-13` (ADR process).
