/**
 * Tests for the real coding-agent invocation adapter (LAT-61).
 *
 * Covers:
 *  - Pre-flight refusals for the ADR-0013 minimum run contract.
 *  - Provider error mapping → structured AgentInvocationResult.
 *  - Typed provider refusals → structured AgentInvocationResult.
 *  - Secret scrubbing on provider-surfaced text.
 *  - JSON envelope parsing (last-JSON-line semantics).
 *  - The command provider's spawn/stdin/stdout/stderr lifecycle, using an
 *    injected `SpawnLike` so no real process is spawned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createCodingAgentAdapter,
  createCommandCodingAgentProvider,
  parseProviderEnvelope,
  scrubSecrets,
  type CodingAgentProvider,
  type CodingAgentProviderRequest,
  type CodingAgentProviderResult,
  type SerialisedProviderRequest,
  type SpawnLike,
  type SpawnedLike,
} from "./agent-invocation-adapter.js";
import type { AgentInvocationRequest } from "../runtime/contract.js";

type ReqOverride = {
  [K in keyof AgentInvocationRequest]?: AgentInvocationRequest[K] | undefined;
};

function validRequest(overrides: ReqOverride = {}): AgentInvocationRequest {
  const base: AgentInvocationRequest = {
    agent_type: "coding",
    linear_issue_id: "LAT-61",
    autonomy_level: "L3-with-approval",
    approve: true,
    dry_run: false,
    repo: "BenjaminDElliott/latentspacelabs",
    branch_target: "main",
    branch_naming: "lat-61-<slug>",
    ticket_context: {
      title: "Implement real coding-agent invocation adapter",
      summary: "Replace the LAT-52 stub with a real provider binding.",
      guardrails: ["No auto-merge."],
      non_goals: [],
    },
    budget_cap_usd: 20,
    cost_band_observed: "normal",
    skill_name_and_version: "dispatch-ticket@0.2.0",
    run_id: "run-test-1",
  };
  const out = { ...base } as AgentInvocationRequest & Record<string, unknown>;
  for (const key of Object.keys(overrides) as Array<keyof AgentInvocationRequest>) {
    const v = overrides[key];
    if (v === undefined) {
      delete (out as Record<string, unknown>)[key as string];
    } else {
      (out as Record<string, unknown>)[key as string] = v;
    }
  }
  return out;
}

function echoRunProvider(): CodingAgentProvider {
  return {
    id: "test-echo",
    async dispatch(req: CodingAgentProviderRequest): Promise<CodingAgentProviderResult> {
      return {
        kind: "run",
        exit_signal: "succeeded",
        pr_url: `https://github.com/${req.repo}/pull/61`,
        pr_branch: req.branch_naming,
        commit_sha: "abcdef0",
        cost_band: "normal",
        spent_usd: 1.23,
        notes: [`echo provider dispatched ${req.linear_issue_id}`],
      };
    },
  };
}

test("adapter refuses when approve=false (missing_approval, needs_human)", async () => {
  const adapter = createCodingAgentAdapter({ provider: echoRunProvider() });
  const res = await adapter.invoke(validRequest({ approve: false }));
  assert.equal(res.exit_signal, "needs_human");
  assert.equal(res.pr_url, null);
  assert.equal(res.cost_band, "unknown");
  assert.match(res.notes.join(" "), /missing_approval/);
});

test("adapter refuses when repo is missing (missing_repo, failed)", async () => {
  const adapter = createCodingAgentAdapter({ provider: echoRunProvider() });
  const res = await adapter.invoke(validRequest({ repo: undefined }));
  assert.equal(res.exit_signal, "failed");
  assert.match(res.notes.join(" "), /missing_repo/);
});

test("adapter refuses when repo is malformed", async () => {
  const adapter = createCodingAgentAdapter({ provider: echoRunProvider() });
  const res = await adapter.invoke(validRequest({ repo: "not-a-slash-pair" }));
  assert.equal(res.exit_signal, "failed");
  assert.match(res.notes.join(" "), /missing_repo/);
});

test("adapter refuses when budget_cap_usd is missing (needs_human)", async () => {
  const adapter = createCodingAgentAdapter({ provider: echoRunProvider() });
  const res = await adapter.invoke(validRequest({ budget_cap_usd: null }));
  assert.equal(res.exit_signal, "needs_human");
  assert.match(res.notes.join(" "), /missing_budget_cap/);
});

test("adapter refuses when cost_band_observed is runaway_risk", async () => {
  const adapter = createCodingAgentAdapter({ provider: echoRunProvider() });
  const res = await adapter.invoke(
    validRequest({ cost_band_observed: "runaway_risk" }),
  );
  assert.equal(res.exit_signal, "needs_human");
  assert.match(res.notes.join(" "), /cost_runaway_risk/);
});

test("adapter refuses when ticket_context.title is missing", async () => {
  const adapter = createCodingAgentAdapter({ provider: echoRunProvider() });
  const res = await adapter.invoke(validRequest({ ticket_context: undefined }));
  assert.equal(res.exit_signal, "failed");
  assert.match(res.notes.join(" "), /missing_minimum_context/);
});

test("adapter refuses when skill_name_and_version is missing", async () => {
  const adapter = createCodingAgentAdapter({ provider: echoRunProvider() });
  const res = await adapter.invoke(
    validRequest({ skill_name_and_version: undefined }),
  );
  assert.equal(res.exit_signal, "failed");
  assert.match(res.notes.join(" "), /missing_minimum_context/);
});

test("adapter forwards valid request to provider and returns run result", async () => {
  let observed: CodingAgentProviderRequest | null = null;
  const adapter = createCodingAgentAdapter({
    provider: {
      id: "capture",
      async dispatch(req) {
        observed = req;
        return {
          kind: "run",
          exit_signal: "succeeded",
          pr_url: `https://github.com/${req.repo}/pull/61`,
          pr_branch: `lat-${req.linear_issue_id.toLowerCase()}-impl`,
          commit_sha: "deadbeef",
          cost_band: "normal",
          spent_usd: 0.5,
          notes: [],
        };
      },
    },
  });
  const res = await adapter.invoke(validRequest());
  assert.equal(res.exit_signal, "succeeded");
  assert.equal(res.pr_url, "https://github.com/BenjaminDElliott/latentspacelabs/pull/61");
  assert.equal(res.pr_branch, "lat-lat-61-impl");
  assert.equal(res.commit_sha, "deadbeef");
  assert.equal(res.cost_band, "normal");
  assert.ok(observed);
  const seen = observed as unknown as CodingAgentProviderRequest;
  assert.equal(seen.repo, "BenjaminDElliott/latentspacelabs");
  assert.equal(seen.budget_cap_usd, 20);
  assert.equal(seen.skill_name_and_version, "dispatch-ticket@0.2.0");
  assert.equal(seen.approve, true);
});

test("adapter maps provider-side refusal to AgentInvocationResult", async () => {
  const adapter = createCodingAgentAdapter({
    provider: {
      id: "refuser",
      async dispatch() {
        return {
          kind: "refusal",
          reason: "provider_refused",
          message: "Unsupported ticket shape for this provider.",
          exit_signal: "needs_human",
        };
      },
    },
  });
  const res = await adapter.invoke(validRequest());
  assert.equal(res.exit_signal, "needs_human");
  assert.equal(res.pr_url, null);
  assert.match(res.notes.join(" "), /provider_refused/);
});

test("adapter converts provider exception to provider_error refusal", async () => {
  const adapter = createCodingAgentAdapter({
    provider: {
      id: "thrower",
      async dispatch() {
        throw new Error("network down");
      },
    },
  });
  const res = await adapter.invoke(validRequest());
  assert.equal(res.exit_signal, "failed");
  assert.match(res.notes.join(" "), /provider_error/);
  assert.match(res.notes.join(" "), /network down/);
});

test("adapter scrubs secret-shaped tokens from provider notes", async () => {
  const adapter = createCodingAgentAdapter({
    provider: {
      id: "leaky",
      async dispatch() {
        return {
          kind: "run",
          exit_signal: "succeeded",
          pr_url: null,
          notes: [
            "Authorization: Bearer agp_LEAKED_EXAMPLE_TOKEN_VALUE",
            "lin_api_LEAKED_EXAMPLE_LINEAR_KEY somewhere in the message",
          ],
        };
      },
    },
  });
  const res = await adapter.invoke(validRequest());
  const joined = res.notes.join(" ");
  assert.doesNotMatch(joined, /agp_LEAKED/);
  assert.doesNotMatch(joined, /lin_api_LEAKED/);
  assert.match(joined, /<redacted>/);
});

test("adapter scrubs extra operator-supplied patterns", async () => {
  const adapter = createCodingAgentAdapter({
    provider: {
      id: "leaky",
      async dispatch() {
        return {
          kind: "run",
          exit_signal: "succeeded",
          notes: ["custom-prefix-ABCDEFGHIJ"],
        };
      },
    },
    extraSecretPatterns: [/custom-prefix-[A-Z]+/g],
  });
  const res = await adapter.invoke(validRequest());
  assert.match(res.notes.join(" "), /<redacted>/);
});

test("adapter events fire on refusal and success paths", async () => {
  const events: Array<{ type: string }> = [];
  const adapter = createCodingAgentAdapter({
    provider: echoRunProvider(),
    onEvent: (e) => events.push(e),
  });
  await adapter.invoke(validRequest());
  await adapter.invoke(validRequest({ approve: false }));
  const types = events.map((e) => e.type);
  assert.ok(types.includes("invocation_started"));
  assert.ok(types.includes("invocation_ok"));
  assert.ok(types.includes("invocation_refused"));
});

test("parseProviderEnvelope reads the last JSON line of stdout", () => {
  const stdout = [
    "noise before",
    '{"level":"info","msg":"starting"}',
    "more noise",
    '{"kind":"run","exit_signal":"succeeded","pr_url":"https://x/1","notes":["ok"]}',
    "",
  ].join("\n");
  const parsed = parseProviderEnvelope(stdout);
  assert.ok(parsed);
  assert.equal(parsed!.kind, "run");
  if (parsed!.kind === "run") {
    assert.equal(parsed!.exit_signal, "succeeded");
    assert.equal(parsed!.pr_url, "https://x/1");
  }
});

test("parseProviderEnvelope accepts a refusal envelope", () => {
  const stdout = '{"kind":"refusal","reason":"provider_refused","message":"nope","exit_signal":"needs_human"}';
  const parsed = parseProviderEnvelope(stdout);
  assert.ok(parsed);
  assert.equal(parsed!.kind, "refusal");
});

test("parseProviderEnvelope rejects unknown kinds and malformed exits", () => {
  assert.equal(parseProviderEnvelope('{"kind":"mystery"}'), null);
  assert.equal(parseProviderEnvelope('{"kind":"run","exit_signal":"maybe"}'), null);
  assert.equal(parseProviderEnvelope("not json at all"), null);
  assert.equal(parseProviderEnvelope(""), null);
});

test("scrubSecrets redacts bearer tokens and known prefixes", () => {
  const s = scrubSecrets(
    "Authorization: Bearer abc.def-123 and key lin_api_exampleValue plus ghp_deadbeefExample",
  );
  assert.doesNotMatch(s, /Bearer abc/);
  assert.doesNotMatch(s, /lin_api_example/);
  assert.doesNotMatch(s, /ghp_deadbeef/);
});

/* ------------------------------------------------------------------ */
/* Command provider lifecycle (fake spawn)                             */
/* ------------------------------------------------------------------ */

