---
id: ADR-0018
title: First ICP agent runtime
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-70
  - LAT-67
  - LAT-69
  - LAT-61
  - LAT-62
supersedes:
superseded_by:
revisit_trigger: Revisit when (a) the pilot onboards a second operator and GitHub Actions minute budgets, concurrency, or per-operator secret scoping no longer match usage; (b) an ICP run needs a runtime surface GitHub Actions cannot provide (long-running sessions beyond the job timeout, persistent state across runs, a custom sandbox image the action does not expose, or a network egress posture the runner cannot offer); (c) spend on GitHub-hosted runners plus Anthropic API calls through the action exceeds the ADR-0009 cost bands for a routine slice; (d) a trigger shape the action does not support (non-GitHub event, external scheduler, cross-repo dispatch) becomes load-bearing; (e) a security incident — committed credential, workflow-edit scope creep, fork-PR abuse, or a bot/user trigger path that bypassed review — forces a tighter posture than Actions permissions can express; or (f) Anthropic changes the action's authentication contract (new token shape, removal of `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`, or a licensing change) such that the runtime assumption here no longer holds.
---

# ADR-0018: First ICP agent runtime

## Context

ADR-0012 defined the ICP's internal software architecture. ADR-0013 named the agent-invocation boundary and said every invocation must flow through the skill runner and the agent-invocation adapter. ADR-0017 fixed the credential-loading contract and named the six execution contexts a credential must be injected into. What none of those ADRs pinned is the **substrate the agent actually runs on**: when the ICP dispatches a coding agent for a Linear ticket today, where does that process live, how is it triggered, and how is `ANTHROPIC_API_KEY` (or an equivalent) delivered to it.

LAT-61 shipped the agent-invocation adapter and LAT-62 is the CI / sandbox execution ticket; both assume *some* runtime exists but neither decides which. LAT-67 is the first ICP-dispatched coding run end-to-end and is blocked on a concrete runtime choice. LAT-69 is the configuration ticket (add the secret, gate the workflow, write the runtime README) and is blocked on the decision here. This ADR closes the runtime question for the MVP so LAT-69 can proceed and LAT-67 can land once LAT-69 confirms the secret is wired.

This is a decision ticket, not an implementation ticket. It does not add a workflow YAML, does not install the Claude GitHub app, and does not configure any real secret value. It picks the first runtime, names how it is triggered, names which credential shape it uses, and names the evidence and security posture that must hold from the first run.

## Decision Drivers

- **Anti-astronautics (`docs/decisions/README.md`).** One operator, one repo, one in-flight ICP dispatch path. A runtime choice that requires new infrastructure, an account with a new vendor, or a dedicated worker service is overbuilt for the pilot slice.
- **Least privilege and least surface (ADR-0017 Rule 4, ADR-0008).** Whatever runtime is chosen must run with a repo-scoped credential set and must not grant the agent `workflow` write, admin, or cross-repo reach. Fork-triggered or comment-triggered workflows need a trigger model that cannot be coerced by a non-author.
- **No committed secret material (ADR-0017 Rule 3 and Rule 6).** Whatever the runtime, the `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`) reaches the agent through an out-of-repo injection mechanism. A runtime that makes this hard (local files, shared machines without per-run isolation) is disqualified.
- **Evidence must be harvestable (ADR-0006, ADR-0013 minimum run contract, ADR-0014).** The runtime must produce a run log, a check run, and a sanitized structured output that the ICP can reference from a Linear write-back. A runtime whose only output is a developer's local shell is disqualified for durable runs.
- **Ephemeral sandbox (ADR-0013 isolation, ADR-0017 Rule 2).** A coding agent sandboxed for one ticket must not outlive the run, must not keep a credential after the process exits, and must not share state with another run unless explicitly handed off. A runtime that gives each run a fresh VM satisfies this structurally; a runtime that reuses a long-lived machine satisfies it by convention.
- **Trigger model matters as much as the runtime.** A runtime that can only be triggered by an in-thread comment or by any user with write access expands the invocation surface beyond what ADR-0013 authorises for the first slice. The first runtime must support a **manual, explicit** trigger owned by the operator.
- **Stay on Node/TS/npm (task guardrails, ADR-0011).** The runtime's wrapper surface — whatever workflow, script, or harness configures it — must not require Python, pnpm, yarn, or a second language runtime.
- **Revocability.** The runtime choice should be reversible in a single PR (replace the workflow, revoke the secret, move the trigger). A runtime that requires standing infrastructure to tear down is a worse first pick than one that does not.

