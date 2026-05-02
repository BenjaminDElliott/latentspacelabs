---
id: ADR-0019
title: Use opencode + local Qwen as first implementation runtime
status: proposed
date: 2026-05-02
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-102
  - LAT-103
  - LAT-104
  - LAT-105
  - LAT-70
  - LAT-67
supersedes:
superseded_by:
revisit_trigger: Revisit when (a) the local Qwen endpoint becomes unreliable or quality on bounded implementation tickets falls below the threshold for a routine slice and a managed-API runtime would clearly outperform it; (b) a second operator joins and the single-host local-endpoint posture no longer matches usage; (c) a ticket-pack class emerges that opencode + Qwen cannot handle within its bounded surface (multi-file refactors that exceed context, repo-wide migrations, anything requiring Linear/GitHub MCP reach beyond what LAT-104 authorises) and Claude Code Action under ADR-0018 would; (d) opencode's agent / skill / command / MCP / GitHub-integration contract changes upstream in a way that breaks the LAT-103 wrapper assumptions or the LAT-105 dry-run harness; (e) cost or rate-limit pressure on the cognitive front door (Perplexity / ICP planner) shifts the optimal split between planner and implementer such that running planning *and* implementation locally — or both remotely — becomes preferable; or (f) a security incident — accidental public exposure of the local endpoint, a credential leaked through an opencode wrapper, an MCP scope that turned out broader than declared, or a self-hosted runner being used to attack the host — forces a tighter posture than this ADR enumerates.
---

# ADR-0019: Use opencode + local Qwen as first implementation runtime

## Context

ADR-0018 picked **GitHub Actions + Claude Code Action** as the first ICP agent runtime, triggered by `workflow_dispatch`, with `ANTHROPIC_API_KEY` in a GitHub Actions secret. That decision unblocked LAT-69 and LAT-67 and gave the pilot a concrete runtime contract for the first end-to-end ICP-dispatched coding run.

Since ADR-0018, two facts on the ground have changed:

1. The operator stood up a **local Qwen 3.6 35B inference endpoint** running on a host they control, at speeds that make it viable for short, bounded implementation tasks (small file edits, narrow refactors, single-ticket PRs).
2. The **opencode** CLI has matured to a point where it can drive an implementation loop against an arbitrary OpenAI-compatible endpoint, expose its own *agents*, *skills*, *commands*, and *MCP servers* to scope what an agent run can do, and integrate with GitHub for branch/PR creation.

The cognitive split the ICP wants is now expressible:

