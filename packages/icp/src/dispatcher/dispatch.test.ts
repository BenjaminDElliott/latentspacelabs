import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import {
  resolveDispatcherConfig,
  runDispatcher,
} from "./dispatch.js";
import { WorktreeAllocator } from "./worktree.js";
import type {
  DispatchIssue,
  DispatcherLinearClient,
  DispatcherSpawn,
  DispatcherSpawnedProcess,
} from "./types.js";

function fakeIssue(overrides: Partial<DispatchIssue> = {}): DispatchIssue {
  return {
    identifier: "LAT-126",
    uuid: "uuid-126",
    title: "Implement small focused change",
    description: [
      "## Summary",
      "Make a small focused change.",
      "",
      "## Acceptance Criteria",
      "- [ ] code compiles",
      "- [ ] tests pass",
      "",
      "Description body is long enough to clear the dispatcher minimum size threshold.",
    ].join("\n"),
    stateName: "Backlog",
    stateId: "state-backlog",
    labels: [],
    ...overrides,
  };
}

interface FakeLinearLog {
  reads: string[];
  comments: Array<{ uuid: string; body: string }>;
  states: Array<{ uuid: string; stateId: string }>;
  runRecords: Array<{ title: string; description: string; parentId: string }>;
}

function fakeLinear(
  issuesById: Record<string, DispatchIssue | "missing">,
  log: FakeLinearLog,
  opts: { commentThrows?: boolean; setStateThrows?: boolean; createRunRecordThrows?: boolean } = {},
): DispatcherLinearClient {
  return {
    async readIssue(id) {
      log.reads.push(id);
      const v = issuesById[id];
      if (!v || v === "missing") throw new Error(`unknown issue ${id}`);
      return v;
    },
    async postComment(uuid, body) {
      if (opts.commentThrows) throw new Error("linear-down");
      log.comments.push({ uuid, body });
      return { url: `https://linear.app/issue/${uuid}/comment/1` };
    },
    async setIssueState(uuid, stateId) {
      if (opts.setStateThrows) throw new Error("transition-failed");
      log.states.push({ uuid, stateId });
    },
    async createRunRecord(issue) {
      if (opts.createRunRecordThrows) throw new Error("linear-down");
      log.runRecords.push(issue);
      return { id: `run-record-${issue.parentId}`, url: `https://linear.app/issue/${issue.parentId}/run-record` };
    },
  };
}

interface SpawnPlan {
  stdout: string;
  stderr?: string;
  exitCode: number;
}

function planSpawn(plan: SpawnPlan, captured: { args: ReadonlyArray<string>[]; cwd: (string | undefined)[] }): DispatcherSpawn {
  return (_cmd, args, options) => {
    captured.args.push(args);
    captured.cwd.push(options.cwd);
    const stdoutE = new EventEmitter();
    const stderrE = new EventEmitter();
    const procE = new EventEmitter();
    const child: DispatcherSpawnedProcess = {
      stdout: { on: (e, cb) => { stdoutE.on(e, cb); } },
      stderr: { on: (e, cb) => { stderrE.on(e, cb); } },
      on: (e, cb) => { procE.on(e, cb); },
      kill: () => true,
    };
    setImmediate(() => {
      stdoutE.emit("data", plan.stdout);
      if (plan.stderr) stderrE.emit("data", plan.stderr);
      procE.emit("close", plan.exitCode);
    });
    return child;
  };
}

interface GitCall {
  args: ReadonlyArray<string>;
  cwd: string | undefined;
}

/**
 * Builds a worktree allocator backed by a fake git runner that
 * always succeeds. Suitable for the orchestration tests below where
 * the focus is dispatch behaviour, not git semantics. The git
 * semantics live in worktree.test.ts.
 */
