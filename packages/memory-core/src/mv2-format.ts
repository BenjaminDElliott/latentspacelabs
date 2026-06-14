/**
 * MV2 Format — single-file memory serialization.
 *
 * The .mv2 file structure:
 * ┌──────────────────────────┐
 * │ Header (version, flags)  │  256 bytes fixed
 * ├──────────────────────────┤
 * │ Entity Index (JSON)      │  variable
 * ├──────────────────────────┤
 * │ Frame Records (JSONL)    │  variable
 * ├──────────────────────────┤
 * │ Footer (checksum + stats)│  128 bytes fixed
 * └──────────────────────────┘
 *
 * Design decisions:
 * - JSON/JSONL for readability and debuggability
 * - Fixed header/footer for fast parsing
 * - No binary vector section yet (stored as JSON array in frames)
 * - Planned Phase 2: binary vector index section for performance
 *
 * File format version: mv2.0 (Phase 1)
 */
/// <reference types="node" />

import { SmartFrame, Entity, MemoryStoreConfig, Mv2Header, Mv2Flags, Mv2Footer } from './types.js';
import { createHash } from 'crypto';

// ─── Types ───

export interface Mv2Footer {
  checksum: string;
  version: string;
  frameCount: number;
  entityCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ───

const HEADER_SIZE = 256;
const FOOTER_SIZE = 128;
const MAGIC_BYTES = Buffer.from('MV2\x01', 'utf-8'); // magic + version byte
const HEADER_VERSION = 'mv2.0';

// ─── Header ───

/** Serialize the file header */
function serializeHeader(header: Mv2Header): Buffer {
  const flags: Mv2Flags = {
    keywordEnabled: true, // Phase 1 always enables keyword search
    temporalEnabled: true,
    encrypted: false,
  };

  const data = {
    magic: 'MV2\x01',
    formatVersion: HEADER_VERSION,
    libraryVersion: '0.1.0',
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    frameCount: header.frameCount,
    entityCount: header.entityCount,
    flags,
  };

  const json = JSON.stringify(data);
  const buf = Buffer.alloc(HEADER_SIZE);
  buf.write(json, 0, Math.min(json.length, HEADER_SIZE - MAGIC_BYTES.length));
  MAGIC_BYTES.copy(buf, HEADER_SIZE - MAGIC_BYTES.length);

  return buf;
}

/** Parse the file header */
function parseHeader(buf: Buffer): Mv2Header {
  const json = buf.toString('utf-8', 0, HEADER_SIZE - MAGIC_BYTES.length);
  const data = JSON.parse(json);

  return {
    formatVersion: data.formatVersion,
    libraryVersion: data.libraryVersion,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    frameCount: data.frameCount,
    entityCount: data.entityCount,
    flags: data.flags,
  };
}

// ─── Serialization ───

/**
 * Serialize a SmartFrame to a plain JSON object for storage.
 */
export function serializeFrame(frame: SmartFrame): Record<string, unknown> {
  return {
    id: frame.id,
    type: frame.type,
    content: frame.content,
    embedding: frame.embedding,
    summary: frame.summary,
    entities: frame.entities,
    tags: frame.tags,
    createdAt: frame.createdAt,
    lastReadAt: frame.lastReadAt,
    contentHash: frame.contentHash,
    metadata: frame.metadata,
  };
}

/**
 * Serialize a set of frames to JSONL lines.
 */
export function serializeFrames(frames: SmartFrame[]): string {
  return frames.map((f) => JSON.stringify(serializeFrame(f))).join('\n');
}

/**
 * Deserialize frame records from JSONL.
 */
export function deserializeFrames(jsonl: string): SmartFrame[] {
  const lines = jsonl.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const raw = JSON.parse(line);
    return {
      id: raw.id,
      type: raw.type,
      content: raw.content,
      embedding: raw.embedding,
      summary: raw.summary,
      entities: raw.entities ?? [],
      tags: raw.tags ?? [],
      createdAt: raw.createdAt,
      lastReadAt: raw.lastReadAt,
      contentHash: raw.contentHash,
      metadata: raw.metadata ?? {},
    };
  });
}

