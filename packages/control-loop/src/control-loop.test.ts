import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runControlLoop } from './control-loop.js';
import { MockRuntimeAdapter, LiveOpencodeAdapter } from './adapters.js';
import { formatRunSummaryJson, formatRunSummaryMarkdown } from './format.js';
import { MissingConfigError } from './types.js';
import type { RuntimeAdapter } from './types.js';

const READY_PACK = new URL('./__fixtures__/ready-pack.md', import.meta.url).pathname;
const BLOCKED_PACK = new URL('./__fixtures__/blocked-pack.md', import.meta.url).pathname;

const FROZEN_NOW = () => new Date('2026-05-02T12:00:00.000Z');

async function inTmp<T>(name: string, body: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'control-loop-test-'));
  const path = join(dir, name);
  await writeFile(path, body, 'utf8');
  try {
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('runControlLoop — happy path with mock adapter', () => {
  it('dispatches a ready pack through the mock adapter and returns ready_for_review', async () => {
    const summary = await runControlLoop({
      packPath: READY_PACK,
      mode: 'mock',
      now: FROZEN_NOW,
      env: {},
    });
    assert.equal(summary.evidence.state, 'ready_for_review');
    assert.equal(summary.evidence.mode, 'mock');
    assert.equal(summary.evidence.ticket, 'LAT-999');
    assert.equal(summary.evidence.costBand, 'low');
    assert.equal(summary.evidence.riskLevel, 'low');
    assert.equal(summary.evidence.provider?.adapter, 'mock');
    assert.equal(summary.evidence.provider?.costClass, 'low');
    assert.equal(summary.evidence.provider?.runtimeId, 'mock-lat-999');
    assert.equal(summary.evidence.branch?.branch, 'lat-999-noop-probe');
    assert.equal(summary.evidence.branch?.prBase, 'main');
    assert.equal(summary.evidence.branch?.prUrl, null, 'MVP loop never opens PRs');
    assert.ok(summary.evidence.checks.length > 0, 'should report at least one check');
    // Shell checks must pass; policy/manual checks land as `manual` (the
    // MVP loop has no signal to verify them and never executes them).
    for (const c of summary.evidence.checks) {
      if (c.kind === 'shell' || c.kind === undefined) {
        assert.equal(c.outcome, 'passed');
      } else {
        assert.equal(c.outcome, 'manual');
      }
    }
    // The ready-pack fixture declares forbidden paths AND lists policy
    // bullets in `Expected checks`. Evidence must surface a forbidden-path
    // policy item so reviewers can confirm the diff against it.
    assert.ok(
      summary.evidence.checks.some((c) => c.kind === 'policy' && /forbidden/i.test(c.name)),
      'evidence must include a forbidden-path policy item with manual outcome',
    );
    assert.equal(summary.evidence.refusals.length, 0);
    assert.match(summary.evidence.nextHumanAction, /Human reviewer/);
    assert.equal(summary.preflight.status, 'ready');
  });

  it('emits structured JSON evidence with no URLs or token-shaped strings', async () => {
    const summary = await runControlLoop({
      packPath: READY_PACK,
      mode: 'mock',
      now: FROZEN_NOW,
      env: {},
    });
    const json = formatRunSummaryJson(summary);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    assert.equal(parsed['schemaVersion'], '1.0.0');
    assert.doesNotMatch(json, /https?:\/\/(?!.*mock:\/\/)/, 'no real http URLs');
    assert.doesNotMatch(json, /sk-[A-Za-z0-9]{20,}/);
    assert.doesNotMatch(json, /ghp_[A-Za-z0-9]{36}/);
    assert.doesNotMatch(json, /Bearer\s+[A-Za-z0-9._-]{16,}/);
  });

  it('renders a markdown summary with branch plan and next action', async () => {
    const summary = await runControlLoop({
      packPath: READY_PACK,
      mode: 'mock',
      now: FROZEN_NOW,
      env: {},
    });
    const md = formatRunSummaryMarkdown(summary);
    assert.match(md, /control-loop run — LAT-999/);
    assert.match(md, /READY_FOR_REVIEW/);
    assert.match(md, /Branch: `lat-999-noop-probe`/);
    assert.match(md, /Next human action/);
  });

  it("plan mode does not call the adapter's run() method", async () => {
    let runCalled = false;
    const adapter: RuntimeAdapter = {
      id: 'test-spy',
      async prepare() {},
      async run() {
        runCalled = true;
        throw new Error('must not be called in plan mode');
      },
    };
    const summary = await runControlLoop({
      packPath: READY_PACK,
      mode: 'plan',
      adapter,
      now: FROZEN_NOW,
      env: {},
    });
    assert.equal(runCalled, false);
    assert.equal(summary.evidence.state, 'planned');
    assert.equal(summary.evidence.provider, null);
    assert.equal(summary.evidence.branch?.branch, 'lat-999-noop-probe');
    assert.match(summary.evidence.nextHumanAction, /mode=mock or mode=live/);
  });
});

describe('runControlLoop — refusal modes', () => {
  it('refuses a blocked pack before any adapter is contacted', async () => {
    let runCalled = false;
    const adapter: RuntimeAdapter = {
      id: 'spy',
      async prepare() {},
      async run() {
        runCalled = true;
        throw new Error('adapter must not run for blocked pack');
      },
    };
    const summary = await runControlLoop({
      packPath: BLOCKED_PACK,
      mode: 'mock',
      adapter,
      now: FROZEN_NOW,
      env: {},
    });
    assert.equal(runCalled, false);
    assert.equal(summary.evidence.state, 'refused');
    assert.equal(summary.evidence.provider, null);
    assert.equal(summary.preflight.status, 'blocked');
  });

  it('refuses an ambiguous pack as needs_clarification → refused', async () => {
    const ambiguous = `# Pack\n\n## Header\n\n- **Linear ID:** LAT-1\n- **Pack version:** 1\n- **Cost band:** TBD\n- **Risk level:** TBD\n- **Readiness status:** ready\n\n## Goal\n\n\n\n## Acceptance criteria\n\n\n\n## Constraints\n\n\n\n## Expected checks\n\n\n\n## Branch / PR rules\n\n`;
    await inTmp('ambiguous.md', ambiguous, async (path) => {
      const summary = await runControlLoop({
        packPath: path,
        mode: 'mock',
        now: FROZEN_NOW,
        env: {},
      });
      assert.equal(summary.evidence.state, 'refused');
      assert.ok(summary.evidence.refusals.length >= 1);
    });
  });

  it('refuses a pack containing a secret-shaped string (guardrail)', async () => {
    const original = await readFile(READY_PACK, 'utf8');
    const tainted = original + '\n\n<!-- accidental: AKIAABCDEFGHIJKLMNOP -->\n'; // secret-guard:allow fake fixture for guardrail test
    await inTmp('tainted.md', tainted, async (path) => {
      let runCalled = false;
      const adapter: RuntimeAdapter = {
        id: 'spy',
        async prepare() {},
        async run() {
          runCalled = true;
          throw new Error('must not run when secret detected');
        },
      };
      const summary = await runControlLoop({
        packPath: path,
        mode: 'mock',
        adapter,
        now: FROZEN_NOW,
        env: {},
      });
      assert.equal(runCalled, false);
      assert.equal(summary.evidence.state, 'refused');
      assert.ok(summary.evidence.refusals.some((r) => r.code === 'secret_aws_access_key'));
    });
  });

  it('refuses live mode when CONTROL_LOOP_LIVE_ENABLED is missing', async () => {
    const summary = await runControlLoop({
      packPath: READY_PACK,
      mode: 'live',
      env: {},
      now: FROZEN_NOW,
    });
    assert.equal(summary.evidence.state, 'refused');
    assert.ok(
      summary.evidence.refusals.some((r) => r.code === 'missing_runtime_config'),
      'should refuse with missing_runtime_config',
    );
    assert.equal(summary.evidence.provider, null);
  });

  it('refuses live mode even with provider set, until LIVE_ENABLED=1', async () => {
    const summary = await runControlLoop({
      packPath: READY_PACK,
      mode: 'live',
      env: {
        CONTROL_LOOP_PROVIDER: 'opencode-runpod',
      },
      now: FROZEN_NOW,
    });
    assert.equal(summary.evidence.state, 'refused');
    assert.ok(summary.evidence.refusals.some((r) => /CONTROL_LOOP_LIVE_ENABLED/.test(r.message)));
  });

  it('refuses live mode when RunPod env is missing even with LIVE_ENABLED=1', async () => {
    const summary = await runControlLoop({
      packPath: READY_PACK,
      mode: 'live',
      env: {
        CONTROL_LOOP_PROVIDER: 'opencode-runpod',
        CONTROL_LOOP_LIVE_ENABLED: '1',
        CONTROL_LOOP_WORKDIR: '/tmp/sandbox',
      },
      now: FROZEN_NOW,
    });
    assert.equal(summary.evidence.state, 'refused');
    assert.ok(
      summary.evidence.refusals.some(
        (r) => /RUNPOD_API_KEY/.test(r.message) && /RUNPOD_POD_ID/.test(r.message),
      ),
      'live adapter should list missing RunPod env vars and never fall back to mock',
    );
  });
});

describe('runControlLoop — failed checks and adapter errors', () => {
  it('translates adapter checks_failed into evidence with state=checks_failed', async () => {
    const adapter = new MockRuntimeAdapter({ outcome: 'checks_failed', now: FROZEN_NOW });
    const summary = await runControlLoop({
      packPath: READY_PACK,
      mode: 'mock',
      adapter,
      now: FROZEN_NOW,
      env: {},
    });
    assert.equal(summary.evidence.state, 'checks_failed');
    assert.ok(summary.evidence.checks.length > 0);
    // Shell checks fail (forced by the mock); policy/manual items remain
    // `manual` regardless of adapter outcome — they're never executed.
    for (const c of summary.evidence.checks) {
      if (c.kind === 'shell' || c.kind === undefined) {
        assert.equal(c.outcome, 'failed');
      } else {
        assert.equal(c.outcome, 'manual');
      }
    }
    assert.equal(summary.evidence.provider?.adapter, 'mock');
    assert.match(summary.evidence.nextHumanAction, /failed checks/);
  });

  it('translates adapter failure into evidence with state=failed and refusal', async () => {
    const adapter = new MockRuntimeAdapter({ outcome: 'failed', now: FROZEN_NOW });
    const summary = await runControlLoop({
      packPath: READY_PACK,
      mode: 'mock',
      adapter,
      now: FROZEN_NOW,
      env: {},
    });
    assert.equal(summary.evidence.state, 'failed');
    assert.ok(summary.evidence.refusals.some((r) => r.code === 'adapter_failure'));
    assert.equal(summary.evidence.provider?.adapter, 'mock');
  });

  it('catches unexpected adapter exceptions as state=failed (not crash)', async () => {
    const adapter: RuntimeAdapter = {
      id: 'throwing',
      async prepare() {},
      async run() {
        throw new Error('boom');
      },
    };
    const summary = await runControlLoop({
      packPath: READY_PACK,
      mode: 'mock',
      adapter,
      now: FROZEN_NOW,
      env: {},
    });
    assert.equal(summary.evidence.state, 'failed');
    assert.ok(summary.evidence.refusals.some((r) => r.code === 'adapter_threw'));
  });

  it('treats MissingConfigError thrown from run() as a refused/missing_runtime_config', async () => {
    const adapter: RuntimeAdapter = {
      id: 'config-fail',
      async prepare() {},
      async run() {
        throw new MissingConfigError('nope', ['FOO']);
      },
    };
    const summary = await runControlLoop({
      packPath: READY_PACK,
      mode: 'mock',
      adapter,
      now: FROZEN_NOW,
      env: {},
    });
    assert.equal(summary.evidence.state, 'refused');
    assert.ok(summary.evidence.refusals.some((r) => r.code === 'missing_runtime_config'));
  });
});

describe('runControlLoop — LAT-135 regression: never exec English as shell', () => {
  /**
   * The ready-pack fixture carries the LAT-127 failure shape: an
   * `Expected checks` section with a real shell command (`npm run
   * check`) AND English policy bullets ("No edits under forbidden
   * paths.", "No new files outside the allowlist exist..."). The
   * pre-LAT-135 loop sent every bullet to the adapter as a shell
   * command, which got `/bin/sh: No: command not found` from a real
   * RunPod dispatch. This test pins the contract: the adapter's
   * `requiredChecks` only ever contains shell strings.
   */
  it('only forwards `kind: shell` items to the adapter as requiredChecks', async () => {
    const captured: { commands: string[] } = { commands: [] };
    const adapter: RuntimeAdapter = {
      id: 'capture',
      async prepare() {},
      async run(req) {
        captured.commands = req.requiredChecks.map((c) => c.command);
        return {
          state: 'ready_for_review',
          provider: { adapter: 'capture', runtimeId: 'capture-1', costClass: 'low' },
          branch: {
            branch: req.branch,
            prTitlePrefix: req.prTitlePrefix,
            prBase: req.prBase,
            prUrl: null,
          },
          checks: req.requiredChecks.map((c) => ({
            name: c.name,
            command: c.command,
            outcome: 'passed' as const,
            durationMs: 1,
          })),
          logs: { type: 'memory' as const, path: 'mem://capture' },
        };
      },
    };
    const summary = await runControlLoop({
      packPath: READY_PACK,
      mode: 'mock',
      adapter,
      now: FROZEN_NOW,
      env: {},
    });

    // The exact LAT-127 failure shape: `No edits under forbidden paths.`
    // must NOT appear as a command the adapter is asked to execute.
    for (const cmd of captured.commands) {
      assert.doesNotMatch(cmd, /forbidden/i, `requiredChecks must not contain policy text: ${cmd}`);
      assert.doesNotMatch(cmd, /No edits/i, `requiredChecks must not contain policy text: ${cmd}`);
      const head = cmd.trim().split(/\s+/, 1)[0] ?? '';
      assert.notEqual(
        head,
        'No',
        `requiredChecks first token must never be the literal word 'No' — that's the LAT-127 failure shape`,
      );
    }
    // And the shell repo gate must still be there.
    assert.ok(
      captured.commands.includes('npm run check'),
      'the repo gate `npm run check` must still be forwarded as a shell command',
    );

    // Evidence must surface the policy guardrail with `manual` outcome
    // so reviewers can see that forbidden-path protection is still in
    // effect — recorded, not silently dropped.
    assert.ok(
      summary.evidence.checks.some(
        (c) => c.kind === 'policy' && c.outcome === 'manual' && /forbidden/i.test(c.name),
      ),
      'forbidden-path policy item must appear in evidence with outcome=manual',
    );
  });

  /**
   * Direct shape regression: a pack that lists the literal LAT-127
   * bullet must not produce a state that fails because `/bin/sh`
   * executed English. We verify the loop reaches `ready_for_review`
   * with a stub adapter that asserts no English is in its argv.
   */
  it('LAT-127-style pack reaches ready_for_review without /bin/sh: No: command not found', async () => {
    const lat127Shape = `# opencode Ticket Pack: LAT-127 shape
## Header
- **Linear ID:** LAT-127
- **Pack version:** 1
- **Planner run / source:** LAT-135 regression
- **Cost band:** low
- **Risk level:** low
- **Readiness status:** ready

## Goal
Reproduce the LAT-127 failure shape.

## Acceptance criteria
- [ ] something happens.

## Constraints
- **Files in scope (allowlist):**
  - packages/x/src/index.ts
- **Files / paths forbidden:** .github/workflows/**, docs/decisions/**, docs/prds/**
- **Dependency policy:** no new deps.

## Expected checks
- [ ] \`npm run check\` passes.
- [ ] No edits under forbidden paths.

## Branch / PR rules
- **Branch:** \`lat-127-shape\`
- **PR title prefix:** \`LAT-127:\`
- **PR base:** \`main\`
`;
    const adapter: RuntimeAdapter = {
      id: 'shell-guard',
      async prepare() {},
      async run(req) {
        // If the loop ever forwarded the LAT-127 English bullet as a
        // shell command, this throw simulates `/bin/sh: No: command
        // not found` and the test fails loudly.
        for (const c of req.requiredChecks) {
          const head = c.command.trim().split(/\s+/, 1)[0] ?? '';
          if (head === 'No' || /forbidden|no edits/i.test(c.command)) {
            throw new Error(`/bin/sh: ${head}: command not found`);
          }
        }
        return {
          state: 'ready_for_review',
          provider: { adapter: 'shell-guard', runtimeId: 'shell-guard-1', costClass: 'low' },
          branch: {
            branch: req.branch,
            prTitlePrefix: req.prTitlePrefix,
            prBase: req.prBase,
            prUrl: null,
          },
          checks: req.requiredChecks.map((c) => ({
            name: c.name,
            command: c.command,
            outcome: 'passed' as const,
            durationMs: 1,
          })),
          logs: { type: 'memory' as const, path: 'mem://shell-guard' },
        };
      },
    };
    await inTmp('lat-127.pack.md', lat127Shape, async (path) => {
      const summary = await runControlLoop({
        packPath: path,
        mode: 'mock',
        adapter,
        now: FROZEN_NOW,
        env: {},
      });
      assert.equal(summary.evidence.state, 'ready_for_review');
      assert.ok(
        summary.evidence.checks.some((c) => c.kind === 'policy' && c.outcome === 'manual'),
        'policy guardrail must be visible in evidence even when adapter succeeds',
      );
    });
  });
});

describe('LiveOpencodeAdapter.prepare', () => {
  it('lists every missing env var in MissingConfigError.missingKeys', async () => {
    const adapter = new LiveOpencodeAdapter({ env: {} });
    await assert.rejects(adapter.prepare(), (err: unknown) => {
      assert.ok(err instanceof MissingConfigError);
      assert.deepEqual(
        [...err.missingKeys].sort(),
        [
          'CONTROL_LOOP_LIVE_ENABLED=1',
          'CONTROL_LOOP_PROVIDER',
          'CONTROL_LOOP_WORKDIR',
          'RUNPOD_API_KEY',
          'RUNPOD_POD_ID',
        ].sort(),
      );
      return true;
    });
  });
});
