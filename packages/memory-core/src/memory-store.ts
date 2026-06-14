/**
 * MemoryStore — the core memory engine.
 *
 * Combines SmartFrames, VectorIndex, EntityStore, and TemporalRanker into
 * a single unified memory layer. Provides the full memory pipeline:
 * 
 *   Write → Embed → Store → Index → Retrieve → Rank → Return
 *
 * Key design principles:
 * - ADD-only accumulation: never overwrite frames
 * - Single-file storage (.mv2 format)
 * - Sub-5ms retrieval for typical datasets
 * - Token-efficient retrieval (~7K tokens for context injection)
 * - Temporal reasoning built into search
 * - Entity linking for cross-memory context
 */
/// <reference types="node" />

import {
  SmartFrame,
  MemoryType,
  MemoryStoreConfig,
  SearchQuery,
  SearchResult,
  WriteResult,
  CompressionRequest,
  CompressionResult,
} from './types.js';
import { createSmartFrame, verifyIntegrity } from './smart-frame.js';
import { VectorIndex } from './vector-index.js';
import { EntityStore } from './entity-store.js';
import { rankResults, getMostRecentPerEntity } from './temporal-ranker.js';
import { buildMv2File, parseMv2File } from './mv2-format.js';
import { readFile, writeFile, mkdirSync, statSync, existsSync } from 'fs';

/**
 * Default embedding dimension for Phase 1 (simulated embeddings).
 * In production, this would come from an embedding model (e.g., Qwen2 1.5B).
 */
const DEFAULT_DIMENSION = 384;

/**
 * Simple deterministic hash-to-embedding for demo/testing.
 * Maps a string to a 384-dim normalized vector.
 * In production, replace with actual embedding model.
 */
function hashToEmbedding(text: string, dim: number = DEFAULT_DIMENSION): number[] {
  const result: number[] = new Array(dim).fill(0);
  
  // Use a simple hash to generate deterministic but distributed embeddings
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  
  // Generate dim values from hash and its derivatives
  for (let i = 0; i < dim; i++) {
    // Mix the hash with the index to get different values per position
    const mixed = ((hash + i * 2654435761) >>> 0) % 100000;
    // Map to [-1, 1] range, then normalize later
    result[i] = (mixed / 50000) - 1;
  }
  
  // Normalize to unit length (cosine similarity requires it)
  const n = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
  if (n > 0) {
    return result.map((v) => v / n);
  }
  return result;
}

/**
 * Extract entities from text content.
 * Simple heuristic: capitalize words, look for known entity patterns.
 * In production, use an LLM or NER model.
 */
function extractEntities(content: string): string[] {
  const entities: string[] = [];
  
  // Look for capitalized words (potential proper nouns)
  const capitalized = content.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) ?? [];
  for (const match of capitalized) {
    const trimmed = match.trim();
    if (trimmed.length >= 2 && !entities.includes(trimmed)) {
      entities.push(trimmed);
    }
  }
  
  // Look for URL patterns
  const urls = content.match(/https?:\/\/[^\s]+/g) ?? [];
  for (const url of urls) {
    entities.push(url.slice(0, 60)); // truncate long URLs
  }
  
  // Look for code identifiers (camelCase, SCREAMING_CASE)
  const codeMatches = content.match(/[A-Z][a-zA-Z0-9]+[a-z][a-zA-Z0-9]+/g) ?? [];
  for (const match of codeMatches) {
    if (match.length >= 3 && match.length <= 30) {
      entities.push(match);
    }
  }
  
  // Deduplicate and limit
  return [...new Set(entities)].slice(0, 20);
}

/**
 * MemoryStore — the unified memory engine.
 * 
 * Wraps SmartFrame creation, VectorIndex search, EntityStore linking,
 * and TemporalRanker scoring into a single API.
 */
export class MemoryStore {
  private vectorIndex: VectorIndex;
  private entityStore: EntityStore;
  private frames: SmartFrame[] = [];
  private config: MemoryStoreConfig;
  private embeddingDim: number;

  constructor(config: MemoryStoreConfig) {
    this.config = config;
    this.embeddingDim = DEFAULT_DIMENSION;
    this.vectorIndex = new VectorIndex({
      maxFrames: config.maxIndexSize ?? 50000,
    });
    this.entityStore = new EntityStore();
  }

  // ─── Write ───

