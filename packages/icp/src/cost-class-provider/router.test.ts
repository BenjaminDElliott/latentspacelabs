/**
 * Tests for the cost-class provider router (LAT-58).
 *
 * Covers:
 * - Cost class classification for all four lanes.
 * - Lane selection rules (ADR-0020).
 * - Refuse-on-missing-config.
 * - Config presence tracking.
 * - Router buildInvocation / buildEvidence.
 * - ProviderRouterError on refused decisions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCostClassProviderRouter,
  route,
  classifyCostClass,
  mapCostClassToLane,
  deriveLaneReason,
} from "./router.js";
import type {
  ProviderConfig,
  RoutingInputs,
} from "./types.js";
import { ProviderRouterError } from "./types.js";

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

function makeInputs(overrides: Partial<RoutingInputs> = {}): RoutingInputs {
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

/* ------------------------------------------------------------------ */
/* Cost class classification                                           */
/* ------------------------------------------------------------------ */

test("classifyCostClass returns mock for ciDispatch=true", () => {
  assert.equal(classifyCostClass(makeInputs({ ciDispatch: true })), "mock");
});

test("classifyCostClass returns mock for dryRun=true", () => {
  assert.equal(classifyCostClass(makeInputs({ dryRun: true })), "mock");
});

test("classifyCostClass returns frontier_reasoning for architectureRisk", () => {
  assert.equal(
    classifyCostClass(makeInputs({ architectureRisk: true })),
    "frontier_reasoning",
  );
});

test("classifyCostClass returns frontier_reasoning for isPlanningOrReview", () => {
  assert.equal(
    classifyCostClass(makeInputs({ isPlanningOrReview: true })),
    "frontier_reasoning",
  );
});

test("classifyCostClass returns local_dev_fallback for operatorOptInLocal", () => {
  assert.equal(
    classifyCostClass(makeInputs({ operatorOptInLocal: true })),
    "local_dev_fallback",
  );
});

test("classifyCostClass returns runpod_frontline as default", () => {
  assert.equal(
    classifyCostClass(makeInputs()),
    "runpod_frontline",
  );
});

test("classifyCostClass: ciDispatch overrides architectureRisk", () => {
  // CI takes priority even for architecture-risk work
  assert.equal(
    classifyCostClass(makeInputs({ ciDispatch: true, architectureRisk: true })),
    "mock",
  );
});

/* ------------------------------------------------------------------ */
/* Lane selection                                                      */
/* ------------------------------------------------------------------ */

test("mapCostClassToLane returns mock for mock cost class", () => {
  assert.equal(mapCostClassToLane("mock", baseConfig), "mock");
});

test("mapCostClassToLane returns claude-anthropic-direct for frontier_reasoning", () => {
  const result = mapCostClassToLane("frontier_reasoning", {
    ...baseConfig,
    cost_class: "frontier_reasoning",
    model: "claude-sonnet-4-20250514",
  });
  assert.equal(result, "claude-anthropic-direct");
});

test("mapCostClassToLane returns opencode+local-qwen for local_dev_fallback", () => {
  assert.equal(
    mapCostClassToLane("local_dev_fallback", baseConfig),
    "opencode+local-qwen",
  );
});

test("mapCostClassToLane returns opencode+runpod-qwen for runpod_frontline", () => {
  assert.equal(
    mapCostClassToLane("runpod_frontline", baseConfig),
    "opencode+runpod-qwen",
  );
});

/* ------------------------------------------------------------------ */
/* Lane reason                                                         */
/* ------------------------------------------------------------------ */

test("deriveLaneReason returns ci-mock for ciDispatch", () => {
  assert.equal(
    deriveLaneReason(makeInputs({ ciDispatch: true }), "mock"),
    "ci-mock",
  );
});

test("deriveLaneReason returns dry-run for dryRun only", () => {
  assert.equal(
    deriveLaneReason(makeInputs({ dryRun: true }), "mock"),
    "dry-run",
  );
});

test("deriveLaneReason returns architecture-risk", () => {
  assert.equal(
    deriveLaneReason(makeInputs({ architectureRisk: true }), "frontier_reasoning"),
    "architecture-risk",
  );
});

test("deriveLaneReason returns planning-or-decomposition", () => {
  assert.equal(
    deriveLaneReason(makeInputs({ isPlanningOrReview: true }), "frontier_reasoning"),
    "planning-or-decomposition",
  );
});

test("deriveLaneReason returns operator-opt-in-local", () => {
  assert.equal(
    deriveLaneReason(makeInputs({ operatorOptInLocal: true }), "local_dev_fallback"),
    "operator-opt-in-local",
  );
});

test("deriveLaneReason returns bounded-ticket-pack as default", () => {
  assert.equal(
    deriveLaneReason(makeInputs(), "runpod_frontline"),
    "bounded-ticket-pack",
  );
});

/* ------------------------------------------------------------------ */
/* Full routing (refused and accepted)                                 */
/* ------------------------------------------------------------------ */

