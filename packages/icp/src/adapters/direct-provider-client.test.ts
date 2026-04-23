/**
 * Tests for the LAT-67 Direct-Path Anthropic client.
 *
 * No test hits the live Anthropic endpoint. All tests inject a mocked
 * `fetch`, a mocked env, and a mocked clock. A real API key is never
 * read from or written to `process.env` in this file; the synthetic
 * value used below does not match any real Anthropic token shape so a
 * secret scanner stays silent, and tests assert the secret value never
 * leaks into notes, events, errors, or returned envelopes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDirectAnthropicProviderClient,
  loadAnthropicCredentialFromEnv,
  LAT67_PROOF_MAX_TOKENS,
  LAT67_PROOF_MODEL,
  LAT67_PROOF_PROMPT,
  type DirectAnthropicClientEvent,
  type FetchLike,
  type FetchLikeResponse,
} from "./direct-provider-client.js";

const SYNTHETIC_KEY = "sk-ant-TEST-NOT-A-REAL-KEY-0123456789ABCDEF";

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
  responses: ReadonlyArray<FetchLikeResponse | Error>,
): { fn: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn: FetchLike = async (url, init) => {
    calls.push({
      url,
      body: init.body ? JSON.parse(init.body) : null,
      headers: init.headers ?? {},
    });
    const next = responses[i];
    i += 1;
    if (next instanceof Error) throw next;
    if (!next) throw new Error(`recordingFetch exhausted at call ${i}`);
    return next;
  };
  return { fn, calls };
}

/* ------------------------------------------------------------------ */
/* loadAnthropicCredentialFromEnv                                      */
/* ------------------------------------------------------------------ */

test("loadAnthropicCredentialFromEnv: returns value when set", () => {
  const key = loadAnthropicCredentialFromEnv({ ANTHROPIC_API_KEY: SYNTHETIC_KEY });
  assert.equal(key, SYNTHETIC_KEY);
});

test("loadAnthropicCredentialFromEnv: throws exact 'ANTHROPIC_API_KEY not set' when missing", () => {
  try {
    loadAnthropicCredentialFromEnv({});
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.equal(err.message, "ANTHROPIC_API_KEY not set");
  }
});

test("loadAnthropicCredentialFromEnv: throws exact message when value is empty string", () => {
  try {
    loadAnthropicCredentialFromEnv({ ANTHROPIC_API_KEY: "" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.equal(err.message, "ANTHROPIC_API_KEY not set");
  }
});

test("loadAnthropicCredentialFromEnv: error message carries no value, prefix, or length", () => {
  try {
    loadAnthropicCredentialFromEnv({});
    assert.fail();
  } catch (err) {
    const m = (err as Error).message;
    // Exactly the contract string. Anything richer (length, prefix, redaction)
    // creates a leak vector the ticket prohibits.
    assert.equal(m, "ANTHROPIC_API_KEY not set");
  }
});

/* ------------------------------------------------------------------ */
/* Client construction                                                 */
/* ------------------------------------------------------------------ */

test("createDirectAnthropicProviderClient: refuses empty apiKey", () => {
  assert.throws(
    () => createDirectAnthropicProviderClient({ apiKey: "" }),
    /without an API key/,
  );
});

test("createDirectAnthropicProviderClient: constructs on Node 20+ without an explicit fetch", () => {
  // Node 20+ provides globalThis.fetch natively; the constructor must
  // accept that fallback without raising.
  const client = createDirectAnthropicProviderClient({ apiKey: SYNTHETIC_KEY });
  assert.equal(typeof client.ping, "function");
});

/* ------------------------------------------------------------------ */
/* ping: happy path                                                    */
/* ------------------------------------------------------------------ */

test("ping: sends POST to /v1/messages with model / max_tokens / prompt pinned by the ticket", async () => {
  const { fn, calls } = recordingFetch([
    jsonResponse(200, {
      id: "msg_abc",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "pong" }],
      model: LAT67_PROOF_MODEL,
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 2 },
    }),
  ]);

  const client = createDirectAnthropicProviderClient({
    apiKey: SYNTHETIC_KEY,
    fetch: fn,
    now: (() => {
      let t = 1_700_000_000_000;
      return () => {
        const v = t;
        t += 42;
        return v;
      };
    })(),
  });

  const result = await client.ping({
    run_id: "run-1",
    secret_source: "env:ANTHROPIC_API_KEY",
  });

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, "https://api.anthropic.com/v1/messages");
  const body = call.body as { model: string; max_tokens: number; messages: Array<{ role: string; content: string }> };
  assert.equal(body.model, LAT67_PROOF_MODEL);
  assert.equal(body.max_tokens, LAT67_PROOF_MAX_TOKENS);
  assert.deepEqual(body.messages, [{ role: "user", content: LAT67_PROOF_PROMPT }]);
  assert.equal(call.headers["x-api-key"], SYNTHETIC_KEY);
  assert.equal(call.headers["anthropic-version"], "2023-06-01");
  assert.equal(call.headers["content-type"], "application/json");

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, LAT67_PROOF_MODEL);
  assert.equal(result.tokens.input, 3);
  assert.equal(result.tokens.output, 2);
  assert.equal(result.cost_band, "normal");
  assert.equal(result.cost_band_unavailable_reason, null);
  assert.equal(result.cost_band_check.outcome, "pass");
  assert.equal(result.secret_source, "env:ANTHROPIC_API_KEY");
  assert.equal(result.latency_ms, 42);
});

