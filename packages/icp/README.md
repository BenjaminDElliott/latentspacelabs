# @latentspacelabs/icp

Integration Control Plane (ICP) — skills framework plus a thin CLI harness.

Current state (LAT-52): skill contract, registry, runner, and the
`dispatch-ticket@0.1.0` skill are in place. Linear and coding-agent adapters
ship as stubs — production Linear GraphQL and real agent-runner invocation
land in their own tickets (see ADR-0008 open question 4 and ADR-0013). The
CLI harness is also deferred; for now the skill runner is invoked directly
(see `src/skills/dispatch-ticket.test.ts` for the end-to-end shape).

## Design references

- [ADR-0011](../../docs/decisions/0011-integration-control-plane-language-and-runtime.md) — TypeScript on Node.js, this package location, skills-first runtime shape.
- [ADR-0012](../../docs/decisions/0012-integration-control-plane-software-architecture.md) — skill contract, skill registry, skill runner, plus shared components (Linear adapter, policy evaluator, run recorder, agent invocation adapter, write-back formatter) and the thin CLI harness.

## Intended layout

The directory skeleton mirrors the components named in ADR-0012. Implementation
tickets will fill these in; the scaffold only reserves the slots.

```
src/
  skills/      # per-skill directories (entrypoint, schema, colocated tests)
  adapters/    # Linear, GitHub, agent-runner, etc.
  runtime/     # skill contract, registry, runner, shared config/logging/error taxonomy
  index.ts     # public package surface
```

## Local commands

From the repo root:

```sh
npm install
npm run build --workspace @latentspacelabs/icp
npm run typecheck --workspace @latentspacelabs/icp
npm run test --workspace @latentspacelabs/icp
```