## Considered Options

1. **Local developer machine.** The operator runs `claude-code` (or a successor CLI) on their own laptop against the local checkout, exporting `ANTHROPIC_API_KEY` from their shell. Rejected as the *first owned runtime*: it is already how the operator drives exploratory work, but it does not produce a durable run log, does not gate on a repo-level trigger, and cannot be consumed as evidence by LAT-67 without extra scaffolding. It remains a legitimate driver for interactive work outside the ICP dispatch path — this ADR does not forbid it; it says it is not the thing LAT-67 writes back against.
2. **Perplexity subagents as the runtime.** Have Perplexity invoke the coding agent in its own execution substrate. Rejected: ADR-0008 already classifies Perplexity as the cognitive front door, not an agent invoker; ADR-0012 and ADR-0013 placed the invocation boundary inside the ICP skill runner. Putting the first owned runtime inside Perplexity reverses those decisions and adds a vendor dependency for the one substrate we most want to own.
3. **Dedicated ICP worker service** (a standing Node process on a VPS, a Fly/Render/Railway worker, a self-hosted runner). Rejected for MVP: introduces hosting, deploy, and rotation infrastructure for a single in-flight dispatch path. Revisit trigger (a) and (b) above name the conditions under which this becomes the right answer; today it is premature.
4. **Managed model-hosting substrate** (Amazon Bedrock, Google Vertex) as the runtime. Rejected: these are model-inference services, not agent runtimes. Using them would still require a wrapper harness around them to execute the coding-agent contract, and would add a cloud-account dependency the pilot does not need. They are a legitimate **provider** choice for a later ADR if the operator wants to swap the direct-Anthropic path for an IAM-federated one, but they do not answer "where does the agent process run."
5. **GitHub Actions + Claude Code Action, triggered by `workflow_dispatch`, with `ANTHROPIC_API_KEY` stored as a GitHub Actions repository (or environment) secret.** *Chosen.* Explanation in the Decision section.

## Decision

**Accepted: Option 5.** The first owned ICP agent runtime is **GitHub Actions running the Claude Code Action**, triggered by `workflow_dispatch`, with `ANTHROPIC_API_KEY` delivered through a GitHub Actions repository or environment secret. The subsections below fix the trigger model, the secret model, the evidence model, and the security posture that must hold from the first run. LAT-69 implements the workflow YAML, registers the secret, and writes the runtime README against these rules. LAT-67 consumes this runtime for the first end-to-end dispatch.

### Trigger model

- **MVP: `workflow_dispatch` only.** The workflow is started by the operator from the GitHub Actions UI or via `gh workflow run`. Inputs (ticket ID, prompt, cost band) are passed through `workflow_dispatch` inputs. No other trigger is wired in this slice.
- Comment-based, label-based, and assignee-based triggers (the Claude Code Action's `@claude` / `claude-review` / `trigger_phrase` / `assignee_trigger` features, per the action's usage docs) are **explicitly deferred**. They are attractive once the invocation path is trusted end-to-end; they are not appropriate as the first trigger because they broaden the set of principals who can start an agent run and interact with the ADR-0013 invocation categories in ways this ADR does not yet enumerate. Adding any of them is a follow-up PR that edits this ADR (or supersedes it) together with `approval-gates-and-autonomy-rules.md`.
- **Fork-PR triggers are out.** Per the GitHub Actions secrets docs, repository secrets are not passed to workflows triggered by pull requests from forks (only `GITHUB_TOKEN` is). This ADR does not introduce a `pull_request_target`-shaped workaround for the first runtime; the operator is the only trigger source.
- **No wildcard bot triggers and no `allowed_non_write_users`.** The Claude Code Action exposes `allowed_bots` and `allowed_non_write_users` to broaden who can trigger it; both remain unused in this slice. When a bot trigger becomes load-bearing (e.g. a scheduled dispatcher), that is a follow-up with its own review.

### Secret model