class FakeChild extends EventEmitter implements SpawnedLike {
  readonly stdin = {
    chunks: [] as string[],
    write: (chunk: string) => {
      (this.stdin.chunks as string[]).push(chunk);
    },
    end: () => {
      /* no-op */
    },
  };
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killed = false;
  kill(_signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    return true;
  }
  emitStdout(s: string) {
    this.stdout.emit("data", s);
  }
  emitStderr(s: string) {
    this.stderr.emit("data", s);
  }
  exit(code: number | null) {
    this.emit("close", code);
  }
}

test("command provider writes JSON request to stdin and parses stdout", async () => {
  const child = new FakeChild();
  const spawnCalls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
  const fakeSpawn: SpawnLike = (command, args) => {
    spawnCalls.push({ command, args });
    return child;
  };
  const provider = createCommandCodingAgentProvider({
    command: "/usr/bin/true",
    args: ["--json"],
    spawn: fakeSpawn,
    env: { CODING_AGENT_DRY: "1" },
  });

  const requestPromise = provider.dispatch({
    linear_issue_id: "LAT-61",
    repo: "BenjaminDElliott/latentspacelabs",
    branch_target: "main",
    branch_naming: "lat-61-<slug>",
    ticket_title: "Implement invocation adapter",
    ticket_summary: "do the thing",
    guardrails: ["no auto-merge"],
    non_goals: [],
    budget_cap_usd: 20,
    cost_band_observed: "normal",
    skill_name_and_version: "dispatch-ticket@0.2.0",
    autonomy_level: "L3-with-approval",
    approve: true,
    run_id: "run-x",
  });

  // Provider writes before the close event fires.
  await new Promise((r) => setImmediate(r));
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0]!.command, "/usr/bin/true");

  const wrote = (child.stdin.chunks as string[])[0];
  assert.ok(wrote);
  const parsedStdin = JSON.parse((wrote as string).trim()) as SerialisedProviderRequest;
  assert.equal(parsedStdin.linear_issue_id, "LAT-61");
  assert.equal(parsedStdin.repo, "BenjaminDElliott/latentspacelabs");
  assert.equal(parsedStdin.schema_version, "1.0.0");

  child.emitStdout(
    '{"kind":"run","exit_signal":"succeeded","pr_url":"https://github.com/x/1","notes":["ok"]}\n',
  );
  child.exit(0);

  const result = await requestPromise;
  assert.equal(result.kind, "run");
  if (result.kind === "run") {
    assert.equal(result.exit_signal, "succeeded");
    assert.equal(result.pr_url, "https://github.com/x/1");
  }
});

