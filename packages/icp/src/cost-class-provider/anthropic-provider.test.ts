/**
 * Tests for the Anthropic provider and mock provider (LAT-58).
 *
 * Covers:
 * - createAnthropicProvider returns an object with id, model, dispatch, buildEvidence.
 * - Credential validation: missing API key produces a refusal.
 * - createMockAnthropicProvider returns a working mock provider.
 * - Mock provider dispatches with canned responses.
 * - Mock provider alwaysRefuse path.
 * - buildEvidence produces structured evidence from runs and refusals.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAnthropicProvider,
  createMockAnthropicProvider,
} from "./anthropic-provider.js";
import type {
  ProviderConfig,
  RoutingInputs,
  RoutingDecision,
  ProviderInvocationRequest,
} from "./types.js";
import {
  route,
  createCostClassProviderRouter,
} from "./router.js";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const baseConfig: ProviderConfig = {
  cost_class: "frontier_reasoning",
  id: "anthropic-mvp",
  model: "claude-sonnet-4-20250514",
  expected_cost_band: "normal",
  budget_cap_usd: 50,
  requiresCredentials: true,
  requiredConfigItems: ["model", "credentials"],
};

function makeRoutingInputs(
  overrides: Partial<RoutingInputs> = {},
): RoutingInputs {
  return {
    filesInScope: 5,
    concreteAcceptanceCriteria: true,
    architectureRisk: false,
    isPlanningOrReview: false,
    operatorOptInLocal: false,
    ciDispatch: false,
    dryRun: false,
    ...overrides,
  };
}

function makeDecision(
  overrides: Partial<RoutingDecision> = {},
): RoutingDecision {
  return {
    cost_class: "frontier_reasoning",
    lane_chosen: "claude-anthropic-direct",
    lane_reason: "bounded-ticket-pack",
    routing_refused: false,
    routing_refused_reason: null,
    expected_cost_band: "normal",
    re_route_of: null,
    config_present: ["model", "credentials"],
    budget_cap_usd: 50,
    ...overrides,
  };
}

function makeProviderRequest(
  overrides: Partial<ProviderInvocationRequest> = {},
): ProviderInvocationRequest {
  return {
    cost_class: "frontier_reasoning",
    lane_chosen: "claude-anthropic-direct",
    model: "claude-sonnet-4-20250514",
    cost_band: "normal",
    budget_cap_usd: 50,
    provider_id: "anthropic-direct",
    run_id: "run-001",
    linear_issue_id: "LAT-58",
    lane_reason: "bounded-ticket-pack",
    dry_run: false,
    context: {},
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Anthropic provider                                                  */
/* ------------------------------------------------------------------ */

test("createAnthropicProvider returns object with id, model, dispatch, buildEvidence", () => {
  const provider = createAnthropicProvider({
    apiKey: "sk-ant...6789",
  });
  assert.equal(typeof provider.id, "string");
  assert.equal(typeof provider.model, "string");
  assert.equal(typeof provider.dispatch, "function");
  assert.equal(typeof provider.buildEvidence, "function");
});

test("Anthropic provider refuses when API key is too short", async () => {
  const provider = createAnthropicProvider({
    apiKey: "short",
    fetch: ((_input: RequestInfo, _init?: RequestInit) => {
      throw new Error("should not be called");
    }) as typeof fetch,
  });
  const result = await provider.dispatch(makeProviderRequest());
  assert.equal(result.kind, "refusal");
  assert.equal(result.refusal.reason, "missing_credentials");
  assert.ok(result.refusal.message.includes("API key"));
});

test("Anthropic provider refuses when API key is empty string", async () => {
  const provider = createAnthropicProvider({
    apiKey: "",
    fetch: ((_input: RequestInfo, _init?: RequestInit) => {
      throw new Error("should not be called");
    }) as typeof fetch,
  });
  const result = await provider.dispatch(makeProviderRequest());
  assert.equal(result.kind, "refusal");
  assert.equal(result.refusal.reason, "missing_credentials");
});

test("Anthropic provider sends correct API payload when credentials present", async () => {
  let capturedBody: unknown = null;
  const provider = createAnthropicProvider({
    apiKey: "***",
    fetch: async (input: RequestInfo, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? "null");
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Hello from Claude" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        { status: 200 },
      );
    },
  });

  const result = await provider.dispatch(makeProviderRequest());
  assert.equal(result.kind, "run");

  assert.ok(capturedBody);
  const body = capturedBody as Record<string, unknown>;
  assert.equal(body.model, "claude-sonnet-4-20250514");
  assert.equal(body.max_tokens, 4096);
  assert.ok(Array.isArray(body.messages));
  const msgs = body.messages as ReadonlyArray<Record<string, unknown>>;
  assert.equal(msgs[0]?.role, "user");
});

/* ------------------------------------------------------------------ */
/* Mock Anthropic provider                                             */
/* ------------------------------------------------------------------ */

test("createMockAnthropicProvider returns a working mock provider", () => {
  const provider = createMockAnthropicProvider();
  assert.equal(typeof provider.id, "string");
  assert.equal(typeof provider.dispatch, "function");
  assert.equal(typeof provider.buildEvidence, "function");
});

