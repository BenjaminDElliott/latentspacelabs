/**
 * Cost-class provider router (LAT-58).
 *
 * Exports all types, the router, the Anthropic provider, and the mock
 * provider from the cost-class-provider module.
 *
 * @module @latentspacelabs/icp/cost-class-provider
 */

// Types
export type {
  CostClass,
  Lane,
  LaneReason,
  ExpectedCostBand,
  RoutingInputs,
  RoutingDecision,
  ProviderConfig,
  ProviderInvocationRequest,
  ProviderRunEvidence,
  ProviderRefusal,
  ProviderRefusalReason,
  CostClassProviderRouter,
  ProviderRunResult,
} from "./types.js";
export { ProviderRouterError } from "./types.js";

// Router
export {
  createCostClassProviderRouter,
  route,
  classifyCostClass,
  mapCostClassToLane,
  deriveLaneReason,
} from "./router.js";

// Anthropic provider
export {
  createAnthropicProvider,
  createMockAnthropicProvider,
} from "./anthropic-provider.js";
export type {
  AnthropicProviderOptions,
  MockAnthropicProviderOptions,
} from "./anthropic-provider.js";