function fakeWorktreeAllocator(repoRoot: string, opts: { gitLog?: GitCall[]; suffix?: () => string } = {}): WorktreeAllocator {
  return new WorktreeAllocator({
    repoRoot,
    runner: async (_cmd, args, options) => {
      opts.gitLog?.push({ args, cwd: options.cwd });
      return { exitCode: 0, stderr: "" };
    },
    makeSuffix: opts.suffix ?? (() => "stable"),
  });
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "lat129-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const READY_JSON = JSON.stringify({
  schemaVersion: "1.0.0",
  evidence: {
    state: "ready_for_review",
    ticket: "LAT-126",
    branch: {
      branch: "lat-126-small-focused-change",
      prTitlePrefix: "LAT-126:",
      prBase: "main",
      prUrl: null,
    },
  },
});

const READY_JSON_NO_BRANCH = JSON.stringify({
  schemaVersion: "1.0.0",
  evidence: { state: "ready_for_review", ticket: "LAT-126" },
});

const READY_JSON_NULL_BRANCH = JSON.stringify({
  schemaVersion: "1.0.0",
  evidence: { state: "ready_for_review", ticket: "LAT-126", branch: null },
});

const READY_JSON_EMPTY_BRANCH = JSON.stringify({
  schemaVersion: "1.0.0",
  evidence: {
    state: "ready_for_review",
    ticket: "LAT-126",
    branch: { branch: "", prTitlePrefix: "LAT-126:", prBase: "main", prUrl: "   " },
  },
});

const FAILED_JSON = JSON.stringify({
  schemaVersion: "1.0.0",
  evidence: { state: "failed", ticket: "LAT-126" },
});

const REFUSED_JSON = JSON.stringify({
  schemaVersion: "1.0.0",
  evidence: { state: "refused", ticket: "LAT-126" },
});

test("runDispatcher: no eligible issue when dispatchIssueId is null", async () => {
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({}, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_TEST_VALUE",
        dispatchIssueId: null,
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "mock",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: READY_JSON, exitCode: 0 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "no_eligible_issue");
    assert.equal(captured.args.length, 0);
    assert.equal(log.reads.length, 0);
    assert.equal(log.comments.length, 0);
    assert.equal(log.states.length, 0);
  });
});

test("runDispatcher: ineligible issue is not dispatched and not promoted", async () => {
  const issue = fakeIssue({ title: "Investigate auth pipeline" });
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "mock",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: READY_JSON, exitCode: 0 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "no_eligible_issue");
    assert.equal(captured.args.length, 0);
    assert.equal(log.comments.length, 0);
    assert.equal(log.states.length, 0);
  });
});

test("runDispatcher: READY_FOR_REVIEW promotes to In Review and writes pack inside worktree", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: [],
        childEnv: { PATH: "/usr/bin" },
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: READY_JSON, exitCode: 0 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "ready_for_review");
    assert.equal(r.promoted, true);
    assert.equal(r.commented, true);
    assert.equal(captured.args.length, 1);
    // Pack file path is inside the per-invocation worktree scratch dir.
    const packPath = r.packPath ?? "";
    assert.ok(packPath.endsWith("lat-126.pack.md"));
    assert.match(packPath, /\.dispatch-worktrees\/lat-126-stable\/\.dispatch-invocation\//);
    const pack = await readFile(packPath, "utf8");
    assert.match(pack, /Linear ID:\*\* LAT-126/);
    // Control loop spawn cwd is the worktree, not the operator repo root.
    assert.match(captured.cwd[0] ?? "", /\.dispatch-worktrees\/lat-126-stable$/);
    assert.equal(log.states.length, 1);
    assert.equal(log.states[0]!.stateId, "state-in-review");
    assert.equal(log.comments.length, 1);
    assert.match(log.comments[0]!.body, /ready_for_review/);
    // LAT-143: comment body must name the exact review target.
    assert.match(log.comments[0]!.body, /Review target/);
    assert.match(log.comments[0]!.body, /lat-126-small-focused-change/);
    // LAT-138: comment body and report carry the worktree branch.
    assert.match(log.comments[0]!.body, /dispatch\/lat-126-stable/);
    assert.equal(r.worktreeBranch, "dispatch/lat-126-stable");
  });
});