test("Mock provider dispatches canned response for known issue id", async () => {
  const provider = createMockAnthropicProvider({
    responses: { "LAT-58": "Mock implementation complete" },
  });
  const result = await provider.dispatch(
    makeProviderRequest({ linear_issue_id: "LAT-58" }),
  );
  assert.equal(result.kind, "run");
  assert.equal(result.evidence.cost_band, "normal");
  assert.equal(result.evidence.spent_usd, 0);
  assert.ok(
    result.evidence.notes.some((n: string) => n.includes("Mock implementation complete")),
  );
});

test("Mock provider dispatches default response for unknown issue id", async () => {
  const provider = createMockAnthropicProvider();
  const result = await provider.dispatch(
    makeProviderRequest({ linear_issue_id: "LAT-99" }),
  );
  assert.equal(result.kind, "run");
  assert.ok(
    result.evidence.notes.some((n: string) => n.includes("LAT-99")),
  );
});

test("Mock provider refuses when alwaysRefuse=true", async () => {
  const provider = createMockAnthropicProvider({
    alwaysRefuse: true,
    refusalReason: "provider_declined",
    refusalMessage: "Always refused",
  });
  const result = await provider.dispatch(makeProviderRequest());
  assert.equal(result.kind, "refusal");
  assert.equal(result.refusal.reason, "provider_declined");
  assert.equal(result.refusal.message, "Always refused");
});

test("Mock provider with custom simulated spend", async () => {
  const provider = createMockAnthropicProvider({
    simulatedSpentUsd: 2.5,
  });
  const result = await provider.dispatch(makeProviderRequest());
  assert.equal(result.kind, "run");
  assert.equal(result.evidence.spent_usd, 2.5);
});

/* ------------------------------------------------------------------ */
/* buildEvidence on providers                                          */
/* ------------------------------------------------------------------ */

test("Anthropic provider buildEvidence on a run produces evidence", () => {
  const provider = createAnthropicProvider({ apiKey: "sk-ant-test" });
  const decision = makeDecision({ cost_class: "frontier_reasoning" });
  const evidence = provider.buildEvidence(decision, {
    kind: "run",
    evidence: {
      spent_usd: 1.23,
      notes: ["test"],
    },
  });
  assert.equal(evidence.cost_class, "frontier_reasoning");
  assert.equal(evidence.lane_chosen, "claude-anthropic-direct");
  assert.equal(evidence.cost_band, "normal");
  assert.equal(evidence.budget_cap_usd, 50);
  assert.equal(evidence.spent_usd, 1.23);
  assert.equal(evidence.provider_id, "anthropic-direct");
  assert.equal(evidence.model, "claude-sonnet-4-20250514");
});

test("Anthropic provider buildEvidence on a refusal produces null spend", () => {
  const provider = createAnthropicProvider({ apiKey: "sk-ant-test" });
  const decision = makeDecision();
  const evidence = provider.buildEvidence(decision, {
    kind: "refusal",
    refusal: {
      kind: "refusal",
      reason: "missing_credentials",
      message: "No key",
    },
  });
  assert.equal(evidence.spent_usd, null);
  assert.ok(
    evidence.notes.some((n: string) => n.includes("refused")),
  );
});

test("Mock provider buildEvidence on a run", () => {
  const provider = createMockAnthropicProvider();
  const decision = makeDecision();
  const evidence = provider.buildEvidence(decision, {
    kind: "run",
    evidence: {
      spent_usd: 0,
      notes: ["mock"],
    },
  });
  assert.equal(evidence.provider_id, "mock-anthropic");
  assert.equal(evidence.dry_run, true);
  assert.equal(evidence.model, "claude-sonnet-4-mock");
});

test("Mock provider buildEvidence on a refusal", () => {
  const provider = createMockAnthropicProvider();
  const decision = makeDecision();
  const evidence = provider.buildEvidence(decision, {
    kind: "refusal",
    refusal: {
      kind: "refusal",
      reason: "provider_declined",
      message: "nope",
    },
  });
  assert.equal(evidence.spent_usd, null);
  assert.ok(
    evidence.notes.some((n: string) => n.includes("refused")),
  );
});

/* ------------------------------------------------------------------ */
/* End-to-end: router + mock provider                                  */
/* ------------------------------------------------------------------ */

test("e2e: router routes, mock provider dispatches, evidence collected", () => {
  const router = createCostClassProviderRouter();
  const decision = route(makeRoutingInputs(), baseConfig);

  // Build invocation from decision
  const invocation = router.buildInvocation(decision, "LAT-58");
  assert.equal(invocation.linear_issue_id, "LAT-58");
  assert.equal(invocation.cost_class, decision.cost_class);

  // Dispatch mock provider
  const provider = createMockAnthropicProvider();
  const result = provider.dispatch(invocation);

  // Build evidence from result
  const evidence = provider.buildEvidence(decision, result);
  assert.equal(evidence.cost_class, decision.cost_class);
  assert.ok(evidence.notes.length > 0);
});