- `ANTHROPIC_API_KEY` is stored as a **GitHub Actions repository secret** (or an environment secret bound to an environment that the workflow declares); per the GitHub Actions secrets docs, the value is entered once under *Settings → Secrets and variables → Actions* and referenced in the workflow as `${{ secrets.ANTHROPIC_API_KEY }}`. No credential material is committed to the repo, to `.mcp.json`, to any workflow file, to any artifact, or to any PR body. ADR-0017 Rule 3 is binding here; this ADR does not relax it.
- The action's setup docs accept either `anthropic_api_key` or `claude_code_oauth_token`. MVP uses `ANTHROPIC_API_KEY`. A later move to `CLAUDE_CODE_OAUTH_TOKEN` (e.g. for subscription-billed access) is a secret swap + workflow-input change; it does not require amending this ADR so long as the residence is still a GitHub Actions secret.
- `GITHUB_TOKEN` for the action is the job's built-in token. The Claude Code Action accepts a custom `github_token` input; this slice **does not supply one**. Using the built-in token keeps the agent's GitHub reach bounded by the job's declared `permissions:` block.
- Workflow `permissions:` is set to the minimum the agent needs for the slice: `contents: write`, `pull-requests: write`, `issues: write`; everything else defaults to `none`. `actions: write` and any workflow-edit capability are **not** granted (ADR-0008 Stop — agents do not edit CI).
- The workflow YAML shape, the exact `permissions:` map, and the runtime README are LAT-69 deliverables. This ADR fixes the constraints they must satisfy.
- Any non-GitHub sensitive value that a step prints (e.g. an echoed model-provider response field) is masked with `::add-mask::` at emission, per the GitHub Actions secrets docs. This is a review-time rule for the first workflow rather than a tool.

### Evidence model

Every ICP dispatch through this runtime must produce, at minimum, the ADR-0006 / ADR-0013 envelope carried over three GitHub-native surfaces:

1. **Action run log.** The workflow run is the primary execution record; its URL is the canonical "where did this run" answer and is what the Linear write-back references.
2. **Check run.** A check run attached to the dispatch's target branch / PR (created by the action or by an explicit step) gives the pass/fail signal the cost-band gate and the QA loop can read.
3. **Sanitized structured output / artifact.** The Claude Code Action's structured outputs (per the action's usage docs) are captured into a workflow artifact (or a committed run report, per ADR-0014) with the ADR-0014 redaction rules applied. Secrets, derived metadata, and free-text citations containing credentials are stripped before the artifact is published.

**Linear write-back is later, not first.** The first run's evidence is the three surfaces above. A Linear write-back step is added in a follow-up once the write-back formatter (ADR-0013) is bound to the action's output shape. LAT-67 is the earliest slice that will exercise the write-back; this ADR does not decide the write-back's shape.

### Security model

- **Least permissions.** The workflow declares an explicit `permissions:` block scoped to the minimum above. `actions: write` is withheld. Cross-repository reach is withheld.
- **No `allowed_non_write_users` and no wildcard `allowed_bots`.** Only principals who already have write access to the repo can trigger the workflow, because only they can dispatch it. This matches ADR-0008's "owners set autonomy, agents do not grant themselves autonomy."
- **No custom `github_token` in the first slice.** The built-in `GITHUB_TOKEN` with the declared `permissions:` block is the reach the agent gets. A custom token is only introduced when a concrete slice needs a capability the built-in cannot cover, and that slice amends this ADR.
- **No `additional_permissions` beyond defaults in the first slice.** The action's `additional_permissions` input (per its usage docs) is left empty; anything it would unlock is a deliberate, ADR-gated extension.
- **Committed credentials are an incident, not a bug.** ADR-0017 Rule 3 applies: if a real value ever appears in a tracked file, the credential is revoked and reissued per ADR-0017 Rule 5, with no grace period.
- **Workflow file edits are agent-restricted.** Per ADR-0008's Stop list, agents do not edit CI. The Claude Code Action running in this workflow does not have `actions: write`; the operator edits the workflow file by hand or in a reviewed PR.

### What this ADR does *not* decide

- The workflow YAML itself. Owned by LAT-69.
- The Linear write-back step. Owned by a later slice once LAT-67 lands.
- Whether a later runtime supersedes this one. The revisit trigger enumerates the conditions under which that review is owed.
- Whether local `claude-code` invocations count as ICP dispatches. They do not, for evidence purposes; they are operator-driven work that may produce inputs to an ICP run but are not themselves "the runtime" under this ADR.

## Consequences

Good:

