/**
 * Experience store for the Agent Self-Improvement System (LAT-273).
 *
 * Manages storage, retrieval, and RAG-based similarity search over
 * experience log entries. Implements the experience replay system
 * described in PRD §4.2 and Research §2.
 *
 * Key features:
 * - In-memory storage with configurable capacity
 * - Vector similarity search for relevant experience retrieval
 * - Tag-based filtering
 * - Outcome-based filtering
 * - Automatic eviction of oldest entries when capacity is reached
 */

import { randomUUID } from "node:crypto";

import type {
  ExperienceLogEntry,
  ExperienceOutcome,
  ExperienceStoreConfig,
  SimilaritySearchOptions,
  SimilaritySearchResult,
} from "./types.js";
import type { Embedding } from "./embedding.js";
import { DEFAULT_EXPERIENCE_STORE_CONFIG } from "./types.js";
import { mergeExperienceStoreConfig } from "./config.js";
import {
  buildExperienceEmbedding,
  buildQueryEmbedding,
  cosineSimilarity,
} from "./embedding.js";

// ─── Experience Store ───────────────────────────────────────────────────────

/**
 * In-memory experience store with RAG-based retrieval.
 *
 * Stores experience log entries and supports:
 * - Storing new experiences
 * - Retrieving by ID
 * - Listing all experiences with optional filters
 * - RAG-based similarity search
 * - Tag-based filtering
 * - Automatic eviction of oldest entries
 *
 * Thread-safe for single-threaded Node.js usage.
 * For multi-process environments, extend this class with a
 * persistence layer (SQLite, PostgreSQL, etc.).
 */
export class ExperienceStore {
  private config: ExperienceStoreConfig;
  private experiences: Map<string, ExperienceLogEntry> = new Map();
  private embeddings: Map<string, Embedding> = new Map();
  private insertionOrder: string[] = [];

  constructor(config?: Partial<ExperienceStoreConfig>) {
    this.config = mergeExperienceStoreConfig(config);
  }

  /**
   * Get the current configuration.
   */
  getConfig(): ExperienceStoreConfig {
    return this.config;
  }

  /**
   * Set the configuration.
   */
  setConfig(config: Partial<ExperienceStoreConfig>): void {
    this.config = mergeExperienceStoreConfig(config);
  }

  /**
   * Get the number of stored experiences.
   */
  get count(): number {
    return this.experiences.size;
  }

  /**
   * Check if the store is at capacity.
   */
  isAtCapacity(): boolean {
    return this.experiences.size >= this.config.maxExperiences;
  }

  /**
   * Store an experience log entry.
   *
   * If the experience already exists (by ID), it will be updated.
   * If the store is at capacity, the oldest entry will be evicted.
   *
   * @param entry - The experience to store
   */
  store(entry: ExperienceLogEntry): void {
    // Enforce max prompt/output lengths
    const sanitized = this.sanitizeEntry(entry);

    if (this.experiences.has(sanitized.id)) {
      // Update existing entry
      this.removeEmbedding(sanitized.id);
    }

    // If at capacity, evict the oldest
    if (this.isAtCapacity()) {
      this.evictOldest();
    }

    // Store the entry
    this.experiences.set(sanitized.id, sanitized);
    this.insertionOrder.unshift(sanitized.id);

    // Generate embedding if enabled
    if (this.config.enableEmbeddings) {
      this.generateEmbedding(sanitized);
    }
  }

  /**
   * Retrieve an experience by ID.
   *
   * @param id - The experience ID
   * @returns The experience, or null if not found
   */
  get(id: string): ExperienceLogEntry | null {
    return this.experiences.get(id) ?? null;
  }

