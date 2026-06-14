import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyIssue, validateClassifierOutput, type ClassifierOutput } from './classifier.js';
import type { DispatchIssue } from './types.js';

function issue(overrides: Partial<DispatchIssue> = {}): DispatchIssue {
  return {
    identifier: 'LAT-126',
    uuid: 'uuid-126',
    title: 'Add support for foo bar baz quux',
    description: [
      '## Summary',
      'Implement a small focused change.',
      '',
      '## Acceptance Criteria',
      '- [ ] code compiles',
      '- [ ] tests pass',
      '',
      'Body is long enough to clear the minimum threshold for safe dispatch and includes acceptance criteria.',
    ].join('\n'),
    stateName: 'Backlog',
    stateId: 'state-backlog',
    labels: [],
    complexityTag: 'unknown',
    reasoningTag: 'unknown',
    ...overrides,
  };
}

const codes = (out: ClassifierOutput) => out.hard_blockers.map((b) => b.code);

test('classifier: dispatchable on baseline issue with explicit override', () => {
  const out = classifyIssue(issue(), { explicitOverride: true });
  assert.equal(out.dispatchable, true);
  assert.equal(out.risk_class, 'low');
  assert.equal(out.required_human_approval, false);
  assert.deepEqual(out.hard_blockers, []);
});

test('classifier: refuses without explicit override (LAT-129 MVP gate)', () => {
  const out = classifyIssue(issue(), { explicitOverride: false });
  assert.equal(out.dispatchable, false);
  assert.deepEqual(codes(out), ['no_explicit_dispatch_target']);
});

// --- LAT-126 false-positive regression ---------------------------------

