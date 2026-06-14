---
id: ADR-0025
title: Agent isolation expectations and forbidden actions
status: proposed
date: 2026-06-14
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-164
  - LAT-21
supersedes:
superseded_by:
revisit_trigger: Revisit when (a) a new agent type is added that requires a distinct isolation profile; (b) the secret management backend changes and credential scope rules need updating; (c) runtime isolation (containers, sandboxes) lands and the scope definitions must be implemented as actual boundary constraints; (d) a new Stop-category action emerges that is not covered by the existing forbidden-action enum; or (e) the network ACL implementation (non-goal of LAT-164) requires moving from domain-pattern strings to actual allow/deny rules.
---

# ADR-0025: Agent isolation expectations and forbidden actions

## Context

ADR-0013 (LAT-21) established the invocation boundary for the ICP: four categories (Direct, Proposed, ICP-Routed, Stop), a minimum run contract, and isolation and safety expectations. It named the *principles* — secrets are resolved by the credential loader, merge/deploy are Stop, external comms are Stop — but did not define per-agent-type boundaries in a machine-readable form.

As the ICP grows from a single coding agent to multiple agent types (QA, review, SRE, research, etc.), each type needs explicit isolation rules so that:

1. **The skill runner** can enforce boundaries at invocation time (e.g. refuse to start a coding agent if `GITHUB_TOKEN` is missing).
2. **The policy scanner** can validate that agent configs match the declared isolation rules.
3. **Reviewers** can quickly verify that a new agent type's config is correct without cross-referencing six ADRs.
4. **Operators** can audit what actions each agent type can perform and which require approval.

This ADR defines those per-agent-type isolation expectations in a structured format. The implementation lives in the new `@latentspacelabs/agent-isolation` package (see `packages/agent-isolation/`), which provides both the policy surface and the enforcement utilities.

## Decision Drivers

- **LAT-21 (ADR-0013) is the policy framework.** This ADR implements and extends the isolation rules from ADR-0013 in a per-agent-type, machine-readable form. Where ADR-0013 says "merge and deploy are Stop per ADR-0008," this ADR defines which agent types forbid which specific actions and at what autonomy level.
- **Acceptance criteria from LAT-164 must be satisfied.** Coding agents cannot delete/merge to protected branches; SRE agents cannot run arbitrary shell without approval; every agent's side effects are logged with evidence.
- **Anti-astronautics.** No new component, no new runtime. The isolation rules are declarative policy consumed at the skill runner boundary. Runtime enforcement (containers, sandboxes) is out of scope.
- **TypeScript / Node / npm only.** No new languages or runtimes.
- **Policy scanner integration.** The `@latentspacelabs/agent-isolation` package integrates with the existing policy-scanner tooling so that isolation rules are validated as part of the CI check pipeline.

## Decision

**Accepted.** This ADR defines per-agent-type isolation configurations, each comprising:

1. **Secret scope** — the list of credential names the agent can access.
2. **Filesystem scope** — the list of directory patterns the agent can read/write.
3. **Network scope** — the list of domain patterns the agent can reach.
4. **Forbidden actions** — actions the agent cannot perform, with reasons.
5. **Approval requirements** — actions the agent can perform but only with human approval, with autonomy level and approver type.
6. **Side-effect scope** — which surfaces (files, Linear, GitHub, notifications) the agent produces side effects on.

The implementation is in `packages/agent-isolation/src/isolation.ts`, with Zod schemas for validation, and the full set of agent type definitions. Tests are in `packages/agent-isolation/src/isolation.test.ts`.

## Per-Agent-Type Definitions

### Coding Agent

| Aspect | Policy |
|---|---|
| Secrets | `LINEAR_API_KEY`, `GITHUB_TOKEN`, `AGENT_RUNNER_TOKEN` |
| Filesystem | `packages/`, `docs/`, `scripts/`, `.github/workflows/`, config files |
| Network | `github.com`, `api.github.com`, `api.linear.app`, `registry.npmjs.org` |
| Forbidden | `delete_branch`, `merge_to_protected`, `force_push`, `deploy_to_prod`, `send_external_notification`, `delete_linear_issue`, `revoke_credentials`, `edit_approval_rules` |
| Approval required | `delete_branch` (L2), `merge_to_protected` (L3), `force_push` (L2), `send_external_notification` (L3) |
| Side effects | files (write), linear (write), github (write), notifications (none) |

**Key rules:**
- Cannot delete branches (branch deletion is human-only per branch-protection-policy.md).
- Cannot merge to protected branches (opens PRs; merge is human or Perplexity action per LAT-47).
- Cannot deploy to production (SRE-only responsibility).
- Can run arbitrary shell within the worktree (lint, build, test) without approval.

### SRE Agent

