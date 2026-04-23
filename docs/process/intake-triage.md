# Intake and Triage

Raw input arrives messy. The job of intake-triage is to turn it into structured work *or explicitly reject it* without burning Ben's time on low-value clarification loops.

This document is a **policy draft**, not an automation specification. It defines what intake-triage must do; it does not specify how any tool, bot, or hook implements it. Automations that operationalize this policy are tracked separately and must cite this doc as their contract.

## Perplexity-first intake

Perplexity is the primary intake and reasoning surface (ADR-0001). Raw input lands there first and is triaged there before anything durable is written to Linear or this repo.

Perplexity's responsibilities at intake:

- Accept the messy dump verbatim. Do not reject on form.
- Run the triage posture defined below and produce the triage output shape.
- Draft any PRD, ADR, ticket, or retro *in-thread* as a proposal. Drafts are not durable until written to Linear or merged into this repo.
- Keep the raw thread as working memory only. Threads are not authoritative — the Linear issue, ADR, or PRD merged into this repo is.

Other intake sources (listed in *Intake sources* below) are first-class but route into the **same** triage pipeline and produce the **same** triage output shape. The Perplexity layer is where a human can talk through an ambiguous dump before it is committed; other sources skip that conversational step and go straight to best-effort classification with stated confidence.

Low-friction chat/mobile UX for Perplexity intake is tracked separately in **LAT-12**. This document defines *what* triage does; LAT-12 defines *how the capture experience feels* on mobile and in chat. Do not conflate the two.

## Intake sources

All of the following are first-class intake sources and route into the same triage pipeline:

- **Perplexity threads and workspace scratch** — free-form brain dumps, drafts, research. Primary source.
- **Voice notes and mobile text** — low-friction capture, typically forwarded into a Perplexity thread.
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
2. **Ruthless chief-of-staff posture.** Push back on vague scope, contradictions, and architecture smell. Refuse to ticket unclear work. See *Chief-of-staff posture* below.
3. **Ask only blocking questions.** A clarification is warranted only when routing, risk, or persistence destination is genuinely ambiguous. Do not run a generic PM interview.
4. **Personal vs project separation.** Personal notes route to Ben's private space, not the LAT work graph. Triage must distinguish, and must confirm before writing personal content into Linear.
5. **Small reversible steps.** Prefer the cheapest next validation step over a large up-front commitment.
6. **Preserve source metadata.** Never discard the URL, author, and context of an intake item. GitHub comments in particular must keep their PR/file/line pointers.
7. **Policy, not automation.** This doc sets the contract. Any agent, skill, or hook that implements intake-triage must conform to it; it does not, by itself, create or run those automations.

## Chief-of-staff posture

Triage is not a stenographer. It is a ruthless chief of staff whose job is to protect Ben's attention and the integrity of the work graph. Concretely:

- **Push back on vague scope.** If a dump says "make the X better", ask what outcome would make it "better" — or classify as `Area` or `research task` and refuse to produce a ticket.
- **Refuse to ticket unclear work.** Producing a `needs-refinement` Linear issue is fine; producing an `agent-ready` ticket from a fuzzy dump is not. Under-specified dumps end as research tasks, open questions, or archive — not as durable commitments.
- **Detect contradictions.** If a new dump contradicts an active Linear issue, an accepted ADR, or a recent decision, name the contradiction explicitly in the triage output's `Risks` and `Open questions` fields before routing. Do not silently let both coexist.
- **Control scope.** One intake item produces at most one primary destination. Mixed dumps are split into multiple triage items, each with its own output. Do not fold five ideas into one ticket.
- **Name architecture smell.** If a dump implies a cross-cutting or irreversible architectural choice, it is an ADR candidate, not a ticket. Escalate rather than quietly encoding the choice in a ticket description.
- **Minimize blocking questions.** Ask at most one question, and only when it is genuinely blocking per the *Clarifying-question policy*. Otherwise proceed with a best-effort classification and stated confidence.
- **Say no.** "Archive" and "reject" are first-class outcomes. Triage that never rejects is failing.

## Classification (PARA-inspired)

Every input is first sorted into one of:

- **Project** — outcome-oriented work with a definite end state; candidate for a Linear Project, PRD, epic, or parent issue.
- **Area** — persistent responsibility (observability, QA, cost, security, DX). Does not need a ticket yet; may accumulate into one later.
- **Resource** — reference material for future work. Not actionable on its own.
- **Archive** — duplicate, stale, rejected, superseded, or non-actionable. A valid and often correct outcome.

### Action classes (secondary classification)

After PARA, assign one or more action classes. An intake item can carry more than one, but must have a single primary:

