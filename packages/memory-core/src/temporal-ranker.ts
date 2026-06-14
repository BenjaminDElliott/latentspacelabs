/**
 * Temporal Ranker — time-aware retrieval ranking.
 *
 * Implements temporal reasoning from mem0 v3: rank the "right dated instance"
 * for queries about current state, past events, and upcoming plans.
 *
 * Key concepts:
 * - Temporal proximity boost: fresher memories get a small relevance boost
 * - Recency weighting: recently-read items rank higher
 * - Time window filtering: exclude very old memories from top results
 */

import { SearchResult, SmartFrame } from './types.js';

// ─── Temporal Scoring ───

/**
 * Compute a temporal relevance score (0-1) for a frame.
 *
 * Scoring model:
 * - Very recent (0-7 days): score = 1.0 (full boost)
 * - Recent (7-30 days): score = 0.9
 * - Medium (30-90 days): score = 0.7
 * - Old (90-365 days): score = 0.4
 * - Ancient (>365 days): score = 0.1
 *
 * Additionally, recently-read frames get a small recency bonus.
 */
function temporalScore(frame: SmartFrame, now: Date): number {
  const ageMs = now.getTime() - new Date(frame.createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  let baseScore: number;

  if (ageDays <= 7) {
    baseScore = 1.0;
  } else if (ageDays <= 30) {
    baseScore = 0.9;
  } else if (ageDays <= 90) {
    baseScore = 0.7;
  } else if (ageDays <= 365) {
    baseScore = 0.4;
  } else {
    baseScore = 0.1;
  }

  // Recency bonus for recently-read frames (small boost)
  let recencyBonus = 0;
  if (frame.lastReadAt) {
    const readAgeMs = now.getTime() - new Date(frame.lastReadAt).getTime();
    const readAgeDays = readAgeMs / (1000 * 60 * 60 * 24);
    if (readAgeDays <= 1) {
      recencyBonus = 0.05;
    } else if (readAgeDays <= 7) {
      recencyBonus = 0.02;
    }
  }

  return Math.min(1, baseScore + recencyBonus);
}

// ─── Ranked Result ───

/**
 * Temporal ranking options.
 */
export interface TemporalRankOptions {
  /** Weight to apply to temporal score (0-1, higher = more temporal bias) */
  temporalWeight?: number;
  /** Maximum age to include results (in days). 0 = no limit. */
  maxAgeDays?: number;
  /** Minimum recency boost for recently-read items (in days) */
  recencyWindowDays?: number;
}

/**
 * Rank search results by combining similarity and temporal relevance.
 *
 * The composite score is:
 *   score = (1 - temporalWeight) * similarity + temporalWeight * temporalScore
 *
 * This allows tuning between pure semantic match and time-aware relevance.
 */
export function rankResults(
  results: SearchResult[],
  options: TemporalRankOptions = {},
  now?: Date,
): SearchResult[] {
  if (results.length === 0) return results;

  const temporalWeight = options.temporalWeight ?? 0.2;
  const maxAgeDays = options.maxAgeDays ?? 0;
  const temporalNow = now ?? new Date();

  const ranked = results.map((r) => {
    // Apply age filter
    if (maxAgeDays > 0) {
      const ageDays =
        (temporalNow.getTime() - new Date(r.frame.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > maxAgeDays) {
        r.score = 0;
        return r;
      }
    }

    // Compute temporal score
    const ts = temporalScore(r.frame, temporalNow);
    r.temporalScore = ts;

    // Compute composite score
    r.score = (1 - temporalWeight) * r.similarity + temporalWeight * ts;

    return r;
  });

  // Sort by composite score descending
  ranked.sort((a, b) => b.score - a.score);

  // Remove zero-score results (filtered by age)
  return ranked.filter((r) => r.score > 0);
}

/**
 * Get the most recent frame for each entity mentioned in the query.
 * Useful for finding the "current state" of an entity.
 *
 * Returns one frame per entity — the most recently created frame for that entity.
 */
export function getMostRecentPerEntity(
  results: SearchResult[],
  entities: string[],
): SearchResult[] {
  const mostRecent: Record<string, SearchResult> = {};

  for (const result of results) {
    for (const entity of entities) {
      if (result.frame.entities.includes(entity)) {
        const existing = mostRecent[entity];
        if (!existing) {
          mostRecent[entity] = result;
        } else {
          // Compare by createdAt (newer wins)
          if (new Date(result.frame.createdAt) > new Date(existing.frame.createdAt)) {
            mostRecent[entity] = result;
          }
        }
      }
    }
  }

  return Object.values(mostRecent);
}

/**
 * Get frames from a specific time window.
 */
export function filterByTimeWindow(
  results: SearchResult[],
  since: string,
  until?: string,
): SearchResult[] {
  const sinceMs = new Date(since).getTime();
  const untilMs = until ? new Date(until).getTime() : Date.now();

  return results.filter((r) => {
    const frameMs = new Date(r.frame.createdAt).getTime();
    return frameMs >= sinceMs && frameMs <= untilMs;
  });
}
