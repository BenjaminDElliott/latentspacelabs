# @latentspacelabs/adr-tools

Repo developer tool: validates Architecture Decision Records under
`docs/decisions/` for numbering collisions, filename/frontmatter consistency,
and required frontmatter keys.

This is a repo tool, not part of the Integration Control Plane runtime. See
`docs/decisions/README.md` for why ADR validation exists and what guardrails it
enforces.

## What is validated

Against every `.md` file in a target directory (default `docs/decisions/`)
other than `README.md` (subdirectories are ignored):

1. Filename matches `NNNN-title-with-dashes.md` (zero-padded 4-digit prefix).
2. Required frontmatter keys are present and non-empty: `id`, `title`,
   `status`, `date`, `decision_makers`.
3. Frontmatter `id` matches `ADR-NNNN` and its `NNNN` equals the filename
   prefix.
4. No two files share the same numeric filename prefix.
5. No two files share the same frontmatter `id`.

All errors are collected and printed in one run; the CLI exits `1` on any
failure, `0` on success.

## Commands

From the repo root:

```sh
# Run all checks the future CI job should run:
npm run check

# Just the ADR validator:
npm run validate:adrs

# Tests for the validator itself:
npm run test --workspace @latentspacelabs/adr-tools

# Validate a different directory:
npm run validate --workspace @latentspacelabs/adr-tools -- path/to/dir
```

## Library surface

```ts
import {
  validateAdrDirectory,
  formatResult,
} from "@latentspacelabs/adr-tools";

const result = await validateAdrDirectory("docs/decisions");
console.log(formatResult(result));
if (result.errors.length > 0) process.exit(1);
```
