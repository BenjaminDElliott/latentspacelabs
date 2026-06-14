import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseTicketPack } from './parser.js';

const MIN_PACK = `# opencode Ticket Pack: tiny

## Header

- **Linear ID:** LAT-42
- **Pack version:** 1
- **Planner run / source:** unit test
- **Cost band:** low
- **Risk level:** low
- **Readiness status:** ready

## Goal

Touch one file.

## Acceptance criteria

- [ ] file is touched.

## Constraints

- **Files in scope (allowlist):**
  - packages/foo/src/index.ts
- **Files / paths forbidden:** .github/workflows/**, docs/decisions/**
- **Dependency policy:** no new deps.

## Expected checks

- [ ] \`npm run check\` passes.

## Branch / PR rules

- **Branch:** \`lat-42-touch-file\`
- **PR title prefix:** \`LAT-42:\`
- **PR base:** \`main\`
`;

describe('parseTicketPack', () => {
  it('parses header, goal, acceptance criteria, files, branch rules', () => {
    const { pack, errors } = parseTicketPack(MIN_PACK, '/tmp/min.md');
    assert.deepEqual(errors, []);
    assert.ok(pack);
    assert.equal(pack!.header.linearId, 'LAT-42');
    assert.equal(pack!.header.costBand, 'low');
    assert.equal(pack!.header.riskLevel, 'low');
    assert.equal(pack!.header.readinessStatus, 'ready');
    assert.equal(pack!.goal, 'Touch one file.');
    assert.deepEqual(pack!.acceptanceCriteria, ['file is touched.']);
    assert.deepEqual(pack!.filesInScope, ['packages/foo/src/index.ts']);
    assert.equal(pack!.filesForbidden.length >= 1, true);
    assert.equal(pack!.branchRules.branch, 'lat-42-touch-file');
    assert.equal(pack!.branchRules.prTitlePrefix, 'LAT-42:');
    assert.equal(pack!.branchRules.prBase, 'main');
    assert.equal(
      pack!.expectedChecks.some((c) => c.includes('npm run check')),
      true,
    );
  });

  it('reports missing header fields', () => {
    const broken = `# pack\n\n## Header\n\n- **Pack version:** 1\n\n## Goal\n\nfoo\n`;
    const { pack, errors } = parseTicketPack(broken, '/tmp/broken.md');
    assert.equal(pack, null);
    assert.ok(errors.some((e) => e.toLowerCase().includes('linear id')));
    assert.ok(errors.some((e) => e.toLowerCase().includes('readiness')));
  });

  it('accepts inline allowlist (comma-separated)', () => {
    const inline = MIN_PACK.replace(
      '- **Files in scope (allowlist):**\n  - packages/foo/src/index.ts',
      '- **Files in scope (allowlist):** packages/a/src/x.ts, packages/a/src/y.ts',
    );
    const { pack } = parseTicketPack(inline, '/tmp/inline.md');
    assert.ok(pack);
    assert.deepEqual(pack!.filesInScope, ['packages/a/src/x.ts', 'packages/a/src/y.ts']);
  });
});
