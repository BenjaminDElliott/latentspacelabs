# Parallel-agent PR merge train and conflict-resolution protocol

**Status:** Draft
**Ticket:** LAT-45
**Created:** 2026-06-14
**Predecessors:** LAT-35 (preflight guardrails), LAT-38 (CI gates)
**Related:** LAT-23 (ICP epic), LAT-33 (merge-authority), LAT-47 (merge authority)

## Goal

Define how multiple agent-created PRs should be **ordered**, **rebased**, **reviewed**, and **merged** so parallelism does not turn into conflict churn. This protocol applies when several `herman/*` (or other agent) PRs are open against `main` and need to land sequentially with minimal rework.

## Non-goals

- No automated merge queue (no GitHub merge-train bot).
- No bypassing required GitHub checks.
- No prohibition on parallel agents — this makes parallelism *safer*, not slower.
- No shared merge-train index file that agents must all edit.

## Principles

1. **One-landing-at-a-time on `main`.** Only one agent PR lands on `main` at a time. This is the single most effective conflict reducer.
2. **Order by dependency, then by scope isolation.** PRs that affect disjoint file trees land first; PRs touching shared hubs land last.
3. **Rebase + recheck, never merge-commit into `main`.** Each PR lands as a linear commit; if it conflicts, rebase on the updated `main` and rerun checks.
4. **The merging agent records evidence.** The agent that merges each PR notes in Linear (PR body + Linear comment) what conflicts were resolved and which checks were rerun.
5. **Ben owns the merge order.** When multiple PRs are queued, Ben (the merge authority) picks the order. Perplexity executes the merge batch in that order.

---

## 1. Merge order selection for parallel PRs

When multiple PRs are open against `main`, apply these rules in order:

### Rule 1 — Disjoint file trees first

PRs that touch completely different parts of the repo have no conflict risk. Merge these first, in any order. The merging agent checks for overlapping file paths:

```
PR-A touches: packages/game/src/, docs/decisions/0023-*.md
PR-B touches: packages/vr/, docs/prds/LAT-*.md
→ No overlap → merge in any order
```

### Rule 2 — Shared-hub PRs last

PRs that edit shared hubs (`docs/README.md`, `docs/decisions/README.md`, `docs/prds/README.md`, `docs/process/README.md`) go **last**. These are the most conflict-prone files per LAT-35's conflict-surface list. All non-hub PRs should land before hub-editing PRs.

### Rule 3 — Smallest diff first (tiebreaker)

When two PRs have disjoint trees and neither touches a hub, prefer the one with the smaller diff. Smaller diffs are faster to rebase, review, and merge.

### Rule 4 — LAT-35 preflight compliance check

Before any PR lands, verify it passes its preflight (LAT-35). If a PR's preflight was not run or was skipped, run it before merging. A failed preflight means rebase and fix before the next merge.

### Rule 5 — Ben's discretion

Ben may override any rule. If Ben says "merge PR-B before PR-A", do it. Log the reason in the merge batch record.

---

## 2. Rebase strategy

### When to rebase

A PR must rebase when:

