# ECC ↔ Hermes SKILL.md Compatibility Matrix

**Task:** LAT-294 — ECC Skill Format Compatibility Audit
**Date:** 2026-06-14
**Source:** [affaan-m/ECC](https://github.com/affaan-m/ECC)

---

## 1. Format Overview

Both ECC and Hermes use markdown SKILL.md files with YAML frontmatter. The formats overlap significantly but have key differences in field naming, required fields, and optional metadata.

### Hermes SKILL.md Frontmatter Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique skill identifier |
| `description` | string | Yes | Human-readable description of the skill |
| `version` | string | No | Semantic version (e.g., 1.0.0) |
| `author` | string | No | Skill author or creator |
| `category` | string | No | Skill category for organization |
| `allowed-tools` | string | No | Comma-separated list of allowed tools |
| `hidden` | boolean | No | Whether the skill is hidden from listing |

### ECC SKILL.md Frontmatter Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique skill identifier |
| `description` | string | Yes | Human-readable description of the skill |
| `allowed-tools` | string | No | Comma-separated list of allowed tools |

## 2. Field-by-Field Comparison

| Field | Hermes | ECC | Migration Required | Notes |
|-------|--------|-----|-------------------|-------|
| `allowed-tools` | ✅ | ✅ | No | Both support; ECC format differs (space-separated vs comma-separated) |
| `author` | ✅ | ❌ | Yes | Hermes tracks authorship; ECC does not |
| `category` | ✅ | ❌ | Yes | Hermes uses category for organization |
| `description` | ✅ | ✅ | No | Common field, compatible |
| `hidden` | ✅ | ❌ | Yes | Hermes supports hidden flag for skills |
| `name` | ✅ | ✅ | No | Common field, compatible |
| `version` | ✅ | ❌ | Yes | Hermes uses semver; ECC lacks versioning |

## 3. Sample Skill Analysis

Analyzed **20 skills** from ECC repository.

| # | Skill | Frontmatter Fields | Compatible |
|---|-------|-------------------|------------|
| 1 | `.agents/skills/agent-introspection-debugging/SKILL.md` | `name, description` | ✅ |
| 2 | `.agents/skills/agent-sort/SKILL.md` | `name, description` | ✅ |
| 3 | `.agents/skills/api-design/SKILL.md` | `name, description` | ✅ |
| 4 | `.agents/skills/article-writing/SKILL.md` | `name, description` | ✅ |
| 5 | `.agents/skills/backend-patterns/SKILL.md` | `name, description` | ✅ |
| 6 | `.agents/skills/brand-voice/SKILL.md` | `name, description` | ✅ |
| 7 | `.agents/skills/bun-runtime/SKILL.md` | `name, description` | ✅ |
| 8 | `.agents/skills/coding-standards/SKILL.md` | `name, description` | ✅ |
| 9 | `.agents/skills/content-engine/SKILL.md` | `name, description` | ✅ |
| 10 | `.agents/skills/crosspost/SKILL.md` | `name, description` | ✅ |
| 11 | `.agents/skills/deep-research/SKILL.md` | `name, description` | ✅ |
| 12 | `.agents/skills/dmux-workflows/SKILL.md` | `name, description` | ✅ |
| 13 | `.agents/skills/documentation-lookup/SKILL.md` | `name, description` | ✅ |
| 14 | `.agents/skills/e2e-testing/SKILL.md` | `name, description` | ✅ |
| 15 | `.agents/skills/eval-harness/SKILL.md` | `name, description, allowed-tools` | ✅ |
| 16 | `.agents/skills/everything-claude-code/SKILL.md` | `name, description` | ✅ |
| 17 | `.agents/skills/exa-search/SKILL.md` | `name, description` | ✅ |
| 18 | `.agents/skills/fal-ai-media/SKILL.md` | `name, description` | ✅ |
| 19 | `.agents/skills/frontend-patterns/SKILL.md` | `name, description` | ✅ |
| 20 | `.agents/skills/frontend-slides/SKILL.md` | `name, description` | ✅ |

**Compatibility rate:** 20/20 skills (100%) have fully compatible frontmatter with Hermes schema.

## 4. Summary Statistics

| Metric | Value |
|--------|-------|
| ECC skills analyzed | 20 |
| Skills with `name` field | 20 |
| Skills with `description` field | 20 |
| Skills with `allowed-tools` field | 1 |
| Skills with `version` field | 0 |
| Skills with `author` field | 0 |
| Fully compatible skills | 20/20 |
| Hermes-only fields (in Hermes, not ECC) | 4 |
| Fields needing migration | 4 |

## 5. Migration Requirements

### Required Migrations

When importing ECC skills into Hermes, the following fields need handling:

1. **`version`**: Missing in ECC → Add default version `1.0.0` during import
2. **`author`**: Missing in ECC → Set to `ecc` (source system) or leave blank
3. **`category`**: Missing in both → Can derive from skill path (e.g., `.agents/skills/<category>/`)
4. **`hidden`**: Missing in ECC → Default to `false`

### allowed-tools Format Difference

- **ECC format:** Space-separated values (e.g., `"Read, Write, Edit, Bash, Grep, Glob"`) — 
  note the comma-space separation within the value
- **Hermes format:** Space-separated tool patterns (e.g., `"Bash(npx:*) Bash(npm:*)"`) —   space-separated patterns with parenthetical patterns

### Backward Compatibility

The formats are **largely backward compatible** because:

1. Both formats share the same `name` and `description` fields (the minimum viable schema)
2. ECC skills can be imported as-is into Hermes with sensible defaults for missing fields
3. The migration adapter (`ecc_migration_adapter.py`) handles automatic field mapping

---

*Generated by LAT-294 ECC Compatibility Audit*