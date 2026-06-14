import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorktreeAllocator, type WorktreeRunner } from './worktree.js';

interface RunnerCall {
  args: ReadonlyArray<string>;
  cwd: string | undefined;
}

function fakeRunner(
  responses: ReadonlyArray<{ exitCode: number; stderr?: string }>,
  log: RunnerCall[],
): WorktreeRunner {
  let i = 0;
  return async (_cmd, args, options) => {
    log.push({ args, cwd: options.cwd });
    const r = responses[i] ?? { exitCode: 0, stderr: '' };
    i += 1;
    return { exitCode: r.exitCode, stderr: r.stderr ?? '' };
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'lat138-worktree-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('WorktreeAllocator: allocate creates worktree on a unique branch', async () => {
  await withTempDir(async (root) => {
    const log: RunnerCall[] = [];
    const alloc = new WorktreeAllocator({
      repoRoot: root,
      runner: fakeRunner([{ exitCode: 0 }], log),
      makeSuffix: () => 'abc123',
    });
    assert.equal(alloc.tryReserve('LAT-138'), true);
    const a = await alloc.allocate('LAT-138');
    assert.equal(a.branch, 'dispatch/lat-138-abc123');
    assert.match(a.worktreePath, /lat-138-abc123$/);
    assert.match(a.invocationDir, /lat-138-abc123\/\.dispatch-invocation$/);
    // Invocation dir actually exists on disk.
    const st = await stat(a.invocationDir);
    assert.equal(st.isDirectory(), true);
    // First git call was `worktree add -b <branch> <path> HEAD`.
    assert.equal(log.length, 1);
    assert.deepEqual(log[0]!.args.slice(0, 4), [
      'worktree',
      'add',
      '-b',
      'dispatch/lat-138-abc123',
    ]);
    assert.equal(log[0]!.args[5], 'HEAD');
  });
});

test('WorktreeAllocator: two simulated dispatches get distinct branches and dirs', async () => {
  await withTempDir(async (root) => {
    const log: RunnerCall[] = [];
    let suffix = 0;
    const alloc = new WorktreeAllocator({
      repoRoot: root,
      runner: fakeRunner([{ exitCode: 0 }, { exitCode: 0 }], log),
      makeSuffix: () => {
        suffix += 1;
        return `s${suffix}`;
      },
    });
    assert.equal(alloc.tryReserve('LAT-100'), true);
    assert.equal(alloc.tryReserve('LAT-200'), true);
    const a1 = await alloc.allocate('LAT-100');
    const a2 = await alloc.allocate('LAT-200');
    assert.notEqual(a1.branch, a2.branch);
    assert.notEqual(a1.worktreePath, a2.worktreePath);
    assert.notEqual(a1.invocationDir, a2.invocationDir);
    assert.match(a1.branch, /lat-100/);
    assert.match(a2.branch, /lat-200/);
    // Both invocation dirs were actually created.
    assert.equal((await stat(a1.invocationDir)).isDirectory(), true);
    assert.equal((await stat(a2.invocationDir)).isDirectory(), true);
  });
});

test('WorktreeAllocator: same ticket re-run gets a distinct branch', async () => {
  await withTempDir(async (root) => {
    const log: RunnerCall[] = [];
    let n = 0;
    const alloc = new WorktreeAllocator({
      repoRoot: root,
      runner: fakeRunner([{ exitCode: 0 }, { exitCode: 0 }], log),
      makeSuffix: () => {
        n += 1;
        return `run${n}`;
      },
    });
    alloc.tryReserve('LAT-138');
    const a1 = await alloc.allocate('LAT-138');
    alloc.release('LAT-138');
    alloc.tryReserve('LAT-138');
    const a2 = await alloc.allocate('LAT-138');
    assert.notEqual(a1.branch, a2.branch);
    assert.notEqual(a1.worktreePath, a2.worktreePath);
  });
});

test('WorktreeAllocator: tryReserve returns false for duplicate ticket in same process', async () => {
  await withTempDir(async (root) => {
    const log: RunnerCall[] = [];
    const alloc = new WorktreeAllocator({
      repoRoot: root,
      runner: fakeRunner([{ exitCode: 0 }], log),
    });
    assert.equal(alloc.tryReserve('LAT-138'), true);
    assert.equal(alloc.tryReserve('LAT-138'), false);
    // Case- and prefix-tolerant: same ticket in different casing is
    // still treated as a duplicate.
    assert.equal(alloc.tryReserve('lat-138'), false);
    alloc.release('LAT-138');
    assert.equal(alloc.tryReserve('LAT-138'), true);
  });
});

test('WorktreeAllocator: cleanup invokes git worktree remove and branch delete', async () => {
  await withTempDir(async (root) => {
    const log: RunnerCall[] = [];
    const alloc = new WorktreeAllocator({
      repoRoot: root,
      runner: fakeRunner(
        [
          { exitCode: 0 }, // worktree add
          { exitCode: 0 }, // worktree remove
          { exitCode: 0 }, // branch -D
        ],
        log,
      ),
      makeSuffix: () => 'abc',
    });
    alloc.tryReserve('LAT-138');
    const a = await alloc.allocate('LAT-138');
    const status = await alloc.cleanup(a);
    assert.equal(status.removed, true);
    assert.deepEqual(log[1]!.args.slice(0, 3), ['worktree', 'remove', '--force']);
    assert.deepEqual(log[2]!.args, ['branch', '-D', a.branch]);
  });
});

test('WorktreeAllocator: cleanup falls back to fs rm when git remove fails', async () => {
  await withTempDir(async (root) => {
    const log: RunnerCall[] = [];
    const alloc = new WorktreeAllocator({
      repoRoot: root,
      runner: fakeRunner(
        [
          { exitCode: 0 }, // add
          { exitCode: 1, stderr: 'fatal: not a worktree' }, // remove fails
          { exitCode: 0 }, // branch -D succeeds
        ],
        log,
      ),
      makeSuffix: () => 'abc',
    });
    alloc.tryReserve('LAT-138');
    const a = await alloc.allocate('LAT-138');
    const status = await alloc.cleanup(a);
    // git worktree remove failed; allocator falls back to rm -rf,
    // succeeds, and reports removed=true after branch delete.
    assert.equal(status.removed, true);
    await assert.rejects(stat(a.worktreePath));
  });
});

test('WorktreeAllocator: allocate surfaces git error without leaking stderr noise', async () => {
  await withTempDir(async (root) => {
    const log: RunnerCall[] = [];
    const alloc = new WorktreeAllocator({
      repoRoot: root,
      runner: fakeRunner(
        [
          {
            exitCode: 128,
            stderr: "fatal: '/some/path' already exists\nhint: ...\nhint: ...",
          },
        ],
        log,
      ),
      makeSuffix: () => 'x',
    });
    alloc.tryReserve('LAT-138');
    await assert.rejects(
      () => alloc.allocate('LAT-138'),
      /git worktree add failed.*already exists/,
    );
  });
});
