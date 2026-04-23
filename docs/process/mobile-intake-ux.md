# Low-Friction Intake UX

How raw input reaches the triage pipeline *before* it becomes a structured item. This doc defines the **interaction contract** between Ben and the intake agent — especially on mobile, mid-day-job, and voice-first — so capture stays cheap while triage still has enough signal to route accurately.

It complements `intake-triage.md` (what triage does with input once captured) and inherits its principles. When the two disagree on intake-surface behavior, this doc wins for UX; `intake-triage.md` wins for classification, persistence, and risk policy.

## Scope and non-goals

In scope:

- Interaction model for chat-style and mobile-first intake (text, short notes, voice-like dumps).
- Terse response pattern the agent uses when Ben is on a phone or mid-task.
- Rules for when the agent asks clarifying questions vs proceeds with a confidence/risk flag.
- Separation of personal vs project content at the capture step, and the confirmation gate before personal content reaches Linear.
- Expectations for backlog refinement of agent-created Linear issues born from messy input.

Out of scope (explicitly deferred):

- A custom mobile app.
- A dedicated Slack bot, email assistant, or SMS gateway.
- Final UI architecture or surface choice. Today's surface is **any chat-style client that can reach the intake agent** (Perplexity thread, Claude chat, future connector). UX contract is surface-agnostic.
- Voice transcription pipeline selection. "Voice-like interaction" here means *input that looks like a transcribed voice note* — sentence fragments, run-on dumps, filler words — not a commitment to any specific voice stack.

## Design priors

1. **Capture latency is the enemy.** If getting a thought into the system takes more than a few seconds of typing or one voice tap plus send, the thought gets lost. Intake UX is optimized for `thought → sent` time, not for first-message completeness.
2. **Ben is often mid-day-job.** Intake must survive being used in 10-second windows between meetings, in a car, or one-handed on a phone. Multi-turn interrogation is a UX failure even if it improves triage accuracy.
3. **Messy is the default, not the exception.** Inputs will mix personal and project items, omit context, contradict earlier notes, and use shorthand. The agent must not punish mess with friction.
4. **Terse beats thorough on mobile.** Response volume is a cost. The agent's reply should fit on a phone screen without scrolling wherever possible.
5. **Confidence + risk flag beats interrogation.** When routing is uncertain but risk is low, the agent proceeds and flags. It asks only when the cost of being wrong exceeds the cost of the extra round-trip.

## Capture styles the UX must support

The intake agent must gracefully accept all of the following without asking the user to reformat:

- **One-liner** — "remind me to ping Jane about the QA budget."
- **Short messy note** — "auth middleware thing, check compliance again, also maybe kill the old cookie path, sometime this week."
- **Voice-style dump** — sentence fragments, restarts, filler words, no punctuation. Treat transcription noise as expected input.
- **Mixed personal + project** — "pick up dry cleaning and also we need an ADR for the telemetry substrate."
- **Link + one word** — a URL with a single hint like "relevant" or "counter-argument." Triage must fetch or reason about the link, not demand a summary.
- **Correction on top of earlier input** — "actually never mind the ADR idea, just a ticket." The agent treats this as editing the previous item, not creating a new one.

Never respond with "please reformat," "please provide more detail before I can help," or any generic PM interview opener. Those are failure modes.

## Terse response pattern (mobile default)

On mobile / chat surfaces, the default intake response is **at most four short lines**, in this order:

1. **Echo line** — one-line restatement of what the agent heard, so Ben can catch transcription or intent errors immediately.
2. **Route line** — where it's going: `project` / `area` / `personal` / `archive`, plus destination if already decided (e.g. `Linear LAT intake`, `personal-only`, `dropped`).
3. **Confidence + risk line** — e.g. `confidence: high, risk: low` or `confidence: medium, risk: low — flagged`.
4. **Question line (optional)** — a single clarifying question, only if the clarifying-question policy below requires one. Omit entirely otherwise.

A full triage output (the long-form block in `intake-triage.md`) is **not** shown in the chat reply on mobile. It is produced as a durable artifact (Linear issue body, triage log, or run report) and linked, not pasted.

Example — low-risk, confident:

```
heard: ADR candidate for telemetry substrate choice
route: project → Linear LAT intake
confidence: high, risk: low
```

Example — medium confidence, one question:

```
heard: rip out old auth cookie path
route: project → Linear LAT intake (needs-refinement)
confidence: medium, risk: medium — reversible
is this a follow-up to the LAT-9 persistence work, or a new thread?
```

Example — personal, confirmation required:

```
heard: pick up dry cleaning thursday
route: personal (not Linear)
confidence: high, risk: n/a
confirm: save to personal list? (y/n)
```

## Clarifying-question policy on the intake surface

Intake inherits the clarifying-question policy from `intake-triage.md` and tightens it for chat/mobile:

- **Ask 0 questions** when routing, risk, and destination are all clear. Proceed; flag confidence if not high.
- **Ask 1 question** when exactly one of { routing, risk, destination } is ambiguous and resolving it unblocks the whole item. This is the common case for "ask."
- **Ask up to 3 questions** only when the item is high-risk, irreversible, or about to create a Linear Project or dispatch an agent — i.e. when the cost of being wrong clearly exceeds the cost of the round-trip.
- **Never ask a question whose answer does not change the next action.** "What's the priority?" and "when do you need this?" are almost always in this bucket and should be inferred or deferred to refinement.

