# Agentic Development Flywheel MVP

The **Agentic Development Flywheel** is a single-operator, skill-framework-first Integration Control Plane (ICP) that composes Perplexity (reasoning), Linear (work graph), and GitHub (code/docs/CI) into a deterministic dispatch-and-observability loop — without a team around it.

> **Future-agent orientation.** If you are a coding agent opening this repo for the first time, read these files in order:
> 1. [Root PRD](docs/prds/root-agentic-development-flywheel.md) — what the product is and its scope.
> 2. [ADR Policy](docs/decisions/README.md) — where architectural decisions live and how to read them.
> 3. [PRD Governance](docs/prds/README.md) — naming, frontmatter, status lifecycle, validation rules.
> 4. [Process docs](docs/process/README.md) — how work moves through the system.
> 5. [Approval gates](docs/process/approval-gates-and-autonomy-rules.md) — the rule matrix for every action the agent may take.
> 6. [Cost controls](docs/process/cost-controls.md) — cost bands, runaway-cost interrupt protocol, reporting.
> 7. [Coding-agent preflight](docs/process/coding-agent-preflight.md) — checks to run before your first file edit.
> 8. [Secret guardrails](docs/process/secret-commit-guardrails.md) — which files may hold credentials and which must not be committed.
>
> After reading, check the [ICP runtime harness](.opencode/README.md) for the local opencode skill, agent, and command layout.

## Quick navigation

| Surface | Location | What it is |
|---|---|---|
| Root PRD | [`docs/prds/root-agentic-development-flywheel.md`](docs/prds/root-agentic-development-flywheel.md) | Product scope, goals, non-goals, acceptance criteria |
| ADR directory | [`docs/decisions/`](docs/decisions/) | Architectural Decision Records (MADR format, zero-padded IDs) |
| ADR policy | [`docs/decisions/README.md`](docs/decisions/README.md) | When to write an ADR, status lifecycle, validation |
| PRD directory | [`docs/prds/`](docs/prds/) | Product Requirements Documents (root + feature PRDs) |
| PRD governance | [`docs/prds/README.md`](docs/prds/README.md) | Naming policy, frontmatter schema, validation |
| Process docs | [`docs/process/`](docs/process/) | Operating model, intake, approval gates, cost, preflight, QA, retro |
| Templates | [`docs/templates/`](docs/templates/) | PRD, ADR, agent-ready ticket, run report, QA report, retro report |
| ICP runtime | [`.opencode/`](.opencode/) | Local opencode agents, skills, and slash commands |
| Credentials | [`.env.example`](.env.example), [`.mcp.example.json`](.mcp.example.json) | Sanitised example configs — env-var references only |
| Secret policy | [ADR-0017](docs/decisions/0017-icp-credentials-and-secrets-management.md) | Local env vars, `.gitignore` rules, least-privilege scopes |

## Directory layout

```
.
├── .env.example              # Local credential placeholders
├── .mcp.example.json         # MCP bridge placeholder config
├── .mcp.json                 # Tracked MCP config (no real tokens)
├── .opencode/                # Local opencode agents, skills, commands
├── docs/
│   ├── decisions/            # ADRs — architectural decisions
│   ├── prds/                 # Product Requirements Documents
│   ├── process/              # Process docs — how work flows
│   └── templates/            # Artifact schemas
├── packages/                 # TypeScript/Node workspace packages
└── Unity/                    # VR/Photon networking spike
```

## Getting started

1. Copy `.env.example` → `.env` (git-ignored) and fill in your credentials.
2. Run `npm install` then `npm run check`.
3. Install the secret-guard pre-commit hook: `npm run secret-guard:install-hook`.
4. See `.opencode/README.md` for the local agent harness layout.

## Key decisions (chronological)

The full ADR list is in [`docs/decisions/`](docs/decisions/). Highlights:

- **ADR-0017** — Credentials and secrets management (local env vars, least-privilege, `.mcp.json` with `${VAR}` only).
- **ADR-0011** — ICP language and runtime: TypeScript / Node / npm.
- **ADR-0012** — ICP software architecture: skill framework.
- **ADR-0013** — Agent invocation and integration boundaries.
- **ADR-0014** — ICP state persistence and telemetry: repo-committed run reports for MVP.
- **ADR-0009** — Cost controls and runaway-cost interrupts.

## Non-goals

- Full secrets manager (Vault, Doppler, etc.).
- Production deployment pipelines.
- Multi-operator or multi-tenant support.
- Custom telemetry backend (deferred to a future ADR).

## Related

- Linear team: **LAT**
- Perplexity: reasoning and intake surface.
- GitHub: code, PRs, docs, CI.
- ADR-0001 — Control plane substrates (Perplexity / Linear / GitHub).
