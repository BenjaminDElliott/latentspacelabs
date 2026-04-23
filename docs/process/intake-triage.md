# Intake and Triage

Raw input arrives messy. The job of intake-triage is to turn it into structured work *or explicitly reject it* without burning Ben's time on low-value clarification loops.

## Intake sources

All of the following are first-class intake sources and route into the same triage pipeline:

- **Perplexity threads and workspace scratch** — free-form brain dumps, drafts, research.
- **Voice notes and mobile text** — low-friction capture.
- **Linear comments and issue descriptions** — especially items arriving with an `intake` or `needs-refinement` label.
- **GitHub issue comments** — on this repo or any repo in the `LAT` surface.
- **GitHub pull-request comments** — both top-level PR conversation and inline review comments on specific lines/files. These carry extra context (the diff, the file path, the PR branch, the linked Linear issue) that triage must preserve rather than flatten.
- **GitHub issues** — newly opened issues, including from future external reporters.

Code-review feedback (inline PR comments) is high-signal intake: it often implies an ADR candidate, a follow-up ticket, or a doc/skill update. Triage must not silently drop it. If a review comment implies durable change and nobody is already on the hook to address it in-PR, it becomes a triage item like any other brain dump.

## Required context for GitHub-sourced intake

When the source is GitHub, the triage result must carry, at minimum:

- Repo and PR/issue number.
- PR branch name and base branch (for PR-sourced intake).
- Linked Linear issue, if any, inferred from PR title, body, or branch name.
- File path and line range (for inline review comments).
- Commenter and whether they are the PR author.
- Comment URL, so the durable Linear item or ADR can link back.

This metadata is what lets a later agent re-enter the PR with enough context to act — without it, the intake is lossy.

## Principles

1. **Low-friction capture.** Any text, voice note, mobile dump, Linear comment, or GitHub comment is valid input. Formatting is not a prerequisite. The interaction contract for chat-style and mobile intake — terse response pattern, when to ask clarifying questions, and the personal-vs-project confirmation gate — is defined in `mobile-intake-ux.md`.
2. **Ruthless chief-of-staff posture.** Push back on vague scope, contradictions, and architecture smell. Refuse to ticket unclear work.
3. **Ask only blocking questions.** A clarification is warranted only when routing, risk, or persistence destination is genuinely ambiguous. Do not run a generic PM interview.
4. **Personal vs project separation.** Personal notes route to Ben's private space, not the LAT work graph. Triage must distinguish.
5. **Small reversible steps.** Prefer the cheapest next validation step over a large up-front commitment.
6. **Preserve source metadata.** Never discard the URL, author, and context of an intake item. GitHub comments in particular must keep their PR/file/line pointers.

## Classification (PARA-inspired)

Every input is first sorted into:

- **Project** — outcome-oriented work; candidate for a Linear Project, PRD, epic, or parent issue.
- **Area** — persistent responsibility (observability, QA, cost, security, DX). Does not need a ticket yet.
- **Resource** — reference material for future work.
- **Archive** — duplicate, stale, rejected, superseded, or non-actionable.

Secondary subtypes: PRD candidate, ticket candidate, ADR candidate, research task, risk, open question, retro learning.

## Triage output shape

Every triage run should produce:

```md
## Triage Result

Classification:
Confidence:
Suggested destination:
Actionability:
Potential duplicates:
Related active work:
Risks:
Open questions:
Recommended next action:
```

## Clarifying-question policy

Ask a clarifying question only if **at least one** of these is true:

- Routing is ambiguous (project vs area vs personal).
- Risk level cannot be assessed.
- The input conflicts with an existing active item and the conflict must be resolved before acting.
- Persistence destination (Linear vs ADR vs PRD vs drop) is unclear.

Otherwise, make a best-effort classification with stated confidence and proceed. Over-asking is a failure mode.

## Severity and risk policy

- **Low risk** — proceed and flag. Safe to create Linear issues marked for refinement.
- **Medium risk** — proceed only if reversible. Flag prominently. Require human confirmation before Linear Project creation or agent dispatch.
- **High risk** — stop and ask. Do not create durable artifacts.
- **Runaway cost risk** — always stop and ask, regardless of product risk level.

## Personal vs project separation

- Personal reminders, health notes, non-work items → personal destination only. Never create `LAT-*` issues for these.
- Mixed dumps → split, summarize both halves, route separately.
- When in doubt about personal vs work, default to personal and ask.

## Backlog refinement loop

1. On a regular cadence (cadence TBD; see ADR-0003 open questions), Ben reviews Linear items labeled `intake` or `needs-refinement`.
2. Items are promoted to `agent-ready` only after passing the pre-flight checks in the agent-ready ticket template (`docs/templates/agent-ready-ticket.md` → *Pre-flight: refuse to mark agent-ready if any of these fail*), including a populated `## Sequencing` block per ADR-0005.
3. A dispatcher (human or agent) that encounters a ticket labeled `agent-ready` but failing pre-flight must **refuse** to dispatch it, move it back to `needs-refinement`, and leave the refusal block on the Linear issue as a comment. Silently proceeding on a vague ticket is a policy violation, not a courtesy.
4. Items that cannot be made agent-ready are either archived or escalated to an ADR (if the blocker is a design decision) or to a PRD (if the blocker is scope ambiguity).
5. Retro learnings feed back into updates to this document, the triage prompt, and the PRD + ticket templates.

## What triage is not

- Not a replacement for PRDs. A triage run may produce a PRD *candidate*, not a finished PRD.
- Not an approval mechanism. Triage recommends; Ben approves per the operating model.
- Not a place to design architecture. Architecturally significant decisions become ADRs.

## Related

- `operating-model.md`
- `mobile-intake-ux.md` — low-friction chat/mobile interaction contract for the capture step.
- `docs/templates/agent-ready-ticket.md`
- ADR-0005: `docs/decisions/0005-linear-dependency-and-sequencing-model.md` (dependency and sequencing model used by dispatch).
- Linear: `LAT-10` (intake scaffolding), `LAT-12` (low-friction intake UX — see `mobile-intake-ux.md`), `LAT-15` (dependency and sequencing model).