A clarifying question must be answerable in under ~10 seconds one-handed. Prefer yes/no, a/b, or a single short phrase over open-ended prompts.

If Ben does not answer a clarifying question within the same session, the agent proceeds with its best-effort classification at reduced confidence, writes a `needs-refinement` item, and moves on. Blocking intake on an un-answered question is a failure mode.

## Personal vs project separation at the capture step

This is the one place the intake UX is **not** ruthless about friction — personal content must not silently become a `LAT-*` issue.

Rules:

1. The agent classifies each item (or each split half of a mixed dump) as `project`, `area`, `personal`, or `archive` before any persistence.
2. `personal` items are **never** written to Linear. They go to Ben's personal destination (exact destination TBD; until a durable personal store is chosen, the agent keeps personal items in the chat thread and echoes them back, but does not create Linear issues).
3. `project` and `area` items may flow into Linear per the normal intake pipeline without extra confirmation, at low/medium risk, marked `needs-refinement`.
4. **Mixed dumps** are split. The agent echoes the split explicitly in the terse response and routes each half separately.
5. **Ambiguous items default to personal and ask.** If the agent cannot confidently tell whether "follow up with Alex" is a work or personal thing, it routes to personal and asks a single yes/no to promote.
6. Before any personal content is persisted to Linear for any reason — even as context — the agent must show an explicit `confirm: save to Linear? (y/n)` gate. No silent leakage of personal context into the work graph.

This makes the work graph safe to trust: anything in Linear was either clearly project/area or was explicitly confirmed by Ben.

## Backlog refinement expectations for messy-input issues

Agent-created Linear issues born from mobile or voice intake are almost always `needs-refinement` quality. The refinement contract:

1. Every agent-created issue from intake carries the `intake` or `needs-refinement` label (per `intake-triage.md`).
2. The issue body preserves the original raw input verbatim in a `## Raw input` section, plus the agent's triage output block. The raw input is evidence; do not edit it into prose.
3. The issue body must **not** be treated as agent-ready. Dispatch rules in ADR-0005 apply: no `## Sequencing` block, no dispatch. The refinement step is what produces that block.
4. Refinement (done by Ben on cadence, per `intake-triage.md`) is the only path by which a messy-input issue becomes `agent-ready`. The intake agent does not promote items itself.
5. If the same raw fragment appears to match an existing active item, the intake agent **comments on the existing item** rather than creating a new one, and says so in the terse reply (`route: comment on LAT-NN`).
6. Duplicate-looking items that the agent is not confident are actually the same are created separately and cross-linked; Ben resolves during refinement.

## Voice-like interaction notes

Until a dedicated voice stack is chosen, "voice-like" means: the intake UX must tolerate transcribed-style input and produce output that is also read-aloud-friendly.

- Do not rely on markdown rendering in responses — the terse pattern reads naturally as plain text.
- Do not ask the user to "click" anything. Clarifying questions must be answerable in speech or a single short typed reply.
- Treat transcription artifacts (repeated words, homophones, dropped punctuation) as noise to normalize, not errors to correct back at the user.

When a voice stack is selected, the UX contract in this doc should survive unchanged; only the capture transport changes.

## Failure modes to avoid

- **Interrogation.** Asking more than one clarifying question on an item that is not high-risk.
- **Reformatting demands.** Asking Ben to restructure his input before the agent will act.
- **Silent personal→Linear leakage.** Creating a `LAT-*` for anything classified personal or ambiguous-toward-personal without explicit confirmation.
- **Over-long mobile replies.** Pasting the full triage block into the chat instead of linking the durable artifact.
- **Dropping source metadata.** Losing the original raw input, timestamp, and surface when a Linear issue is created. Raw input is evidence; keep it.
- **Auto-promoting to agent-ready.** Turning a messy-input issue into `agent-ready` without Ben passing it through refinement.

## Open questions

- **Personal store.** Where do `personal`-classified items durably land? Options: a private Linear team, a personal notes store, or keep them ephemeral in the chat thread. Not yet decided; likely a follow-up ADR alongside the telemetry substrate choice.
- **Voice stack.** Which voice transcription path (device-native, connector-provided, third-party) does the pilot use? Deferred until the intake surface question is revisited.
- **Confirmation persistence.** Does a `y` confirmation for personal→Linear in one session grant blanket permission in that session, or is it per-item? Default assumed per-item until Ben says otherwise.
- **Agent control layer interplay.** Parts of this contract (routing decisions, dispatch gating) may migrate into the agent control layer described in LAT-14 / LAT-16. This doc is UX/process only and does not commit to implementation.
- **Intake surface selection.** The surface-agnostic posture is a deliberate deferral, not a final answer. A follow-up ADR may pick a canonical intake surface once evidence accumulates.

## Related

- `intake-triage.md` — classification, triage output shape, clarifying-question policy (base rules this doc tightens for chat/mobile).
- `operating-model.md` — approval gates, personal vs project boundary, Linear write-back contract.
- `docs/decisions/0003-linear-persistence-boundary.md` — what belongs in Linear vs elsewhere.
- `docs/decisions/0005-linear-dependency-and-sequencing-model.md` — why messy-input issues are not dispatchable without refinement.
- Linear: `LAT-10` (intake scaffolding), `LAT-12` (low-friction intake UX — this doc), `LAT-14` / `LAT-16` (agent control layer, may absorb parts of this contract later).
