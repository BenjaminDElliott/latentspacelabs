# @latentspacelabs/agent-isolation

Agent isolation expectations for the Latent Space Labs ICP.

## Overview

This package defines the isolation boundaries for each agent type in the ICP:

- **Secret scope** — which credentials each agent can access
- **Filesystem scope** — which directories each agent can read/write
- **Network scope** — which endpoints each agent can reach
- **Forbidden actions** — actions an agent type cannot perform
- **Approval requirements** — risky actions that need human approval
- **Side-effect logging** — structured evidence for every non-trivial action

## Agent Types

| Type | Description | Default Autonomy |
|---|---|---|
| `coding` | Reads/writes code, opens PRs, comments on Linear | L3-with-approval |
| `sre` | Monitors, deploys, runs runbooks, manages infrastructure | L3-with-approval |
| `qa` | Runs tests, produces reports, validates acceptance criteria | L3-with-approval |
| `review` | Reviews PRs, comments, suggests changes | L3-with-approval |
| `pm` | Analysis, drafting, documentation | L2-with-approval |
| `research` | Literature review, benchmarking, analysis | L2 |
| `observability` | Dashboards, metrics, logs | L2 |

## Key Policies

### Coding Agent
- Cannot delete branches
- Cannot merge to protected branches (opens PRs instead)
- Cannot deploy to production
- Cannot send external notifications without approval
- Can run shell commands within the worktree (lint, build, test)

### SRE Agent
- Can deploy to production (with approval during pilot)
- Cannot run arbitrary shell commands without approval
- Has access to cloud credentials (AWS, Docker registry)
- Can send notifications (Slack, email)

### All Agent Types
- External communications (Slack, email) are Stop by default
- Credential revocation is Stop
- Approval rule edits are Stop
- All side effects are logged with evidence

## API

```typescript
import { getAgentType, getForbiddenActions, getApprovalRequirements, createSideEffectLog } from '@latentspacelabs/agent-isolation';

// Get full config for an agent type
const cfg = getAgentType('coding');

// Get forbidden actions
const forbidden = getForbiddenActions('coding');

// Get approval requirements
const approvals = getApprovalRequirements('sre');

// Log a side effect
const log = createSideEffectLog({
  agentType: 'coding',
  action: 'create_pull_request',
  outcome: 'succeeded',
  details: { url: 'https://github.com/example/pull/1' },
});
```

## References

- **ADR-0013** — Agent invocation and integration boundaries (LAT-21)
- **ADR-0008** — Agent control layer and Perplexity boundary
- **ADR-0009** — Cost controls and runaway-cost interrupts
- **branch-protection-policy.md** — Branch protection rules (LAT-48)
- **approval-gates-and-autonomy-rules.md** — Day-to-day rule matrix
