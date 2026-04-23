/**
 * @latentspacelabs/icp public surface.
 *
 * This package implements ADR-0012's skill framework (contract, registry,
 * runner) plus the shared adapters the first-slice skill composes. The first
 * skill, `dispatch-ticket@0.1.0`, reads an agent-ready Linear ticket,
 * evaluates dispatch policy, invokes one coding-agent run under explicit
 * approval, and posts the ADR-0006 five-element Linear write-back.
 */

export const ICP_PACKAGE_NAME = "@latentspacelabs/icp";
export const ICP_PACKAGE_VERSION = "0.0.0";

export type {
  AgentType,
  AutonomyLevel,
  SkillDefinition,
  SkillStatus,
  PolicyVerdict,
  RunReportStatus,
  ToolName,
  TriggeredBy,
  RunReport,
  LinearAdapter,
  LinearIssueSnapshot,
  PolicyEvaluator,
  PolicyEvaluation,
  PolicyInput,
  AgentInvocationAdapter,
  AgentInvocationRequest,
  AgentInvocationResult,
  TicketInvocationContext,
  RunRecorder,
  RunRecorderInput,
  RunRecorderOutput,
  WriteBackFormatter,
  ResolvedTools,
  SkillExecutionContext,
} from "./runtime/contract.js";
export { RUN_REPORT_SCHEMA_VERSION, toRunStatus } from "./runtime/contract.js";

export { SkillRegistry, SkillRegistryError } from "./runtime/registry.js";
export type { RegistryOptions, RegisteredSkill } from "./runtime/registry.js";

export { SkillRunner } from "./runtime/runner.js";
export type {
  RunnerOptions,
  RunInvocation,
  RunResult,
} from "./runtime/runner.js";

export { createPolicyEvaluator } from "./adapters/policy-evaluator.js";
export { createRunRecorder } from "./adapters/run-recorder.js";
export { createWriteBackFormatter } from "./adapters/write-back-formatter.js";
export {
  createStubLinearAdapter,
  createLinearAdapter,
  loadLinearCredentialFromEnv,
  LinearAdapterError,
  buildSnapshotFromRaw,
  parseDispatchFields,
} from "./adapters/linear-adapter.js";
export type {
  StubLinearAdapterOptions,
  LinearAdapterOptions,
  LinearAdapterErrorKind,
  LinearAdapterEvent,
  FetchLike,
  FetchLikeResponse,
} from "./adapters/linear-adapter.js";
export {
  createStubAgentAdapter,
  createCodingAgentAdapter,
  createCommandCodingAgentProvider,
  parseProviderEnvelope,
  scrubSecrets,
} from "./adapters/agent-invocation-adapter.js";
export type {
  StubAgentAdapterOptions,
  StubAgentResponse,
  CodingAgentAdapterOptions,
  CodingAgentAdapterEvent,
  CodingAgentProvider,
  CodingAgentProviderRequest,
  CodingAgentProviderResult,
  CodingAgentRun,
  CodingAgentRefusal,
  CodingAgentRefusalKind,
  CommandCodingAgentProviderOptions,
  SerialisedProviderRequest,
  SpawnLike,
  SpawnedLike,
} from "./adapters/agent-invocation-adapter.js";

export {
  dispatchTicketSkill,
  type DispatchTicketInputs,
  type DispatchTicketOutputs,
} from "./skills/dispatch-ticket.js";