test("LAT-140: runDispatcher emits sanitised run artefact and references it in the Linear comment", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[] };
  // The control-loop child echoes a token-shaped substring; the dispatcher
  // must scrub it from the artefact's free-text fields.
  const stdout =
    READY_JSON + "\nfine-grained token ghp_ZZZZZZZZZZZZZZZZZZZZ surfaced\n";
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: ["topsecretvalue1234"],
        childEnv: { PATH: "/usr/bin" },
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout, exitCode: 0 }, { args: captured.args, cwd: [] }),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "ready_for_review");
    // Artefact emitted alongside the pack.
    assert.ok(r.artefactPath, "artefact path should be set");
    assert.ok(r.artefact, "artefact in-memory object should be set");
    assert.equal(r.artefact?.surface, "dispatcher");
    assert.equal(r.artefact?.outcome, "ready_for_review");
    assert.equal(r.artefact?.ticket_id, "LAT-126");
    assert.equal(r.artefact?.artefact_class, "operational_log");
    assert.equal(r.artefact?.training_eligibility, "needs_human_decision");
    // Pack hash recorded.
    assert.match(r.artefact?.pack_sha256 ?? "", /^[0-9a-f]{64}$/);
    // Redaction metadata stamped.
    assert.equal(r.artefact?.redaction.redactor, "dispatcher.redactOutput");
    assert.match(
      r.artefact?.redaction.pre_redaction_payload_sha256 ?? "",
      /^[0-9a-f]{64}$/,
    );
    // Persisted artefact JSON exists and contains no token-shaped substring.
    const json = await readFile(r.artefactPath!, "utf8");
    assert.doesNotMatch(json, /ghp_ZZZZZZZZZZZZZZZZZZZZ/);
    assert.doesNotMatch(json, /topsecretvalue1234/);
    // Linear comment carries the compact artefact reference.
    assert.equal(log.comments.length, 1);
    const body = log.comments[0]!.body;
    assert.match(body, /Artefact \(LAT-140\):/);
    assert.match(body, /payload-sha256: `[0-9a-f]{12}`/);
    // Comment must not echo the secret either.
    assert.doesNotMatch(body, /topsecretvalue1234/);
    assert.doesNotMatch(body, /ghp_ZZZZZZZZZZZZZZZZZZZZ/);
  });
});

test("LAT-140: refused run still produces an artefact with a refusal code", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[] };
  const refusedJson = JSON.stringify({
    schemaVersion: "1.0.0",
    evidence: {
      state: "refused",
      ticket: "LAT-126",
      refusals: [{ code: "missing_runtime_config", message: "no provider" }],
    },
  });
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: refusedJson, exitCode: 2 }, { args: captured.args, cwd: [] }),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "refused");
    assert.equal(r.artefact?.outcome, "refused");
    assert.equal(r.artefact?.refusal_code, "missing_runtime_config");
    assert.equal(r.artefact?.refusal_message, "no provider");
    assert.equal(r.promoted, false);
  });
});

test("runDispatcher: failed run posts comment but does NOT promote", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: FAILED_JSON, exitCode: 3 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "failed");
    assert.equal(r.promoted, false);
    assert.equal(r.commented, true);
    assert.equal(log.states.length, 0);
  });
});

test("runDispatcher: refused run posts comment, no promotion", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "mock",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: REFUSED_JSON, exitCode: 2 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "refused");
    assert.equal(r.promoted, false);
    assert.equal(r.commented, true);
    assert.equal(log.states.length, 0);
  });
});

test("runDispatcher: comment body is sanitised before write-back", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    await runDispatcher({
      config: {
        linearApiKey: "lin_api_REDACTABLE",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: ["lin_api_REDACTABLE", "RUNPOD_API_VAL_xxxxxxxxxxxx"],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn(
          {
            stdout:
              "Connecting to https://api.runpod.io/v2/abc with Authorization: lin_api_REDACTABLE\n" +
              READY_JSON,
            stderr: "RUNPOD_API_VAL_xxxxxxxxxxxx leaked",
            exitCode: 0,
          },
          captured,
        ),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(log.comments.length, 1);
    const body = log.comments[0]!.body;
    assert.doesNotMatch(body, /lin_api_REDACTABLE/);
    assert.doesNotMatch(body, /api\.runpod\.io/);
    assert.doesNotMatch(body, /RUNPOD_API_VAL_xxxxxxxxxxxx/);
    assert.match(body, /<redacted/);
  });
});

