/**
 * @latentspacelabs/ticket-contract — Agent-ready ticket contract (ADR-0023, LAT-142).
 *
 * Validates tickets against the agent-ready contract and lane policy.
 */

export {
  validateAgentReadyContract,
  formatResult,
  type LaneId,
  type AgentType,
  type RiskLevel,
  type RefusalCode,
  type Refusal,
  type ValidationResult,
} from './validate.js';
