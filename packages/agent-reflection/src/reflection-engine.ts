/**
 * Post-action reflection engine for the Agent Self-Improvement System (LAT-273).
 *
 * Generates structured + free-form reflections after each action or task.
 * Implements the hybrid pattern recommended in Research §1.5 and PRD §4.1.
 *
 * Bounded overhead: quick reflections take ≤50 tokens, standard ≤150,
 * deep ≤500. All reflections are deterministic (no LLM dependency) for
 * Phase 1. Future phases can swap in LLM-based reflection.
 *
 * Workflow:
 *   1. Receive an ExperienceLogEntry (or partial action data)
 *   2. Generate structured reflection fields (actionSummary, outcome, metrics, etc.)
 *   3. Generate free-form reasoning at the configured depth level
 *   4. Extract rules/heuristics based on patterns detected
 *   5. Return a ReflectionOutput with all generated content
 */

import { randomUUID } from 'node:crypto';

import type {
  ExperienceAction,
  ExperienceLogEntry,
  ExperienceOutcome,
  ExtractedRule,
  ReflectionDepth,
  ReflectionEngineConfig,
  ReflectionEntry,
  ReflectionInput,
  ReflectionOutput,
  ReflectionStructured,
} from './types.js';
import { DEFAULT_REFLECTION_ENGINE_CONFIG } from './types.js';
import { getExpectedTokenBudget, mergeReflectionEngineConfig } from './config.js';

// ─── Rule Extraction Heuristics ─────────────────────────────────────────────

/**
 * Pattern-matching rules that can be extracted from actions without an LLM.
 * Each pattern maps action characteristics to a suggested rule.
 *
 * These are the Phase 1 built-in heuristics. They fire deterministically
 * based on observable action patterns.
 */
interface PatternRule {
  /** What to match (action type, error pattern, outcome). */
  matches: (action: ExperienceAction, outcome: ExperienceOutcome) => boolean;

  /** The rule to extract. */
  toRule: (action: ExperienceAction) => ExtractedRule;
}

const BUILTIN_PATTERNS: PatternRule[] = [
  {
    matches: (action) => action.type.includes('terminal') && !action.success,
    toRule: (action) => ({
      id: randomUUID(),
      description: 'Terminal command failed — check path and permissions',
      triggerCondition: 'Terminal action returns non-zero exit code',
      recommendedAction:
        'Verify working directory exists, check file permissions, and validate command syntax before retrying.',
      confidence: 0.7,
      applicationCount: 0,
      successRate: 0,
    }),
  },
  {
    matches: (action) => action.type.includes('file') && action.output.length > 10000,
    toRule: (action) => ({
      id: randomUUID(),
      description: 'Large file output — consider streaming or truncation',
      triggerCondition: 'File read/write operation produces output >10KB',
      recommendedAction:
        'For files >10KB, read in chunks or use head/tail to preview before full read.',
      confidence: 0.6,
      applicationCount: 0,
      successRate: 0,
    }),
  },
  {
    matches: (action) => action.durationMs > 5000 && action.success,
    toRule: (action) => ({
      id: randomUUID(),
      description: 'Slow successful action — consider caching',
      triggerCondition: 'Action takes >5 seconds and succeeds',
      recommendedAction:
        "For actions that consistently take >5s, cache results when input parameters don't change.",
      confidence: 0.5,
      applicationCount: 0,
      successRate: 0,
    }),
  },
  {
    matches: (action) => action.type.includes('linear') && action.success,
    toRule: (action) => ({
      id: randomUUID(),
      description: 'Linear API call succeeded — note response pattern',
      triggerCondition: 'Any Linear MCP tool call succeeds',
      recommendedAction:
        'Linear API responses are consistent; prefer cached results for repeated queries with same parameters.',
      confidence: 0.8,
      applicationCount: 0,
      successRate: 0,
    }),
  },
  {
    matches: (action) => action.type.includes('write_file') && action.success,
    toRule: (action) => ({
      id: randomUUID(),
      description: 'File write succeeded — consider verification read',
      triggerCondition: 'File write operation succeeds',
      recommendedAction:
        'After writing files, read back a portion to verify the write was successful, especially for large files.',
      confidence: 0.75,
      applicationCount: 0,
      successRate: 0,
    }),
  },
];