test("runDispatcher: missing config produces config_error via resolveDispatcherConfig", () => {
  const r = resolveDispatcherConfig(
    { LAT_DISPATCH_ISSUE: "LAT-126" },
    { repoRoot: "/repo", controlLoopCliPath: "/cli.js" },
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.missing, ["LINEAR_API_KEY"]);
});

test("resolveDispatcherConfig: forwards safe env, never LINEAR_API_KEY", () => {
  const r = resolveDispatcherConfig(
    {
      LINEAR_API_KEY: "lin_api_TEST",
      LAT_DISPATCH_ISSUE: "LAT-126",
      LAT_DISPATCH_MODE: "live",
      RUNPOD_API_KEY: "RUNPOD_TEST",
      RUNPOD_POD_ID: "pod_test_1234",
      PATH: "/usr/bin",
      HOME: "/home/user",
      SOMETHING_ELSE: "ignored",
    },
    { repoRoot: "/repo", controlLoopCliPath: "/cli.js" },
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.config.mode, "live");
  assert.equal(r.config.dispatchIssueId, "LAT-126");
  assert.equal(r.config.childEnv["LINEAR_API_KEY"], undefined);
  assert.equal(r.config.childEnv["RUNPOD_API_KEY"], "RUNPOD_TEST");
  assert.equal(r.config.childEnv["PATH"], "/usr/bin");
  assert.equal(r.config.childEnv["SOMETHING_ELSE"], undefined);
  // Linear key value is in extraSecrets so it gets scrubbed from output.
  assert.ok(r.config.extraSecrets.includes("lin_api_TEST"));
  assert.ok(r.config.extraSecrets.includes("RUNPOD_TEST"));
});

test("runDispatcher: read-issue failure returns failed outcome with no spawn", async () => {
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear: DispatcherLinearClient = {
    async readIssue() {
      throw new Error("issue not found");
    },
    async postComment() {
      log.comments.push({ uuid: "?", body: "?" });
      return { url: "x" };
    },
    async setIssueState() {
      log.states.push({ uuid: "?", stateId: "?" });
    },
  };
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "mock",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: READY_JSON, exitCode: 0 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "failed");
    assert.equal(captured.args.length, 0);
    assert.equal(log.comments.length, 0);
    assert.equal(log.states.length, 0);
  });
});

test("runDispatcher: comment-failure on READY does not silently promote", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log, { commentThrows: true });
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "mock",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: READY_JSON, exitCode: 0 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "ready_for_review");
    assert.equal(r.commented, false);
    assert.equal(r.promoted, false);
    assert.equal(log.states.length, 0);
  });
});

test("runDispatcher: command construction passes pack path and mode", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/abs/control-loop/dist/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: READY_JSON, exitCode: 0 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(captured.args.length, 1);
    const args = captured.args[0]!;
    assert.equal(args[0], "/abs/control-loop/dist/cli.js");
    assert.match(args[1] ?? "", /lat-126\.pack\.md$/);
    assert.equal(args[2], "--mode");
    assert.equal(args[3], "live");
    assert.equal(args[4], "--format");
    assert.equal(args[5], "json");
  });
});

// LAT-143 regression coverage: a `ready_for_review` summary that has no
// branch evidence at all (the LAT-127 ready-with-no-branch/PR shape)
// must NOT promote the issue.
test("runDispatcher: LAT-143 ready_for_review with NO branch evidence is downgraded to no_review_artifact and not promoted", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: READY_JSON_NO_BRANCH, exitCode: 0 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "no_review_artifact");
    assert.equal(r.promoted, false);
    assert.equal(r.commented, true);
    assert.equal(log.states.length, 0, "must not promote when no review target exists");
    assert.match(r.message, /no actionable review artifact/i);
    // Comment body must explain the exact review target (or its absence).
    const body = log.comments[0]!.body;
    assert.match(body, /Review target/);
    assert.match(body, /none/);
    assert.match(body, /LAT-143/);
  });
});