test("command provider returns provider_error on non-zero exit", async () => {
  const child = new FakeChild();
  const provider = createCommandCodingAgentProvider({
    command: "/fake",
    spawn: () => child,
  });
  const p = provider.dispatch(makeProviderReq());
  await new Promise((r) => setImmediate(r));
  child.emitStderr("exploded in the middle\n");
  child.exit(2);
  const res = await p;
  assert.equal(res.kind, "refusal");
  if (res.kind === "refusal") {
    assert.equal(res.reason, "provider_error");
    assert.match(res.message, /exited with code 2/);
  }
});

test("command provider returns provider_error when stdout has no JSON", async () => {
  const child = new FakeChild();
  const provider = createCommandCodingAgentProvider({
    command: "/fake",
    spawn: () => child,
  });
  const p = provider.dispatch(makeProviderReq());
  await new Promise((r) => setImmediate(r));
  child.emitStdout("plain text with no json\n");
  child.exit(0);
  const res = await p;
  assert.equal(res.kind, "refusal");
  if (res.kind === "refusal") {
    assert.equal(res.reason, "provider_error");
  }
});

test("command provider refuses when command is empty", async () => {
  const provider = createCommandCodingAgentProvider({
    command: "",
    spawn: () => {
      throw new Error("should not be called");
    },
  });
  const res = await provider.dispatch(makeProviderReq());
  assert.equal(res.kind, "refusal");
  if (res.kind === "refusal") {
    assert.equal(res.reason, "provider_not_configured");
  }
});