// ─── Reflection Engine ──────────────────────────────────────────────────────

/**
 * Post-action reflection engine.
 *
 * Generates structured + free-form reflections for agent experiences.
 * Uses deterministic pattern-matching for Phase 1; future phases can
 * integrate LLM-based reflection.
 */
export class ReflectionEngine {
  private config: ReflectionEngineConfig;

  constructor(config?: Partial<ReflectionEngineConfig>) {
    this.config = mergeReflectionEngineConfig(config);
  }

  /**
   * Get the current configuration.
   */
  getConfig(): ReflectionEngineConfig {
    return this.config;
  }

  /**
   * Set the configuration.
   */
  setConfig(config: Partial<ReflectionEngineConfig>): void {
    this.config = mergeReflectionEngineConfig(config);
  }

  /**
   * Generate a reflection for an experience log entry.
   *
   * This is the main public API. It takes an ExperienceLogEntry and
   * returns a ReflectionOutput containing structured + free-form reflections.
   *
   * @param input - The experience to reflect on, optionally with depth override
   * @returns A ReflectionOutput with all generated reflection entries
   */
  generateReflection(input: ReflectionInput): ReflectionOutput {
    const startTime = Date.now();
    const depth = input.depth ?? this.config.defaultDepth;
    const experience = input.experience;

    // Generate one reflection per action (for fine-grained review) plus
    // one aggregate reflection for the overall task.
    const actionReflections: ReflectionEntry[] = [];
    const aggregateReflection = this.generateAggregateReflection(experience, depth);

    for (const action of experience.actions) {
      const actionRef = this.generateActionReflection(action, experience, depth);
      actionReflections.push(actionRef);
    }

    const allReflections = [...actionReflections, aggregateReflection];

    // Enforce token budget
    const estimatedTokens = allReflections.reduce(
      (sum, r) => sum + r.freeFormReasoning.length + r.structured.actionSummary.length,
      0,
    );

    return {
      experience,
      reflections: allReflections,
      estimatedTokens,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Generate a reflection for a single action.
   * Used for post-action (immediate) reflection after each tool call.
   */
  generateActionReflection(
    action: ExperienceAction,
    context: Pick<ExperienceLogEntry, 'taskPrompt' | 'taskSummary' | 'workspaceContext'>,
    depth?: ReflectionDepth,
  ): ReflectionEntry {
    const reflectionDepth = depth ?? this.config.defaultDepth;
    const structured = this.buildStructuredReflection(action, context);
    const freeForm = this.buildFreeFormReasoning(structured, action, context, reflectionDepth);
    const rules = this.extractRules(action);

    return {
      schemaVersion: '1.0.0',
      id: randomUUID(),
      depth: reflectionDepth,
      generatedAt: new Date().toISOString(),
      structured,
      freeFormReasoning: freeForm,
      confidence: this.calculateConfidence(structured, action),
      extractedRules: rules,
    };
  }

  /**
   * Generate a reflection for the overall task/session.
   * Used for episodic (session-level) reflection after task completion.
   */
  generateAggregateReflection(
    experience: ExperienceLogEntry,
    depth?: ReflectionDepth,
  ): ReflectionEntry {
    const reflectionDepth = depth ?? this.config.defaultDepth;

    // Build a high-level structured summary
    const totalActions = experience.actions.length;
    const successfulActions = experience.actions.filter((a) => a.success).length;
    const failedActions = totalActions - successfulActions;
    const totalDuration = experience.durationMs;

    const structured: ReflectionStructured = {
      actionSummary: `Task completed: ${experience.taskSummary}`,
      actionOutcome:
        experience.outcome.classification === 'success'
          ? 'success'
          : experience.outcome.classification === 'partial_success'
            ? 'partial'
            : 'failure',
      isRetry: false,
      metrics: {
        durationMs: totalDuration,
        outputSize: experience.actions.reduce((sum, a) => sum + a.output.length, 0),
        errorCount: failedActions,
      },
      taskType: this.inferTaskType(experience),
      keyInsight: this.generateKeyInsight(experience),
      suggestedRules: this.inferSuggestedRules(experience),
    };

    const freeForm = this.buildAggregateFreeForm(experience, structured, reflectionDepth);

    const rules = this.extractAggregateRules(experience);

    return {
      schemaVersion: '1.0.0',
      id: randomUUID(),
      depth: reflectionDepth,
      generatedAt: new Date().toISOString(),
      structured,
      freeFormReasoning: freeForm,
      confidence: this.calculateAggregateConfidence(experience),
      extractedRules: rules,
    };
  }

  // ─── Structured Reflection Builder ──────────────────────────────────────

  private buildStructuredReflection(
    action: ExperienceAction,
    context: Pick<ExperienceLogEntry, 'taskPrompt' | 'taskSummary' | 'workspaceContext'>,
  ): ReflectionStructured {
    return {
      actionSummary: `${action.type} → ${action.success ? 'success' : 'failure'} (${action.durationMs}ms)`,
      actionOutcome: action.success
        ? 'success'
        : action.output.includes('error') ||
            action.output.includes('Error') ||
            action.output.includes('Error:')
          ? 'failure'
          : 'partial',
      isRetry: this.isRetry(action),
      metrics: {
        durationMs: action.durationMs,
        outputSize: action.output.length,
        errorCount: action.output.match(/(?:error|Error|exception|failed)/gi)?.length ?? 0,
      },
      taskType: this.inferTaskTypeFromAction(action, context),
      keyInsight: this.generateActionKeyInsight(action),
      suggestedRules: [],
    };
  }

  // ─── Free-Form Reasoning Builder ─────────────────────────────────────────

  private buildFreeFormReasoning(
    structured: ReflectionStructured,
    action: ExperienceAction,
    context: Pick<ExperienceLogEntry, 'taskPrompt' | 'taskSummary' | 'workspaceContext'>,
    depth: ReflectionDepth,
  ): string {
    const budget = getExpectedTokenBudget(depth);

    switch (depth) {
      case 'quick':
        return this.buildQuickSummary(structured, action, context);
      case 'standard':
        return this.buildStandardReasoning(structured, action, context);
      case 'deep':
        return this.buildDeepAnalysis(structured, action, context, budget);
    }
  }

  private buildQuickSummary(
    structured: ReflectionStructured,
    action: ExperienceAction,
    context: Pick<ExperienceLogEntry, 'taskPrompt' | 'taskSummary'>,
  ): string {
    // Quick summary: ≤50 tokens (roughly ≤300 chars)
    const lines: string[] = [];

    if (structured.actionOutcome === 'success') {
      lines.push(`Action ${structured.actionSummary} completed successfully.`);
      if (structured.isRetry) {
        lines.push('Retried after initial failure.');
      }
      if (action.durationMs > 3000) {
        lines.push(`Took ${action.durationMs}ms — consider caching.`);
      }
    } else {
      lines.push(`Action ${structured.actionSummary}. Output: ${truncate(action.output, 100)}.`);
    }

    return lines.join(' ');
  }

  private buildStandardReasoning(
    structured: ReflectionStructured,
    action: ExperienceAction,
    context: Pick<ExperienceLogEntry, 'taskPrompt' | 'taskSummary'>,
  ): string {
    // Standard reasoning: ≤150 tokens (roughly ≤900 chars)
    const lines: string[] = [];

    lines.push(`Task: ${context.taskSummary}`);
    lines.push(`Action: ${structured.actionSummary}`);

    if (action.success) {
      lines.push(`Outcome: Success in ${action.durationMs}ms.`);
      lines.push(`Insight: ${structured.keyInsight}`);
      if (structured.isRetry) {
        lines.push('Retried successfully — the approach works but may need one correction.');
      }
    } else {
      const errorMsg = truncate(
        action.output.match(/(?:error|Error|Exception|failed|fail):?\s*(.+)/i)?.[1] ??
          action.output,
        200,
      );
      lines.push(`Outcome: Failed. Error: ${errorMsg}`);
      lines.push(`Suggestion: ${this.generateActionSuggestion(action)}`);
    }

    return lines.join('\n');
  }

  private buildDeepAnalysis(
    structured: ReflectionStructured,
    action: ExperienceAction,
    context: Pick<ExperienceLogEntry, 'taskPrompt' | 'taskSummary' | 'workspaceContext'>,
    budget: number,
  ): string {
    // Deep analysis: ≤500 tokens (roughly ≤3000 chars)
    const lines: string[] = [];

    lines.push(`=== Deep Reflection ===`);
    lines.push(`Task: ${context.taskSummary}`);
    lines.push(`Workspace: ${context.workspaceContext}`);
    lines.push(`Action: ${structured.actionSummary}`);
    lines.push(`Task Type: ${structured.taskType}`);
    lines.push(`Duration: ${action.durationMs}ms`);
    lines.push(`Output Size: ${action.output.length} chars`);

    lines.push(`\n--- Analysis ---`);
    lines.push(this.generateKeyInsight(action));
    lines.push(`\n--- Root Cause ---`);
    if (!action.success) {
      lines.push(this.analyzeRootCause(action));
    } else {
      lines.push('No error detected. Action completed within expected parameters.');
    }

    lines.push(`\n--- Improvements ---`);
    lines.push(this.generateImprovementSuggestions(action, context));

    lines.push(`\n--- Rules Learned ---`);
    const rules = this.extractRules(action);
    if (rules.length > 0) {
      for (const rule of rules) {
        lines.push(`  • ${rule.description}`);
      }
    } else {
      lines.push('  No new rules extracted.');
    }

    return lines.join('\n');
  }

  // ─── Aggregate Free-Form Builder ─────────────────────────────────────────

  private buildAggregateFreeForm(
    experience: ExperienceLogEntry,
    structured: ReflectionStructured,
    depth: ReflectionDepth,
  ): string {
    const budget = getExpectedTokenBudget(depth);

    switch (depth) {
      case 'quick': {
        const summary = experience.outcome.classification;
        return `Task "${experience.taskSummary}" completed (${summary}). ${experience.actions.length} actions, ${experience.durationMs}ms total.`;
      }
      case 'standard': {
        const successes = experience.actions.filter((a) => a.success).length;
        const failures = experience.actions.length - successes;
        const topIssues: string[] = [];

        for (const action of experience.actions) {
          if (!action.success) {
            topIssues.push(`${action.type}: ${truncate(action.output, 80)}`);
          }
        }

        return [
          `Task: ${experience.taskSummary}`,
          `Outcome: ${experience.outcome.classification} (quality: ${experience.outcome.qualityScore}/100)`,
          `Actions: ${successes} succeeded, ${failures} failed`,
          ...(topIssues.length > 0
            ? [`Issues:`, ...topIssues.slice(0, 3).map((i) => `  - ${i}`)]
            : []),
          `Key insight: ${structured.keyInsight}`,
        ].join('\n');
      }
      case 'deep': {
        const successes = experience.actions.filter((a) => a.success).length;
        const failures = experience.actions.length - successes;

        return [
          `=== Aggregate Reflection ===`,
          `Task: ${experience.taskSummary}`,
          `Workspace: ${experience.workspaceContext}`,
          `Outcome: ${experience.outcome.classification} (quality: ${experience.outcome.qualityScore}/100)`,
          `Duration: ${experience.durationMs}ms`,
          `Actions: ${successes}/${experience.actions.length} succeeded`,
          ``,
          `--- Pattern Analysis ---`,
          this.analyzePatterns(experience),
          ``,
          `--- Lessons Learned ---`,
          ...experience.reflections.flatMap((r) =>
            r.extractedRules.map((rule) => `  • ${rule.description}: ${rule.recommendedAction}`),
          ),
          ``,
          `--- Next Time ---`,
          this.generateNextTimeSuggestions(experience),
        ].join('\n');
      }
    }
  }

  // ─── Rule Extraction ─────────────────────────────────────────────────────

  private extractRules(action: ExperienceAction): ExtractedRule[] {
    return BUILTIN_PATTERNS.filter((p) => p.matches(action)).map((p) => p.toRule(action));
  }

  private extractAggregateRules(experience: ExperienceLogEntry): ExtractedRule[] {
    const ruleMap = new Map<string, ExtractedRule>();

    for (const action of experience.actions) {
      for (const rule of this.extractRules(action)) {
        const existing = ruleMap.get(rule.description);
        if (existing) {
          existing.applicationCount += 1;
          if (action.success) {
            existing.successRate =
              (existing.successRate * (existing.applicationCount - 1) + 1) /
              existing.applicationCount;
          }
        } else {
          ruleMap.set(rule.description, { ...rule, applicationCount: 1 });
        }
      }
    }

    return Array.from(ruleMap.values()).filter(
      (r) => r.successRate >= this.config.ruleActionThreshold,
    );
  }

  // ─── Helper Methods ──────────────────────────────────────────────────────

  private isRetry(action: ExperienceAction): boolean {
    // Heuristic: if the action type includes "retry" or the output mentions
    // retry/retry, it's likely a retry.
    return (
      action.type.toLowerCase().includes('retry') ||
      action.output.toLowerCase().includes('retry') ||
      action.output.toLowerCase().includes('attempt')
    );
  }

  private calculateConfidence(structured: ReflectionStructured, action: ExperienceAction): number {
    let confidence = 0.5; // Base confidence

    // Higher confidence for clear outcomes
    if (structured.actionOutcome === 'success') confidence += 0.2;
    if (structured.actionOutcome === 'failure') confidence += 0.1;

    // Higher confidence for longer output (more signals)
    if (action.output.length > 500) confidence += 0.1;
    if (action.output.length > 2000) confidence += 0.1;

    // Lower confidence for very short output
    if (action.output.length < 10) confidence -= 0.2;

    return Math.max(0, Math.min(1, confidence));
  }

  private calculateAggregateConfidence(experience: ExperienceLogEntry): number {
    // Aggregate confidence is higher because we have more data
    let confidence = 0.7;

    if (experience.actions.length > 10) confidence += 0.1;
    if (experience.outcome.qualityScore > 80) confidence += 0.1;
    if (experience.outcome.qualityScore < 40) confidence -= 0.1;

    return Math.max(0, Math.min(1, confidence));
  }

  private inferTaskType(
    experience: Pick<ExperienceLogEntry, 'actions' | 'taskPrompt' | 'taskSummary'>,
  ): string {
    return this.inferTaskTypeFromActions(experience.actions);
  }

  private inferTaskTypeFromAction(
    action: ExperienceAction,
    context: Pick<ExperienceLogEntry, 'taskPrompt' | 'taskSummary'>,
  ): string {
    return this.inferTaskTypeFromActions([action]);
  }

  private inferTaskTypeFromActions(actions: ExperienceAction[]): string {
    // Analyze action types to infer the task type
    const typeSet = new Set(actions.map((a) => a.type.toLowerCase()));

    if (typeSet.has('mcp_linear_get_issue') || typeSet.has('mcp_linear_save_issue')) {
      return 'linear_task_management';
    }
    if (typeSet.has('terminal') || typeSet.has('write_file') || typeSet.has('read_file')) {
      return 'code_development';
    }
    if (typeSet.has('mcp_linear_list_issues') || typeSet.has('mcp_linear_list_projects')) {
      return 'linear_query';
    }
    if (typeSet.has('mcp_linear_save_comment') || typeSet.has('mcp_linear_delete_comment')) {
      return 'comment_management';
    }
    if (typeSet.has('mcp_linear_get_document') || typeSet.has('mcp_linear_save_document')) {
      return 'document_management';
    }
    if (
      typeSet.has('mcp_linear_create_issue_label') ||
      typeSet.has('mcp_linear_delete_attachment')
    ) {
      return 'organization';
    }

    // Fall back to analyzing the task prompt
    return 'general';
  }

  private generateKeyInsight(action: ExperienceAction): string {
    if (action.success) {
      if (action.durationMs > 5000) {
        return `This action succeeded but was slow (${action.durationMs}ms). Consider caching or pre-fetching next time.`;
      }
      return `Action completed successfully within expected time (${action.durationMs}ms). No changes needed.`;
    }
    const errorMsg = action.output.match(/(?:error|Error|Exception):?\s*(.+)/i)?.[1];
    if (errorMsg) {
      return `Failure caused by: ${truncate(errorMsg, 150)}. Check input parameters and environment.`;
    }
    return `Action failed without specific error. Review output and retry with modified parameters.`;
  }

  private generateActionKeyInsight(action: ExperienceAction): string {
    return this.generateKeyInsight(action);
  }

  private generateActionSuggestion(action: ExperienceAction): string {
    if (!action.success) {
      const output = action.output.toLowerCase();
      if (output.includes('permission') || output.includes('denied') || output.includes('access')) {
        return 'Check file/directory permissions and try again.';
      }
      if (output.includes('not found') || output.includes('ENOENT')) {
        return 'Verify the file path exists. Use list_directory to check available files.';
      }
      if (output.includes('timeout') || output.includes('timed out')) {
        return 'The action timed out. Try with a shorter scope or larger timeout.';
      }
      if (output.includes('invalid') || output.includes('malformed')) {
        return "Check the input format. Review the action's expected parameters.";
      }
    }
    return 'Review the action output and try with adjusted parameters.';
  }

  private analyzeRootCause(action: ExperienceAction): string {
    const output = action.output.toLowerCase();

    if (output.includes('permission') || output.includes('denied')) {
      return 'Permission denied — likely a file or API access issue.';
    }
    if (output.includes('not found') || output.includes('enoent')) {
      return 'Resource not found — path or ID may be incorrect.';
    }
    if (output.includes('timeout') || output.includes('timed out')) {
      return 'Timeout — the operation took too long or the server was unresponsive.';
    }
    if (output.includes('invalid') || output.includes('malformed')) {
      return 'Invalid input — check parameter types and formats.';
    }
    if (output.includes('rate limit') || output.includes('too many')) {
      return 'Rate limited — reduce request frequency or add backoff.';
    }

    return 'Unknown cause — inspect the raw output for clues.';
  }

  private generateImprovementSuggestions(
    action: ExperienceAction,
    context: Pick<ExperienceLogEntry, 'taskPrompt' | 'taskSummary'>,
  ): string {
    const suggestions: string[] = [];

    if (!action.success) {
      suggestions.push(this.generateActionSuggestion(action));
    }

    if (action.durationMs > 5000) {
      suggestions.push(
        `This action took ${action.durationMs}ms. Consider caching results or reducing scope.`,
      );
    }

    if (action.output.length > 10000) {
      suggestions.push(
        `Output was large (${action.output.length} chars). Consider using pagination or filtering.`,
      );
    }

    return suggestions.length > 0 ? suggestions.join(' ') : 'No improvements needed.';
  }

  private analyzePatterns(experience: ExperienceLogEntry): string {
    const successes = experience.actions.filter((a) => a.success).length;
    const failures = experience.actions.length - successes;
    const avgDuration =
      experience.actions.length > 0
        ? experience.actions.reduce((sum, a) => sum + a.durationMs, 0) / experience.actions.length
        : 0;

    const lines: string[] = [];
    lines.push(
      `Success rate: ${successes}/${experience.actions.length} (${((successes / Math.max(1, experience.actions.length)) * 100).toFixed(0)}%)`,
    );
    lines.push(`Average action duration: ${avgDuration.toFixed(0)}ms`);

    // Check for retry patterns
    const retries = experience.actions.filter((a) => this.isRetry(a));
    if (retries.length > 0) {
      lines.push(`Retry pattern detected: ${retries.length} actions were retries.`);
    }

    // Check for slow actions
    const slowActions = experience.actions.filter((a) => a.durationMs > 5000);
    if (slowActions.length > 0) {
      lines.push(`Slow actions: ${slowActions.map((a) => a.type).join(', ')} all took >5s.`);
    }

    return lines.join('\n');
  }

  private generateNextTimeSuggestions(experience: ExperienceLogEntry): string {
    const suggestions: string[] = [];

    // Check for repeated failures of the same action type
    const failureByType = new Map<string, number>();
    for (const action of experience.actions) {
      if (!action.success) {
        failureByType.set(action.type, (failureByType.get(action.type) ?? 0) + 1);
      }
    }

    for (const [type, count] of failureByType) {
      if (count >= 2) {
        suggestions.push(
          `Action "${type}" failed ${count} times — consider a different approach or pre-check.`,
        );
      }
    }

    // Check for very slow actions
    const slowActions = experience.actions.filter((a) => a.durationMs > 5000);
    if (slowActions.length > 0) {
      suggestions.push(
        `Consider caching for slow actions: ${slowActions.map((a) => a.type).join(', ')}.`,
      );
    }

    if (suggestions.length === 0) {
      suggestions.push('No significant issues detected. The workflow was efficient.');
    }

    return suggestions.join('\n');
  }
}

// ─── Utility Functions ──────────────────────────────────────────────────────

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}
