# CI Quality Gates (LAT-49)

## Local Commands

| Command | Description |
|---------|-------------|
| `npm run lint` | ESLint across all TypeScript source files |
| `npm run coverage` | Per-workspace test coverage via Node.js --experimental-test-coverage |
| `npm run check` | Full CI check: lint + typecheck + build + validate + coverage |

## CI Check Names

| Check Name | Type | Description |
|-----------|------|-------------|
| `lint` | Advisory | ESLint output across packages/ |
| `coverage` | Advisory | Coverage reports per workspace |
| `typecheck` | Blocking | TypeScript compilation |
| `build` | Blocking | Build step |
| `validate:adrs` | Blocking | ADR frontmatter validation |
| `validate:prds` | Blocking | PRD validation |
| `policy-scan` | Blocking | Architecture policy scanner |
| `secret-guard` | Blocking | Secret leak detection |

## Coverage Threshold Policy (MVP)

**Report-only.** Coverage jobs use `continue-on-error: true` so PRs merge regardless of coverage output. To set a hard threshold, add `--test-coverage-lines=<N>` to a workspace's coverage script.

## ESLint Configuration

- Root `eslint.config.js` with TypeScript ESLint rules
- Run as `npx eslint packages/` to cover all workspace sources
- Known warnings: non-null assertion advisories (non-blocking)