test("runDispatcher: LAT-143 ready_for_review with explicit `branch: null` is not promoted", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: READY_JSON_NULL_BRANCH, exitCode: 0 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "no_review_artifact");
    assert.equal(r.promoted, false);
    assert.equal(log.states.length, 0);
  });
});

test("runDispatcher: LAT-143 ready_for_review with empty/whitespace branch + prUrl is not promoted", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: READY_JSON_EMPTY_BRANCH, exitCode: 0 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "no_review_artifact");
    assert.equal(r.promoted, false);
    assert.equal(log.states.length, 0);
  });
});

test("runDispatcher: LAT-143 ready_for_review with PR URL only (no branch ref) promotes and reports the PR", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  const summary = JSON.stringify({
    schemaVersion: "1.0.0",
    evidence: {
      state: "ready_for_review",
      ticket: "LAT-126",
      branch: { prUrl: "https://github.com/example/repo/pull/42" },
    },
  });
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: summary, exitCode: 0 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "ready_for_review");
    assert.equal(r.promoted, true);
    assert.match(log.comments[0]!.body, /pull\/42/);
  });
});

test("runDispatcher: LAT-143 ready_for_review with patch artifact (no branch / no PR) promotes and names the patch path", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  const summary = JSON.stringify({
    schemaVersion: "1.0.0",
    evidence: {
      state: "ready_for_review",
      ticket: "LAT-126",
      branch: { branch: null, prUrl: null, patchPath: "/tmp/lat-126.patch" },
    },
  });
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: summary, exitCode: 0 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "ready_for_review");
    assert.equal(r.promoted, true);
    assert.match(log.comments[0]!.body, /lat-126\.patch/);
  });
});

test("runDispatcher: LAT-143 ready_for_review with explicit local diff path promotes and names it", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  const summary = JSON.stringify({
    schemaVersion: "1.0.0",
    evidence: {
      state: "ready_for_review",
      ticket: "LAT-126",
      branch: { branch: null, prUrl: null, diffPath: "/tmp/lat-126.diff" },
    },
  });
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: summary, exitCode: 0 }, captured),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "ready_for_review");
    assert.equal(r.promoted, true);
    assert.match(log.comments[0]!.body, /lat-126\.diff/);
  });
});

// Defense-in-depth: even if the JSON summary fails to parse but the
// child exited 0 (which mapStateToOutcome treats as ready_for_review),
// there is still no review artifact, so we must refuse to promote.
test("runDispatcher: LAT-143 exit-0 with unparseable summary is treated as no_review_artifact, not silently promoted", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn(
          { stdout: "this is not json at all", exitCode: 0 },
          captured,
        ),
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(r.outcome, "no_review_artifact");
    assert.equal(r.promoted, false);
    assert.equal(log.states.length, 0);
  });
});

test("runDispatcher: two simulated dispatches use distinct branches and worktree dirs", async () => {
  // LAT-138 acceptance: two dispatches in the same process must not
  // share branch state or scratch paths. We run them sequentially
  // (the dispatcher has no internal concurrency) but the allocator
  // hands out distinct identifiers, and the orchestration threads
  // them through pack paths, child cwd, and Linear comments.
  const issueA = fakeIssue({ identifier: "LAT-100", uuid: "uuid-100" });
  const issueB = fakeIssue({ identifier: "LAT-200", uuid: "uuid-200" });
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-100": issueA, "LAT-200": issueB }, log);
  const capA = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  const capB = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    let n = 0;
    const allocator = fakeWorktreeAllocator(dir, {
      suffix: () => {
        n += 1;
        return `r${n}`;
      },
    });
    const baseConfig = {
      linearApiKey: "lin_api_X",
      inReviewStateId: "state-in-review",
      controlLoopCliPath: "/cli.js",
      repoRoot: dir,
      mode: "live" as const,
      extraSecrets: [],
      childEnv: {},
    };
    const ra = await runDispatcher({
      config: { ...baseConfig, dispatchIssueId: "LAT-100" },
      deps: {
        linear,
        spawn: planSpawn(
          {
            stdout: JSON.stringify({
              schemaVersion: "1.0.0",
              evidence: {
                state: "ready_for_review",
                ticket: "LAT-100",
                branch: { branch: "lat-100-stub", prUrl: null },
              },
            }),
            exitCode: 0,
          },
          capA,
        ),
        worktree: allocator,
      },
    });
    const rb = await runDispatcher({
      config: { ...baseConfig, dispatchIssueId: "LAT-200" },
      deps: {
        linear,
        spawn: planSpawn(
          {
            stdout: JSON.stringify({
              schemaVersion: "1.0.0",
              evidence: {
                state: "ready_for_review",
                ticket: "LAT-200",
                branch: { branch: "lat-200-stub", prUrl: null },
              },
            }),
            exitCode: 0,
          },
          capB,
        ),
        worktree: allocator,
      },
    });
    assert.equal(ra.outcome, "ready_for_review");
    assert.equal(rb.outcome, "ready_for_review");
    assert.notEqual(ra.worktreeBranch, rb.worktreeBranch);
    assert.notEqual(ra.worktreePath, rb.worktreePath);
    assert.notEqual(ra.packPath, rb.packPath);
    assert.match(ra.worktreeBranch ?? "", /dispatch\/lat-100-/);
    assert.match(rb.worktreeBranch ?? "", /dispatch\/lat-200-/);
    // Each control-loop spawn ran in its own worktree cwd.
    assert.notEqual(capA.cwd[0], capB.cwd[0]);
    assert.match(capA.cwd[0] ?? "", /lat-100-/);
    assert.match(capB.cwd[0] ?? "", /lat-200-/);
  });
});

