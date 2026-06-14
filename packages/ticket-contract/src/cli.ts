#!/usr/bin/env node
/**
 * CLI for the ticket-contract validator.
 *
 * Usage:
 *   node cli.js <ticket-body-file>   — validate a ticket body file
 *   node cli.js -                     — read ticket body from stdin
 *   node cli.js --example             — run the built-in example tickets
 *
 * Exit codes:
 *   0  valid
 *   1  invalid (refusals found)
 *   2  error (bad arguments or I/O)
 */

import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAgentReadyContract, formatResult } from './validate.js';

function readTicketBody(input: string): Promise<string> {
  if (input === '-') {
    return new Promise((resolve) => {
      let data = '';
      process.stdin.on('data', (chunk: string) => {
        data += chunk;
      });
      process.stdin.on('end', () => resolve(data || ''));
    });
  }
  const abs = resolve(input);
  if (!existsSync(abs)) {
    process.stderr.write(`Error: file not found: ${abs}\n`);
    process.exit(2);
  }
  return Promise.resolve(readFileSync(abs, 'utf8'));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`
ticket-contract — ADR-0023 / LAT-142 agent-ready ticket validator

Usage:
  node cli.js <ticket-body-file>   — validate a ticket body file
  node cli.js -                    — read ticket body from stdin
  node cli.js --example            — run built-in example tickets

Exit codes:
  0  valid
  1  invalid (refusals found)
  2  error (bad arguments or I/O)
`);
    return 0;
  }

  if (args.includes('--example')) {
    return runExamples();
  }

  const inputFile = args[0];
  const body = await readTicketBody(inputFile);

  if (body.trim().length === 0) {
    process.stderr.write('Error: empty ticket body\n');
    return 2;
  }

  const result = validateAgentReadyContract(body);
  process.stdout.write(formatResult(result) + '\n');
  return result.valid ? 0 : 1;
}

/**
 * Built-in examples for `--example` mode.
 * Demonstrates: safe implementation, ADR/PRD escalation, vague spike refusal,
 * secret/deploy hard stop.
 */
async function runExamples(): Promise<number> {
  const results = await Promise.all([
    validateExampleTicket('safe_implementation', makeExampleSafeImplementation()),
    validateExampleTicket('adr_prd_escalation', makeExampleAdrdPrd()),
    validateExampleTicket('vague_spike_refusal', makeExampleVagueSpike()),
    validateExampleTicket('secret_hard_stop', makeExampleSecretRotation()),
    validateExampleTicket('deploy_hard_stop', makeExampleDeploy()),
  ]);

  let exitCode = 0;
  for (const r of results) {
    process.stdout.write(`\n=== ${r.name} ===\n`);
    process.stdout.write(r.formatted + '\n');
    if (!r.valid) exitCode = 1;
  }

  return exitCode;
}

interface ExampleResult {
  name: string;
  valid: boolean;
  formatted: string;
}

async function validateExampleTicket(name: string, body: string): Promise<ExampleResult> {
  const result = validateAgentReadyContract(body);
  return {
    name,
    valid: result.valid,
    formatted: formatResult(result),
  };
}

function makeExampleSafeImplementation(): string {
  return [
    '# Ticket: Add /healthz endpoint',
    '',
    '- **Linear ID:** LAT-200',
    '- **Agent type:** coding',
    '- **Lane:** implementation',
    '- **Risk level:** low',
    '- **Budget cap:** 100k tokens',
    '- **Approval required:** yes',
    '',
    '## Goal',
    '',
    'Add a GET /healthz endpoint to packages/api-server that returns 200 with status and git SHA.',
    '',
    '## Context',
    '',
    'See ADR-0019, LAT-104. The API server is under packages/api-server/.',
    '',
    '## Inputs',
    '',
    '- Files: packages/api-server/src/routes/index.ts',
    '',
    '## Constraints',
    '',
    '- Must not modify apps/foo/',
    '- No new runtime dependencies',
    '',
    '## Sequencing',
    '',
    'Hard blockers: none',
    'Recommended predecessors: none',
    'Related context: none',
    '',
    '## Scope',
    '',
    '### In scope',
    '',
    '- packages/api-server/src/routes/healthz.ts (new)',
    '- packages/api-server/src/routes/index.ts',
    '',
    '### Out of scope',
    '',
    '- packages/api-server/src/middleware/**',
    '- packages/api-server/test/** (existing tests)',
    '',
    '## Acceptance Criteria',
    '',
    `- [ ] GET /healthz responds 200 with body {"status":"ok","sha":"<7-char-git-sha>"}`,
    `- [ ] Endpoint is registered in packages/api-server/src/routes/index.ts`,
    `- [ ] Unit test in packages/api-server/test/healthz.test.ts covers the 200 response shape`,
    '',
    '## Tests',
    '',
    '- Unit test in healthz.test.ts covers the 200 response shape.',
    '',
    '## Required Evidence',
    '',
    '- [ ] PR link',
    '- [ ] Files changed',
    '- [ ] Tests added and results',
    '',
    '## Quality Gate Checklist',
    '',
    '- [ ] Scope is bounded',
    '- [ ] Acceptance criteria are testable',
    '',
    '## Rollback / Reversal Plan',
    '',
    'revert PR',
    '',
    '## Definition of Done',
    '',
    '- [ ] All acceptance criteria checked',
    '- [ ] All tests pass',
    '',
    '## Links',
    '',
    '- ADR-0019',
  ].join('\n');
}

