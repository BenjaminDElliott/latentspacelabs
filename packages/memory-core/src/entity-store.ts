/**
 * Entity Store — manages entity definitions and cross-memory links.
 *
 * Entities are extracted from SmartFrames and tracked in an index.
 * Entity linking enables cross-memory context discovery — the same
 * entity mentioned in different frames gets connected.
 *
 * ADD-only: entities are never updated, only new frame references appended.
 */
/// <reference types="node" />

import { Entity } from './types.js';
import { randomUUID } from 'crypto';

/**
 * Create an entity or return existing if canonical name matches.
 * ADD-only: existing entities get new frame references appended.
 */
export class EntityStore {
  private entities: Map<string, Entity> = new Map();
  private nameToEntity: Map<string, string> = new Map(); // canonical name -> entity id

  /**
   * Ensure an entity exists. If name already exists, return existing.
   * Otherwise create a new entity.
   */
  ensure(name: string, entityType: Entity['entityType']): Entity {
    const existingId = this.nameToEntity.get(name.toLowerCase().trim());
    if (existingId) {
      return this.entities.get(existingId)!;
    }

    const entity: Entity = {
      id: randomUUID(),
      name,
      entityType,
      frameIds: [],
      metadata: {},
    };

    this.entities.set(entity.id, entity);
    this.nameToEntity.set(name.toLowerCase().trim(), entity.id);

    return entity;
  }

  /**
   * Link a frame to an entity (ADD-only: appends frameId to existing entity).
   */
  linkFrame(entityId: string, frameId: string): void {
    const entity = this.entities.get(entityId);
    if (entity && !entity.frameIds.includes(frameId)) {
      entity.frameIds.push(frameId);
    }
  }

  /**
   * Get entity by ID.
   */
  get(entityId: string): Entity | undefined {
    return this.entities.get(entityId);
  }

  /**
   * Get all entities.
   */
  getAll(): Entity[] {
    return Array.from(this.entities.values());
  }

  /**
   * Get all frames linked to a set of entity names.
   */
  getFrameIdsForEntities(entityNames: string[]): string[] {
    const frameIds = new Set<string>();
    for (const name of entityNames) {
      const entityId = this.nameToEntity.get(name.toLowerCase().trim());
      if (entityId) {
        const entity = this.entities.get(entityId);
        if (entity) {
          for (const fid of entity.frameIds) {
            frameIds.add(fid);
          }
        }
      }
    }
    return Array.from(frameIds);
  }

  /**
   * Count of entities.
   */
  count(): number {
    return this.entities.size;
  }

  /**
   * Clear all entities.
   */
  clear(): void {
    this.entities.clear();
    this.nameToEntity.clear();
  }
}