/**
 * Serialize a set of entities to JSON.
 */
export function serializeEntities(entities: Entity[]): string {
  return JSON.stringify(entities);
}

/**
 * Deserialize entity index from JSON.
 */
export function deserializeEntities(json: string): Entity[] {
  const arr = JSON.parse(json);
  return arr.map((e: Record<string, unknown>) => ({
    id: e.id as string,
    name: e.name as string,
    entityType: e.entityType as string,
    frameIds: e.frameIds as string[],
    metadata: e.metadata as Record<string, unknown>,
  }));
}

// ─── Full File ───

/**
 * Build the complete .mv2 file content from frames and entities.
 */
export function buildMv2File(
  frames: SmartFrame[],
  entities: Entity[],
  config: MemoryStoreConfig,
): Buffer {
  const now = new Date().toISOString();
  const header: Mv2Header = {
    formatVersion: HEADER_VERSION,
    libraryVersion: '0.1.0',
    createdAt: now,
    updatedAt: now,
    frameCount: frames.length,
    entityCount: entities.length,
    flags: {
      keywordEnabled: true,
      temporalEnabled: true,
      encrypted: false,
    },
  };

  const headerBuf = serializeHeader(header);
  const entityJson = serializeEntities(entities);
  const framesJsonl = serializeFrames(frames);
  const content = `${entityJson}\n${framesJsonl}`;

  // Compute checksum over header + content
  const checksumInput = Buffer.concat([headerBuf, Buffer.from(content, 'utf-8')]);
  const checksum = createHash('sha256').update(checksumInput).digest('hex').slice(0, 64);

  const footer: Mv2Footer = {
    checksum,
    version: HEADER_VERSION,
    frameCount: frames.length,
    entityCount: entities.length,
    createdAt: header.createdAt,
    updatedAt: now,
  };

  const footerJson = JSON.stringify(footer);
  const footerBuf = Buffer.alloc(FOOTER_SIZE);
  footerBuf.write(footerJson, 0, Math.min(footerJson.length, FOOTER_SIZE));

  return Buffer.concat([headerBuf, Buffer.from(content, 'utf-8'), footerBuf]);
}

/**
 * Parse a .mv2 file buffer into frames and entities.
 */
export function parseMv2File(buf: Buffer): {
  header: Mv2Header;
  frames: SmartFrame[];
  entities: Entity[];
} {
  // Verify magic bytes
  const magic = buf.slice(buf.length - FOOTER_SIZE, buf.length - FOOTER_SIZE + 4);
  if (!magic.equals(MAGIC_BYTES)) {
    throw new Error('Invalid MV2 file: magic bytes mismatch');
  }

  // Verify footer checksum
  const footerRaw = buf.slice(buf.length - FOOTER_SIZE);
  const footerJson = footerRaw.toString('utf-8').trim();
  const footer: Mv2Footer = JSON.parse(footerJson);

  const expectedChecksum = createHash('sha256')
    .update(buf.slice(0, buf.length - FOOTER_SIZE))
    .digest('hex')
    .slice(0, 64);

  if (footer.checksum !== expectedChecksum) {
    throw new Error('Invalid MV2 file: checksum mismatch');
  }

  // Parse header
  const header = parseHeader(buf);

  // Parse content (between header and footer)
  const content = buf.slice(HEADER_SIZE, buf.length - FOOTER_SIZE).toString('utf-8');

  // Split into entity index and frame records
  const newlineIdx = content.indexOf('\n');
  if (newlineIdx === -1) {
    // No entity index, all frames
    const frames = deserializeFrames(content);
    return { header, frames, entities: [] };
  }

  const entityJson = content.slice(0, newlineIdx);
  const framesJsonl = content.slice(newlineIdx + 1);

  const entities = entityJson.trim().length > 0 ? deserializeEntities(entityJson) : [];
  const frames = framesJsonl.trim().length > 0 ? deserializeFrames(framesJsonl) : [];

  return { header, frames, entities };
}