function makeExampleAdrdPrd(): string {
  return [
    '# Ticket: Write ADR-0023: Agent-ready ticket contract',
    '',
    '- **Linear ID:** LAT-201',
    '- **Agent type:** pm',
    '- **Lane:** docs/adr/prd',
    '- **Risk level:** medium',
    '- **Budget cap:** 50k tokens',
    '- **Approval required:** yes',
    '',
    '## Goal',
    '',
    'Write an ADR documenting the agent-ready ticket contract and lane policy.',
    '',
    '## Context',
    '',
    'See LAT-142. The dispatcher (LAT-129) and classifier (LAT-131) need a contract to validate tickets.',
    '',
    '## Inputs',
    '',
    '- Files: docs/decisions/ (new ADR file)',
    '- Linear: LAT-142',
    '',
    '## Constraints',
    '',
    '- Follow ADR template at docs/templates/adr.md',
    '- Frontmatter must include id, title, status, date, decision_makers',
    '- Cite LAT-131, LAT-133, LAT-134, LAT-135, LAT-137',
    '',
    '## Sequencing',
    '',
    'Hard blockers: none',
    'Recommended predecessors: none',
    'Related context: ADR-0008, ADR-0020',
    '',
    '## Scope',
    '',
    '### In scope',
    '',
    '- docs/decisions/0023-agent-ready-ticket-contract.md (new)',
    '- docs/process/ticket-lane-policy.md (new)',
    '',
    '### Out of scope',
    '',
    '- packages/ticket-contract/ (executable validator — separate ticket)',
    '- Any code changes',
    '',
    '## Acceptance Criteria',
    '',
    `- [ ] ADR file exists at docs/decisions/0023-agent-ready-ticket-contract.md`,
    `- [ ] ADR frontmatter contains id: ADR-0023, status: proposed`,
    `- [ ] Lane policy exists at docs/process/ticket-lane-policy.md`,
    `- [ ] Both files are validated by npm run validate:adrs`,
    '',
    '## Tests',
    '',
    '- npm run validate:adrs exits 0.',
    '',
    '## Required Evidence',
    '',
    '- [ ] PR link',
    '- [ ] Files changed',
    '',
    '## Quality Gate Checklist',
    '',
    '- [ ] Scope is bounded',
    '- [ ] Acceptance criteria are testable',
    '',
    '## Rollback / Reversal Plan',
    '',
    'revert PR',
    '',
    '## Definition of Done',
    '',
    '- [ ] All acceptance criteria checked',
    '',
    '## Links',
    '',
    '- ADR-0023',
  ].join('\n');
}

