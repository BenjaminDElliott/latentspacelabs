---
name: local-agent-commands
description: Reusable command snippets and conventions for the local-agent implementation run. Covers repo hygiene, TypeScript/npm conventions, secret handling, Linear/GitHub evidence, and PR creation. Load alongside `implement-ticket` for full context.
---

# local-agent-commands

Reusable command snippets and conventions for the local-agent implementation run. These are the practical building blocks that the `implement-ticket` skill orchestrates.

## Repo hygiene commands

### Start fresh

```bash
# Ensure clean state before starting
git status
git checkout main
git pull origin main
# Create ticket branch from main
git checkout -b lat-<NN>-<slug>
```

### After editing

```bash
# Stage only changed files in scope
git add <file1> <file2>

# Commit with a concise imperative message
git commit -m "LAT-NN: <imperative description of change>"

# Push to ticket branch
git push -u origin lat-<NN>-<slug>
```

### Before opening PR

```bash
# Verify no unexpected files
git status --short

# Verify diff only touches allowlisted files
git diff --name-only

# Re-run checks one more time
npm run check
```

### PR creation

```bash
# Open PR against main
gh pr create \
  --base main \
  --title "LAT-NN: <short imperative title>" \
  --body "$(cat <<'EOF'
## LAT-NN: <short title>

### Changes
- `<file1>`: <one-line description>
- `<file2>`: <one-line description>

### Checks
- [x] `npm run check` passes
- [x] `<ticket-specific test>` passes

### Linear
Closes LAT-NN.

### Files changed
$(git diff --name-only --cached 2>/dev/null || git diff --name-only)
EOF
)"
```

## TypeScript / npm conventions

### New file template

```typescript
// path: packages/<name>/src/<path>
// purpose: <what this file does>

import { SomeType } from "@latentspacelabs/<package>";

export function <functionName>(<params>): ReturnType {
  // implementation
  return result;
}

export default <export>;
```

### Naming conventions

- Files: kebab-case (`my-handler.ts`)
- Functions: camelCase (`createUser`)
- Types/Interfaces: PascalCase (`UserConfig`)
- Tests: same name as source file, with `.test.ts` suffix

### Import patterns

```typescript
// Prefer named exports over default exports
import { foo } from "./foo";

// For package imports, use the workspace alias
import { bar } from "@latentspacelabs/my-package";

// Avoid wildcard imports
import * as utils from "./utils"; // prefer: import { utilityFn } from "./utils";
```

### Error handling

```typescript
// Always use typed errors
throw new Error("Descriptive message");

// Or define custom error classes for domain-specific errors
class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} not found`);
    this.name = "NotFoundError";
  }
}
```

## Secret handling

### Never embed these values:

- Qwen endpoint URL
- Auth tokens (any provider)
- MCP `Authorization` headers
- Internal hostnames
- Database connection strings with passwords

### Redact before writing

When a secret-shaped value appears in your context, redact it:

```
Before: process.env.QWEN_ENDPOINT="http://internal:8080/v1/chat"
After:  process.env.QWEN_ENDPOINT="http://<host>:8080/v1/chat"

Before: Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
After:  Authorization: Bearer <token>
```

### Use environment variables

```typescript
// Prefer env over inline strings
const apiKey = process.env.API_KEY ?? "default-key";
const endpoint = process.env.QWEN_ENDPOINT ?? "http://localhost:8080";

// Never log secrets to stdout
console.log("Endpoint:", endpoint); // OK — endpoint is not secret
console.log("Key:", apiKey); // Better: console.log("Key:", apiKey.slice(0, 8) + "...");
```

### Secret guard commands

```bash
# Check all tracked files
npm run secret-guard:tracked

# Check staged changes
npm run secret-guard:staged