  /**
   * List all experiences with optional filtering.
   *
   * @param options - Filter options (tags, outcome, workspace)
   * @returns Array of matching experiences
   */
  list(options?: {
    tagFilter?: string[];
    outcomeFilter?: ExperienceOutcome["classification"];
    workspaceFilter?: string;
    limit?: number;
  }): ExperienceLogEntry[] {
    let results = Array.from(this.experiences.values());

    // Apply tag filter (AND semantics — must have ALL specified tags)
    if (options?.tagFilter && options.tagFilter.length > 0) {
      results = results.filter((e) =>
        options.tagFilter!.every((tag) => e.tags.includes(tag)),
      );
    }

    // Apply outcome filter
    if (options?.outcomeFilter) {
      results = results.filter(
        (e) => e.outcome.classification === options.outcomeFilter,
      );
    }

    // Apply workspace filter
    if (options?.workspaceFilter) {
      results = results.filter(
        (e) => e.workspaceContext === options.workspaceFilter,
      );
    }

    // Sort by newest first
    results.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

    // Apply limit
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * RAG-based similarity search over stored experiences.
   *
   * Embeds the query text and finds the most similar stored experiences
   * using cosine similarity. This is the core of the experience replay
   * system described in PRD §4.2.
   *
   * @param query - Text to search for (task description, prompt, etc.)
   * @param options - Search options (topK, minScore, filters)
   * @returns Ranked list of similar experiences
   */
  search(
    query: string,
    options?: SimilaritySearchOptions,
  ): SimilaritySearchResult[] {
    const topK = options?.topK ?? 5;
    const minScore = options?.minScore ?? 0.0;

    // Build query embedding
    const queryEmbedding = buildQueryEmbedding(query, {
      dimension: 128,
    });

    // Score all stored experiences
    const scored: SimilaritySearchResult[] = [];

    for (const [id, embedding] of this.embeddings) {
      const similarity = cosineSimilarity(queryEmbedding, embedding);

      // Apply score threshold
      if (similarity < minScore) continue;

      const experience = this.experiences.get(id);
      if (!experience) continue;

      // Apply tag filter
      if (options?.tagFilter && options.tagFilter.length > 0) {
        const hasAllTags = options.tagFilter.every((tag) =>
          experience.tags.includes(tag),
        );
        if (!hasAllTags) continue;
      }

      // Apply outcome filter
      if (options?.outcomeFilter) {
        if (experience.outcome.classification !== options.outcomeFilter)
          continue;
      }

      // Apply workspace filter
      if (options?.workspaceFilter) {
        if (experience.workspaceContext !== options.workspaceFilter)
          continue;
      }

      scored.push({ experience, score: similarity });
    }

    // Sort by similarity descending
    scored.sort((a, b) => b.score - a.score);

    // Return top-K
    return scored.slice(0, topK);
  }

  /**
   * Delete an experience by ID.
   *
   * @param id - The experience ID to delete
   * @returns true if deleted, false if not found
   */
  delete(id: string): boolean {
    if (!this.experiences.has(id)) return false;

    this.experiences.delete(id);
    this.removeEmbedding(id);

    const idx = this.insertionOrder.indexOf(id);
    if (idx >= 0) {
      this.insertionOrder.splice(idx, 1);
    }

    return true;
  }

  /**
   * Clear all experiences from the store.
   */
  clear(): void {
    this.experiences.clear();
    this.embeddings.clear();
    this.insertionOrder = [];
  }

  /**
   * Export all experiences as a JSON-serializable array.
   * Useful for backup, migration, or analysis.
   */
  exportAll(): ExperienceLogEntry[] {
    return this.list();
  }

  /**
   * Import experiences from an array.
   * Existing experiences (by ID) will be updated.
   */
  importAll(entries: ExperienceLogEntry[]): void {
    for (const entry of entries) {
      this.store(entry);
    }
  }

  // ─── Internal Methods ───────────────────────────────────────────────────

  private sanitizeEntry(entry: ExperienceLogEntry): ExperienceLogEntry {
    // Enforce max prompt length
    const maxPrompt = Math.min(
      entry.taskPrompt.length,
      this.config.maxPromptLength,
    );
    const taskPrompt =
      maxPrompt < entry.taskPrompt.length
        ? entry.taskPrompt.slice(0, this.config.maxPromptLength) + "..."
        : entry.taskPrompt;

    // Enforce max output length per action
    const sanitizedActions = entry.actions.map((action) => {
      const maxOutput = Math.min(
        action.output.length,
        this.config.maxOutputLength,
      );
      const output =
        maxOutput < action.output.length
          ? action.output.slice(0, this.config.maxOutputLength) + "..."
          : action.output;
      return { ...action, output };
    });

    return {
      ...entry,
      taskPrompt,
      actions: sanitizedActions,
    };
  }

  private generateEmbedding(entry: ExperienceLogEntry): void {
    const embedding = buildExperienceEmbedding(
      {
        taskSummary: entry.taskSummary,
        taskType: this.inferTaskType(entry),
        tags: entry.tags,
        outcomeClassification: entry.outcome.classification,
        actionTypes: entry.actions.map((a) => a.type),
      },
      { dimension: 128 },
    );
    this.embeddings.set(entry.id, embedding);
  }

  private removeEmbedding(id: string): void {
    this.embeddings.delete(id);
  }

  private evictOldest(): void {
    if (this.insertionOrder.length === 0) return;

    const oldestId = this.insertionOrder.pop();
    if (oldestId) {
      this.experiences.delete(oldestId);
      this.embeddings.delete(oldestId);
    }
  }

  private inferTaskType(
    entry: Pick<ExperienceLogEntry, "actions" | "taskPrompt">,
  ): string {
    const typeSet = new Set(entry.actions.map((a) => a.type.toLowerCase()));

    if (typeSet.has("mcp_linear_get_issue") || typeSet.has("mcp_linear_save_issue")) {
      return "linear_task_management";
    }
    if (typeSet.has("terminal") || typeSet.has("write_file") || typeSet.has("read_file")) {
      return "code_development";
    }
    if (typeSet.has("mcp_linear_list_issues") || typeSet.has("mcp_linear_list_projects")) {
      return "linear_query";
    }
    if (typeSet.has("mcp_linear_save_comment") || typeSet.has("mcp_linear_delete_comment")) {
      return "comment_management";
    }
    if (typeSet.has("mcp_linear_get_document") || typeSet.has("mcp_linear_save_document")) {
      return "document_management";
    }

    return "general";
  }
}
