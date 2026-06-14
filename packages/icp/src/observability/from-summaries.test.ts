import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fromControlLoopSummary,
  fromOpencodeDryRunSummary,
  type ControlLoopSummaryLike,
  type OpencodeDryRunSummaryLike,
} from './from-summaries.js';
import { buildRunArtefact } from './run-artifact.js';

function controlLoopSummary(
  overrides: Partial<ControlLoopSummaryLike['evidence']> = {},
): ControlLoopSummaryLike {
  return {
    schemaVersion: '1.0.0',
    evidence: {
      ticket: 'LAT-127',
      packPath: '/tmp/pack.md',
      state: 'ready_for_review',
      mode: 'mock',
      costBand: 'low',
      riskLevel: 'low',
      provider: { adapter: 'mock', runtimeId: 'deterministic-1', costClass: 'low' },
      branch: {
        branch: 'lat-127-foo',
        prTitlePrefix: 'LAT-127:',
        prBase: 'main',
        prUrl: 'https://github.com/owner/repo/pull/42',
      },
      checks: [
        {
          name: 'build',
          command: 'npm run build',
          outcome: 'passed',
          durationMs: 120,
          kind: 'shell',
        },
      ],
      refusals: [],
      logs: { type: 'memory', path: 'memory://run-1' },
      startedAt: '2026-05-01T00:00:00.000Z',
      finishedAt: '2026-05-01T00:01:00.000Z',
      ...overrides,
    },
    preflight: {
      acceptanceCriteria: ['AC1: builds', 'AC2: tests pass'],
    },
  };
}

test('fromControlLoopSummary: maps ready_for_review summary to artefact input', () => {
  const input = fromControlLoopSummary({
    invocation_id: 'run_abc',
    summary: controlLoopSummary(),
  });
  assert.equal(input.surface, 'control-loop');
  assert.equal(input.outcome, 'ready_for_review');
  assert.equal(input.ticket_id, 'LAT-127');
  assert.equal(input.branch, 'lat-127-foo');
  assert.equal(input.provider, 'mock');
  assert.equal(input.pr_url, 'https://github.com/owner/repo/pull/42');
  assert.equal(input.checks?.[0]?.name, 'build');
  assert.equal(input.acceptance_criteria_coverage?.length, 2);
});

test('fromControlLoopSummary: refused state surfaces refusal code as artefact code', () => {
  const input = fromControlLoopSummary({
    invocation_id: 'run_abc',
    summary: controlLoopSummary({
      state: 'refused',
      branch: null,
      refusals: [{ code: 'missing_runtime_config', message: 'no provider env' }],
    }),
  });
  assert.equal(input.outcome, 'refused');
  assert.equal(input.refusal_code, 'missing_runtime_config');
  assert.equal(input.refusal_message, 'no provider env');
});

test('fromControlLoopSummary -> buildRunArtefact: end-to-end produces a valid sanitised artefact', () => {
  const input = fromControlLoopSummary({
    invocation_id: 'run_abc',
    summary: controlLoopSummary(),
    raw_stdout: 'saw lin_api_ABCDEFGHIJ12345 token leaked',
    log_stdout_redacted: 'saw <redacted> token leaked\nbut also https://api.runpod.io/v2/foo',
    extra_secrets: ['topsecretvalue1234'],
  });
  const a = buildRunArtefact(input);
  assert.equal(a.outcome, 'ready_for_review');
  assert.equal(a.surface, 'control-loop');
  // Sanity: no token-shaped substring leaks anywhere in the JSON body.
  const json = JSON.stringify(a);
  assert.doesNotMatch(json, /lin_api_ABCDEFGHIJ12345/);
});

function harnessSummary(
  overrides: Partial<OpencodeDryRunSummaryLike> = {},
): OpencodeDryRunSummaryLike {
  return {
    schemaVersion: '1.0.0',
    ticket: 'LAT-127',
    packPath: '/tmp/pack.md',
    status: 'ready',
    generatedAt: '2026-05-01T00:00:00.000Z',
    packReadinessStatus: 'ready',
    costBand: 'low',
    riskLevel: 'low',
    filesInScope: ['packages/icp/src/foo.ts'],
    filesForbidden: ['.github/workflows/**'],
    acceptanceCriteria: ['AC1', 'AC2'],
    branchPlan: { branch: 'lat-127-foo', prTitlePrefix: 'LAT-127:', prBase: 'main' },
    checkPlan: [
      { name: 'build', command: 'npm run build', source: 'ticket-pack', kind: 'shell' },
      {
        name: 'no-forbidden',
        command: 'No edits under forbidden paths.',
        source: 'ticket-pack',
        kind: 'policy',
      },
    ],
    refusals: [],
    ...overrides,
  };
}

test('fromOpencodeDryRunSummary: ready harness summary maps to planned artefact outcome', () => {
  const input = fromOpencodeDryRunSummary({
    invocation_id: 'run_abc',
    summary: harnessSummary(),
    started_at: new Date('2026-05-01T00:00:00.000Z'),
    ended_at: new Date('2026-05-01T00:00:01.000Z'),
  });
  assert.equal(input.surface, 'opencode-harness');
  assert.equal(input.outcome, 'planned');
  assert.equal(input.ticket_id, 'LAT-127');
  assert.equal(input.branch, 'lat-127-foo');
  assert.equal(input.checks?.length, 2);
  assert.equal(input.checks?.[1]?.kind, 'policy');
});

test('fromOpencodeDryRunSummary: blocked / too_large / needs_clarification map to refused', () => {
  for (const status of ['blocked', 'needs_clarification', 'too_large']) {
    const input = fromOpencodeDryRunSummary({
      invocation_id: 'run_abc',
      summary: harnessSummary({
        status,
        refusals: [{ code: 'first_refusal', message: 'nope' }],
      }),
      started_at: new Date(),
      ended_at: new Date(),
    });
    assert.equal(input.outcome, 'refused', `status=${status}`);
    assert.equal(input.refusal_code, 'first_refusal');
  }
});

test('fromOpencodeDryRunSummary: harness_error and unknown statuses default to failed', () => {
  const a = fromOpencodeDryRunSummary({
    invocation_id: 'run_abc',
    summary: harnessSummary({ status: 'harness_error' }),
    started_at: new Date(),
    ended_at: new Date(),
  });
  assert.equal(a.outcome, 'failed');
  const b = fromOpencodeDryRunSummary({
    invocation_id: 'run_abc',
    summary: harnessSummary({ status: 'totally_made_up' }),
    started_at: new Date(),
    ended_at: new Date(),
  });
  assert.equal(b.outcome, 'failed');
});