test("ping: returned envelope never carries the raw API key", async () => {
  const { fn } = recordingFetch([
    jsonResponse(200, {
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  ]);

  const client = createDirectAnthropicProviderClient({
    apiKey: SYNTHETIC_KEY,
    fetch: fn,
  });

  const result = await client.ping({
    run_id: "run-1",
    secret_source: "env:ANTHROPIC_API_KEY",
  });

  const serialised = JSON.stringify(result);
  assert.ok(!serialised.includes(SYNTHETIC_KEY));
});

/* ------------------------------------------------------------------ */
/* ping: failure paths                                                 */
/* ------------------------------------------------------------------ */

test("ping: non-2xx HTTP surfaces as cost_band=unknown with cost_band_check=fail", async () => {
  const { fn } = recordingFetch([textResponse(401, "Unauthorized")]);
  const client = createDirectAnthropicProviderClient({
    apiKey: SYNTHETIC_KEY,
    fetch: fn,
  });
  const result = await client.ping({
    run_id: "run-x",
    secret_source: "env:ANTHROPIC_API_KEY",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.cost_band, "unknown");
  assert.equal(result.cost_band_check.outcome, "fail");
  assert.ok(result.cost_band_unavailable_reason);
  assert.match(result.cost_band_check.reason, /401/);
});

test("ping: network error before HTTP status maps to status=0, cost_band=unknown", async () => {
  const { fn } = recordingFetch([new Error("ECONNREFUSED")]);
  const client = createDirectAnthropicProviderClient({
    apiKey: SYNTHETIC_KEY,
    fetch: fn,
  });
  const result = await client.ping({
    run_id: "run-x",
    secret_source: "env:ANTHROPIC_API_KEY",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.equal(result.cost_band, "unknown");
  assert.equal(result.cost_band_check.outcome, "fail");
  assert.match(result.cost_band_check.reason, /network error/);
});

test("ping: HTTP 200 with non-JSON body surfaces as failure", async () => {
  const { fn } = recordingFetch([textResponse(200, "not json at all")]);
  const client = createDirectAnthropicProviderClient({
    apiKey: SYNTHETIC_KEY,
    fetch: fn,
  });
  const result = await client.ping({
    run_id: "run-x",
    secret_source: "env:ANTHROPIC_API_KEY",
  });
  assert.equal(result.ok, false);
  assert.equal(result.cost_band, "unknown");
  assert.equal(result.cost_band_check.outcome, "fail");
});

test("ping: failure notes scrub token-shaped substrings from provider responses", async () => {
  // Provider misbehaves and echoes the key back in an error body. The
  // client should not surface it into notes or cost_band_check.reason.
  const { fn } = recordingFetch([
    textResponse(500, `internal error while validating ${SYNTHETIC_KEY}`),
  ]);
  const client = createDirectAnthropicProviderClient({
    apiKey: SYNTHETIC_KEY,
    fetch: fn,
  });
  const result = await client.ping({
    run_id: "run-x",
    secret_source: "env:ANTHROPIC_API_KEY",
  });
  const serialised = JSON.stringify(result);
  assert.ok(
    !serialised.includes(SYNTHETIC_KEY),
    "serialised result must not contain the raw API key",
  );
  // The redactor should have substituted <redacted> for the sk- shape.
  assert.ok(serialised.includes("<redacted>") || !serialised.includes("sk-ant"));
});

/* ------------------------------------------------------------------ */
/* Event stream                                                        */
/* ------------------------------------------------------------------ */

test("ping: event stream carries no credential value", async () => {
  const events: DirectAnthropicClientEvent[] = [];
  const { fn } = recordingFetch([
    jsonResponse(200, { usage: { input_tokens: 1, output_tokens: 1 } }),
  ]);
  const client = createDirectAnthropicProviderClient({
    apiKey: SYNTHETIC_KEY,
    fetch: fn,
    onEvent: (e) => events.push(e),
  });
  await client.ping({ run_id: "r", secret_source: "env:ANTHROPIC_API_KEY" });
  assert.equal(events.length, 2);
  for (const e of events) {
    const s = JSON.stringify(e);
    assert.ok(!s.includes(SYNTHETIC_KEY), `event leaked the key: ${s}`);
  }
});

test("ping: observer exceptions do not break the client", async () => {
  const { fn } = recordingFetch([
    jsonResponse(200, { usage: { input_tokens: 1, output_tokens: 1 } }),
  ]);
  const client = createDirectAnthropicProviderClient({
    apiKey: SYNTHETIC_KEY,
    fetch: fn,
    onEvent: () => {
      throw new Error("observer failed");
    },
  });
  const result = await client.ping({
    run_id: "r",
    secret_source: "env:ANTHROPIC_API_KEY",
  });
  assert.equal(result.ok, true);
});