# Install pre-commit hook
npm run secret-guard:install-hook
```

## Linear / GitHub evidence

### Evidence checklist

Every implementation run must produce:

1. **PR link** — URL to the created PR against `main`
2. **Files changed** — list of paths modified
3. **Acceptance criteria mapping** — table mapping each criterion to a change
4. **Check results** — pass/fail for each expected check
5. **Run artifact** — opencode transcript, redacted of secrets

### Linear write-back format

Paste this into the Linear issue as a comment:

```markdown
**Outcome:** <one sentence on what happened>
**Evidence:** <PR URL> · <run report URL>
**Risks:** <risk flags>
**PR:** <PR URL>
**Next action:** <single recommended next step>
**Open questions:** <blocking questions, or "none">
```

### GitHub PR body template

```markdown
## Summary
<One sentence on what this PR does>

## Changes
| File | Change |
|------|--------|
| `src/foo.ts` | Added `bar()` function |
| `src/bar.ts` | Registered new route |

## Acceptance Criteria
- [x] AC-1: <criterion> — satisfied by <change>
- [x] AC-2: <criterion> — satisfied by <change>

## Checks
- [x] `npm run check` passes
- [x] <ticket-specific test> passes

## Linear
Closes LAT-NN.

## Files changed
$(git diff --name-only)
```

## Implementation vs other run types

This skill is for **implementation** runs only. Do not use it for:

| Run type | Use this skill? | Use instead |
|----------|-----------------|-------------|
| Implementation (coding) | **Yes** | `implement-ticket` |
| Architecture (ADR) | No | `small-model-decomposition` + planner |
| PRD writing | No | PRD template |
| Research spike | No | `small-model-decomposition` |
| QA verification | Partial | `qa-evidence` |
| PR review-fix | Partial | `pr-review-fix` |

## Example: Small implementation ticket

**Ticket:** Add `GET /healthz` endpoint.

```bash
# 1. Inspect relevant files
cat packages/api-server/src/routes/index.ts
cat packages/api-server/src/app.ts

# 2. Create the handler
cat > packages/api-server/src/routes/healthz.ts << 'EOF'
import { Request, Response } from "express";

export function healthzHandler(_req: Request, res: Response): void {
  const sha = require("child_process").execSync("git rev-parse --short HEAD").toString().trim();
  res.status(200).json({ status: "ok", sha });
}
EOF

# 3. Register the route
cat packages/api-server/src/routes/index.ts
# Add: import { healthzHandler } from "./healthz";
# Add: routes.push({ path: "/healthz", handler: healthzHandler });

# 4. Create test
cat > packages/api-server/test/healthz.test.ts << 'EOF'
import { healthzHandler } from "../src/routes/healthz";

describe("healthz", () => {
  it("returns 200 with status and sha", () => {
    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    healthzHandler({} as any, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ok", sha: expect.any(String) })
    );
  });
});
EOF

# 5. Run checks
npm run check

# 6. Commit and PR
git add packages/api-server/src/routes/healthz.ts packages/api-server/src/routes/index.ts packages/api-server/test/healthz.test.ts
git commit -m "LAT-200: add /healthz endpoint"
git push -u origin lat-200-healthz-endpoint
gh pr create --base main --title "LAT-200: add /healthz endpoint" --body "..."
```

## Example: LAT-127-style docs dedupe

**Ticket:** Remove duplicate ADR summaries from `docs/README.md`.

```bash
# 1. Inspect
cat docs/README.md
ls docs/decisions/

# 2. Plan: Replace inline ADR summaries with links
# Change docs/README.md: Replace summary paragraphs with [ADR-NNN](../decisions/NNNN-title.md) links

# 3. Edit (example)
# Replace:
#   "ADR-0001: Introduces TypeScript/Node/npm..." (3 paragraphs)
# With:
#   "- [ADR-0001](../decisions/0001-typescript-node-npm.md): TypeScript/Node/npm"

# 4. Check for broken links
npm run check

# 5. Commit
git add docs/README.md
git commit -m "LAT-127: deduplicate ADR summaries in docs README"
```
