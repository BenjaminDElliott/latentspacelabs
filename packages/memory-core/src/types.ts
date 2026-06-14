/**
 * Core type definitions for the memory layer.
 *
 * Defines Smart Frames, memory types, entity structures, and search results
 * based on the cognitive architecture taxonomy from the agent memory research.
 */

// ─── Memory Types (Cognitive Architecture Taxonomy) ───

export enum MemoryType {
  /** Event-based historical interaction memory with temporal sequence */
  Episodic = 'episodic',
  /** Facts, rules, and preferences abstracted from experiences */
  Semantic = 'semantic',
  /** Action patterns, skills, task execution strategies */
  Procedural = 'procedural',
  /** Agent identity and persona consistency */
  Autobiographical = 'autobiographical',
}

// ─── Smart Frame ───

/**
 * Immutable memory unit with timestamp, checksum, and metadata.
 * Inspired by memvid's Smart Frames — append-only, never overwritten.
 *
 * Each frame has a unique ID, content hash for change detection,
 * and a creation timestamp for temporal reasoning.
 */
export interface SmartFrame {
  /** Unique frame ID — UUID v4 */
  id: string;
  /** Memory type classification */
  type: MemoryType;
  /** Raw memory content */
  content: string;
  /** Dense embedding vector for similarity search */
  embedding: number[];
  /** Semantic summary (AI-generated or manually provided) */
  summary?: string;
  /** Entities extracted from this memory (names, concepts, references) */
  entities: string[];
  /** Tags for keyword filtering */
  tags: string[];
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last read timestamp — for recency boosting */
  lastReadAt?: string;
  /** Content hash — SHA-256 of content for integrity verification */
  contentHash: string;
  /** Metadata key-value pairs (arbitrary extension) */
  metadata: Record<string, unknown>;
}

// ─── Entity ───

/**
 * An entity (person, concept, tool, location) linked across memories.
 * Entity linking enables cross-memory context discovery.
 */
export interface Entity {
  /** Entity identifier */
  id: string;
  /** Canonical name */
  name: string;
  /** Entity type category */
  entityType: 'person' | 'tool' | 'concept' | 'location' | 'event' | 'code' | 'other';
  /** All frame IDs that reference this entity */
  frameIds: string[];
  /** Entity metadata */
  metadata: Record<string, unknown>;
}

// ─── Search Query ───

export interface SearchQuery {
  /** Text query for semantic matching */
  query: string;
  /** Dense query embedding vector */
  embedding?: number[];
  /** Maximum number of results to return */
  limit?: number;
  /** Minimum similarity threshold (0-1, default: 0.3) */
  minSimilarity?: number;
  /** Memory types to include (default: all) */
  types?: MemoryType[];
  /** Tags to filter by */
  tags?: string[];
  /** Entity names to filter by */
  entities?: string[];
  /** Time window for temporal filtering (e.g., 'P30D' for last 30 days) */
  since?: string;
  /** Override sort: 'similarity', 'time', 'recency', or 'mixed' */
  orderBy?: 'similarity' | 'time' | 'recency' | 'mixed';
}

// ─── Search Result ───

/** A single result from a memory search, with scoring metadata */
export interface SearchResult {
  /** The matched SmartFrame */
  frame: SmartFrame;
  /** Cosine similarity score (0-1) */
  similarity: number;
  /** BM25-style keyword relevance score (0-1, normalized) */
  keywordScore?: number;
  /** Temporal relevance score (0-1) — higher for more relevant time context */
  temporalScore?: number;
  /** Composite score after all rankings */
  score: number;
}

// ─── Write Result ───

/** Result returned after adding a new memory */
export interface WriteResult {
  /** The created SmartFrame */
  frame: SmartFrame;
  /** Frames that were newly linked to extracted entities */
  linkedEntityIds: string[];
}

// ─── Store Configuration ───

export interface MemoryStoreConfig {
  /** Path to the .mv2 memory file */
  path: string;
  /** Maximum frames before auto-compaction triggers (default: 100000) */
  maxFramesBeforeCompaction?: number;
  /** Minimum similarity threshold for retrieval (default: 0.3) */
  minSimilarity?: number;
  /** Maximum frames to retain in the vector index (default: 50000) */
  maxIndexSize?: number;
  /** Enable keyword search via BM25 (default: true) */
  enableKeywordSearch?: boolean;
  /** Enable temporal reasoning boost (default: true) */
  enableTemporalReasoning?: boolean;
}

// ─── Compression ───

/**
 * Compression request: merge related frames into a single summary frame.
 * ADD-only: originals are preserved, new summary frame is appended.
 */
export interface CompressionRequest {
  /** Grouping key (e.g., 'same-entity', 'same-day', 'same-tag') */
  groupBy: string;
  /** Maximum frames to compress into one */
  maxFramesPerGroup?: number;
  /** Minimum frames before a group is eligible for compression */
  minGroupSize?: number;
}

/** Result of a compression operation */
export interface CompressionResult {
  /** The new compressed SmartFrame */
  compressedFrame: SmartFrame;
  /** IDs of frames that were grouped into this compression */
  sourceFrameIds: string[];
}

// ─── MV2 File Format ───

/**
 * The .mv2 file structure:
 * ┌──────────────────────────┐
 * │ Header (version, flags)  │
 * ├──────────────────────────┤
 * │ Entity Index (JSON)      │
 * ├──────────────────────────┤
 * │ Frame Records (JSONL)    │
 * ├──────────────────────────┤
 * │ Vector Index (binary)    │
 * ├──────────────────────────┤
 * │ Keyword Index (JSON)     │
 * ├──────────────────────────┤
 * │ Footer (checksum)        │
 * └──────────────────────────┘
 */
export interface Mv2Header {
  formatVersion: 'mv2.0';
  libraryVersion: string;
  createdAt: string;
  updatedAt: string;
  frameCount: number;
  entityCount: number;
  flags: Mv2Flags;
}

export interface Mv2Flags {
  /** Whether keyword search index is enabled */
  keywordEnabled: boolean;
  /** Whether temporal reasoning is enabled */
  temporalEnabled: boolean;
  /** Whether encryption is applied */
  encrypted: boolean;
}

export interface Mv2Footer {
  checksum: string;
  version: string;
  frameCount: number;
  entityCount: number;
  createdAt: string;
  updatedAt: string;
}