  /**
   * Add a new memory frame. ADD-only: never overwrites.
   * 
   * Steps:
   * 1. Create SmartFrame with embedding
   * 2. Verify integrity
   * 3. Add to vector index
   * 4. Extract and link entities
   * 5. Persist to disk
   */
  async add(params: {
    type: MemoryType;
    content: string;
    summary?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<WriteResult> {
    const entities = extractEntities(params.content);
    const embedding = hashToEmbedding(params.content, this.embeddingDim);

    const frame = createSmartFrame({
      type: params.type,
      content: params.content,
      embedding,
      summary: params.summary,
      entities,
      tags: params.tags ?? [],
      metadata: params.metadata ?? {},
    });

    // Verify integrity of the created frame
    if (!verifyIntegrity(frame)) {
      throw new Error('Frame integrity check failed');
    }

    // Add to vector index
    this.vectorIndex.add(frame);

    // Link entities
    const linkedIds: string[] = [];
    for (const entityName of entities) {
      const entity = this.entityStore.ensure(entityName, 'concept');
      this.entityStore.linkFrame(entity.id, frame.id);
      linkedIds.push(entity.id);
    }

    // Add to frames array
    this.frames.push(frame);

    // Auto-persist
    await this.persist();

    return {
      frame,
      linkedEntityIds: linkedIds,
    };
  }

  /**
   * Add multiple frames in batch.
   */
  async addMany(params: Array<{
    type: MemoryType;
    content: string;
    summary?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }>): Promise<WriteResult[]> {
    const results: WriteResult[] = [];
    for (const p of params) {
      results.push(await this.add(p));
    }
    return results;
  }

  // ─── Retrieve ───

  /**
   * Search memories using hybrid semantic + keyword + temporal ranking.
   * 
   * This is the single-pass retrieval from mem0 v3: one call, no agentic loops.
   */
  async search(query: string, options: Partial<SearchQuery> = {}): Promise<SearchResult[]> {
    const queryEmbedding = hashToEmbedding(query, this.embeddingDim);
    
    const filterTypes = options.types ?? [
      MemoryType.Episodic,
      MemoryType.Semantic,
      MemoryType.Procedural,
      MemoryType.Autobiographical,
    ];

    // Step 1: Vector similarity search
    const vectorResults = this.vectorIndex.search(queryEmbedding, {
      limit: options.limit ?? 50,
      minSimilarity: options.minSimilarity ?? this.config.minSimilarity ?? 0.3,
      filterTypes,
      filterTags: options.tags,
      filterEntities: options.entities,
    });

    // Step 2: Temporal ranking
    const orderBy = options.orderBy ?? 'mixed';
    
    if (orderBy === 'similarity') {
      // Pure similarity ranking
      return vectorResults;
    }

    if (orderBy === 'time') {
      // Pure temporal ranking (most recent first)
      const ranked = [...vectorResults].sort(
        (a, b) =>
          new Date(b.frame.createdAt).getTime() -
          new Date(a.frame.createdAt).getTime()
      );
      return ranked;
    }

    // Mixed (similarity + temporal) — default
    const temporalWeight = this.config.enableTemporalReasoning !== false ? 0.2 : 0;
    return rankResults(vectorResults, { temporalWeight });
  }

  // ─── Compression ───

  /**
   * Compress related frames into summary frames.
   * ADD-only: originals are preserved, new summaries are appended.
   */
  async compress(request: CompressionRequest): Promise<CompressionResult[]> {
    // Group frames by the specified grouping key
    const groups: Map<string, SmartFrame[]> = new Map();

    for (const frame of this.frames) {
      let key: string;
      
      switch (request.groupBy) {
        case 'same-entity': {
          // Group by most common entity
          const entityCounts = new Map<string, number>();
          for (const e of frame.entities) {
            entityCounts.set(e, (entityCounts.get(e) ?? 0) + 1);
          }
          key = entityCounts.size > 0
            ? [...entityCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
            : frame.id.slice(0, 8);
          break;
        }
        case 'same-day': {
          // Group by day
          const day = frame.createdAt.slice(0, 10);
          key = `day-${day}`;
          break;
        }
        case 'same-tag': {
          // Group by first tag
          key = frame.tags.length > 0 ? `tag-${frame.tags[0]}` : 'untagged';
          break;
        }
        default:
          key = frame.id.slice(0, 8);
      }

      const group = groups.get(key) ?? [];
      group.push(frame);
      groups.set(key, group);
    }

    // Compress groups meeting criteria
    const results: CompressionResult[] = [];
    const maxFrames = request.maxFramesPerGroup ?? 5;
    const minGroupSize = request.minGroupSize ?? 2;

    for (const [key, groupFrames] of groups) {
      if (groupFrames.length < minGroupSize) continue;

      // Take up to maxFrames from this group
      const framesToCompress = groupFrames.slice(0, maxFrames);
      const content = framesToCompress.map((f) => f.content).join('\n---\n');
      const summary = framesToCompress
        .map((f) => f.summary || f.content.slice(0, 100))
        .join(' ')
        .slice(0, 500);

      const embedding = hashToEmbedding(summary, this.embeddingDim);
      const allEntities = [...new Set(framesToCompress.flatMap((f) => f.entities))];
      const allTags = [...new Set(framesToCompress.flatMap((f) => f.tags))];

      const compressedFrame = createSmartFrame({
        type: MemoryType.Semantic,
        content,
        embedding,
        summary,
        entities: allEntities,
        tags: allTags,
        metadata: {
          compressed: true,
          sourceFrameIds: framesToCompress.map((f) => f.id),
          compressionDate: new Date().toISOString(),
        },
      });

      this.vectorIndex.add(compressedFrame);
      this.frames.push(compressedFrame);

      results.push({
        compressedFrame,
        sourceFrameIds: framesToCompress.map((f) => f.id),
      });
    }

    await this.persist();
    return results;
  }

  // ─── Persistence ───

  /**
   * Save all state to the .mv2 file.
   */
  async persist(): Promise<void> {
    // Ensure directory exists
    const dir = this.config.path.replace(/\/[^/]*$/, '');
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const buffer = buildMv2File(this.frames, this.entityStore.getAll(), this.config);
    await writeFile(this.config.path, buffer);
  }

  /**
   * Load all state from the .mv2 file.
   */
  async load(): Promise<void> {
    if (!existsSync(this.config.path)) {
      return; // Empty store, nothing to load
    }

    const buffer = await readFile(this.config.path);
    const { frames, entities } = parseMv2File(buffer);

    this.frames = frames;
    this.entityStore.clear();

    // Rebuild entity store
    for (const entity of entities) {
      this.entityStore.ensure(entity.name, entity.entityType);
      for (const frameId of entity.frameIds) {
        this.entityStore.linkFrame(entity.id, frameId);
      }
    }

    // Rebuild vector index
    this.vectorIndex.clear();
    for (const frame of frames) {
      this.vectorIndex.add(frame);
    }

    // Update dimension
    if (frames.length > 0) {
      this.embeddingDim = frames[0].embedding.length;
    }
  }

  // ─── Query ───

  /**
   * Get a frame by ID.
   */
  getFrame(id: string): SmartFrame | undefined {
    return this.frames.find((f) => f.id === id);
  }

  /**
   * Get all frames.
   */
  getAllFrames(): SmartFrame[] {
    return [...this.frames];
  }

  /**
   * Get store statistics.
   */
  stats(): {
    frameCount: number;
    entityCount: number;
    vectorIndex: ReturnType<VectorIndex['stats']>;
    fileSizeBytes?: number;
  } {
    const stats = {
      frameCount: this.frames.length,
      entityCount: this.entityStore.count(),
      vectorIndex: this.vectorIndex.stats(),
    };

    try {
      if (existsSync(this.config.path)) {
        const fs = require('fs');
        const stat = fs.statSync(this.config.path);
        stats.fileSizeBytes = stat.size;
      }
    } catch {
      // File not yet persisted
    }

    return stats;
  }

  /**
   * Get entity information.
   */
  getEntity(entityId: string): ReturnType<EntityStore['get']> {
    return this.entityStore.get(entityId);
  }

  getAllEntities(): ReturnType<EntityStore['getAll']> {
    return this.entityStore.getAll();
  }

  // ─── Management ───

  /**
   * Remove a frame and re-index.
   */
  async removeFrame(frameId: string): Promise<boolean> {
    const idx = this.frames.findIndex((f) => f.id === frameId);
    if (idx === -1) return false;

    this.frames.splice(idx, 1);
    this.vectorIndex.remove(frameId);
    await this.persist();
    return true;
  }

  /**
   * Clear all memories (reset store to empty).
   */
  async clear(): Promise<void> {
    this.frames = [];
    this.vectorIndex.clear();
    this.entityStore.clear();
    await this.persist();
  }

  /**
   * Get frame count.
   */
  count(): number {
    return this.frames.length;
  }

  /**
   * Create a MemoryStore from a config, auto-loading if file exists.
   */
  static async open(config: MemoryStoreConfig): Promise<MemoryStore> {
    const store = new MemoryStore(config);
    await store.load();
    return store;
  }
}
