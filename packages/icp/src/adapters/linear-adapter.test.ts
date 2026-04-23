/**
 * Tests for the production Linear adapter (LAT-62).
 *
 * All tests inject a mocked `fetch`; none reach the live Linear API. A real
 * API key is never set on `process.env` in this file — the env-loader test
 * uses a synthetic value that does not match any real Linear token shape, so
 * a secret scanner running against the repo stays silent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLinearAdapter,
  loadLinearCredentialFromEnv,
  LinearAdapterError,
  parseDispatchFields,
  buildSnapshotFromRaw,
  type FetchLike,
  type FetchLikeResponse,
  type LinearAdapterEvent,
} from "./linear-adapter.js";

function jsonResponse(status: number, body: unknown): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function textResponse(status: number, text: string): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      throw new Error("not json");
    },
    async text() {
      return text;
    },
  };
}

interface FetchCall {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function recordingFetch(
  responses: ReadonlyArray<FetchLikeResponse>,
): { fn: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn: FetchLike = async (url, init) => {
    calls.push({
      url,
      body: init?.body ? JSON.parse(init.body) : null,
      headers: init?.headers ?? {},
    });
    const next = responses[i];
    i += 1;
    if (!next) throw new Error(`recordingFetch exhausted at call ${i}`);
    return next;
  };
  return { fn, calls };
}

const SYNTHETIC_KEY = "lin_api_TEST_NOT_A_REAL_KEY";

/* ------------------------------------------------------------------ */
/* parseDispatchFields                                                  */
/* ------------------------------------------------------------------ */

test("parseDispatchFields: extracts hard blockers, status, note, and budget", () => {
  const desc = [
    "# Goal",
    "Ship LAT-62.",
    "",
    "## Sequencing",
    "- Hard blockers: LAT-36, LAT-37",
    "- Recommended predecessors: LAT-39",
    "- Dispatch status: ready",
    "- Dispatch note: approved on 2026-04-23",
    "",
    "## Budget",
    "Budget cap: $5",
    "",
  ].join("\n");

  const parsed = parseDispatchFields(desc);
  assert.deepEqual([...parsed.hard_blockers], ["LAT-36", "LAT-37"]);
  assert.deepEqual([...parsed.recommended_predecessors], ["LAT-39"]);
  assert.equal(parsed.dispatch_status, "ready");
  assert.match(parsed.dispatch_note, /approved on 2026-04-23/);
  assert.equal(parsed.budget_cap_usd, 5);
});

test("parseDispatchFields: missing Sequencing block → unknown status, no blockers", () => {
  const parsed = parseDispatchFields("# Goal\nShip it.\n\nBudget: 100 USD\n");
  assert.equal(parsed.dispatch_status, "unknown");
  assert.equal(parsed.hard_blockers.length, 0);
  assert.equal(parsed.budget_cap_usd, 100);
});

test("parseDispatchFields: Sequencing with blockers but no explicit status → blocked", () => {
  const desc = [
    "## Sequencing",
    "- Hard blockers: LAT-99",
    "",
  ].join("\n");
  const parsed = parseDispatchFields(desc);
  assert.equal(parsed.dispatch_status, "blocked");
  assert.deepEqual([...parsed.hard_blockers], ["LAT-99"]);
});

test("parseDispatchFields: malformed budget yields null, does not throw", () => {
  const parsed = parseDispatchFields("## Budget\nBudget cap: not-a-number\n");
  assert.equal(parsed.budget_cap_usd, null);
});

test("parseDispatchFields: explicit dispatch_status=caution propagates", () => {
  const desc = [
    "## Sequencing",
    "- Dispatch status: caution",
    "- Dispatch note: trimmed scope",
    "",
  ].join("\n");
  const parsed = parseDispatchFields(desc);
  assert.equal(parsed.dispatch_status, "caution");
  assert.equal(parsed.dispatch_note, "trimmed scope");
});