| Aspect | Policy |
|---|---|
| Secrets | `LINEAR_API_KEY`, `GITHUB_TOKEN`, `AGENT_RUNNER_TOKEN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `DOCKER_REGISTRY_TOKEN` |
| Filesystem | `packages/`, `docs/`, `logs/`, `config/`, `.github/workflows/` |
| Network | `api.linear.app`, `github.com`, `api.github.com`, `monitoring.*`, `*.amazonaws.com`, `registry.docker.io` |
| Forbidden | `delete_branch`, `merge_to_protected`, `force_push`, `deploy_to_prod`, `send_external_notification`, `delete_linear_issue`, `run_arbitrary_shell`, `send_email`, `revoke_credentials`, `edit_approval_rules` |
| Approval required | `deploy_to_prod` (L3), `deploy_to_staging` (L2), `run_arbitrary_shell` (L2), `send_external_notification` (L3) |
| Side effects | files (write), linear (write), github (none), notifications (write) |

**Key rules:**
- Can deploy to production but requires human approval during pilot (ADR-0013).
- Cannot run arbitrary shell commands without L2 approval (risk of unintended side effects).
- Has access to cloud credentials and Docker registry.
- Can send notifications (Slack pages, email alerts).

### QA Agent

| Aspect | Policy |
|---|---|
| Secrets | `LINEAR_API_KEY`, `GITHUB_TOKEN`, `AGENT_RUNNER_TOKEN` |
| Filesystem | `packages/`, `docs/`, `tests/` |
| Network | `api.linear.app`, `github.com`, `api.github.com`, `registry.npmjs.org` |
| Forbidden | `delete_branch`, `merge_to_protected`, `deploy_to_prod`, `deploy_to_staging`, `send_external_notification`, `delete_linear_issue`, `revoke_credentials`, `edit_approval_rules` |
| Approval required | `deploy_to_staging` (L2), `send_external_notification` (L3) |
| Side effects | files (write reports), linear (write), github (none), notifications (none) |

### Review Agent

| Aspect | Policy |
|---|---|
| Secrets | `LINEAR_API_KEY`, `GITHUB_TOKEN`, `AGENT_RUNNER_TOKEN` |
| Filesystem | `packages/`, `docs/` |
| Network | `api.linear.app`, `github.com`, `api.github.com` |
| Forbidden | `delete_branch`, `merge_to_protected`, `deploy_to_prod`, `send_external_notification`, `delete_linear_issue`, `revoke_credentials`, `edit_approval_rules` |
| Approval required | `send_external_notification` (L3) |
| Side effects | files (none), linear (write reports), github (write comments), notifications (none) |

### PM Agent

| Aspect | Policy |
|---|---|
| Secrets | `LINEAR_API_KEY`, `AGENT_RUNNER_TOKEN` |
| Filesystem | `docs/`, `docs/decisions/`, `docs/prds/`, `docs/process/`, `docs/templates/` |
| Network | `api.linear.app` |
| Forbidden | `delete_branch`, `merge_to_protected`, `deploy_to_prod`, `send_external_notification`, `delete_linear_issue`, `revoke_credentials`, `edit_approval_rules` |
| Approval required | `send_external_notification` (L3) |
| Side effects | files (write docs), linear (write), github (none), notifications (none) |

### Research Agent

| Aspect | Policy |
|---|---|
| Secrets | `LINEAR_API_KEY`, `AGENT_RUNNER_TOKEN` |
| Filesystem | `docs/`, `docs/decisions/`, `docs/prds/` |
| Network | `api.linear.app` |
| Forbidden | `delete_branch`, `merge_to_protected`, `deploy_to_prod`, `send_external_notification`, `delete_linear_issue`, `revoke_credentials`, `edit_approval_rules` |
| Approval required | *(none)* |
| Side effects | files (write), linear (write), github (none), notifications (none) |

### Observability Agent

| Aspect | Policy |
|---|---|
| Secrets | `LINEAR_API_KEY`, `AGENT_RUNNER_TOKEN` |
| Filesystem | `logs/`, `config/` |
| Network | `api.linear.app`, `monitoring.*` |
| Forbidden | `delete_branch`, `merge_to_protected`, `deploy_to_prod`, `send_external_notification`, `delete_linear_issue`, `revoke_credentials`, `edit_approval_rules` |
| Approval required | *(none)* |
| Side effects | files (read), linear (write), github (none), notifications (none) |

## Acceptance Criteria

### AC-1: Coding agent cannot delete or merge to protected branches

```typescript
const forbidden = getForbiddenActions('coding');
assert.ok(forbidden.some(a => a.action === 'delete_branch'));
assert.ok(forbidden.some(a => a.action === 'merge_to_protected'));
```

Verified by tests: "coding agent forbids delete_branch" and "coding agent forbids merge_to_protected".

### AC-2: SRE agent cannot run arbitrary shell without approval

```typescript
const forbidden = getForbiddenActions('sre');
assert.ok(forbidden.some(a => a.action === 'run_arbitrary_shell'));
const approvals = getApprovalRequirements('sre');
assert.ok(approvals.some(a => a.action === 'run_arbitrary_shell' && a.level === 'L2-with-approval'));
```

Verified by tests: "SRE agent forbids run_arbitrary_shell without approval" and "SRE arbitrary shell requires L2 approval".

### AC-3: All agents log side effects with evidence

```typescript
const log = createSideEffectLog({
  agentType: 'coding',
  action: 'create_pull_request',
  outcome: 'succeeded',
  details: { url: 'https://github.com/example/pull/1' },
});
assert.ok(log.evidence.includes('agent_type=coding'));
assert.ok(log.evidence.includes('action=create_pull_request'));
assert.ok(log.evidence.includes('outcome=succeeded'));
```

Verified by tests: "createSideEffectLog produces a valid log entry" and "createSideEffectLog includes agent type in evidence".

### AC-4: Forbidden actions include merge, delete, deploy to prod, send external notifications

All seven agent types have these four actions in their forbidden list:

| Action | Coding | SRE | QA | Review | PM | Research | Observability |
|---|---|---|---|---|---|---|---|
| `merge_to_protected` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `delete_branch` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `deploy_to_prod` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `send_external_notification` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### AC-5: Approval requirements for risky actions

All Stop-category actions (merge, deploy to prod, external notifications, credential revocation, approval rule edits) require human approval at L2 or L3 level depending on agent type.

### AC-6: Side-effect scope per agent type

Each agent type declares which surfaces it produces side effects on (files, linear, github, notifications), enabling the skill runner to verify that observed side effects match expectations.

## Non-Goals

- **Runtime isolation implementation.** Containers, sandboxes, and process-level isolation are out of scope. This ADR defines the *expectations*; runtime enforcement is a follow-up ticket.
- **Network ACL implementation.** Domain patterns are declarative strings, not actual firewall rules. Network ACLs are a follow-up ticket.
- **Secret management backend.** The `secrets` array lists credential names; the actual secret retrieval is handled by the credential loader (ADR-0017).

## Consequences

**Good:**

- Given an agent type, the skill runner has a single source of truth for its isolation boundaries — no cross-referencing of multiple documents.
- New agent types can be added by creating a new config object; no edit to this ADR is required (only a row in the registry).
- The policy-scanner can validate isolation configs as part of CI.
- Operators can audit agent permissions programmatically via `getForbiddenActions()` and `getApprovalRequirements()`.
- Side-effect logging provides auditability for every non-trivial agent action.

**Bad / open:**

- The isolation configs are static policy. When a runtime enforcement layer (containers, sandboxes) lands, the configs must be translated into runtime constraints (e.g., Docker environment variables, mount points, network policies).
- The `secrets` arrays are declarative name lists, not actual credential paths. When the secret management backend changes, these names may need to be remapped.
- The network scope uses domain-pattern strings (e.g., `monitoring.`) which are prefixes, not exact domains. This may lead to overly permissive access for patterns like `monitoring.` (matches `monitoring.example.com`, `monitoring.prod.internal`, etc.).
- The forbidden-action enum is shared across all agent types. If a future agent type needs an action not in the enum, the enum must be extended — this is not a per-type enum.

## Revisit Triggers

This ADR should be revisited when:

1. A new agent type is added that requires a distinct isolation profile not covered by the existing seven types.
2. The secret management backend changes and credential scope rules need updating.
3. Runtime isolation (containers, sandboxes) lands and the scope definitions must be implemented as actual boundary constraints.
4. A new Stop-category action emerges that is not covered by the existing forbidden-action enum.
5. The network ACL implementation requires moving from domain-pattern strings to actual allow/deny rules.

## Links

- **Linear:** `LAT-164` (this ticket). Predecessors: `LAT-21` (ADR-0013), "Identify and document agent types" feature.
- **Related ADRs:** `0013-agent-invocation-and-integration-boundaries.md` (invocation boundary), `0008-agent-control-layer-and-perplexity-boundary.md` (action categories), `0009-cost-controls-and-runaway-cost-interrupts.md` (cost bands), `0017-icp-credentials-and-secrets-management.md` (credential loader), `0021-dispatcher-synthesis-boundary-and-deterministic-hard-stops.md` (dispatcher hard stops).
- **Process:** `branch-protection-policy.md` (branch protection rules), `approval-gates-and-autonomy-rules.md` (rule matrix).
- **Code:** `packages/agent-isolation/src/isolation.ts` (implementation), `packages/agent-isolation/src/isolation.test.ts` (tests).
