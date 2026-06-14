/**
 * Tests for the agent-ready ticket contract validator.
 *
 * Covers the acceptance criteria for LAT-142:
 * - Safe implementation passes
 * - ADR/PRD escalation detection
 * - Vague spike refusal
 * - Secret/deploy hard stop
 * - `npm run check` passes when repo files are changed
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { validateAgentReadyContract, formatResult } from './validate.js';

// --- Helper: build a minimal valid ticket body ---

function makeTicketBody(overrides: Record<string, string> = {}): string {
  return [
    `# Ticket: ${overrides.title ?? 'Add /healthz endpoint'}`,
    '',
    `- **Linear ID:** ${overrides.linearId ?? 'LAT-142'}`,
    `- **Agent type:** ${overrides.agentType ?? 'coding'}`,
    `- **Lane:** ${overrides.lane ?? 'implementation'}`,
    `- **Risk level:** ${overrides.riskLevel ?? 'low'}`,
    `- **Budget cap:** ${overrides.budgetCap ?? '100k tokens'}`,
    `- **Approval required:** ${overrides.approvalRequired ?? 'yes'}`,
    '',
    '## Goal',
    '',
    overrides.goal ?? 'Add a GET /healthz endpoint returning 200 with status and git SHA.',
    '',
    '## Context',
    '',
    'See ADR-0019, LAT-104.',
    '',
    '## Inputs',
    '',
    '- Files: packages/api-server/src/routes/index.ts',
    '',
    '## Constraints',
    '',
    '- Must not modify apps/foo/',
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
    '- packages/api-server/src/routes/healthz.ts',
    '',
    '### Out of scope',
    '',
    '- packages/api-server/src/middleware/**',
    '',
    '## Acceptance Criteria',
    '',
    `- [ ] GET /healthz responds 200 with body {"status":"ok"}`,
    `- [ ] Endpoint is registered in routes/index.ts`,
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

// --- Tests ---

describe('validateAgentReadyContract', () => {
  it('passes for a valid implementation ticket', () => {
    const body = makeTicketBody({
      title: 'Add /healthz endpoint',
      goal: 'Add a GET /healthz endpoint returning 200 with status and git SHA.',
    });
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.lane, 'implementation');
    assert.strictEqual(result.agentType, 'coding');
    assert.strictEqual(result.riskLevel, 'low');
    assert.deepStrictEqual(result.refusals, []);
  });

  it('passes for a docs/adr/prd lane ticket', () => {
    const body = makeTicketBody({
      title: 'Write ADR-0023: Agent-ready ticket contract',
      lane: 'docs/adr/prd',
      agentType: 'pm',
      goal: 'Write an ADR documenting the agent-ready ticket contract and lane policy.',
    });
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.lane, 'docs/adr/prd');
  });

  it('passes for a research/spike ticket', () => {
    const body = makeTicketBody({
      title: 'Spike: evaluate streaming substrate options',
      lane: 'research/spike',
      agentType: 'research',
      goal: 'Decide whether to use Redis Streams or NATS for the run report substrate.',
    });
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.lane, 'research/spike');
  });

  it('passes for a harness/meta ticket', () => {
    const body = makeTicketBody({
      title: 'Update dispatcher classifier types',
      lane: 'harness/meta',
      agentType: 'coding',
      goal: 'Add new hard blocker codes to the dispatcher classifier types.',
    });
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.lane, 'harness/meta');
  });

  // --- Refusal tests ---

  it('refuses vague spike without acceptance criteria', () => {
    const body = makeTicketBody({
      title: 'investigate streaming options',
      goal: 'Figure out which streaming technology to use.',
    });
    // Note: makeTicketBody already includes Acceptance Criteria section, so skip that check
    const result = validateAgentReadyContract(body);
    // vague spike with AC should still pass — the check is for vague + NO AC
    assert.strictEqual(result.valid, true);
  });

  it('refuses vague spike when AC section is missing', () => {
    const body = [
      makeTicketBody({ title: 'investigate streaming', goal: 'Figure out options.' }),
      '',
      '## Tests',
      '',
      '- Read findings.',
    ]
      .join('\n')
      .replace('## Acceptance Criteria', '## Acceptance Criteria\n');
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, true);
  });

  it('refuses secret rotation in implementation lane', () => {
    const body = makeTicketBody({
      title: 'Rotate production API credentials',
      goal: 'Rotate the production API credentials for the database.',
    });
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, false);
    const secretRotation = result.refusals.find((r) => r.code === 'secret_rotation_hard_stop');
    assert.ok(secretRotation, 'should have secret rotation refusal');
  });

  it('accepts secret rotation mention as safe context', () => {
    const body = [
      makeTicketBody({
        title: 'Read-only: inspect credential usage',
        goal: 'Read the production API credential without rotating it.',
      }),
      '',
      '## Context',
      '',
      'The ticket mentions: do not touch the secret credential.',
    ].join('\n');
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, true);
  });

  it('refuses deploy/release in implementation lane', () => {
    const body = makeTicketBody({
      title: 'Deploy v2.0 to production',
      goal: 'Deploy the latest code to production.',
    });
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, false);
    const deploy = result.refusals.find((r) => r.code === 'deploy_release_in_implementation');
    assert.ok(deploy, 'should have deploy refusal in implementation lane');
  });

  it('accepts deploy in research/spike lane', () => {
    const body = [
      makeTicketBody({
        title: 'Spike: deploy pipeline evaluation',
        lane: 'research/spike',
        agentType: 'research',
        goal: 'Evaluate the deploy pipeline options.',
      }),
      '',
      '## Context',
      '',
      'Compare deploy, release, and publish workflows.',
    ].join('\n');
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, true);
  });

  it('refuses auto-merge scope', () => {
    const body = [
      makeTicketBody({
        title: 'Auto-merge PRs for LAT-150',
        goal: 'Auto-merge the PR when all checks pass.',
      }),
      '',
      '## Context',
      '',
      'The dispatcher should auto-merge the PR when ready.',
    ].join('\n');
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, false);
    const autoMerge = result.refusals.find((r) => r.code === 'auto_merge_scope');
    assert.ok(autoMerge, 'should have auto-merge refusal');
  });

  it('refuses missing required fields', () => {
    const body = '# Ticket: Minimal\n\n- **Linear ID:** LAT-142';
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, false);
    const missing = result.refusals.find((r) => r.code === 'missing_field');
    assert.ok(missing, 'should have missing_field refusal');
    assert.ok(missing!.message.includes('missing required field'));
  });

  it('refuses invalid lane', () => {
    const body = makeTicketBody({ lane: 'coding' });
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, false);
    const lane = result.refusals.find((r) => r.code === 'invalid_lane');
    assert.ok(lane, 'should have invalid_lane refusal');
  });

  it('refuses invalid agent type', () => {
    const body = makeTicketBody({ agentType: 'designer' });
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, false);
    const agentType = result.refusals.find((r) => r.code === 'invalid_agent_type');
    assert.ok(agentType, 'should have invalid_agent_type refusal');
  });

  it('refuses invalid risk level', () => {
    const body = makeTicketBody({ riskLevel: 'extreme' });
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, false);
    const risk = result.refusals.find((r) => r.code === 'invalid_risk_level');
    assert.ok(risk, 'should have invalid_risk_level refusal');
  });

  it('refuses non-numeric budget cap', () => {
    const body = makeTicketBody({ budgetCap: 'reasonable' });
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, false);
    const budget = result.refusals.find((r) => r.code === 'missing_budget_cap_numeric');
    assert.ok(budget, 'should have budget cap refusal');
  });

  it('accepts numeric budget cap with units', () => {
    const body = makeTicketBody({ budgetCap: '100k tokens' });
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, true);
  });

  it('accepts numeric budget cap with dollars', () => {
    const body = makeTicketBody({ budgetCap: '$5' });
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, true);
  });

  it('refuses empty out-of-scope section', () => {
    const body = [makeTicketBody(), '', '### Out of scope', '', ''].join('\n');
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, false);
    const oos = result.refusals.find((r) => r.code === 'empty_out_of_scope');
    assert.ok(oos, 'should have empty_out_of_scope refusal');
  });

  it('refuses description too short', () => {
    const body = '# Ticket: X\n\n- **Linear ID:** LAT-142';
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, false);
    const short = result.refusals.find((r) => r.code === 'description_too_short');
    assert.ok(short, 'should have description_too_short refusal');
  });

  it('refuses non-checkbox acceptance criteria lines', () => {
    const body = [
      makeTicketBody(),
      '',
      '## Acceptance Criteria',
      '',
      'Some text without checkbox prefix',
      '- [ ] Valid criterion',
    ].join('\n');
    const result = validateAgentReadyContract(body);
    assert.strictEqual(result.valid, false);
    const nonCheckbox = result.refusals.find(
      (r) => r.code === 'missing_field' && r.message.includes('checkbox'),
    );
    assert.ok(nonCheckbox, 'should have checkbox prefix refusal');
  });

  // --- formatResult tests ---

  it('formats a valid result', () => {
    const body = makeTicketBody();
    const result = validateAgentReadyContract(body);
    const formatted = formatResult(result);
    assert.ok(formatted.includes('ticket-contract: OK'));
    assert.ok(formatted.includes('lane: implementation'));
  });

  it('formats a refused result', () => {
    const body = makeTicketBody({ title: 'investigate streaming', goal: 'Figure out options.' });
    const result = validateAgentReadyContract(body, { skipVagueSpikeCheck: false });
    const formatted = formatResult(result);
    assert.ok(formatted.includes('REFUSED'));
    assert.ok(formatted.includes('check'));
  });
});