function makeExampleVagueSpike(): string {
  return [
    '# Ticket: Investigate streaming options',
    '',
    '- **Linear ID:** LAT-202',
    '- **Agent type:** research',
    '- **Lane:** implementation',
    '- **Risk level:** low',
    '- **Budget cap:** 100k tokens',
    '- **Approval required:** yes',
    '',
    '## Goal',
    '',
    'Figure out which streaming technology to use for the run report substrate.',
    '',
    '## Context',
    '',
    'We need to decide between Redis Streams, NATS, and Postgres LISTEN.',
    '',
    '## Inputs',
    '',
    '- External references: Redis Streams docs, NATS docs, Postgres docs',
    '',
    '## Constraints',
    '',
    '- No new dependencies in the repo',
    '',
    '## Sequencing',
    '',
    'Hard blockers: none',
    'Recommended predecessors: none',
    'Related context: ADR-0020',
    '',
    '## Scope',
    '',
    '### In scope',
    '',
    '- Compare Redis Streams, NATS, Postgres LISTEN',
    '',
    '### Out of scope',
    '',
    '- Implement any of the options',
    '',
    '## Tests',
    '',
    '- Readability of findings.',
    '',
    '## Required Evidence',
    '',
    '- [ ] PR link',
    '',
    '## Quality Gate Checklist',
    '',
    '- [ ] Scope is bounded',
    '',
    '## Rollback / Reversal Plan',
    '',
    'revert PR',
    '',
    '## Definition of Done',
    '',
    '- [ ] Findings written',
    '',
    '## Links',
    '',
    '- ADR-0020',
  ].join('\n');
}

function makeExampleSecretRotation(): string {
  return [
    '# Ticket: Rotate production API credentials',
    '',
    '- **Linear ID:** LAT-203',
    '- **Agent type:** sre',
    '- **Lane:** implementation',
    '- **Risk level:** high',
    '- **Budget cap:** 50k tokens',
    '- **Approval required:** yes',
    '',
    '## Goal',
    '',
    'Rotate the production API credentials for the database.',
    '',
    '## Context',
    '',
    'Current credentials expire in 30 days. Must use the vault CLI.',
    '',
    '## Inputs',
    '',
    '- Files: packages/api-server/src/config.ts',
    '- External: vault CLI docs',
    '',
    '## Constraints',
    '',
    '- Must not touch secrets in docs/decisions/ADR-0017.md',
    '',
    '## Sequencing',
    '',
    'Hard blockers: none',
    '',
    '## Scope',
    '',
    '### In scope',
    '',
    '- packages/api-server/src/config.ts',
    '',
    '### Out of scope',
    '',
    '- packages/api-server/src/middleware/**',
    '',
    '## Acceptance Criteria',
    '',
    `- [ ] New credentials are injected via process.env`,
    `- [ ] Old credentials are not in the diff`,
    '',
    '## Tests',
    '',
    '- Manual: verify the app starts with new credentials.',
    '',
    '## Required Evidence',
    '',
    '- [ ] PR link',
    '- [ ] Files changed',
    '',
    '## Quality Gate Checklist',
    '',
    '- [ ] Risk level is high',
    '',
    '## Rollback / Reversal Plan',
    '',
    'revert PR and restore old credentials from vault.',
    '',
    '## Definition of Done',
    '',
    '- [ ] All acceptance criteria checked',
    '',
    '## Links',
    '',
    '- ADR-0017',
  ].join('\n');
}

function makeExampleDeploy(): string {
  return [
    '# Ticket: Deploy v2.1 to production',
    '',
    '- **Linear ID:** LAT-204',
    '- **Agent type:** sre',
    '- **Lane:** implementation',
    '- **Risk level:** high',
    '- **Budget cap:** 30k tokens',
    '- **Approval required:** yes',
    '',
    '## Goal',
    '',
    'Deploy the latest merged PR to production.',
    '',
    '## Context',
    '',
    'PR #456 has been approved. Deploy via the existing CI pipeline.',
    '',
    '## Inputs',
    '',
    '- PR: #456',
    '',
    '## Constraints',
    '',
    '- Must not rotate secrets',
    '',
    '## Sequencing',
    '',
    'Hard blockers: none',
    '',
    '## Scope',
    '',
    '### In scope',
    '',
    '- Run the deploy pipeline',
    '',
    '### Out of scope',
    '',
    '- Rolling back if deploy fails (separate ticket)',
    '',
    '## Acceptance Criteria',
    '',
    `- [ ] Production returns 200 at /healthz`,
    `- [ ] No errors in the deploy log`,
    '',
    '## Tests',
    '',
    '- Manual: check /healthz endpoint.',
    '',
    '## Required Evidence',
    '',
    '- [ ] Deploy log link',
    '- [ ] /healthz response screenshot',
    '',
    '## Quality Gate Checklist',
    '',
    '- [ ] Risk level is high',
    '',
    '## Rollback / Reversal Plan',
    '',
    'Revert the PR and re-deploy.',
    '',
    '## Definition of Done',
    '',
    '- [ ] All acceptance criteria checked',
    '',
    '## Links',
    '',
    '- PR #456',
  ].join('\n');
}

main().then((code) => {
  process.exit(code);
});