- LAT-69 can proceed against a concrete runtime contract: one workflow, one secret, one trigger, one evidence shape. LAT-67 unblocks once LAT-69 confirms the secret is available in this runtime.
- The first runtime adds zero standing infrastructure. If the choice proves wrong, the reversal is a single PR (remove the workflow, revoke the secret) and a superseding ADR.
- GitHub Actions provides per-run VM isolation structurally; ADR-0013's ephemeral-sandbox expectation is satisfied without new convention.
- Evidence is harvestable from GitHub-native surfaces (action run, check run, artifact) that already fit ADR-0006 and ADR-0014.
- The secret model aligns with ADR-0017 Rule 2 without regressing any other rule: the workspace-root `.env` / OS keychain residence remains correct for local dev; GitHub Actions `secrets.*` is the CI / runner residence the loader's `process.env` contract already anticipates.
- Staying on `workflow_dispatch` keeps the invocation surface narrow. Comment/label triggers can be added later with a deliberate review, not inherited silently.

Bad / open:

- GitHub Actions runner minute budgets and concurrency caps are a standing cost surface the pilot now depends on. The ADR-0009 cost bands do not currently meter CI minutes; a runaway-cost event on the runner side would show up as a GitHub billing signal, not an ICP band alert. Revisit trigger (c) names this.
- `workflow_dispatch` is operator-driven, not event-driven. Anything the pilot wants to trigger from a Linear state change, a scheduler, or a cross-repo event needs a follow-up ADR or a superseding runtime.
- The action's `allowed_bots` / `allowed_non_write_users` / `trigger_phrase` / `assignee_trigger` surface is attractive but unbounded; keeping it off in this slice means the "easy onboarding" path for a reviewer to start an agent run is not available yet. That is by design.
- Anthropic's action contract is a moving target (authentication shapes, structured-output schema, input names). An upstream change to `anthropic_api_key` / `claude_code_oauth_token` or to the action's output shape would force a LAT-69 follow-up. Revisit trigger (f) names this.
- Fine-grained PAT limits and fork-PR secret-exclusion rules mean this runtime is structurally single-operator, single-repo today. That is compatible with ADR-0017 Rule 4 and the pilot's single-operator constraint; it stops being enough the moment a second operator joins (revisit trigger a).
- The operator is responsible for not committing `ANTHROPIC_API_KEY` to `.env`, `.mcp.json`, or any other tracked file during setup. The secret-guard tooling (`npm run secret-guard`) is the backstop; this ADR does not add a new check for it.

## Confirmation

The decision is working when:

- LAT-69 merges a workflow file (outside this PR) that declares `workflow_dispatch`, references `${{ secrets.ANTHROPIC_API_KEY }}`, sets an explicit `permissions:` block at or below `contents:write` + `pull-requests:write` + `issues:write`, does not supply a custom `github_token`, and does not set `allowed_non_write_users` or wildcard `allowed_bots`.
- LAT-67 produces its first end-to-end ICP dispatch in this runtime, and the resulting Linear write-back links to the action run URL and the check run rather than a local transcript.
- `npm run check` remains offline (ADR-0017 Rule 2): the action's workflow is separate from `.github/workflows/check.yml`, and `check` does not depend on any Anthropic credential.
- No `.env`, `.mcp.json`, workflow file, artifact, or PR body on any branch contains a real Anthropic credential. Spot-checked in the LAT-54 retrospective loop (ADR-0010) and enforced by `secret-guard` (ADR-0017).
- A scope increase on this runtime (new trigger, new permission, bot allowlist, custom `github_token`, `additional_permissions`) lands as a PR diff to this ADR or as a superseding ADR — not as a quiet workflow edit.

Signals to revisit are enumerated in `revisit_trigger` above. The shortest path is a trigger-shape requirement the action cannot express; the next is a cost or security signal that makes GitHub Actions' posture insufficient.

## Links

- Related Linear issue(s): LAT-70 (this decision), LAT-69 (workflow + secret configuration, consumes this ADR), LAT-67 (first ICP-dispatched coding run, consumes this runtime), LAT-61 (agent-invocation adapter, calls into this runtime), LAT-62 (CI / sandbox execution, Rule 2 residence).
- Related ADRs: ADR-0008 (agent control layer, Stop list and autonomy), ADR-0009 (cost bands and runaway-cost interrupts), ADR-0011 (ICP language/runtime — Node/TS/npm constraints), ADR-0012 (ICP skill runner as the single invocation gate), ADR-0013 (agent invocation boundary and minimum run contract), ADR-0014 (run-report redaction), ADR-0017 (credentials and secrets management — `ANTHROPIC_API_KEY` residence rules).
- External sources:
  - Claude Code Action setup docs: <https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md>
  - Claude Code Action usage docs: <https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md>
  - GitHub Actions — using secrets in workflows: <https://docs.github.com/actions/security-guides/using-secrets-in-github-actions>
