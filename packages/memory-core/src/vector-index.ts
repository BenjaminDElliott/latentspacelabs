/**
 * Vector Index — approximate nearest neighbor search using cosine similarity.
 *
 * Implements an efficient flat-index vector store with cosine similarity scoring.
 * For Phase 1, uses brute-force cosine search (fast for <50K embeddings).
 * HNSW indexing is planned for Phase 2.
 *
 * Design goals:
 * - ADD-only: vectors are never modified in place
 * - Sub-5ms retrieval for <10K vectors
 * - Simple, portable, no external dependencies
 */

import { SmartFrame, SearchResult } from './types.js';

// ─── Vector Math ───

/** Compute dot product of two vectors */
function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/** Compute L2 norm of a vector */
function norm(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

/** Cosine similarity between two vectors (returns 0-1) */
function cosineSimilarity(a: number[], b: number[]): number {
  const dot = dotProduct(a, b);
  const normA = norm(a);
  const normB = norm(b);
  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, Math.min(1, dot / (normA * normB)));
}

/** Normalize a vector to unit length */
function normalize(v: number[]): number[] {
  const n = norm(v);
  if (n === 0) return new Array(v.length).fill(0);
  return v.map((x) => x / n);
}

// ─── Vector Index ───

export interface VectorIndexStats {
  dimension: number;
  frameCount: number;
  maxFrames: number;
  avgQueryTimeMs: number;
}

/**
 * Flat vector index supporting ADD-only insertions and cosine similarity search.
 *
 * Frames are stored in insertion order. On search, we scan all vectors and
 * return top-K by cosine similarity. For <10K vectors, this is typically
 * under 1ms on modern hardware.
 */
export class VectorIndex {
  private frames: SmartFrame[] = [];
  private normalizedEmbeddings: number[][] = [];
  private vectorDim: number = 0;
  private maxFrames: number;
  private queryCount: number = 0;
  private totalQueryTime: number = 0;

  constructor(options?: { maxFrames?: number }) {
    this.maxFrames = options?.maxFrames ?? 50000;
  }

  /**
   * Add a frame to the index. Append-only — no overwrite.
   */
  add(frame: SmartFrame): void {
    if (this.vectorDim === 0) {
      this.vectorDim = frame.embedding.length;
    } else if (frame.embedding.length !== this.vectorDim) {
      throw new Error(
        `Dimension mismatch: expected ${this.vectorDim}, got ${frame.embedding.length}`,
      );
    }

    // Enforce max size: evict oldest if exceeded
    if (this.frames.length >= this.maxFrames) {
      this.frames.shift();
      this.normalizedEmbeddings.shift();
    }

    this.frames.push(frame);
    this.normalizedEmbeddings.push(normalize(frame.embedding));
  }

  /**
   * Search for top-K similar frames.
   * Uses cosine similarity with optional minimum threshold.
   */
  search(
    queryEmbedding: number[],
    options: {
      limit?: number;
      minSimilarity?: number;
      filterTypes?: string[];
      filterTags?: string[];
      filterEntities?: string[];
    } = {},
  ): SearchResult[] {
    const startTime = performance.now();
    const limit = options.limit ?? 10;
    const minSimilarity = options.minSimilarity ?? 0.3;
    const normalizedQuery = normalize(queryEmbedding);

    // Early exit for empty index
    if (this.frames.length === 0) {
      return [];
    }

    const results: SearchResult[] = [];

    for (let i = 0; i < this.frames.length; i++) {
      const frame = this.frames[i];

      // Type filter
      if (options.filterTypes && !options.filterTypes.includes(frame.type)) {
        continue;
      }

      // Tag filter
      if (options.filterTags && options.filterTags.length > 0) {
        const hasTag = options.filterTags.some((t) => frame.tags.includes(t));
        if (!hasTag) continue;
      }

      // Entity filter
      if (options.filterEntities && options.filterEntities.length > 0) {
        const hasEntity = options.filterEntities.some((e) => frame.entities.includes(e));
        if (!hasEntity) continue;
      }

      const similarity = cosineSimilarity(normalizedQuery, this.normalizedEmbeddings[i]);

      if (similarity >= minSimilarity) {
        results.push({
          frame,
          similarity,
          score: similarity, // will be updated by temporal ranker
        });
      }
    }

    // Sort by similarity descending and trim
    results.sort((a, b) => b.similarity - a.similarity);
    const trimmed = results.slice(0, limit);

    // Update lastReadAt for all matched frames
    const now = new Date().toISOString();
    for (const r of trimmed) {
      r.frame.lastReadAt = now;
    }

    const elapsed = performance.now() - startTime;
    this.queryCount++;
    this.totalQueryTime += elapsed;

    return trimmed;
  }

  /**
   * Remove a frame by ID (creates a new index without it).
   * Used by compaction.
   */
  remove(frameId: string): void {
    const idx = this.frames.findIndex((f) => f.id === frameId);
    if (idx !== -1) {
      this.frames.splice(idx, 1);
      this.normalizedEmbeddings.splice(idx, 1);
    }
  }

  /**
   * Get the full list of frames (for serialization).
   */
  getFrames(): SmartFrame[] {
    return [...this.frames];
  }

  /**
   * Get count of indexed frames.
   */
  count(): number {
    return this.frames.length;
  }

  /**
   * Get dimensionality of the index.
   */
  getDimension(): number {
    return this.vectorDim;
  }

  /**
   * Get index statistics.
   */
  stats(): VectorIndexStats {
    return {
      dimension: this.vectorDim,
      frameCount: this.frames.length,
      maxFrames: this.maxFrames,
      avgQueryTimeMs: this.queryCount > 0 ? this.totalQueryTime / this.queryCount : 0,
    };
  }

  /**
   * Reset the index to empty state.
   */
  clear(): void {
    this.frames = [];
    this.normalizedEmbeddings = [];
    this.vectorDim = 0;
    this.queryCount = 0;
    this.totalQueryTime = 0;
  }
}
