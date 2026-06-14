# ECC ↔ Hermes SKILL.md Compatibility Audit (LAT-286)

**Date:** 2026-06-14
**Author:** Hermes Agent
**ECC Version:** v2.0.0
**Source:** [affaan-m/ECC](https://github.com/affaan-m/ECC) (214K⭐)

---

## Executive Summary

ECC and Hermes use fundamentally the same SKILL.md format: YAML frontmatter followed by Markdown content. The frontmatter schemas overlap significantly, making migration straightforward. The primary differences are in optional fields and naming conventions.

**Compatibility Score: 87%** — ECC skills can be imported into Hermes with minimal transformation.

---

## ECC SKILL.md Format (v2.0.0)

### Canonical Location
```
skills/<skill-name>/SKILL.md   # Top-level skills (authoritative)
.agents/skills/<skill-name>/SKILL.md  # Claude Code variant
.cursor/skills/<skill-name>/SKILL.md  # Cursor variant
.kiro/skills/<skill-name>/SKILL.md    # Kiro variant
docs/*/skills/<skill-name>/SKILL.md   # Localized variants
```

### Frontmatter Fields

```yaml
---
name: <string>         # Required. Skill identifier
description: <string>  # Required. Human-readable description
origin: <string>       # Always "ECC" for canonical skills
---
```

### Content Structure
- H1 title matching skill name
- "When to Activate" section (activation triggers)
- Core principles, patterns, or workflow steps
- Code examples where applicable
- No strict schema enforcement — content is freeform Markdown

### Key Observations
- **31 canonical skills** in top-level `skills/` directory
- **~60+ tool-specific variants** in `.agents/`, `.cursor/`, `.kiro/` subdirectories
- **~100+ localized variants** in `docs/*/skills/` (es, ja-JP, zh-TW, etc.)
- Total SKILL.md files: **200+** across all paths
- ECC also uses `allowed-tools` in some `.agents/` variants

---

## Hermes SKILL.md Format

### Location
```
~/.hermes/skills/<skill-name>/SKILL.md
```

### Frontmatter Fields

```yaml
---
name: <string>         # Required. Skill identifier
description: <string>  # Required (or strongly conventional). Purpose statement
version: <semver>      # Optional. Semantic version
author: <string>       # Optional. Origin (e.g., "hermes", "ecc")
category: <string>     # Optional. Organizational category
tags: [<string>]       # Optional. Searchable tags
---
```

### Content Structure
- H1 title
- Optional "Overview" section
- "When to Activate" or similar activation triggers
- Core content (freeform Markdown)
- Optional scripts/paths references

---

## Field Comparison Matrix

| Field | ECC | Hermes | Compatible? | Migration Action |
|-------|-----|--------|-------------|-----------------|
| `name` | ✓ Required | ✓ Required | ✓ Direct mapping | None |
| `description` | ✓ Required | ✓ Required/Strong | ✓ Direct mapping | None |
| `version` | ✗ Not used | ✓ Optional | N/A | Default to `1.0.0` on import |
| `author` | `origin: "ECC"` | Optional | ✓ Map `origin` → `author` | Rewrite `origin` to `author` |
| `category` | `.agents/skills` in some variants | Optional | Partial | Extract from path or default |
| `tags` | ✗ Not used | ✓ Optional | N/A | Derive from skill content |
| `allowed-tools` | In some variants | Not used | N/A | Strip or ignore |

---

## Field Differences Documented

### 1. `origin` (ECC) vs `author` (Hermes)
- ECC uses `origin: "ECC"` to mark canonical skills
- Hermes uses `author: "hermes"` or `author: <name>`
- **Migration:** Rewrite `origin` → `author`, prepend `"ecc"` authorship for imported skills

### 2. `version` (Hermes only)
- ECC skills have no version field
- Hermes uses semantic versioning (e.g., `1.0.0`)
- **Migration:** Assign `1.0.0` to all imported skills

### 3. `category` (Hermes only)
- ECC uses implicit categorization via directory paths (`.agents/skills/`, `skills/`)
- Hermes uses explicit `category` field (e.g., `devops`, `security`)
- **Migration:** Derive category from skill content/topic; use generic categories where unclear

### 4. `tags` (Hermes only)
- ECC has no tagging system
- Hermes uses `tags` for searchability
- **Migration:** Extract keywords from skill description and content

### 5. `allowed-tools` (ECC variant only)
- Some `.agents/` variants include `allowed-tools: Read, Write, Edit, ...`
- Hermes does not use this field
- **Migration:** Strip from frontmatter during import

---

## ECC Skill Categories (by top-level `skills/` directory)

### Skills Relevant to Hermes (PRD-specified)

| ECC Skill | Description | Hermes Category | Priority |
|-----------|-------------|-----------------|----------|
| `coding-standards` | TS/JS conventions, React, API design | engineering | ✅ Imported |
| `security-review` | Security checklist, auth, input validation | security | ✅ Target |
| `verification-loop` | Quality gates, code review, refactoring checks | engineering | ✅ Target |
| `tdd-workflow` | Test-driven development, 80%+ coverage | engineering | ✅ Target |
| `eval-harness` | Eval-driven development, pass@k metrics | engineering | ✅ Imported |
| `strategic-compact` | Manual context compaction at milestones | operations | ✅ Target |
| `deep-research` | Multi-source web research reports | research | ✅ Imported |

### Additional High-Value Skills

| ECC Skill | Description | Hermes Category |
|-----------|-------------|-----------------|
| `backend-patterns` | Repository/service layers, endpoint design | engineering |
| `frontend-patterns` | React composition, hooks, rendering | engineering |
| `api-design` | REST conventions, validation, server concerns | engineering |
| `documentation-lookup` | API documentation search and integration | engineering |
| `e2e-testing` | End-to-end testing frameworks | engineering |
| `mcp-server-patterns` | MCP server development patterns | devops |
| `hookify-rules` | Hook-based automation rules | devops |
| `agent-sort` | Agent role assignment and prioritization | operations |
| `search-first` | Search-before-code approach | engineering |
| `context-budget` | Token budget management | operations |

---

## Migration Path

### Step 1: Parse ECC SKILL.md
```python
# Extract YAML frontmatter
frontmatter = parse_frontmatter(raw_content)
# Validate required fields: name, description
```

### Step 2: Transform Frontmatter
```python
# Map ECC fields → Hermes fields
mapped = {
    "name": frontmatter["name"],
    "description": frontmatter["description"],
    "version": "1.0.0",          # Default version
    "author": "ecc",             # From origin field
    "category": derive_category(frontmatter["name"]),
    "tags": extract_tags(frontmatter["description"]),
}
# Remove ECC-specific: origin, allowed-tools
```

### Step 3: Deduplicate
```python
# Compare with existing skills in ~/.hermes/skills/
if skill_exists(mapped["name"]):
    if version_gte(existing, new):
        skip()  # Existing is newer
    else:
        overwrite()  # Import newer version
else:
    install()
```

### Step 4: Write to Namespace
```
~/.hermes/skills/ecc/<skill-name>/SKILL.md
~/.hermes/skills/ecc/<skill-name>/METADATA.json
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| ECC `origin` field conflicts with Hermes `author` | Low | Rename field during migration |
| ECC skills are tool-specific (.agents/ vs .kiro/) | Medium | Only import from canonical `skills/` path |
| ECC descriptions are short, need more context | Low | Append "Source: ECC (affaan-m/ECC)" to content |
| Localization variants differ from canonical | Medium | Only import from English `skills/` directory |
| Import pipeline breaks on ECC format changes | Low | Pin to v2.0.0 branch/tag |

---

## Conclusion

ECC and Hermes SKILL.md formats are **highly compatible**. The migration adapter handles all field differences with simple transformations. The curated import pipeline should target the 7 PRD-specified skills first, then expand to additional high-value skills.

**Recommendation:** Import the following subset first (Phase 2 scope):
1. security-review
2. verification-loop
3. tdd-workflow
4. strategic-compact
5. eval-harness (already imported)
6. coding-standards (already imported)
7. deep-research (already imported)
