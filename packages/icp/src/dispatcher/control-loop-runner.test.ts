import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { runControlLoopCli } from './control-loop-runner.js';
import type { DispatcherSpawn, DispatcherSpawnedProcess } from './types.js';

interface FakeChildOptions {
  stdoutChunks?: string[];
  stderrChunks?: string[];
  exitCode?: number | null;
  errorBeforeExit?: Error;
}

function makeFakeChild(opts: FakeChildOptions): {
  child: DispatcherSpawnedProcess;
  fire: () => void;
} {
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const procEmitter = new EventEmitter();
  const child: DispatcherSpawnedProcess = {
    stdout: {
      on: (e, cb) => {
        stdoutEmitter.on(e, cb);
      },
    },
    stderr: {
      on: (e, cb) => {
        stderrEmitter.on(e, cb);
      },
    },
    on: (e, cb) => {
      procEmitter.on(e, cb);
    },
    kill: () => true,
  };
  const fire = () => {
    setImmediate(() => {
      for (const c of opts.stdoutChunks ?? []) stdoutEmitter.emit('data', c);
      for (const c of opts.stderrChunks ?? []) stderrEmitter.emit('data', c);
      if (opts.errorBeforeExit) {
        procEmitter.emit('error', opts.errorBeforeExit);
      } else {
        procEmitter.emit('close', opts.exitCode ?? 0);
      }
    });
  };
  return { child, fire };
}

function spawnReturning(child: DispatcherSpawnedProcess, fire: () => void): DispatcherSpawn {
  return () => {
    fire();
    return child;
  };
}

test('runControlLoopCli: passes ticket-pack path, mode, and json format', async () => {
  let captured: { cmd: string; args: ReadonlyArray<string> } | null = null;
  const { child, fire } = makeFakeChild({
    stdoutChunks: [
      JSON.stringify({
        schemaVersion: '1.0.0',
        evidence: { state: 'ready_for_review' },
      }) + '\n',
    ],
    exitCode: 0,
  });
  const spawn: DispatcherSpawn = (cmd, args) => {
    captured = { cmd, args };
    fire();
    return child;
  };
  const r = await runControlLoopCli({
    cliPath: '/abs/control-loop/dist/cli.js',
    packPath: '/tmp/lat-126.pack.md',
    mode: 'live',
    cwd: '/repo',
    env: {},
    spawn,
  });
  assert.deepEqual(captured, {
    cmd: 'node',
    args: [
      '/abs/control-loop/dist/cli.js',
      '/tmp/lat-126.pack.md',
      '--mode',
      'live',
      '--format',
      'json',
    ],
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.jsonSummary?.evidence.state, 'ready_for_review');
});

test('runControlLoopCli: redacts captured stdout/stderr', async () => {
  const { child, fire } = makeFakeChild({
    stdoutChunks: [
      'Authorization: lin_api_AAAAAAAAAAAAAAAA done\n',
      JSON.stringify({
        schemaVersion: '1.0.0',
        evidence: { state: 'failed' },
      }),
    ],
    stderrChunks: ['secret=hunter22hunter22hunter22'],
    exitCode: 3,
  });
  const r = await runControlLoopCli({
    cliPath: '/cli.js',
    packPath: '/p.md',
    mode: 'mock',
    cwd: '/repo',
    env: {},
    extraSecrets: ['hunter22hunter22hunter22'],
    spawn: spawnReturning(child, fire),
  });
  assert.doesNotMatch(r.stdout, /lin_api_AAAA/);
  assert.match(r.stdout, /<redacted>/);
  assert.doesNotMatch(r.stderr, /hunter22/);
});

test('runControlLoopCli: surfaces process error before exit as exit code 1', async () => {
  const { child, fire } = makeFakeChild({
    errorBeforeExit: new Error('ENOENT'),
  });
  const r = await runControlLoopCli({
    cliPath: '/cli.js',
    packPath: '/p.md',
    mode: 'mock',
    cwd: '/repo',
    env: {},
    spawn: spawnReturning(child, fire),
  });
  assert.equal(r.exitCode, 1);
  assert.equal(r.jsonSummary, null);
});

test('runControlLoopCli: returns null jsonSummary when stdout has no JSON', async () => {
  const { child, fire } = makeFakeChild({
    stdoutChunks: ['non-json output\n'],
    exitCode: 3,
  });
  const r = await runControlLoopCli({
    cliPath: '/cli.js',
    packPath: '/p.md',
    mode: 'mock',
    cwd: '/repo',
    env: {},
    spawn: spawnReturning(child, fire),
  });
  assert.equal(r.jsonSummary, null);
  assert.equal(r.exitCode, 3);
});

test('runControlLoopCli: tolerates malformed JSON gracefully', async () => {
  const { child, fire } = makeFakeChild({
    stdoutChunks: ['{ schemaVersion: malformed'],
    exitCode: 3,
  });
  const r = await runControlLoopCli({
    cliPath: '/cli.js',
    packPath: '/p.md',
    mode: 'mock',
    cwd: '/repo',
    env: {},
    spawn: spawnReturning(child, fire),
  });
  assert.equal(r.jsonSummary, null);
});
