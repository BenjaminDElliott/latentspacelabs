/**
 * Lightweight embedding module for RAG-based experience retrieval.
 *
 * Phase 1 uses a simple hash-based embedding (simHash-style) for
 * similarity search without external dependencies. This keeps the
 * package self-contained and fast.
 *
 * The embedding is computed from:
 * - Task summary (most important for retrieval)
 * - Action types taken
 * - Tags assigned
 * - Outcome classification
 *
 * For Phase 2+, this can be swapped for a real embedding model (OpenAI,
 * Sentence Transformers, etc.) with minimal interface changes.
 */

// ─── Type Definitions ───────────────────────────────────────────────────────

/**
 * A fixed-size embedding vector.
 * Phase 1 uses 128-dimensional vectors for efficiency.
 */
export type Embedding = number[];

/**
 * Configuration for the embedding module.
 */
export interface EmbeddingConfig {
  /** Dimension of the embedding vector. Default: 128. */
  dimension: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_DIMENSION = 128;

// ─── Hash Functions ─────────────────────────────────────────────────────────

/**
 * Simple deterministic hash function (djb2 variant).
 * Returns a non-negative integer from any string.
 */
function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  return h >>> 0; // unsigned 32-bit
}

/**
 * Hash a string into a vector of ±1 values.
 * Uses multiple hash positions for better distribution.
 */
function stringToBinaryVector(str: string, dimension: number): number[] {
  const vec = new Float32Array(dimension);

  // Use multiple hash positions for robustness
  const numHashes = Math.max(dimension, 8);
  for (let i = 0; i < numHashes; i++) {
    const h = hash(str + `|${i}`);
    // Spread bits across the vector
    const bits = (h * (h + 1)) >>> 0; // quadratic spread
    for (let b = 0; b < dimension && b < 32; b++) {
      if (bits & (1 << b)) {
        vec[b] += 1;
      } else {
        vec[b] -= 1;
      }
    }
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dimension; i++) {
      vec[i] /= magnitude;
    }
  }

  return Array.from(vec);
}

// ─── Embedding Builder ──────────────────────────────────────────────────────

/**
 * Build an embedding vector from an experience record.
 *
 * The embedding captures the semantic "shape" of the experience:
 * - Task description (weighted heavily)
 * - Action types performed
 * - Tags assigned
 * - Outcome classification
 */
export function buildExperienceEmbedding(
  experience: {
    taskSummary: string;
    taskType: string;
    tags: string[];
    outcomeClassification: string;
    actionTypes: string[];
  },
  config?: Partial<EmbeddingConfig>,
): Embedding {
  const dim: number = (config?.dimension ?? DEFAULT_DIMENSION) as number;

  // Build component vectors
  const taskVec = stringToBinaryVector(experience.taskSummary, dim);
  const typeVec = stringToBinaryVector(experience.taskType, dim);
  const outcomeVec = stringToBinaryVector(experience.outcomeClassification, dim);

  // Aggregate action types and tags
  const actionTypeStr = experience.actionTypes.join(' ');
  const actionVec = stringToBinaryVector(actionTypeStr, dim);

  const tagStr = experience.tags.join(' ');
  const tagVec = tagStr.length > 0 ? stringToBinaryVector(tagStr, dim) : zeroVector(dim);

  // Weighted combination (task summary is most important for retrieval)
  const combined = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    combined[i] =
      3.0 * taskVec[i] + // Task summary: highest weight
      1.5 * typeVec[i] + // Task type: moderate weight
      1.0 * actionVec[i] + // Actions performed: baseline weight
      0.5 * outcomeVec[i] + // Outcome: low weight
      0.3 * tagVec[i]; // Tags: lowest weight
  }

  // Normalize
  const magnitude = Math.sqrt(combined.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dim; i++) {
      combined[i] /= magnitude;
    }
  }

  return Array.from(combined);
}

/**
 * Build an embedding from a search query (text to match against experiences).
 */
export function buildQueryEmbedding(query: string, config?: Partial<EmbeddingConfig>): Embedding {
  const dim: number = (config?.dimension ?? DEFAULT_DIMENSION) as number;
  return stringToBinaryVector(query, dim);
}

/**
 * Compute cosine similarity between two embeddings.
 * Returns a value in [-1, 1]; for normalized vectors, this is the dot product.
 */
export function cosineSimilarity(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimensions mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += (a[i] ?? 0) * (b[i] ?? 0);
  }

  return dotProduct;
}

/**
 * Create a zero vector of the given dimension.
 */
function zeroVector(dimension: number): number[] {
  return new Array(dimension).fill(0);
}
