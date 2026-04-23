# @latentspacelabs/icp

Integration Control Plane (ICP) — skills framework plus a thin CLI harness.

Scaffold only. No runtime behaviour ships in this package yet; see the ADRs for
the shape the implementation tickets will fill in.

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
