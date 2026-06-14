/**
 * LAT-138 per-agent worktree sandboxing for concurrent dispatch MVP.
 *
 * Each dispatcher invocation gets its own git worktree on a unique
 * branch, plus an invocation-specific scratch directory that holds the
 * generated pack, logs, and any evidence the control loop emits. The
 * worktree is the cwd handed to the control-loop CLI so opencode never
 * mutates the operator's main checkout, and two concurrent dispatches
 * for distinct tickets cannot collide on either branch state or
 * scratch paths.
 *
 * The allocator is intentionally minimal:
 *
 * - One worktree per invocation. The branch is derived from the ticket
 *   identifier and a short timestamp/random suffix so re-runs of the
 *   same ticket get distinct branches.
 * - All allocations live under `<repoRoot>/.dispatch-worktrees/`. The
 *   directory is git-ignored convention; we create the parent on
 *   demand and never reach outside it.
 * - Cleanup is best-effort: on success we remove the worktree (and
 *   delete the branch) so a long-running operator session does not
 *   accumulate state. On failure we leave the worktree on disk and
 *   surface its path so the operator can inspect evidence.
 *
 * The git operations are encapsulated behind a `WorktreeRunner` seam
 * so tests can simulate two simultaneous dispatches without touching
 * the host filesystem's git state.
 */

import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Stable, non-secret-bearing identifier for a single dispatch
 * invocation. Used as a directory name and as part of the branch
 * name; sanitised at construction time.
 */
export interface InvocationId {
  /** Linear ticket identifier in lowercase form, e.g. `lat-138`. */
  ticketSlug: string;
  /** Monotonic suffix that distinguishes re-runs of the same ticket. */
  suffix: string;
}

export interface WorktreeAllocation {
  /** Absolute path to the allocated worktree. Use as cwd for the child. */
  worktreePath: string;
  /** Branch name created for the worktree. */
  branch: string;
  /** Absolute path to the invocation scratch dir (packs/logs/evidence). */
  invocationDir: string;
  /** Echo of the invocation id used to allocate. */
  invocationId: InvocationId;
}

/**
 * Run-a-git-command seam. Returns the exit code; stdout/stderr are
 * intentionally not surfaced — the dispatcher never logs raw git
 * output and only reacts to success/failure.
 */
export type WorktreeRunner = (
  command: 'git',
  args: ReadonlyArray<string>,
  options: { cwd?: string },
) => Promise<{ exitCode: number; stderr: string }>;

export interface WorktreeAllocatorOptions {
  /** Repo root the dispatcher operates in. */
  repoRoot: string;
  /** Base ref for new branches. Defaults to `HEAD`. */
  baseRef?: string;
  /** Test seam: override the git runner. Defaults to spawning git. */
  runner?: WorktreeRunner;
  /** Test seam: override the suffix generator (e.g. for stable IDs in tests). */
  makeSuffix?: () => string;
  /** Subdirectory under repoRoot that holds all worktree allocations. */
  worktreesSubdir?: string;
}

const DEFAULT_WORKTREES_SUBDIR = '.dispatch-worktrees';

export class WorktreeAllocator {
  private readonly repoRoot: string;
  private readonly baseRef: string;
  private readonly runner: WorktreeRunner;
  private readonly makeSuffix: () => string;
  private readonly worktreesRoot: string;
  /**
   * In-process duplicate-dispatch guard. The set holds ticket slugs
   * that are currently allocated. `release` removes them. The
   * dispatcher checks `tryReserve` before doing any expensive work so
   * two concurrent invocations for the same ticket short-circuit on
   * the second caller.
   */
  private readonly inFlight = new Set<string>();

  constructor(opts: WorktreeAllocatorOptions) {
    this.repoRoot = resolve(opts.repoRoot);
    this.baseRef = opts.baseRef ?? 'HEAD';
    this.runner = opts.runner ?? defaultRunner;
    this.makeSuffix = opts.makeSuffix ?? defaultSuffix;
    this.worktreesRoot = join(this.repoRoot, opts.worktreesSubdir ?? DEFAULT_WORKTREES_SUBDIR);
  }