test("runDispatcher: refuses duplicate dispatch of same ticket while in flight", async () => {
  // LAT-138 acceptance: the in-process duplicate guard short-circuits
  // a second invocation for the same ticket while the first has not
  // yet released its reservation. We simulate "in flight" by manually
  // pre-reserving the slot before calling runDispatcher.
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  await withTempDir(async (dir) => {
    const allocator = fakeWorktreeAllocator(dir);
    // Simulate the first dispatch having already reserved the slot.
    assert.equal(allocator.tryReserve("LAT-126"), true);
    const r = await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "mock",
        extraSecrets: [],
        childEnv: {},
      },
      deps: {
        linear,
        spawn: planSpawn({ stdout: READY_JSON, exitCode: 0 }, captured),
        worktree: allocator,
      },
    });
    assert.equal(r.outcome, "duplicate_in_flight");
    // Did not spawn the control loop, did not touch Linear.
    assert.equal(captured.args.length, 0);
    assert.equal(log.reads.length, 0);
    assert.equal(log.comments.length, 0);
    assert.equal(log.states.length, 0);
  });
});

test("runDispatcher: forwards CONTROL_LOOP_WORKDIR to the control loop env", async () => {
  const issue = fakeIssue();
  const log: FakeLinearLog = { reads: [], comments: [], states: [], runRecords: []};
  const linear = fakeLinear({ "LAT-126": issue }, log);
  const captured = { args: [] as ReadonlyArray<string>[], cwd: [] as (string | undefined)[] };
  // Capture env separately by augmenting the spawn factory.
  const envSeen: Record<string, string | undefined>[] = [];
  await withTempDir(async (dir) => {
    const spawnImpl: DispatcherSpawn = (cmd, args, options) => {
      envSeen.push(options.env ?? {});
      return planSpawn({ stdout: READY_JSON, exitCode: 0 }, captured)(cmd, args, options);
    };
    await runDispatcher({
      config: {
        linearApiKey: "lin_api_X",
        dispatchIssueId: "LAT-126",
        inReviewStateId: "state-in-review",
        controlLoopCliPath: "/cli.js",
        repoRoot: dir,
        mode: "live",
        extraSecrets: [],
        childEnv: { PATH: "/usr/bin" },
      },
      deps: {
        linear,
        spawn: spawnImpl,
        worktree: fakeWorktreeAllocator(dir),
      },
    });
    assert.equal(envSeen.length, 1);
    const env = envSeen[0]!;
    assert.equal(env["PATH"], "/usr/bin");
    assert.match(env["CONTROL_LOOP_WORKDIR"] ?? "", /\.dispatch-worktrees\/lat-126-stable$/);
  });
});
