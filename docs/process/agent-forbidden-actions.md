# Agent forbidden actions

Forbidden actions per agent type: what each agent type **cannot do without approval**.
This document is the canonical lookup for agent-type-specific restrictions during the pilot.

**If this doc and another process doc or ADR disagree on a forbidden action for a given agent type, this doc wins for agent-type restrictions.** If the disagreement is about whether a broader action is Stop, the `approval-gates-and-autonomy-rules.md` rule matrix takes precedence.

## Agent types

The pilot recognizes seven agent types (see `agent-run-report.md`): `coding`, `qa`, `review`, `sre`, `pm`, `research`, `observability`. This document defines forbidden actions for the four types whose restrictions are currently material. The remaining three (`pm`, `research`, `observability`) have no type-specific forbidden actions beyond the global Stop category.

## Forbidden actions

### Coding agent

A coding agent executes implementation work: writing code, updating docs, opening PRs. Its restrictions prevent it from unilaterally modifying the repo's branch topology or merge state.

| # | Forbidden action | Scope | Exception (with approval) |
|---|---|---|---|
| C1 | **Delete a branch** | Any branch with unmerged work, including the agent's own feature branch. | Ben approves in-thread; the branch's work is merged or superseded. |
| C2 | **Merge to `main`** | Any PR targeting `main`. | Ben approves in-thread and the PR passes all checks (`thread-approved-merge-authority.md` → *Ready-to-merge gate*). The agent may mechanically execute the merge; it may not decide to merge. |

**Allowed.** Opening PRs, creating feature branches, writing code, updating tests, running lint/build/check within the branch, closing the branch after merge.

### QA agent

A QA agent verifies that code changes meet the ticket's acceptance criteria. Its restriction ensures it acts as an independent verifier, not a co-author.

| # | Forbidden action | Scope | Exception (with approval) |
|---|---|---|---|
| Q1 | **Modify source code** | Any `.ts`, `.js`, `.tsx`, `.jsx`, `.css`, `.html`, `.json` (config), or other implementation file under `src/` or package roots. | Ben explicitly authorises a fix in the ticket body (e.g. "QA agent: fix the type error in `src/foo.ts`"). The action is logged as QA-approved fix. |

**Allowed.** Reading source code, running tests, running lint/check scripts, writing test files, updating config that is not source (e.g. `tsconfig.json`, `.eslintrc` if scoped to the ticket), writing QA reports, updating the ticket description.

### PR review agent

A PR review agent assesses whether a change is the right change, done well. Its restrictions ensure it evaluates without altering the PR's metadata, which could affect routing, CI triggers, or assignment.

| # | Forbidden action | Scope | Exception (with approval) |
|---|---|---|---|
| R1 | **Edit PR title** | The GitHub PR title field. | Ben explicitly authorises a title change (e.g. the title is wrong or the ticket key changed). |
| R2 | **Edit PR assignees** | The GitHub PR assignee list. | Ben explicitly authorises the change (e.g. reassigning to the original coder for a fix). |

**Allowed.** Reviewing diffs, requesting changes, leaving comments, approving with or without nits, blocking merge, suggesting code changes in comments.

### SRE agent

An SRE agent operates the runtime environment: infrastructure, deployments, CI, monitoring. Its restrictions prevent it from arbitrary shell execution (which can be unbounded in cost/impact) and from deploying directly to production.

| # | Forbidden action | Scope | Exception (with approval) |
|---|---|---|---|
| S1 | **Run arbitrary shell** | Shell commands that touch the network, run arbitrary scripts, or execute outside the agent's sandboxed workspace. Examples: `curl` to unknown endpoints, `npm install -g`, `docker run` with volume mounts, `kubectl exec` into production pods. | Ben approves the command in the ticket or the command matches a pre-approved whitelist in the ticket body. |
| S2 | **Deploy to production** | Any deploy to the production environment (staging is allowed). | Ben approves in-thread (or the deploy is a canary that reverts automatically on health-check failure). |

**Allowed.** Running shell commands inside the sandboxed workspace (e.g. `npm test`, `npm run build`), reading logs, scaling up/down within defined bounds, deploying to staging, updating CI config files (as code), reading infrastructure state.

## Interaction with global rules

Agent-type forbidden actions are **in addition to** (not instead of) the global Stop-category actions from `approval-gates-and-autonomy-rules.md`. For example:

- Approve a PR is **Stop** globally (all agents). A coding agent cannot approve; neither can a QA, review, or SRE agent.
- Deploy is **Stop** globally. A coding agent cannot deploy; an SRE agent also cannot deploy to prod without approval (per S2), but can deploy to staging.
- Delete a Linear issue is **Stop** globally. Applies to all agent types.

## Adding a new forbidden action

When a new restriction is needed:

1. Pick the right section (coding, qa, review, sre) or add a new section if it's a new agent type.
2. Assign a unique identifier (C3, Q2, R3, S3, etc.).
3. Describe the action, scope, and the approval path (usually "Ben approves in-thread").
4. Update `docs/process/README.md` → *What lives here* if this is a new doc.
5. Link the Linear issue that owns this change.

## Related

- `approval-gates-and-autonomy-rules.md` — global rule matrix (Stop / P-Direct / P-Propose / ICP-Routed)
- `operating-model.md` — approval gates and autonomy boundaries
- `coding-agent-preflight.md` — pre-write checks for coding agents
- `qa-review-evidence.md` — QA and PR review workflow
- `thread-approved-merge-authority.md` — when agents may merge under explicit approval
- `agent-run-report.md` — agent type enumeration and run envelope