  /**
   * Reserve the in-process slot for a ticket. Returns `false` if the
   * same ticket is already in flight in this process. The caller must
   * pair a successful reservation with a `release` in a finally
   * block, or call `allocate` which handles the lifecycle for it.
   */
  tryReserve(ticketIdentifier: string): boolean {
    const slug = ticketSlugFrom(ticketIdentifier);
    if (this.inFlight.has(slug)) return false;
    this.inFlight.add(slug);
    return true;
  }

  /** Release a reservation. Safe to call even if no reservation exists. */
  release(ticketIdentifier: string): void {
    this.inFlight.delete(ticketSlugFrom(ticketIdentifier));
  }

  /**
   * Allocate a fresh worktree + branch + invocation scratch dir for
   * this dispatch. The caller MUST have first obtained a reservation
   * via `tryReserve`; `allocate` does not re-check the slot to keep
   * the duplicate-prevention semantics explicit at the call site.
   */
  async allocate(ticketIdentifier: string): Promise<WorktreeAllocation> {
    const slug = ticketSlugFrom(ticketIdentifier);
    const suffix = this.makeSuffix();
    const invocationId: InvocationId = { ticketSlug: slug, suffix };
    const dirName = `${slug}-${suffix}`;
    const worktreePath = join(this.worktreesRoot, dirName);
    const invocationDir = join(worktreePath, '.dispatch-invocation');
    const branch = `dispatch/${slug}-${suffix}`;

    await mkdir(this.worktreesRoot, { recursive: true });

    const addRes = await this.runner(
      'git',
      ['worktree', 'add', '-b', branch, worktreePath, this.baseRef],
      { cwd: this.repoRoot },
    );
    if (addRes.exitCode !== 0) {
      throw new Error(
        `git worktree add failed (exit ${addRes.exitCode}): ${shortGitError(addRes.stderr)}`,
      );
    }

    await mkdir(invocationDir, { recursive: true });

    return { worktreePath, branch, invocationDir, invocationId };
  }

  /**
   * Best-effort cleanup. Removes the worktree via git, then deletes
   * the branch. Errors are swallowed and surfaced via the returned
   * status so the caller can decide whether to log; the dispatcher
   * intentionally never aborts a run because cleanup failed.
   */
  async cleanup(allocation: WorktreeAllocation): Promise<{ removed: boolean; reason?: string }> {
    const removeRes = await this.runner(
      'git',
      ['worktree', 'remove', '--force', allocation.worktreePath],
      { cwd: this.repoRoot },
    );
    if (removeRes.exitCode !== 0) {
      // Fall back to filesystem removal so we don't leak directories
      // when git is unhappy (e.g. submodule weirdness).
      await rm(allocation.worktreePath, { recursive: true, force: true });
    }
    const branchRes = await this.runner('git', ['branch', '-D', allocation.branch], {
      cwd: this.repoRoot,
    });
    if (branchRes.exitCode !== 0) {
      return {
        removed: removeRes.exitCode === 0,
        reason: `branch delete failed (exit ${branchRes.exitCode})`,
      };
    }
    return { removed: true };
  }
}

function ticketSlugFrom(identifier: string): string {
  // Linear identifiers look like LAT-138. Lowercase, strip anything
  // that isn't [a-z0-9-] so the slug is safe in directory and branch
  // names regardless of where the identifier came from.
  return identifier.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function defaultSuffix(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now}-${rand}`;
}

function defaultRunner(
  _command: 'git',
  args: ReadonlyArray<string>,
  options: { cwd?: string },
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('git', [...args], {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.stdout.on('data', () => {
      // discard; dispatcher never echoes raw git stdout
    });
    child.on('error', () => {
      resolvePromise({ exitCode: 1, stderr });
    });
    child.on('close', (code) => {
      resolvePromise({ exitCode: typeof code === 'number' ? code : 1, stderr });
    });
  });
}

function shortGitError(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed.length === 0) return '(no stderr)';
  // Keep the first line only; git already writes a useful one-liner
  // for the common failure modes (branch exists, path exists, etc.).
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? '';
  return firstLine.length > 200 ? firstLine.slice(0, 200) + '…' : firstLine;
}