- **PRD candidate** — an outcome large enough to warrant a product requirements doc before any ticket is cut.
- **Ticket candidate** — a discrete unit of agent-ready or human-ready work, routable to Linear.
- **ADR candidate** — an architecturally significant decision that must be captured as an ADR before code is written.
- **Research task** — a time-boxed investigation whose output is a writeup, not a shipped change.
- **Risk** — a hazard, regression, cost, security, or quality concern that must be tracked even if no ticket is cut today.
- **Open question** — unresolved ambiguity that blocks routing; parked explicitly rather than guessed.
- **Retro learning** — an observation about *how we work* that should feed back into process docs, templates, or the triage prompt itself.

## Triage output shape

Every triage run — whether from Perplexity, a Linear comment, or a GitHub comment — produces this shape. Fields are required unless marked optional.

```md
## Triage Result

Source: <intake source + URL/thread reference>
Classification: <Project | Area | Resource | Archive>
Action class: <primary action class; list secondary classes if any>
Confidence: <low | medium | high, with one-line justification>
Suggested destination: <Linear issue | Linear project | ADR | PRD | repo doc | personal | drop>
Actionability: <agent-ready | needs-refinement | research-only | not-actionable>
Potential duplicates: <Linear keys, PR/issue URLs, or "none found">
Related active work: <Linear keys or URLs; empty if none>
Risks: <cost, security, scope, contradiction, reversibility; or "none identified">
Open questions: <blocking questions only; empty if none>
Recommended next action: <one concrete next step, with owner hint>
```

Notes:

- `Confidence` is required. A missing confidence is itself a routing risk.
- `Recommended next action` must be a single concrete step, not a list of possibilities.
- For GitHub-sourced intake, `Source` must include the repo, PR/issue number, and comment URL per *Required context for GitHub-sourced intake*.
- For Perplexity-sourced intake that will persist into Linear, include the thread reference (or a stable pointer) so the durable item can link back to its origin thread.

## Clarifying-question policy

Ask a clarifying question only if **at least one** of these is true:

- Routing is ambiguous (project vs area vs personal).
- Risk level cannot be assessed.
- The input conflicts with an existing active item and the conflict must be resolved before acting.
- Persistence destination (Linear vs ADR vs PRD vs drop) is unclear.
- The input mixes personal and project content and cannot be split confidently.

Otherwise, make a best-effort classification with stated confidence and proceed. Over-asking is a failure mode. So is asking more than one question at a time.

## Severity, risk, and failure posture

Triage defaults to **proceed-and-flag** for low-risk reversible ambiguity, and **stop-and-ask** for anything severe or runaway-cost. The matrix:

| Risk level | Reversible? | Posture |
|---|---|---|
| Low | Yes | Proceed. Flag in `Risks`. Safe to create `needs-refinement` Linear issues. |
| Low | No | Proceed only with flagged caution. Do not auto-create Linear Projects or ADRs. |
| Medium | Yes | Proceed only if the next step is a reversible draft (PRD candidate, ADR draft, `needs-refinement` ticket). Flag prominently. |
| Medium | No | Stop and ask. Do not create durable artifacts. |
| High | Either | Stop and ask. Do not create durable artifacts. |
| Runaway cost | Either | Always stop and ask, regardless of product risk level. |

"Reversible" here means: if the classification turns out wrong, we can unwind it by archiving the Linear item, closing the PR, or deleting the draft, with no lingering state outside this repo or Linear. Anything that touches infrastructure, external services, billing, or production data is *not* reversible for this purpose.

When in doubt about reversibility, treat as non-reversible.

## Personal vs project separation

- Personal reminders, health notes, non-work items → personal destination only. Never create `LAT-*` issues for these.
- Mixed dumps → split into two triage items, summarize both halves, route separately.
- Personal content must never be persisted into Linear, GitHub, or this repo without **explicit** human confirmation in the same thread. Triage may propose persistence ("this reads like a personal reminder — confirm if you want it in Linear anyway") but must not execute until the human says yes.
- When in doubt about personal vs work, default to personal and ask.
- If a Perplexity thread has drifted between personal and work across many messages, triage should split the thread into distinct triage items rather than emit a single mixed result.

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
- Not an automation. This doc is the policy contract; automations that implement it are separate artifacts.

## Related

- `operating-model.md`
- `mobile-intake-ux.md` — low-friction chat/mobile interaction contract for the capture step.
- `docs/templates/agent-ready-ticket.md`
- ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0003-linear-persistence-boundary.md`.' `0005-linear-dependency-and-sequencing-model.md`
- Linear: `LAT-10` (this policy), `LAT-12` (low-friction chat/mobile intake UX), `LAT-15` (dependency and sequencing model).
