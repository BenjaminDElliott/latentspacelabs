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

export {
  evaluateReadiness,
  evaluateCodingRun,
  aggregateRunsForRetro,
} from "./evaluation/index.js";
export type {
  Recommendation,
  Severity,
  FailureCategory,
  EvaluationFinding,
  EvaluationReport,
  EvaluationRunInput,
  ReadinessVerdict,
  ReadinessReason,
  ReadinessReport,
  ReadinessTicketInput,
  AggregatableRun,
  RetroCandidate,
  RetroAggregationResult,
  RetroAggregationOptions,
} from "./evaluation/index.js";

/* LAT-129 polling dispatcher MVP. Selects one eligible Linear issue,
 * generates a bounded ticket pack, invokes the control-loop CLI once,
 * and writes sanitised evidence back to Linear. */
export {
  runDispatcher,
  resolveDispatcherConfig,
  ensureControlLoopBuilt,
  defaultControlLoopCliPath,
  defaultRepoRoot,
  runDispatcherFromEnv,
} from "./dispatcher/dispatch.js";
export type {
  DispatcherConfig,
  DispatcherDeps,
  RunDispatcherInput,
} from "./dispatcher/dispatch.js";
export { redactOutput } from "./dispatcher/redact.js";
export { evaluateEligibility } from "./dispatcher/select.js";
export { buildTicketPack } from "./dispatcher/ticket-pack.js";
export { runControlLoopCli } from "./dispatcher/control-loop-runner.js";
export {
  createDispatcherLinearClient,
  DispatcherLinearError,
} from "./dispatcher/linear-client.js";
export type {
  DispatchIssue,
  DispatchOutcome,
  DispatchReport,
  DispatcherLinearClient,
  DispatcherSpawn,
  DispatcherSpawnedProcess,
  ControlLoopRunResult,
  ControlLoopJsonSummary,
  EligibilityOutcome,
} from "./dispatcher/types.js";

/* LAT-186 pre-run invocation gate. Validates AgentInvocationRequest
 * parameters against isolation rules before a run proceeds. Blocks if
 * any forbidden action is detected, and logs the gate decision with
 * evidence. LAT-187 adds the corresponding post-run gate. */
export {
  runPreRunGate,
  buildDefaultRules,
  buildPermissiveRules,
} from "./runtime/gates.js";
export type {
  GateOutcome,
  GateEvidence,
  InvocationGateInput,
  IsolationRules,
  ForbiddenAction,
} from "./runtime/gates.js";

/* LAT-140 structured run artefact (sanitised observability record).
 * Pure module: produces the JSON / compact comment-ready summary; the
 * caller decides where to persist it. Never uploads or externalises. */
export {
  RUN_ARTIFACT_SCHEMA_VERSION,
  buildRunArtefact,
  renderRunArtefactJson,
  formatArtefactCompactRef,
} from "./observability/run-artifact.js";
export type {
  RunArtefact,
  RunArtefactInput,
  RunArtefactOutcome,
  RunSurface,
  ArtefactClass,
  ArtefactCheck,
  AcceptanceCriterionCoverage,
  ChangedFilesSummary,
  ClassifierEvidence,
  CostClass,
  QualityLabel,
  RedactionMetadata,
  RiskClass,
  TrainingEligibility,
} from "./observability/run-artifact.js";

/* LAT-184 run-record module — builds Linear sub-issue title and description
 * from a structured run artefact. Produces queryable run records inside
 * Linear (sub-issues under the source ticket). */
export {
  buildRunRecord,
  buildRunRecordTitle,
  buildRunRecordDescription,
} from "./observability/run-record.js";

export {
  fromControlLoopSummary,
  fromOpencodeDryRunSummary,
} from "./observability/from-summaries.js";
export type {
  ControlLoopSummaryLike,
  OpencodeDryRunSummaryLike,
  FromControlLoopSummaryArgs,
  FromOpencodeDryRunArgs,
} from "./observability/from-summaries.js";

/* ICP observability cockpit (LAT-55, PRD docs/prds/LAT-28). Read-through
 * projection of the ADR-0006 envelope onto the seven MVP views. */
export { readRunsDir, parseRunJson } from "./cockpit/reader.js";
export { buildCockpitState } from "./cockpit/views.js";
export {
  renderCockpitSummary,
  type SummaryOptions,
} from "./cockpit/summary.js";
export type {
  ActiveRunRow,
  BlockedWorkRow,
  CockpitInputs,
  CockpitRunRecord,
  CockpitState,
  CostRiskRow,
  FailedRunsGroup,
  GitHubPRState,
  LearningCandidate,
  LinearIssueState,
  NotificationEvent,
  NotificationTier,
  PRReviewQueueRow,
  QAReviewReport,
  RecentCompletionRow,
  ViewName,
} from "./cockpit/types.js";

/* LAT-174 coding agent input/output contract.
 * TypeScript types defining the canonical coding agent contract surface. */
export {
  CODING_AGENT_CONTRACT_SCHEMA_VERSION,
  type CodingAgentInput,
  type CodingAgentOutput,
  type BuildStatus,
  type BuildStatusValue,
  type TestOutcome,
  type TestResults,
  type TestCaseResult,
  type TestCaseStatus,
  type LintStatusValue,
  type LintResults,
  type LintViolation,
  type CoverageMetrics,
  type CoverageFileSummary,
  type AcceptanceCriterionResult,
  type AcceptanceCriterionStatus,
  type Recommendation,
  type AutonomyLevel,
} from "./contract/coding-agent-contract.js";