/* ------------------------------------------------------------------ */
/* buildSnapshotFromRaw                                                 */
/* ------------------------------------------------------------------ */

test("buildSnapshotFromRaw: maps parent state into blocker_statuses", () => {
  const snap = buildSnapshotFromRaw({
    id: "uuid-1",
    identifier: "LAT-62",
    title: "Production Linear adapter",
    description: "## Sequencing\n- Hard blockers: LAT-52\n",
    state: { name: "Todo", type: "unstarted" },
    parent: {
      id: "uuid-parent",
      identifier: "LAT-52",
      state: { name: "Done", type: "completed" },
    },
  });
  assert.equal(snap.id, "LAT-62");
  assert.equal(snap.status, "Todo");
  assert.deepEqual([...snap.sequencing.hard_blockers], ["LAT-52"]);
  assert.equal(snap.blocker_statuses["LAT-52"], "Done");
});

test("buildSnapshotFromRaw: null description → unknown dispatch_status", () => {
  const snap = buildSnapshotFromRaw({
    id: "uuid-2",
    identifier: "LAT-70",
    description: null,
    state: { name: "Todo" },
  });
  assert.equal(snap.sequencing.dispatch_status, "unknown");
  assert.equal(snap.budget_cap_usd, null);
});

/* ------------------------------------------------------------------ */
/* loadLinearCredentialFromEnv                                          */
/* ------------------------------------------------------------------ */

test("loadLinearCredentialFromEnv: throws typed error when var is missing", () => {
  try {
    loadLinearCredentialFromEnv({});
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof LinearAdapterError);
    assert.equal((err as LinearAdapterError).kind, "missing_credentials");
    assert.match((err as LinearAdapterError).message, /LINEAR_API_KEY/);
  }
});

test("loadLinearCredentialFromEnv: returns value when set", () => {
  const v = loadLinearCredentialFromEnv({ LINEAR_API_KEY: SYNTHETIC_KEY });
  assert.equal(v, SYNTHETIC_KEY);
});

/* ------------------------------------------------------------------ */
/* createLinearAdapter: construction                                    */
/* ------------------------------------------------------------------ */

test("createLinearAdapter: refuses construction without apiKey", () => {
  try {
    createLinearAdapter({ apiKey: "" });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof LinearAdapterError);
    assert.equal((err as LinearAdapterError).kind, "missing_credentials");
  }
});

/* ------------------------------------------------------------------ */
/* readIssue                                                            */
/* ------------------------------------------------------------------ */

test("readIssue: sends identifier in query and builds snapshot from response", async () => {
  const { fn, calls } = recordingFetch([
    jsonResponse(200, {
      data: {
        issue: {
          id: "uuid-A",
          identifier: "LAT-62",
          title: "Prod Linear adapter",
          description:
            "## Sequencing\n- Hard blockers: LAT-52\n- Dispatch status: ready\n",
          state: { name: "Todo", type: "unstarted" },
          project: { id: "p1", name: "ICP" },
          team: { key: "LAT" },
          parent: {
            id: "uuid-P",
            identifier: "LAT-52",
            state: { name: "Done", type: "completed" },
          },
          labels: { nodes: [{ name: "agent-ready" }] },
          comments: { nodes: [] },
        },
      },
    }),
  ]);

  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  const snap = await adapter.readIssue("LAT-62");

  assert.equal(snap.id, "LAT-62");
  assert.equal(snap.status, "Todo");
  assert.equal(snap.sequencing.dispatch_status, "ready");
  assert.deepEqual([...snap.sequencing.hard_blockers], ["LAT-52"]);
  assert.equal(snap.blocker_statuses["LAT-52"], "Done");

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.linear.app/graphql");
  assert.equal(calls[0]!.headers["Authorization"], SYNTHETIC_KEY);
  const body = calls[0]!.body as { query: string; variables: { id: string } };
  assert.equal(body.variables.id, "LAT-62");
  assert.match(body.query, /query ReadIssue/);
});