test("route returns refused decision when credentials missing", () => {
  const config: ProviderConfig = {
    ...baseConfig,
    cost_class: "frontier_reasoning",
    requiredConfigItems: ["model", "credentials", "api_endpoint"],
  };
  const decision = route(makeInputs(), config);
  assert.equal(decision.routing_refused, true);
  assert.equal(decision.cost_class, "runpod_frontline");
  assert.ok(decision.routing_refused_reason?.includes("api_endpoint"));
});

test("route returns accepted decision when config is sufficient", () => {
  const decision = route(makeInputs(), baseConfig);
  assert.equal(decision.routing_refused, false);
  assert.equal(decision.routing_refused_reason, null);
  assert.ok(decision.config_present.length > 0);
});

test("route preserves expected_cost_band from config", () => {
  const config: ProviderConfig = {
    ...baseConfig,
    expected_cost_band: "elevated",
  };
  const decision = route(makeInputs(), config);
  assert.equal(decision.expected_cost_band, "elevated");
});

test("route includes re_route_of when provided", () => {
  const decision = route(
    makeInputs({ reRouteOf: "run-abc-123" }),
    baseConfig,
  );
  assert.equal(decision.re_route_of, "run-abc-123");
});

test("route includes budget_cap_usd from inputs", () => {
  const decision = route(
    makeInputs({ budget_cap_usd: 25 }),
    baseConfig,
  );
  assert.equal(decision.budget_cap_usd, 25);
});

/* ------------------------------------------------------------------ */
/* Router factory                                                      */
/* ------------------------------------------------------------------ */

test("createCostClassProviderRouter returns a functional router", () => {
  const router = createCostClassProviderRouter();
  assert.equal(typeof router.route, "function");
  assert.equal(typeof router.buildInvocation, "function");
  assert.equal(typeof router.buildEvidence, "function");
});

test("router.buildInvocation throws ProviderRouterError on refused decision", () => {
  const router = createCostClassProviderRouter();
  const config: ProviderConfig = {
    ...baseConfig,
    cost_class: "frontier_reasoning",
    requiredConfigItems: ["model", "credentials", "api_endpoint"],
  };
  const decision = route(makeInputs(), config);
  assert.throws(
    () => router.buildInvocation(decision, "LAT-58"),
    ProviderRouterError,
  );
});

test("router.buildInvocation succeeds on accepted decision", () => {
  const router = createCostClassProviderRouter();
  const decision = route(makeInputs(), baseConfig);
  const invocation = router.buildInvocation(decision, "LAT-58");
  assert.equal(invocation.linear_issue_id, "LAT-58");
  assert.ok(invocation.run_id.startsWith("lat58-LAT-58-"));
  assert.equal(invocation.cost_class, decision.cost_class);
  assert.equal(invocation.lane_chosen, decision.lane_chosen);
  assert.equal(invocation.lane_reason, decision.lane_reason);
});

test("router.buildEvidence for a run produces structured evidence", () => {
  const router = createCostClassProviderRouter();
  const decision = route(makeInputs(), baseConfig);
  const evidence = router.buildEvidence(decision, {
    kind: "run",
    evidence: {
      spent_usd: 1.5,
      notes: ["test note"],
    },
  });
  assert.equal(evidence.cost_class, decision.cost_class);
  assert.equal(evidence.lane_chosen, decision.lane_chosen);
  assert.equal(evidence.cost_band, decision.expected_cost_band);
  assert.ok(evidence.notes.some((n) => n.includes("cost_class")));
  assert.ok(evidence.notes.some((n) => n.includes("test note")));
});

test("router.buildEvidence for a refusal produces structured evidence", () => {
  const router = createCostClassProviderRouter();
  const decision = route(makeInputs(), baseConfig);
  const evidence = router.buildEvidence(decision, {
    kind: "refusal",
    refusal: {
      kind: "refusal",
      reason: "missing_credentials",
      message: "No API key",
    },
  });
  assert.equal(evidence.spent_usd, null);
  assert.ok(evidence.notes.some((n) => n.includes("refused")));
  assert.ok(evidence.notes.some((n) => n.includes("missing_credentials")));
});

/* ------------------------------------------------------------------ */
/* Mock lane                                                           */
/* ------------------------------------------------------------------ */

test("mock cost class: buildInvocation returns mock lane and model", () => {
  const router = createCostClassProviderRouter();
  const mockConfig: ProviderConfig = {
    ...baseConfig,
    cost_class: "mock",
    model: "mock@0.0.0",
  };
  const decision = route(makeInputs(), mockConfig);
  const invocation = router.buildInvocation(decision, "LAT-58");
  assert.equal(invocation.lane_chosen, "mock");
  assert.ok(invocation.model.includes("mock"));
  assert.equal(invocation.dry_run, true);
});

/* ------------------------------------------------------------------ */
/* Frontier reasoning lane                                             */
/* ------------------------------------------------------------------ */

test("frontier_reasoning: buildInvocation returns claude model", () => {
  const router = createCostClassProviderRouter();
  const config: ProviderConfig = {
    ...baseConfig,
    cost_class: "frontier_reasoning",
    model: "claude-sonnet-4-20250514",
  };
  const decision = route(makeInputs({ architectureRisk: true }), config);
  const invocation = router.buildInvocation(decision, "LAT-58");
  assert.ok(invocation.model.includes("claude"));
});
