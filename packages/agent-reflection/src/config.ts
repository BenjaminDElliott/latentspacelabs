/**
 * Configuration utilities for the Agent Self-Improvement System.
 *
 * Provides validation, merging, and defaults for both the reflection engine
 * and experience store configs.
 */

import type { ExperienceStoreConfig, ReflectionDepth, ReflectionEngineConfig } from './types.js';
import { DEFAULT_EXPERIENCE_STORE_CONFIG, DEFAULT_REFLECTION_ENGINE_CONFIG } from './types.js';

/**
 * Merge user overrides with defaults for the experience store config.
 * Validates critical invariants.
 */
export function mergeExperienceStoreConfig(
  overrides?: Partial<ExperienceStoreConfig>,
): ExperienceStoreConfig {
  const config: ExperienceStoreConfig = {
    ...DEFAULT_EXPERIENCE_STORE_CONFIG,
    ...overrides,
  };

  // Validate invariants
  if (config.maxExperiences < 1) {
    throw new Error(`maxExperiences must be >= 1, got ${config.maxExperiences}`);
  }
  if (config.maxPromptLength < 128) {
    throw new Error(`maxPromptLength must be >= 128, got ${config.maxPromptLength}`);
  }
  if (config.maxOutputLength < 64) {
    throw new Error(`maxOutputLength must be >= 64, got ${config.maxOutputLength}`);
  }

  return config;
}

/**
 * Merge user overrides with defaults for the reflection engine config.
 * Validates critical invariants.
 */
export function mergeReflectionEngineConfig(
  overrides?: Partial<ReflectionEngineConfig>,
): ReflectionEngineConfig {
  const config: ReflectionEngineConfig = {
    ...DEFAULT_REFLECTION_ENGINE_CONFIG,
    ...overrides,
  };

  // Validate invariants
  const validDepths = ['quick', 'standard', 'deep'] as const;
  if (!validDepths.includes(config.defaultDepth)) {
    throw new Error(
      `defaultDepth must be one of ${validDepths.join(', ')}, got "${config.defaultDepth}"`,
    );
  }
  if (config.maxReflectionTokens < 10) {
    throw new Error(`maxReflectionTokens must be >= 10, got ${config.maxReflectionTokens}`);
  }
  if (config.ruleActionThreshold < 0 || config.ruleActionThreshold > 1) {
    throw new Error(
      `ruleActionThreshold must be between 0 and 1, got ${config.ruleActionThreshold}`,
    );
  }

  return config;
}

/**
 * Validate a reflection depth string.
 */
export function isValidDepth(depth: string): depth is 'quick' | 'standard' | 'deep' {
  return ['quick', 'standard', 'deep'].includes(depth);
}

/**
 * Get the expected token budget for a given reflection depth.
 * Used to enforce the ≤500 tokens constraint.
 */
export function getExpectedTokenBudget(depth: ReflectionDepth): number {
  switch (depth) {
    case 'quick':
      return 50;
    case 'standard':
      return 150;
    case 'deep':
      return 500;
  }
}