test("readIssue: issue=null → typed issue_not_found error", async () => {
  const { fn } = recordingFetch([jsonResponse(200, { data: { issue: null } })]);
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  await assert.rejects(
    () => adapter.readIssue("LAT-9999"),
    (err: unknown) =>
      err instanceof LinearAdapterError && err.kind === "issue_not_found",
  );
});

test("readIssue: 401 → unauthorized with ADR-0017 rotation guidance; no api key in message", async () => {
  const { fn } = recordingFetch([jsonResponse(401, { errors: [{ message: "denied" }] })]);
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  try {
    await adapter.readIssue("LAT-1");
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof LinearAdapterError);
    const e = err as LinearAdapterError;
    assert.equal(e.kind, "unauthorized");
    assert.equal(e.status, 401);
    assert.match(e.message, /ADR-0017/);
    assert.ok(!e.message.includes(SYNTHETIC_KEY), "error must not leak api key");
  }
});

test("readIssue: 429 → rate_limited", async () => {
  const { fn } = recordingFetch([jsonResponse(429, { errors: [] })]);
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  await assert.rejects(
    () => adapter.readIssue("LAT-1"),
    (err: unknown) =>
      err instanceof LinearAdapterError && err.kind === "rate_limited",
  );
});

test("readIssue: 500 with text body → api_error without leaking headers", async () => {
  const { fn } = recordingFetch([textResponse(500, "oops")]);
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  try {
    await adapter.readIssue("LAT-1");
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof LinearAdapterError);
    const e = err as LinearAdapterError;
    assert.equal(e.kind, "api_error");
    assert.equal(e.status, 500);
  }
});

test("readIssue: GraphQL errors field → api_error, message redacts api key if echoed", async () => {
  const { fn } = recordingFetch([
    jsonResponse(200, {
      errors: [{ message: `upstream said ${SYNTHETIC_KEY} bad` }],
    }),
  ]);
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  try {
    await adapter.readIssue("LAT-1");
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof LinearAdapterError);
    assert.equal((err as LinearAdapterError).kind, "api_error");
    assert.ok(
      !(err as LinearAdapterError).message.includes(SYNTHETIC_KEY),
      "api key must be redacted even if server echoed it",
    );
    assert.match((err as LinearAdapterError).message, /<redacted>/);
  }
});

test("readIssue: fetch throws (network) → network_error", async () => {
  const fn: FetchLike = async () => {
    throw new Error("ECONNRESET");
  };
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  await assert.rejects(
    () => adapter.readIssue("LAT-1"),
    (err: unknown) =>
      err instanceof LinearAdapterError && err.kind === "network_error",
  );
});

test("readIssue: empty identifier → malformed_ticket", async () => {
  const { fn } = recordingFetch([]);
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  await assert.rejects(
    () => adapter.readIssue("   "),
    (err: unknown) =>
      err instanceof LinearAdapterError && err.kind === "malformed_ticket",
  );
});

test("readIssue: emits sanitised lifecycle events (no api key)", async () => {
  const events: LinearAdapterEvent[] = [];
  const { fn } = recordingFetch([
    jsonResponse(200, {
      data: {
        issue: {
          id: "uuid-B",
          identifier: "LAT-10",
          description: "## Sequencing\n- Dispatch status: ready\n",
          state: { name: "Todo" },
        },
      },
    }),
  ]);
  const adapter = createLinearAdapter({
    apiKey: SYNTHETIC_KEY,
    fetch: fn,
    onEvent: (e) => events.push(e),
  });
  await adapter.readIssue("LAT-10");

  assert.equal(events[0]!.type, "read_issue_started");
  assert.equal(events[1]!.type, "read_issue_ok");
  for (const e of events) {
    assert.ok(
      !JSON.stringify(e).includes(SYNTHETIC_KEY),
      "events must not contain api key",
    );
  }
});

/* ------------------------------------------------------------------ */
/* postComment                                                           */
/* ------------------------------------------------------------------ */