1. **Any other agent PR has landed on `main`** since the PR's branch was last updated. This is the default rule — every PR rebases before merging.
2. **A shared doc was edited** by another PR (e.g. `docs/decisions/0023-*.md` or `docs/README.md`).
3. **CI checks failed due to upstream changes** (not due to the PR's own changes).

### How to rebase

```bash
# On the PR branch
git fetch origin main
git rebase origin/main
# Resolve conflicts if any
git push --force-with-lease origin herman/<branch-name>
```

After rebasing:

1. **Rerun CI checks.** GitHub Actions will trigger automatically on push. Wait for green before merging.
2. **If the PR is thread-approved**, no new review is needed unless the rebase introduces new conflicts that change the semantic diff. For trivial rebases (line-wrap, index shuffle), skip re-review.
3. **Record in Linear.** Add a comment on the PR's Linear ticket: *"Rebased on main after LAT-NNN landed. CI green. No review needed."*

### Rebase frequency target

- **Ideal:** One rebase per PR (at merge time).
- **Acceptable:** Two rebases if another PR landed mid-review.
- **Warning:** Three+ rebases on one PR → pause that PR, let it stabilize.

---

## 3. Conflict-resolution protocol

### 3.1 Conflicts between herman/* branches

When two `herman/*` branches conflict on the same file(s):

1. **Identify the conflict author.** If both PRs were created by the same agent (herman), the conflict is intra-agent. If different agents, it's inter-agent.
2. **Apply the ownership rule.** The PR whose ticket *explicitly owns* the conflicting file wins. If neither owns it, the earlier-landed PR wins.
3. **Resolve on the later PR's branch.** Rebase the later PR on `main` (which includes the earlier PR) and resolve the conflict.
4. **Record what was kept.** In the PR body comment, note what content from each side was preserved.

Example:

```
PR herman/LAT-100-something and herman/LAT-101-something both edit docs/decisions/0023-x.md.
→ LAT-100's ticket says "edit ADR-0023". LAT-101's ticket does not.
→ LAT-100's version of ADR-0023 is the winning version.
→ Rebase LAT-101 on main, resolve the conflict in ADR-0023 to keep LAT-100's version.
→ If LAT-101 also made changes to other files in that PR, keep those too.
```

### 3.2 Conflict resolution for shared Markdown hubs

Shared hubs (`docs/README.md`, `docs/decisions/README.md`, etc.) have a specific resolution strategy per LAT-35:

#### Priority order

1. **Delete-and-regenerate.** If the hub is a list/table that drifts (like `docs/decisions/README.md`'s ADR index), delete the table content and regenerate it from `ls docs/decisions/` for the PR that touches the most ADRs.
2. **Generate from scratch.** If multiple PRs add ADRs/PRDs to the hub, the PR that adds the most entries regenerates the entire hub. Other PRs' hub edits are dropped.
3. **Avoid the hub entirely.** If a PR only needs to link to something (e.g., "see ADR-0023"), write the link in the PR's own doc rather than in a shared hub. This is the default preference.

#### Specific rules per hub

| Hub file | Resolution strategy |
|---|---|
| `docs/README.md` | Each PR that owns a subdirectory updates only its own section. If two PRs add new top-level entries, the first-landed PR's entry stays; the second PR adds after it. |
| `docs/decisions/README.md` | Table was removed in LAT-35 era. Do not re-add. New ADRs just land; no hub edit needed. |
| `docs/prds/README.md` | Same as ADRs. No index table. New PRDs just land. |
| `docs/process/README.md` | Each PR that adds a process doc adds its own row. If two PRs add rows, they append in merge order. |

### 3.3 Conflict resolution for code files

When two PRs edit the same non-shared code file:

1. **The later PR rebases on main.** If the conflict is a simple line-level overlap (both changed the same line), use `ours` from the earlier PR if the change is orthogonal (e.g., one added a comment, the other changed logic).
2. **If both changes are substantive**, combine them. The agent resolving the conflict should read both PRs' descriptions and ensure neither change is lost.
3. **Record the combination.** Comment on the Linear ticket: *"Rebased on main after LAT-NNN. Conflicts in file.md resolved by combining LAT-NNN's X change with LAT-NNN's Y change."*

---

## 4. Stale PR branch handling

A PR branch is **stale** when:

- `main` has advanced by 3+ commits since the branch was last updated.
- CI checks on the branch have failed for 24+ hours and are likely due to upstream changes.
- Another agent PR that the stale PR depends on has landed.

### Actions on stale PRs

1. **Notify.** Add a comment on the PR: *"This branch is stale. Please rebase on main and update CI."* (If the agent owns the PR, the agent should auto-rebase.)
2. **Auto-rebase.** If the PR was created by herman/Perplexity, rebase on `main` without waiting for approval. If CI turns green, the PR stays in the queue.
3. **Force-close.** If the PR is stale for >7 days or its ticket has moved to Done, close the PR. The ticket owner can reopen or create a new branch if needed.

### Branch lifecycle

```
herman/LAT-NNN-slug: created → CI green → reviewed → merged → deleted
                                           ↓ (stale)
                                    rebase on main → CI green → merged → deleted
```

---

## 5. Merge batch execution protocol

When Ben approves a batch of PRs (e.g., "merge LAT-100, LAT-101, LAT-102 in that order"), Perplexity executes them as follows:

### Step 1 — Fetch and order

```bash
git fetch origin
# Check merge order: LAT-100 → LAT-101 → LAT-102
# Verify no file overlap between consecutive PRs
```

### Step 2 — Merge each PR in order

For each PR in the approved order:

```bash
# 1. Rebase the PR branch on main
git fetch origin main
git checkout herman/lat-NNN-slug
git rebase origin/main
git push --force-with-lease origin herman/lat-NNN-slug
# 2. Wait for CI green
# 3. Merge to main (squash merge preferred)
git checkout main
git merge --squash herman/lat-NNN-slug -m "LAT-NNN: <title>"
git push origin main
# 4. Delete the branch
git push origin --delete herman/lat-NNN-slug
```

### Step 3 — Record evidence

After each merge, add a Linear comment on the ticket:

```
**Merged to main on YYYY-MM-DD HH:MM UTC.**
- Conflicts resolved: [none / file.md (see notes)]
- CI checks: all green before merge
- Checks rerun after rebase: [yes/no]
- Merge order: [N/M in batch]
```

After the full batch, add a summary comment:

```
**Merge batch complete: LAT-100, LAT-101, LAT-102**
Order: LAT-100 → LAT-101 → LAT-102
All merged cleanly. No conflicts.
```

---

## 6. Direct-to-main PRs

Some PRs may go straight to `main` without a review thread (P-Direct actions per approval-gates rules). These follow the same merge-train protocol with one exception:

- **No pre-merge review required.** CI green is sufficient.
- **Still rebase on main before merge.** Even direct PRs must be current with `main`.
- **Still record merge evidence in Linear.** The agent adds a merge comment after landing.

---

## 7. Interaction with LAT-35 preflight

The merge-train protocol and the preflight protocol are complementary:

- **Preflight** runs *before* the agent starts work. It ensures the agent's instructions align with repo policy.
- **Merge-train** runs *after* the PR is ready. It ensures the agent's output lands cleanly.

A PR that passes preflight but fails merge-train (conflicts, stale branch) still gets rebased and merged. The preflight just reduces the likelihood of structural conflicts.

### Pre-flight + merge-train interaction matrix

| Pre-flight result | Merge-train result | Action |
|---|---|---|
| Pass | No conflicts | Merge immediately |
| Pass | Conflicts | Rebase + resolve + merge |
| Pass | Stale branch | Auto-rebase + merge |
| Warn | No conflicts | Merge, note the warn |
| Warn | Conflicts | Rebase + resolve + merge, escalate warn |
| Fail | — | Fix before merge |

---

## Appendix A: Quick-reference checklist for merging agents

When merging a `herman/*` PR into `main`:

- [ ] Branch is rebased on latest `main`
- [ ] CI checks are green
- [ ] Merge order is correct (disjoint first, hubs last)
- [ ] No unmerged sibling PRs overlap the same files
- [ ] Conflicts resolved per protocol (ownership rule for shared hubs)
- [ ] Linear ticket updated with merge evidence
- [ ] Branch deleted after merge
- [ ] Next PR's rebase triggered if needed

## Appendix B: Branch naming convention

| Pattern | Purpose |
|---|---|
| `herman/LAT-NNN-slug` | Agent-created PR branch |
| `herman/LAT-NNN-slug-rebased` | Rebased version (if manual rebase needed) |
| `ben/lat-NNN-slug` | Human-created PR branch |
| `lat-NNN-slug` | Historical / legacy branch pattern |

Branches are deleted immediately after merge to keep the remote clean and reduce stale branch accumulation.
