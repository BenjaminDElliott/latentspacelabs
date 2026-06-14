/**
 * Smart Frame — the immutable memory unit.
 * 
 * Inspired by memvid's Smart Frames (video encoding metaphor).
 * Frames are append-only: never overwritten, never mutated in place.
 * Each frame has a content hash for integrity verification.
 */

import { SmartFrame, MemoryType } from './types.js';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';

/**
 * Compute SHA-256 hash of content string.
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Create a new SmartFrame instance.
 * 
 * @param params - Frame parameters
 * @returns A new immutable SmartFrame
 */
export function createSmartFrame(params: {
  type: MemoryType;
  content: string;
  embedding: number[];
  summary?: string;
  entities?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}): SmartFrame {
  if (params.embedding.length === 0) {
    throw new Error('Embedding vector must be non-empty');
  }

  return {
    id: randomUUID(),
    type: params.type,
    content: params.content,
    embedding: [...params.embedding], // immutable copy
    summary: params.summary,
    entities: params.entities ?? [],
    tags: params.tags ?? [],
    createdAt: new Date().toISOString(),
    lastReadAt: undefined,
    contentHash: hashContent(params.content),
    metadata: params.metadata ?? {},
  };
}

/**
 * Create a SmartFrame from raw data (for deserialization).
 */
export function fromRaw(raw: Record<string, unknown>): SmartFrame {
  return {
    id: raw.id as string,
    type: raw.type as MemoryType,
    content: raw.content as string,
    embedding: raw.embedding as number[],
    summary: (raw.summary as string) ?? undefined,
    entities: (raw.entities as string[]) ?? [],
    tags: (raw.tags as string[]) ?? [],
    createdAt: raw.createdAt as string,
    lastReadAt: (raw.lastReadAt as string) ?? undefined,
    contentHash: raw.contentHash as string,
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
  };
}

/**
 * Verify a frame's content integrity against its stored hash.
 */
export function verifyIntegrity(frame: SmartFrame): boolean {
  return frame.contentHash === hashContent(frame.content);
}

/**
 * Get the frame's age in milliseconds (time since creation).
 */
export function frameAge(frame: SmartFrame): number {
  return Date.now() - new Date(frame.createdAt).getTime();
}

/**
 * Get the frame's age in days (float).
 */
export function frameAgeDays(frame: SmartFrame): number {
  return frameAge(frame) / (1000 * 60 * 60 * 24);
}

/**
 * Check if a frame is considered "fresh" (created within the given age threshold).
 */
export function isFresh(frame: SmartFrame, maxAgeDays: number): boolean {
  return frameAgeDays(frame) <= maxAgeDays;
}