- **Perplexity / ICP planner** — reasoning, planning, decomposition, review, refinement. Stays remote (ADR-0008's cognitive front door).
- **Implementer** — small, bounded implementation tickets and PR creation. The candidate runtime for *this* role is what this ADR decides.

ADR-0018 named GitHub Actions + Claude Code Action as the implementation runtime by default, because no alternative was concrete at the time. With a working local model and a viable implementation CLI, the question is now real: does the first slice run implementation work in the cloud (Anthropic API + GitHub-hosted runner) or against the operator's own model and host?

LAT-102 is the decision ticket. LAT-103, LAT-104, and LAT-105 are the implementation follow-ups gated on the answer here. This ADR closes the question for the MVP slice and names what happens to ADR-0018.

This is a decision ticket, not an implementation ticket. It does not configure opencode, does not stand up a self-hosted runner, does not write any wrapper, and does not commit any endpoint URL.

## Decision Drivers

- **Anti-astronautics (`docs/decisions/README.md`).** One operator, one repo, one in-flight implementation path. The chosen runtime should require the smallest standing surface that satisfies the implementation slice.
- **Cost of cognition vs cost of implementation (ADR-0009).** Reasoning quality on plans, decompositions, and reviews is where managed frontier models earn their keep; bounded mechanical implementation does not benefit from frontier-quality cognition at frontier-quality price. A split that runs planning remote and implementation local is the cheap, defensible shape — provided implementation quality is acceptable.
- **Boundary discipline (ADR-0008, ADR-0013).** ADR-0008 fixes Perplexity as the cognitive front door and bars agents from granting themselves autonomy. ADR-0013 names the agent-invocation boundary and the minimum run contract. Whatever runtime is chosen, the implementer must consume a **bounded ticket pack** produced upstream and must not self-expand its scope (no Linear write-back, no repo-wide reach, no cross-ticket batching).
- **Least privilege and least surface (ADR-0017 Rule 4, ADR-0008).** The implementer's reach into Linear, GitHub, and the repo is whatever LAT-103 / LAT-104 declare and no more. MCP servers exposed to opencode are scoped per ticket-pack contract; full Linear/GitHub MCP exposure is explicitly out of this slice.
- **No committed secret material and no exposed endpoints (ADR-0017 Rule 3 and Rule 6).** The local Qwen endpoint URL, any auth token in front of it, and any GitHub token used by the implementer must reach the runtime through out-of-repo injection. The endpoint itself **must not be publicly exposed**; reachability is via tunnel / private network / `localhost` from the runner only.
- **Evidence must be harvestable (ADR-0006, ADR-0013, ADR-0014).** The runtime must produce a run record (transcript, action log, or equivalent) and a sanitized structured output the ICP can reference. A purely-local invocation that produces only a developer's terminal scrollback is disqualified for durable runs — same disqualification as ADR-0018 applied to local `claude-code`.
- **Ephemeral sandbox per ticket (ADR-0013, ADR-0017 Rule 2).** Each implementation run is sandboxed for one ticket: fresh checkout, no state carried across runs, credentials not retained after the process exits.
- **Stay on Node/TS/npm (ADR-0011).** Wrappers, harness, and skill surface stay in the project's existing language posture. opencode is a CLI invoked from outside the language; that's compatible. A Python wrapper layer is not.
- **PR automation must remain GitHub-native.** The pilot's review and merge surface is GitHub PRs. Whatever runtime is chosen must produce a PR through `gh` / GitHub's APIs, not a side-channel patch attached to a Linear comment.
- **Revocability.** The chosen runtime should be reversible in a single PR (revert to ADR-0018's path). A runtime that requires standing infrastructure to tear down is a worse first pick than one that does not.

## Considered Options

1. **Local opencode runner only.** Operator runs `opencode` on their own laptop, pointed at the local Qwen endpoint, against the local checkout. Implementation runs entirely on the operator's machine; PR creation is via `gh` from the same machine.
2. **Self-hosted GitHub Actions runner + opencode + local Qwen endpoint.** A self-hosted runner registered to this repo executes a workflow that invokes `opencode` against the local Qwen endpoint. The runner is the only client of the endpoint and reaches it over `localhost` / a private network. PR creation is via the workflow's `GITHUB_TOKEN` (same shape as ADR-0018).
3. **GitHub-hosted Actions + Claude Code Action (ADR-0018's choice).** Keep ADR-0018 as the primary implementation runtime. Implementation runs on GitHub-hosted runners against the Anthropic API, paid per minute and per token.
4. **Dedicated future ICP worker.** A standing Node service (Fly/Render/Railway worker, a VPS, a dedicated host) that the ICP dispatches implementation jobs to. Owns its own queue, evidence sink, and rotation surface.

### Trade-offs

| Axis | (1) Local opencode | (2) Self-hosted runner + opencode + Qwen | (3) GitHub-hosted + Claude Code Action | (4) Dedicated worker |
|---|---|---|---|---|
| Standing infra | None beyond the local model host | Self-hosted runner + local model host (already exists) | None (GitHub-hosted) | New service to deploy and rotate |
| Marginal cost per ticket | ~0 (electricity) | ~0 (electricity) | Anthropic tokens + Actions minutes | Hosting + tokens or local |
| Endpoint exposure | Local-only by construction | Local-only; runner is the only client | N/A (cloud model) | Depends on deployment |
| Evidence shape | Operator transcript only — not durable | Workflow run + check run + artifact (ADR-0018 evidence model carries over) | Workflow run + check run + artifact | Custom — needs a new evidence path |
| PR creation | `gh` on operator machine | Workflow `GITHUB_TOKEN` (ADR-0018 shape) | Workflow `GITHUB_TOKEN` (ADR-0018 shape) | Custom token management |
| Trigger model | Operator shell | `workflow_dispatch` (ADR-0018 carries over) | `workflow_dispatch` (ADR-0018 carries over) | Custom dispatcher |
| Reversibility | Trivial | Single PR (remove workflow + deregister runner) | Already the fallback | Tear down a service |
| Boundary fit (ADR-0008/0013) | Weak: invocation boundary collapses to operator shell | Strong: invocation boundary is the workflow + ticket pack | Strong: same shape ADR-0018 already approved | Strong, but premature for one operator |
| Anti-astronautics fit | Best | Acceptable: reuses existing local host + GitHub Actions surface | Acceptable: existing surface | Worst: new substrate for one in-flight path |

## Decision

**Accepted: Option 2 — self-hosted GitHub Actions runner + opencode + local Qwen endpoint** as the **first implementation runtime** for small, bounded implementation tickets and PR creation.

The cognitive split is fixed as:

- **Perplexity / ICP planner (remote)** — reasoning, planning, decomposition, review, refinement. Produces a **ticket pack** for each implementation ticket.
- **opencode + local Qwen (local, via self-hosted runner)** — consumes the ticket pack, performs the bounded edits, runs `npm run check`, opens a PR. Does not plan, does not decompose, does not review its own output, does not write back to Linear from inside the implementation run.

### Boundary

- **Inputs (boundary in).** opencode consumes a **bounded ticket pack** produced by the ICP planner: ticket ID, scope statement, files in scope (allowlist), forbidden files, acceptance criteria, cost band, and any reference snippets the planner chose to include. The ticket-pack contract is owned by **LAT-104** and is *not* defined in this ADR; this ADR fixes the contract as the *only* input shape opencode consumes. An implementation run that lacks a ticket pack does not start.
- **Outputs (boundary out).** A PR on the target repo, the workflow run log, a check run, and a sanitized structured output (per ADR-0014). Linear write-back is not performed from inside the implementation run — that happens in the planner / review path, same as ADR-0018.
- **Forbidden expansion.** opencode does not edit files outside the ticket pack's allowlist, does not add new dependencies unless the pack authorises it, does not edit `.github/workflows/**` (ADR-0008 Stop), and does not amend ADRs or PRDs.
- **No self-review.** Review and refinement are owned by the planner / Perplexity path. opencode runs the project's mechanical checks (`npm run check`) and no more. A failing check is reported as a failed run, not papered over.

### Trigger model

- **MVP: `workflow_dispatch` only**, same as ADR-0018. Inputs (ticket pack reference, ticket ID, cost band) are passed through `workflow_dispatch` inputs.
- Comment-based, label-based, assignee-based, and scheduler-based triggers are **explicitly deferred** for the same reasons ADR-0018 deferred them: they broaden the principal set in ways this ADR does not yet enumerate.
- **Fork-PR triggers are out**, same as ADR-0018: self-hosted runners on fork-triggered workflows are a known security pitfall (a fork PR could execute arbitrary code on the host) and this ADR does not introduce a `pull_request_target`-shaped workaround.

### Endpoint and credential model

- **The local Qwen endpoint must not be publicly exposed.** No port forward to the public internet, no authenticated reverse proxy on a public hostname for this endpoint, no DNS record that resolves it from outside the operator's network. The self-hosted runner reaches the endpoint over `localhost` (if co-located) or a private network only. If the runner is co-located with the model host, the endpoint binds to `127.0.0.1`; if separated, the endpoint binds to a private interface and a host-firewall rule blocks public ingress. Public exposure of this endpoint is treated as the ADR-0017 Rule 3 incident class.
- **Endpoint URL is not committed.** The URL (and any token in front of it) is provided through a runner-side environment variable or an out-of-repo configuration file (per ADR-0017's residence rules). It does not appear in `.env`, `.mcp.json`, any workflow file, any artifact, or any PR body in this repo.
- **GitHub credential** for PR creation is the workflow's built-in `GITHUB_TOKEN`, with the same `permissions:` shape ADR-0018 fixed (`contents: write`, `pull-requests: write`, `issues: write`; `actions: write` and workflow-edit capability withheld). LAT-103 implements the workflow against this constraint.
- **Anthropic credential** is **not used** by this runtime. ADR-0017's `ANTHROPIC_API_KEY` rules continue to apply to ADR-0018's runtime, which remains the fallback (see "What happens to ADR-0018" below).
- **Self-hosted runner posture.** The runner runs as a non-root user on a host the operator controls, has only the labels needed to be selected by this workflow, has no persistent secrets on disk beyond what the operator's secret manager places there, and is registered with repository scope only — not organisation-wide. The runner host is treated as a secret-bearing host under ADR-0017.

### Evidence model

Evidence shape carries over from ADR-0018:

1. **Workflow run log** — the canonical "where did this run" answer.
2. **Check run** on the dispatch's target branch / PR — pass/fail signal for the cost-band gate and the QA loop.
3. **Sanitized structured output / artifact** — opencode's transcript and tool-call summary, redacted per ADR-0014 before publication. The local endpoint URL, any auth token, and any internal hostnames are stripped; only the model name and high-level run metadata remain.

The PR itself is the implementation output; the artifact is the evidence trail behind it.

### Non-goals (this slice)

- **No full Linear or GitHub MCP exposure** to opencode. MCP servers wired into the implementer are limited to what the ticket pack requires (typically: a read-only repo-context server and a scoped `gh`-style server for PR creation). Broad Linear MCP access is the planner's surface, not the implementer's.
- **No multi-ticket automation.** One ticket pack → one run → one PR. Batching is a follow-up ADR if the pilot ever wants it.
- **No auto-merge.** PRs land in review, not in `main`. The reviewer is the operator (and, later, a reviewer agent in the planner path).
- **No proof of "Anthropic-equivalent" quality (LAT-67's question).** This ADR does not claim Qwen matches Claude on implementation tickets. It claims Qwen + opencode is *good enough* for the bounded pilot slice and that the runtime is reversible if it isn't.
- **No model-routing / fallback orchestration.** A failed Qwen run does not auto-retry on Claude. Fallback is a manual operator decision (re-dispatch under ADR-0018).
- **No replacement of ADR-0018's runtime for non-implementation work.** Anything that is not a bounded implementation ticket — review, planning, decomposition, anything that needs frontier-model cognition — does not run here.

### What happens to ADR-0018

- **ADR-0018 is retained as the fallback implementation runtime.** It is not superseded outright. The runtime contract it fixed (workflow_dispatch trigger, GitHub Actions secret residence, evidence shape, security model) remains the contract for any implementation slice that cannot run on opencode + Qwen — for example, a ticket whose context pack exceeds Qwen's effective window, a ticket requiring frontier-model judgement, or any run during a Qwen-host outage.
- **For the *primary* implementation runtime of bounded tickets**, ADR-0018 is **amended**: this ADR adds a higher-priority option (opencode + local Qwen on a self-hosted runner) and re-classifies ADR-0018's GitHub-hosted + Claude Code Action path as the fallback for that class of work. ADR-0018's `superseded_by` field is updated to point at this ADR for that scope; ADR-0018's status moves from `proposed` to `revisit-by` with the trigger pointing at the conditions in this ADR's `revisit_trigger`.
- ADR-0018 continues to govern any future runtime decision for non-implementation agent runs (e.g. the first reviewer-agent runtime, if that ever lands as a separate runtime). This ADR does not decide that.

### What this ADR does *not* decide

- **The opencode wrapper itself** — agent definitions, skill set, command surface, MCP scoping. Owned by **LAT-103**.
- **The ticket-pack contract** — schema, allowlist semantics, cost-band field, refusal modes. Owned by **LAT-104**.
- **The dry-run harness** that validates a ticket pack against this runtime before a real dispatch. Owned by **LAT-105**.
- **The workflow YAML** itself, the self-hosted runner registration, the runner host hardening checklist, or the endpoint binding configuration. Those are LAT-103 deliverables; this ADR fixes the constraints they must satisfy.
- **Whether to ever expose Qwen publicly behind an authenticated gateway.** This ADR forbids it for the pilot. A later ADR may revisit.
- **Whether a managed-API replacement for Qwen** (a hosted open-weights endpoint, a cheaper-than-frontier API) becomes the implementer once the local-only constraint relaxes. Revisit trigger (a) and (e) name this.

## Consequences

Good:

- The cost split lines up with the cognition split: frontier cost only where frontier cognition pays. Bounded implementation runs at ~zero marginal cost on hardware the operator already owns.
- ADR-0018's runtime contract — `workflow_dispatch`, GitHub-native evidence, narrow `permissions:` block, no fork-PR exposure — carries over almost unchanged. The substrate underneath the workflow changes (self-hosted runner instead of GitHub-hosted; opencode + local model instead of Claude Code Action); the contract above it does not. That keeps LAT-67's evidence shape stable.
- The boundary between planner and implementer becomes physical, not just nominal: the implementer literally cannot reach Linear or the planner's tools because its MCP surface does not include them. ADR-0008's "agents do not grant themselves autonomy" gets a structural rather than conventional defence.
- ADR-0018 staying live as the fallback means the pilot is never one Qwen-host outage away from being unable to ship. Reverting to the cloud path is a single workflow-input change, not a re-decision.
- opencode's *agents / skills / commands* surface gives the pilot a local equivalent of Claude Code's harness — same skill-runner shape ADR-0012 / ADR-0016 already assume, executable against any compliant model. That keeps ADR-0016's skill-directory layering meaningful without locking it to one vendor.
- Scope discipline is enforceable at the ticket-pack boundary (LAT-104) and at the MCP scope (LAT-103). The implementer cannot quietly grow into a planner.

Bad / open:

- **Self-hosted runner is a non-trivial security surface.** It executes code from this repo on a host the operator controls; misconfiguration (running as root, wrong network namespace, the runner host also serving other services, fork-PR triggers later being added without re-reading this ADR) can turn it into an attack vector against the host. The runner-host hardening checklist is a LAT-103 deliverable; this ADR fixes the policy (non-root, repo-scoped, no fork-PR triggers, no public endpoint exposure) but does not implement it.
- **Single-host availability.** When the local model host is down, no implementation runs happen on the primary runtime. Fallback is ADR-0018's path; that requires a manual re-dispatch. Revisit trigger (a).
- **Implementation quality at Qwen 3.6 35B is unproven for this codebase's tickets.** The pilot bears the calibration cost: some tickets will need to be re-run on the fallback. LAT-105's dry-run harness is the cheap way to fail before a real run; it does not eliminate the calibration.
- **opencode is moving upstream.** Agents/skills/commands/MCP/GitHub contracts may change. LAT-103's wrapper takes that risk; pinning a known-good opencode version and tracking upstream changes is part of LAT-103's brief. Revisit trigger (d).
- **Cost meter ambiguity.** ADR-0009's cost bands meter remote model spend; local model runs are free in tokens but real in electricity, hardware wear, and operator attention. The ADR-0009 bands do not currently model that. The pilot accepts this as a known gap until a band shape covers it.
- **Two runtimes at once is two runtimes to keep healthy.** The ADR-0018 fallback only stays useful if it is occasionally exercised. LAT-103 should include a "fallback smoke test" (a ticket-pack run dispatched against ADR-0018's path on a cadence) so the fallback does not silently rot.
- **Endpoint-exposure compliance is operator-enforced.** This ADR forbids public exposure but cannot mechanically check it. A periodic `nmap` from outside the operator's network or an explicit firewall-rule audit is the backstop; this ADR notes the rule rather than tooling it.

## Confirmation

The decision is working when:

- **LAT-103 lands** an opencode wrapper (agents/skills/commands/MCP scope) and a self-hosted-runner workflow that consumes the LAT-104 ticket-pack contract, references no committed endpoint URL, declares `permissions:` at or below ADR-0018's shape, does not use `actions: write`, and registers the runner repo-scoped + non-root + with no fork-PR trigger path.
- **LAT-104 lands** the ticket-pack contract and a validator. A run that lacks a valid ticket pack refuses to start.
- **LAT-105 lands** a dry-run harness that exercises a ticket pack against opencode + Qwen without opening a PR (no GitHub side-effects, no Linear write-back) and produces the same evidence artifact a real run would, redacted.
- **Endpoint posture holds.** The local Qwen endpoint is not reachable from the public internet; spot-checked at LAT-103 review and again on each runner host re-bootstrap. Any reachability event is treated as the ADR-0017 Rule 3 incident class.
- **No endpoint URL, auth token, or internal hostname** appears in any tracked file, artifact, or PR body. Spot-checked in the LAT-54 retrospective loop (ADR-0010) and enforced by `secret-guard` (ADR-0017).
- **`npm run check` remains offline.** This ADR does not add a check that requires the local endpoint to be up; the check passes even when Qwen is offline.
- **Fallback stays exercised.** ADR-0018's runtime is invoked at least occasionally (LAT-103's smoke-test cadence) so the fallback does not rot.
- **Boundary holds.** No implementation run reaches Linear, opens additional PRs, batches tickets, edits ADRs/PRDs, or edits `.github/workflows/**`. Spot-checked at QA review per ADR-0007.
- **Scope increase = ADR diff.** Any change that broadens the implementer's reach (Linear MCP access, multi-ticket batching, auto-merge, comment/label triggers, public endpoint exposure, model-routing fallback) lands as a PR diff to this ADR or as a superseding ADR — not as a quiet workflow or wrapper edit.

Signals to revisit are enumerated in `revisit_trigger` above. The shortest paths are an unreliable local endpoint, a security incident on the self-hosted runner, or an opencode upstream change that breaks the wrapper contract.

## Links

- Related Linear issue(s): LAT-102 (this decision), LAT-103 (opencode wrapper — agents/skills/commands/MCP scope and self-hosted runner workflow), LAT-104 (ticket-pack contract and validator), LAT-105 (dry-run harness), LAT-70 (ADR-0018, the prior runtime decision this ADR amends), LAT-67 (first ICP-dispatched coding run, now consumes this runtime first and ADR-0018 as fallback).
- Related ADRs: ADR-0008 (agent control layer, cognitive front door, Stop list), ADR-0009 (cost bands), ADR-0011 (ICP language/runtime — Node/TS/npm constraints), ADR-0012 (ICP skill runner as the single invocation gate), ADR-0013 (agent invocation boundary and minimum run contract), ADR-0014 (run-report redaction), ADR-0016 (skill directory and adapter layering), ADR-0017 (credentials and secrets management), ADR-0018 (first ICP agent runtime — retained as fallback, amended for primary implementation runtime).
- External sources:
  - opencode agents docs: <https://opencode.ai/docs/agents/>
  - opencode skills docs: <https://opencode.ai/docs/skills/>
  - opencode commands docs: <https://opencode.ai/docs/commands/>
  - opencode GitHub integration docs: <https://opencode.ai/docs/github/>
  - opencode MCP servers docs: <https://opencode.ai/docs/mcp-servers/>