test("command provider times out if the process never exits", async () => {
  const child = new FakeChild();
  const provider = createCommandCodingAgentProvider({
    command: "/fake",
    spawn: () => child,
    timeoutMs: 10,
  });
  const res = await provider.dispatch(makeProviderReq());
  assert.equal(res.kind, "refusal");
  if (res.kind === "refusal") {
    assert.equal(res.reason, "provider_timeout");
  }
  assert.equal(child.killed, true);
});

test("command provider forwards provider-side refusal JSON transparently", async () => {
  const child = new FakeChild();
  const provider = createCommandCodingAgentProvider({
    command: "/fake",
    spawn: () => child,
  });
  const p = provider.dispatch(makeProviderReq());
  await new Promise((r) => setImmediate(r));
  child.emitStdout(
    '{"kind":"refusal","reason":"provider_refused","message":"not today","exit_signal":"needs_human"}\n',
  );
  child.exit(0);
  const res = await p;
  assert.equal(res.kind, "refusal");
  if (res.kind === "refusal") {
    assert.equal(res.reason, "provider_refused");
    assert.equal(res.exit_signal, "needs_human");
  }
});

/* ------------------------------------------------------------------ */
/* End-to-end: real adapter wrapping the command provider (fake spawn) */
/* ------------------------------------------------------------------ */

test("end-to-end: valid request flows through adapter → command provider", async () => {
  const child = new FakeChild();
  const provider = createCommandCodingAgentProvider({
    id: "e2e",
    command: "/fake",
    spawn: () => child,
  });
  const adapter = createCodingAgentAdapter({ provider });
  const resultPromise = adapter.invoke(validRequest());
  await new Promise((r) => setImmediate(r));
  child.emitStdout(
    '{"kind":"run","exit_signal":"succeeded","pr_url":"https://x/61","pr_branch":"lat-61-impl","commit_sha":"abc","cost_band":"normal","spent_usd":0.5,"notes":["ok"]}\n',
  );
  child.exit(0);
  const res = await resultPromise;
  assert.equal(res.exit_signal, "succeeded");
  assert.equal(res.pr_url, "https://x/61");
  assert.equal(res.cost_band, "normal");
  assert.equal(res.spent_usd, 0.5);
});

function makeProviderReq(): CodingAgentProviderRequest {
  return {
    linear_issue_id: "LAT-61",
    repo: "BenjaminDElliott/latentspacelabs",
    branch_target: "main",
    branch_naming: "lat-61-<slug>",
    ticket_title: "t",
    ticket_summary: "s",
    guardrails: [],
    non_goals: [],
    budget_cap_usd: 20,
    cost_band_observed: "normal",
    skill_name_and_version: "dispatch-ticket@0.2.0",
    autonomy_level: "L3-with-approval",
    approve: true,
    run_id: "r",
  };
}