test('classifier: LAT-126 — references to existing ADR are safe context, not risky scope', () => {
  const out = classifyIssue(
    issue({
      identifier: 'LAT-126',
      title: 'Wire live opencode adapter behind control-loop seam',
      description: [
        '## Summary',
        'Per the existing architecture decision (ADR-0012), wire the seam so',
        'the live adapter implements the contract documented there.',
        'See ADR-0011 for the runtime context.',
        '',
        '## Acceptance Criteria',
        '- [ ] adapter implements the seam',
        '- [ ] tests pass without touching credentials',
        '',
        'Body long enough to clear the minimum description threshold for safe dispatch.',
      ].join('\n'),
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, true, `expected dispatchable, got reason: ${out.reason}`);
  assert.equal(out.risk_class, 'low');
  assert.deepEqual(out.hard_blockers, []);
});

// --- LAT-127 false-positive regression ---------------------------------

test("classifier: LAT-127 — guardrail 'do not touch secrets' is safe context", () => {
  const out = classifyIssue(
    issue({
      identifier: 'LAT-127',
      title: 'Refactor redact helper to share regex constants',
      description: [
        '## Summary',
        'Pure refactor of the redact module. Do not touch secrets.',
        'Must not expose any token-shaped values in logs.',
        '',
        '## Acceptance Criteria',
        '- [ ] no behaviour change',
        '- [ ] no new dependencies',
        '',
        'Body long enough to clear the minimum description size threshold safely.',
      ].join('\n'),
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, true, `expected dispatchable, got reason: ${out.reason}`);
  assert.deepEqual(out.hard_blockers, []);
});

test("classifier: 'no secrets' / 'without exposing secrets' are safe context", () => {
  const out = classifyIssue(
    issue({
      description: [
        '## Summary',
        'Refactor without exposing secrets. No secrets in fixtures.',
        '',
        '## Acceptance Criteria',
        '- [ ] no token-shaped fixtures',
        'Long body to clear the minimum description size threshold for safe dispatch.',
      ].join('\n'),
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, true);
});

// --- Risky counterexamples ---------------------------------------------

test('classifier: rotate-the-secret is risky scope, even alongside guardrail phrasing', () => {
  const out = classifyIssue(
    issue({
      description: [
        '## Summary',
        'Do not touch secrets in logs.',
        'Also rotate the production token for the inference provider.',
        '',
        '## Acceptance Criteria',
        '- [ ] new token in place',
        'Long body to clear the minimum description size threshold for safe dispatch.',
      ].join('\n'),
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, false);
  assert.equal(out.risk_class, 'high');
  assert.ok(codes(out).includes('risky_scope_secret_rotation'));
});

test('classifier: revoke API keys is risky scope', () => {
  const out = classifyIssue(
    issue({
      title: 'Revoke leaked api keys',
      description: [
        '## Summary',
        'Revoke the leaked API keys and reissue.',
        '',
        '## Acceptance Criteria',
        '- [ ] keys revoked',
        'Long body to clear minimum description threshold for safe dispatch operation here.',
      ].join('\n'),
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, false);
  assert.ok(codes(out).includes('risky_scope_secret_rotation'));
});

test('classifier: handle production credentials is risky scope', () => {
  const out = classifyIssue(
    issue({
      title: 'Add new credentials',
      description: [
        '## Summary',
        'Introduce new production credentials for the worker pool.',
        '',
        '## Acceptance Criteria',
        '- [ ] credentials added',
        'Long body to clear minimum description threshold for safe dispatch operation here.',
      ].join('\n'),
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, false);
  assert.ok(codes(out).includes('risky_scope_credential_handling'));
});

test('classifier: deploy/release/publish is risky scope', () => {
  for (const verb of ['Deploy', 'Release', 'Publish', 'Ship']) {
    const out = classifyIssue(
      issue({
        title: `${verb} the new build`,
        description: issue().description,
      }),
      { explicitOverride: true },
    );
    assert.equal(out.dispatchable, false, `expected refusal for ${verb}`);
    assert.ok(codes(out).includes('risky_scope_deploy_release'), `missing deploy code for ${verb}`);
  }
});

test('classifier: auto-merge / merge PR is risky scope', () => {
  for (const phrase of ['auto-merge the PR', 'automerge the pull request', 'merge to main']) {
    const out = classifyIssue(
      issue({
        title: phrase,
        description: issue().description,
      }),
      { explicitOverride: true },
    );
    assert.equal(out.dispatchable, false, `expected refusal for "${phrase}"`);
    assert.ok(
      codes(out).includes('risky_scope_auto_merge'),
      `missing auto-merge code for "${phrase}"`,
    );
  }
});

test('classifier: writing a NEW ADR / architecture decision is risky scope', () => {
  const out = classifyIssue(
    issue({
      title: 'Write a new ADR for inference routing',
      description: [
        '## Summary',
        'Author a new architecture decision documenting the chosen routing policy.',
        '',
        '## Acceptance Criteria',
        '- [ ] ADR file added',
        'Long body to clear minimum description threshold for safe dispatch operation here.',
      ].join('\n'),
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, false);
  assert.ok(codes(out).includes('risky_scope_primary_decision'));
});

test('classifier: vague spike with no acceptance criteria is risky scope', () => {
  const out = classifyIssue(
    issue({
      title: 'Investigate slowness',
      description:
        "Take a look at the workflow and see what's slow. Long enough body for the threshold check to pass without hitting size guard.",
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, false);
  // Both vague_planning_title and risky_scope_vague_spike fire.
  assert.ok(codes(out).includes('vague_planning_title'));
  assert.ok(codes(out).includes('risky_scope_vague_spike'));
});

// --- LAT-134: complexity & reasoning tags ------------------------------

test('classifier: complexity:small + reasoning:implementation → local_agent_eligible=true', () => {
  const out = classifyIssue(
    issue({
      labels: ['complexity/small', 'reasoning/implementation'],
      complexityTag: 'small',
      reasoningTag: 'implementation',
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, true);
  assert.equal(out.local_agent_eligible, true);
  assert.equal(out.complexity_tag, 'small');
  assert.equal(out.reasoning_tag, 'implementation');
  assert.equal(out.required_human_approval, false);
});

test('classifier: complexity:medium + reasoning:implementation → local_agent_eligible=true', () => {
  const out = classifyIssue(
    issue({
      labels: ['complexity/medium', 'reasoning/implementation'],
      complexityTag: 'medium',
      reasoningTag: 'implementation',
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, true);
  assert.equal(out.local_agent_eligible, true);
  assert.equal(out.required_human_approval, false);
});

test('classifier: complexity:large → local_agent_eligible=false (escape to reasoning/human)', () => {
  const out = classifyIssue(
    issue({
      labels: ['complexity/large', 'reasoning/implementation'],
      complexityTag: 'large',
      reasoningTag: 'implementation',
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, true);
  assert.equal(out.local_agent_eligible, false);
  // Dispatchable but not local-agent-eligible.
  assert.equal(out.required_human_approval, false);
});

test('classifier: reasoning:synthesis → local_agent_eligible=false', () => {
  const out = classifyIssue(
    issue({
      labels: ['complexity/small', 'reasoning/synthesis'],
      complexityTag: 'small',
      reasoningTag: 'synthesis',
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, true);
  assert.equal(out.local_agent_eligible, false);
  assert.equal(out.required_human_approval, false);
});

test('classifier: reasoning:architecture → local_agent_eligible=false', () => {
  const out = classifyIssue(
    issue({
      labels: ['complexity/medium', 'reasoning/architecture'],
      complexityTag: 'medium',
      reasoningTag: 'architecture',
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, true);
  assert.equal(out.local_agent_eligible, false);
  assert.equal(out.required_human_approval, false);
});

test('classifier: tags absent (unknown) → local_agent_eligible=false, requires human review for local', () => {
  const out = classifyIssue(
    issue({
      labels: [],
      complexityTag: 'unknown',
      reasoningTag: 'unknown',
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, true);
  assert.equal(out.local_agent_eligible, false);
  assert.equal(out.complexity_tag, 'unknown');
  assert.equal(out.reasoning_tag, 'unknown');
  assert.equal(out.required_human_approval, false);
});

test('classifier: hard blockers present → local_agent_eligible=false regardless of tags', () => {
  const out = classifyIssue(
    issue({
      labels: ['complexity/small', 'reasoning/implementation'],
      complexityTag: 'small',
      reasoningTag: 'implementation',
      title: 'Write a new ADR',
      description: [
        '## Summary',
        'Author a new architecture decision documenting the chosen routing policy.',
        '',
        '## Acceptance Criteria',
        '- [ ] ADR file added',
        'Long body to clear minimum description threshold for safe dispatch operation here.',
      ].join('\n'),
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, false);
  assert.equal(out.local_agent_eligible, false);
  assert.equal(out.complexity_tag, 'small');
  assert.equal(out.reasoning_tag, 'implementation');
  assert.ok(codes(out).includes('risky_scope_primary_decision'));
});

test('classifier: reasoning:synthesis with complexity:large → both trigger refusal for local', () => {
  const out = classifyIssue(
    issue({
      labels: ['complexity/large', 'reasoning/synthesis'],
      complexityTag: 'large',
      reasoningTag: 'synthesis',
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, true);
  assert.equal(out.local_agent_eligible, false);
  // Dispatchable but routed away from local.
  assert.equal(out.required_human_approval, false);
});

test('classifier: complexity/medium + reasoning/synthesis → local eligible=false', () => {
  const out = classifyIssue(
    issue({
      labels: ['complexity/medium', 'reasoning/synthesis'],
      complexityTag: 'medium',
      reasoningTag: 'synthesis',
    }),
    { explicitOverride: true },
  );
  assert.equal(out.dispatchable, true);
  assert.equal(out.local_agent_eligible, false);
  assert.equal(out.required_human_approval, false);
});

// --- Schema validation -------------------------------------------------

test('validateClassifierOutput: accepts a real classifier output', () => {
  const out = classifyIssue(issue(), { explicitOverride: true });
  const v = validateClassifierOutput(out);
  assert.equal(v.ok, true);
});

test('validateClassifierOutput: rejects missing fields', () => {
  const v = validateClassifierOutput({});
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.ok(v.errors.length >= 4);
});

test('validateClassifierOutput: rejects bad enum values', () => {
  const v = validateClassifierOutput({
    dispatchable: false,
    risk_class: 'extreme',
    work_type: 'magic',
    reason: 'x',
    required_human_approval: true,
    hard_blockers: [],
    local_agent_eligible: false,
    complexity_tag: 'huge',
    reasoning_tag: 'deep',
  });
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.ok(v.errors.some((e) => e.includes('risk_class')));
  assert.ok(v.errors.some((e) => e.includes('work_type')));
  assert.ok(v.errors.some((e) => e.includes('complexity_tag')));
  assert.ok(v.errors.some((e) => e.includes('reasoning_tag')));
});

test('validateClassifierOutput: rejects dispatchable=true with hard_blockers', () => {
  const v = validateClassifierOutput({
    dispatchable: true,
    risk_class: 'low',
    work_type: 'code_change',
    reason: 'x',
    required_human_approval: false,
    hard_blockers: [{ code: 'missing_uuid', message: 'x' }],
    local_agent_eligible: true,
    complexity_tag: 'small',
    reasoning_tag: 'implementation',
  });
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.ok(v.errors.some((e) => e.includes('dispatchable=true')));
});

test('validateClassifierOutput: rejects high-risk dispatchable', () => {
  const v = validateClassifierOutput({
    dispatchable: true,
    risk_class: 'high',
    work_type: 'code_change',
    reason: 'x',
    required_human_approval: false,
    hard_blockers: [],
    local_agent_eligible: true,
    complexity_tag: 'small',
    reasoning_tag: 'implementation',
  });
  assert.equal(v.ok, false);
});

test('validateClassifierOutput: rejects unknown hard-blocker code', () => {
  const v = validateClassifierOutput({
    dispatchable: false,
    risk_class: 'high',
    work_type: 'code_change',
    reason: 'x',
    required_human_approval: true,
    hard_blockers: [{ code: 'made_up_code', message: 'x' }],
    local_agent_eligible: false,
    complexity_tag: 'small',
    reasoning_tag: 'implementation',
  });
  assert.equal(v.ok, false);
});

test('validateClassifierOutput: accepts valid LAT-134 fields', () => {
  const v = validateClassifierOutput({
    dispatchable: true,
    risk_class: 'low',
    work_type: 'code_change',
    reason: 'test',
    required_human_approval: false,
    hard_blockers: [],
    local_agent_eligible: true,
    complexity_tag: 'small',
    reasoning_tag: 'implementation',
  });
  assert.equal(v.ok, true);
});

test('validateClassifierOutput: rejects missing local_agent_eligible', () => {
  const v = validateClassifierOutput({
    dispatchable: true,
    risk_class: 'low',
    work_type: 'code_change',
    reason: 'x',
    required_human_approval: false,
    hard_blockers: [],
    complexity_tag: 'small',
    reasoning_tag: 'implementation',
  });
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.ok(v.errors.some((e) => e.includes('local_agent_eligible')));
});

test('validateClassifierOutput: rejects missing complexity_tag', () => {
  const v = validateClassifierOutput({
    dispatchable: true,
    risk_class: 'low',
    work_type: 'code_change',
    reason: 'x',
    required_human_approval: false,
    hard_blockers: [],
    local_agent_eligible: true,
    reasoning_tag: 'implementation',
  });
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.ok(v.errors.some((e) => e.includes('complexity_tag')));
});

test('validateClassifierOutput: rejects missing reasoning_tag', () => {
  const v = validateClassifierOutput({
    dispatchable: true,
    risk_class: 'low',
    work_type: 'code_change',
    reason: 'x',
    required_human_approval: false,
    hard_blockers: [],
    local_agent_eligible: true,
    complexity_tag: 'small',
  });
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.ok(v.errors.some((e) => e.includes('reasoning_tag')));
});
