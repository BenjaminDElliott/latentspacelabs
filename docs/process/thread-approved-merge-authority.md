# Thread-approved merge authority and ready-to-merge gate

> Operational rule for when Perplexity (or any coding/review agent acting on Ben's behalf) may **merge** a pull request after Ben's explicit approval in a Perplexity or Linear thread. Companion to [`approval-gates-and-autonomy-rules.md`](approval-gates-and-autonomy-rules.md) (merge classification) and [`coding-agent-preflight.md`](coding-agent-preflight.md) (pre-write checks). If this doc and `approval-gates-and-autonomy-rules.md` disagree on classification, that doc and the ADR it cites win until superseded (`operating-model.md` → *Source-of-truth rules*).
>
> **Scope limit.** This doc narrows the *merge* gate only. Deploy (`operating-model.md` → *Approval gates*) remains Ben-approved and is not covered here. Autonomy level L5 (autonomous merge without per-PR approval) remains out of scope per `approval-gates-and-autonomy-rules.md` → *Autonomy levels*.

## Why this exists

`approval-gates-and-autonomy-rules.md` → *GitHub / code / PRs* classifies **Merge a PR** as **Stop** — "Human only during the pilot." In practice, Ben has delegated a bounded slice of that authority: **when Ben gives explicit, unambiguous thread approval on a specific PR, Perplexity (or a dispatched agent) may execute the merge without Ben clicking the button himself.** That delegation is not a new autonomy level — it is a mechanical pass-through of a Ben decision that already happened. This doc makes the boundary checkable so an agent can tell a *real* approval from a vague one, and refuse rather than guess.

It also codifies the **ready-to-merge gate** (the pre-merge checks that must all pass) and the **post-merge write-back** (what lands in Linear after the merge), so the approval packet Ben sees is terse and the evidence trail remains durable.

## The authority, stated precisely

An agent may merge a PR **if and only if** all five conditions hold. Missing any one is a refuse.

1. **Explicit thread approval from Ben** identifying the PR, Linear ticket, or named batch unambiguously (§ *What counts as approval*).
2. **Ready-to-merge gate passes** — every pre-merge check in § *Ready-to-merge gate* is green.
3. **No Stop-category action is hidden in the PR** beyond the merge itself (§ *Refusal and stop cases*).
4. **Scope of approval matches scope of merge** — one-PR approval merges one PR; a batch approval that names PRs merges exactly those. Merging a PR Ben did not name is a refuse (§ *Scope*).
5. **A Linear write-back plan is present** — the agent knows, before merging, what write-back it will post after merge (§ *Post-merge write-back*).

If any condition fails, the agent does not merge. The fallback is to post the terse approval packet (§ *Terse approval packet*) back in the thread and wait for Ben to re-approve or merge himself. Over-asking a sixth time is cheaper than an unauthorized merge.

## What counts as approval

An approval from Ben is valid for merge only when all of the following are true:

- **The message is from Ben**, not inferred from a reaction, a prior statement, or another participant. Presence-in-thread is not approval.
- **It identifies the target unambiguously.** Exactly one of:
  - a specific PR URL or PR number;
  - a specific `LAT-NN` ticket key whose sole open PR is obvious; or
  - a named batch whose members are listed in the same message or in a referenced message (e.g. "merge PRs #41, #42, #43" or "merge the three docs PRs above").
- **It is merge-intent, not review-intent.** Phrasings that approve merge: "merge it", "ship it", "go ahead and merge", "approved to merge", "land it". Phrasings that are *not* merge approval: "looks good", "lgtm", "nice", "agreed", a thumbs-up reaction alone, "approved" without a verb. When ambiguous, treat as review approval only and post the terse packet asking for explicit merge.
- **It is current.** Approval given before the last substantive PR change (new commit, rebase, conflict resolution) is stale; re-ask. A comment-only update to the PR does not stale the approval.
- **It is in a durable thread surface.** Perplexity thread, Linear comment on the issue, or PR comment are all acceptable. A reference like "Ben said so earlier" that does not resolve to a specific message is a refuse (`coding-agent-preflight.md` § C — durable-source references).

### Unambiguous vs vague — worked examples

| Message | Verdict | Reason |
|---|---|---|
| "merge #33" | Valid | PR number named, merge-intent verb. |
| "merge LAT-47" | Valid *if* LAT-47 has exactly one open PR; otherwise refuse and ask which one. | Ticket + single open PR resolves unambiguously. |
| "merge the three docs PRs above" | Valid *if* the prior message lists three PRs; otherwise refuse. | Batch with enumerable members. |
| "lgtm" | Invalid | Review-intent, not merge-intent. |
| "approved" | Invalid | No verb; treat as review approval only. |
| 👍 reaction on a PR | Invalid | Not a message; not merge-intent. |
| "go ahead" (no antecedent) | Invalid | No target. Refuse and ask which PR. |
| "merge whatever's ready" | Invalid | Scope is not enumerable; Ben must name the PRs. |
| "you can merge these from now on" (no PRs named) | Invalid | Blanket pre-approval is an autonomy-level change, not a per-PR approval. Route to ADR-0008 update. |

A valid approval is copied verbatim into the run report's narrative and the post-merge Linear write-back as the **exact approval phrase** (§ *Post-merge write-back*). No paraphrase.

## Ready-to-merge gate

Every item is a hard check. Any fail refuses the merge even if Ben's approval is valid.

| # | Check | How to verify | Fail action |
|---|---|---|---|
| G1 | **PR targets `main`.** No stacked branch as base. | `gh pr view <N> --json baseRefName` → `main`. | Refuse. Unusual stacking needs explicit mention in the ticket (`coding-agent-preflight.md` § A.6). |
| G2 | **PR is not a draft.** | `gh pr view <N> --json isDraft` → `false`. | Refuse. Ask Ben or PR author to mark ready. |
| G3 | **PR is mergeable.** No conflicts; branch is up to date enough that GitHub reports it mergeable. | `gh pr view <N> --json mergeable,mergeStateStatus` → `MERGEABLE` and `mergeStateStatus` in `{CLEAN, UNSTABLE, HAS_HOOKS}`. | Refuse. Rebase / resolve via a new commit (no force-push on shared history, per `approval-gates-and-autonomy-rules.md`). |
| G4 | **Required CI is green.** The `check / npm run check` GitHub Actions workflow (LAT-38) has completed with conclusion `success` on the head commit. Any additional required checks configured on the repo must also be `success`. | `gh pr checks <N>` → all required checks `pass`. | Refuse. If CI is missing, wait or re-run; do not merge a PR whose required check never ran. |
| G5 | **PR title has the `LAT-NN:` prefix** per `operating-model.md` → *PR ↔ Linear linking convention*. | Read `gh pr view <N> --json title`. | Refuse. Exception: the no-Linear-issue escape clause must be cited in writing on the PR. |
| G6 | **No unresolved hard-blocker / sequencing issue.** For the primary `LAT-*` key, re-read the issue's `## Sequencing` block per ADR-0005 and confirm every hard blocker is `Done`/`Cancelled`/`Superseded`. | Check Linear issue `## Sequencing`. | Refuse. Return to dispatch / refinement — a PR cannot merge past an unresolved hard blocker even with thread approval. |
| G7 | **No Stop-category action is hidden in the PR** beyond the merge itself — e.g. the diff does not introduce a deploy, delete an unmerged branch, rewrite shared history, change secrets/permissions, raise an autonomy level, or edit `approval-gates-and-autonomy-rules.md` / ADR-0008 / this doc without a superseding ADR. | Scan the diff for touched files against the Stop table in `approval-gates-and-autonomy-rules.md`. | Refuse. A Stop-category change requires its own explicit approval, independent of merge approval. |
| G8 | **No unresolved Ben feedback on the PR.** Every inline comment / review thread from Ben is either resolved or explicitly answered with an in-PR commit, and no Ben comment reads as an unanswered blocker. | Read PR review comments. | Refuse. Ask Ben before merging. |
| G9 | **PR body matches current diff** at a high level — no stale changelog claim that the diff contradicts (e.g. PR body claims "docs-only" but the diff touches `packages/`). | Skim PR body against `gh pr diff`. | Refuse. Ask the PR author to refresh the body, or do so and re-request. |
| G10 | **Linear write-back plan is present** in the run context — the agent has drafted the post-merge comment before merging. | See § *Post-merge write-back*. | Refuse. Do not merge without the write-back ready to post. |

The gate is conservative by design. A missing required-CI result is treated the same as a failed one: the agent waits rather than merges.

## Refusal and stop cases

Independent of gate pass/fail, the agent **must refuse to merge** when any of the following is true. These are restatements of `approval-gates-and-autonomy-rules.md` obligations in the merge context; they are enumerated here so the preflight reader does not have to cross-reference mid-run.

- **Failed or missing required CI.** Silence is not success.
- **Merge conflicts.** Resolution requires a new commit; do not merge "draft" state.
- **Branch target is not `main`** (unless the ticket explicitly authorizes an alternate base).
- **A destructive / irreversible action is in the diff** and not explicitly named in Ben's approval — deletions of directories/files beyond the PR's stated scope, branch deletions, force-pushes, DB migrations, infra changes.
- **Deploy, release, or environment change** is entangled with the PR. Deploy remains separately Ben-approved.
- **Autonomy-level change** (edits to `approval-gates-and-autonomy-rules.md`, ADR-0008, ADR-0012, this doc, or adjacent policy) without a superseding ADR in the same PR.
- **High-risk security / cost / secrets change** — auth, permissions, secrets, tokens, connector scopes, cost gating, data retention. These stay Stop-category even with merge approval; Ben must approve the *change*, not just the merge.
- **Stale PR body vs diff mismatch** — the PR description no longer describes what the PR does.
- **Unresolved Ben feedback** on the PR or its associated Linear issue.
- **Runaway-cost band** on the originating run (`cost-controls.md`). A `runaway_risk` run halts; its PR does not merge until Ben's unblock comment is on the Linear issue.
- **QA / PR review recommended `block-merge` or `needs-human`** and the finding is not resolved (`qa-review-evidence.md` → *Recommendation values*).

On refusal, the agent:

1. Does not click merge. Does not push a new commit on behalf of the merger.
2. Posts a terse refusal in the thread citing the failed check (gate number from § *Ready-to-merge gate* or bullet from § *Refusal and stop cases*).
3. Updates the Linear write-back draft with the refusal reason so the next actor sees it.

A refusal is not a failure; over-asking is the safe posture for an action classified Stop-by-default.

## Scope of an approval

- **Per-PR approval.** Default. Applies to the one PR named. Does not extend to follow-ups, stacked PRs, or re-opened versions.
- **Batch approval.** Valid when Ben enumerates the PRs in the approval message or in a directly-referenced message. The batch is closed: a new PR added after the approval is not in scope.
- **Blanket pre-approval / standing order.** Not valid under this doc. A standing "you can merge X in the future" is an autonomy-level change and requires an ADR per `approval-gates-and-autonomy-rules.md` → *Autonomy levels* and ADR-0008. Route the request to `needs-human` with a suggested ADR draft.

If a batch approval covers PRs with different merge readiness states, the agent merges only the PRs that pass the ready-to-merge gate and posts a per-PR refusal for the rest. Partial-batch merges are expected; silent skips are not.

## Terse approval packet

When the agent is seeking merge approval (or has refused and is re-asking), the message Ben sees is terse by design — per Ben's feedback in thread. Format:

```md
**Purpose:** <1 sentence — what the PR does and for which LAT-NN>
**Changelog:** <bulleted list, 3–7 short bullets of what actually changed; no adjectives>
**Status:** target=main · draft=no · mergeable=<yes|no> · required CI=<pass|fail|pending> · title LAT-prefixed=<yes|no> · hard blockers=<clear|listed> · unresolved Ben feedback=<none|listed>
**Risks:** <risk flags; "none" is fine; cost band if elevated; any Stop-category surface touched>
**Exact approval phrase requested:** "merge <#PR or LAT-NN or named batch>"
```

Rules:

- No preamble, no sign-off, no progress narration. One packet, five lines (plus bullets).
- "Exact approval phrase requested" tells Ben what to type; his reply back is the verbatim approval the agent will quote in the post-merge write-back.
- If any gate item is not yet `pass`, the packet is *informational* — the agent is not asking to merge yet, only to surface state. Say so: add a `**Not ready to merge:**` line listing the failing gates.
- If multiple PRs, post one packet per PR (or a compact batch packet whose `Exact approval phrase requested` enumerates them).

The packet is not a replacement for the PR description, the run report, or the Linear write-back; it is the terse surface Ben reads on mobile before typing the approval.

## Post-merge write-back

After a successful merge, the agent executes the Linear write-back **before** marking the run finished. The write-back follows the ADR-0003 five-element contract (`operating-model.md` → *Linear write-back contract*), with two merge-specific additions:

1. **Linear state update** — move the primary `LAT-*` issue to the terminal state the ticket's acceptance criteria describe (usually `Done`). If the ticket does not specify, leave state unchanged and say so in the write-back.
2. **Write-back comment on the Linear issue** with:
   - **Outcome** — "Merged via thread approval" + one-line summary.
   - **Evidence** — PR URL, merge commit SHA (`git rev-parse main` after fetch, or the `mergeCommit.oid` from `gh pr view --json mergeCommit`), run report URL, CI run URL.
   - **Risks** — carried over from the pre-merge packet; `none` is fine; cost band if elevated.
   - **PR** — PR URL (same as evidence, explicit line per contract).
   - **Next action** — concrete next step (`deploy pending Ben approval`, `follow-up LAT-NN dispatched`, or `none`).
   - **Approval phrase (verbatim)** — Ben's exact merge-intent message, quoted. This is the auditable delegation record.

The write-back is planned (drafted) *before* merge per gate G10 and *posted* immediately after. If the write-back cannot be posted (Linear API failure, connector outage), the agent still records the merge in the run report narrative and retries the comment; a merge without a durable write-back is a `medium` retro finding but does not roll back the merge.

### Write-back example

```md
**Outcome:** Merged via thread approval. LAT-47 adds the thread-approved merge authority doc and ready-to-merge gate.
**Evidence:** <PR URL> · commit `<SHA>` · <run report URL> · <CI run URL>
**Risks:** none. Cost band: normal.
**PR:** <PR URL>
**Next action:** none — policy is live on main.
**Approval phrase (verbatim):** "merge #NN"
```

## Interaction with other gates

- **Preflight (`coding-agent-preflight.md`).** Preflight governs *whether the agent should be writing files at all*; this doc governs *whether the agent should merge a PR*. A PR that was written under a preflight refuse must not be merged regardless of thread approval — resolve the preflight conflict first.
- **QA / review (`qa-review-evidence.md`).** A verification recommendation of `block-merge` or `needs-human` overrides thread approval until the finding is resolved. An `approve` or `approve-with-nits` recommendation does not itself authorize merge (the doc already says so) — it only clears the verification concern; thread approval still required.
- **Cost controls (`cost-controls.md`).** A `runaway_risk` run halts its PR's merge path until Ben's unblock comment lands on the Linear issue.
- **Dispatch (`operating-model.md` → *Dispatch readiness*).** Hard blockers on the issue's `## Sequencing` block are re-checked at merge time (gate G6); a hard blocker resolved at dispatch but newly re-added is still a merge blocker.
- **Context handoff (`context-compaction-and-handoff.md`).** If the run that is merging has crossed a compaction event, the record (when / what / where durable) is in the run report before the merge write-back is posted. The thread approval itself is the load-bearing content and is quoted verbatim in the write-back, so it is durable by construction.

## Operational notes

- **One approval, one merge.** The agent does not queue a thread approval for later. If the gate is not green when approval arrives, refuse and ask again when ready; do not cache a stale approval.
- **No force-merge.** If a required status check is red, the fix is a new commit and a re-run, not a bypass. `--admin` override flags are Stop-category regardless of approval.
- **No auto-merge via GitHub's auto-merge feature** by default. The pilot prefers an explicit, synchronous merge under thread approval so the approval phrase and the merge action are co-located in the run report. A future ADR may relax this.
- **Merge method** follows the repo convention (squash vs merge commit vs rebase). If the repo has not set a convention, the agent uses squash for docs-only PRs and merge-commit otherwise, and records the method in the write-back.

## Affected adapters

None yet. When the ICP skill framework lands (`coding-agent-preflight.md` → *Skill-contract alignment*; ADR-0012), the gate in § *Ready-to-merge gate* becomes a typed pre-merge skill contract and the refusal path maps to the skill-runner's refusal formatter. Until then, this doc is executed as a manual checklist by whichever agent is performing the merge.

## Sequencing

Hard blockers: none (LAT-38 merged — `check / npm run check` required CI is live on `main`)
Recommended predecessors: LAT-38 (CI), LAT-54 (context handoff), LAT-53 (policy scanner), LAT-35 (coding-agent preflight)
Related context: LAT-6 (approval / cost gates), LAT-16 (approval-gates-and-autonomy-rules.md), ADR-0008, ADR-0012
Dispatch status: ready
Dispatch note: docs-only; no new packages or runtime code. Merge authority is codified for the pilot and can be superseded by a future ADR that raises autonomy to L5 or reclassifies merge out of Stop-category.

## Related

- ADRs: [`0001`](../decisions/0001-use-perplexity-linear-and-github-as-control-plane.md), [`0003`](../decisions/0003-linear-persistence-boundary.md), [`0005`](../decisions/0005-linear-dependency-and-sequencing-model.md), [`0007`](../decisions/0007-qa-review-evidence-workflow.md), [`0008`](../decisions/0008-agent-control-layer-and-perplexity-boundary.md), [`0009`](../decisions/0009-cost-controls-and-runaway-cost-interrupts.md), [`0012`](../decisions/0012-integration-control-plane-software-architecture.md), [`0015`](../decisions/0015-context-compaction-and-agent-handoff-policy.md).
- Process: [`approval-gates-and-autonomy-rules.md`](approval-gates-and-autonomy-rules.md), [`operating-model.md`](operating-model.md), [`coding-agent-preflight.md`](coding-agent-preflight.md), [`context-compaction-and-handoff.md`](context-compaction-and-handoff.md), [`qa-review-evidence.md`](qa-review-evidence.md), [`cost-controls.md`](cost-controls.md).
- Templates: [`agent-run-report.md`](../templates/agent-run-report.md).
- Linear: `LAT-47` (this doc), `LAT-38` (required CI), `LAT-54` (handoff), `LAT-53` (policy scanner), `LAT-35` (preflight), `LAT-16` (approval-gates rule matrix), `LAT-6` (approval / cost gates).