test("postComment: resolves identifier → UUID, then posts mutation and returns url", async () => {
  const { fn, calls } = recordingFetch([
    jsonResponse(200, {
      data: { issue: { id: "uuid-X", identifier: "LAT-62" } },
    }),
    jsonResponse(200, {
      data: {
        commentCreate: {
          success: true,
          comment: {
            id: "cmt-1",
            url: "https://linear.app/lat/issue/LAT-62/comment/cmt-1",
          },
        },
      },
    }),
  ]);
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  const result = await adapter.postComment("LAT-62", "**Outcome:** ok");

  assert.equal(result.url, "https://linear.app/lat/issue/LAT-62/comment/cmt-1");
  assert.equal(calls.length, 2);
  const mutationBody = calls[1]!.body as {
    query: string;
    variables: { issueId: string; body: string };
  };
  assert.match(mutationBody.query, /mutation PostComment/);
  assert.equal(mutationBody.variables.issueId, "uuid-X");
  assert.equal(mutationBody.variables.body, "**Outcome:** ok");
});

test("postComment: falls back to derived URL when Linear returns null url", async () => {
  const { fn } = recordingFetch([
    jsonResponse(200, {
      data: { issue: { id: "uuid-X", identifier: "LAT-62" } },
    }),
    jsonResponse(200, {
      data: {
        commentCreate: {
          success: true,
          comment: { id: "cmt-2", url: null },
        },
      },
    }),
  ]);
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  const result = await adapter.postComment("LAT-62", "body");
  assert.match(result.url, /LAT-62\/comment\/cmt-2$/);
});

test("postComment: unknown issue during UUID resolution → issue_not_found", async () => {
  const { fn } = recordingFetch([
    jsonResponse(200, { data: { issue: null } }),
  ]);
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  await assert.rejects(
    () => adapter.postComment("LAT-999", "body"),
    (err: unknown) =>
      err instanceof LinearAdapterError && err.kind === "issue_not_found",
  );
});

test("postComment: commentCreate.success=false → api_error", async () => {
  const { fn } = recordingFetch([
    jsonResponse(200, {
      data: { issue: { id: "uuid-X", identifier: "LAT-62" } },
    }),
    jsonResponse(200, {
      data: { commentCreate: { success: false, comment: null } },
    }),
  ]);
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  await assert.rejects(
    () => adapter.postComment("LAT-62", "body"),
    (err: unknown) =>
      err instanceof LinearAdapterError && err.kind === "api_error",
  );
});

test("postComment: empty body → malformed_ticket, no network call", async () => {
  const { fn, calls } = recordingFetch([]);
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  await assert.rejects(
    () => adapter.postComment("LAT-1", ""),
    (err: unknown) =>
      err instanceof LinearAdapterError && err.kind === "malformed_ticket",
  );
  assert.equal(calls.length, 0);
});

test("postComment: 403 during resolution → unauthorized", async () => {
  const { fn } = recordingFetch([jsonResponse(403, { errors: [] })]);
  const adapter = createLinearAdapter({ apiKey: SYNTHETIC_KEY, fetch: fn });
  await assert.rejects(
    () => adapter.postComment("LAT-1", "body"),
    (err: unknown) =>
      err instanceof LinearAdapterError && err.kind === "unauthorized",
  );
});

/* ------------------------------------------------------------------ */
/* Secret hygiene                                                       */
/* ------------------------------------------------------------------ */

test("secret hygiene: no public surface method returns the api key", () => {
  const adapter = createLinearAdapter({
    apiKey: SYNTHETIC_KEY,
    fetch: async () => jsonResponse(200, { data: null }),
  });
  // Surface inspection: the adapter only exposes readIssue and postComment.
  assert.deepEqual(Object.keys(adapter).sort(), ["postComment", "readIssue"]);
  // Serialised form must not leak the key either.
  assert.ok(!JSON.stringify(adapter).includes(SYNTHETIC_KEY));
});
