---
name: using-superpowers
description: Use when starting any conversation — establishes how to find and use skills, requiring skill invocation before ANY response including clarifying questions
---

# Using Skills (Hermes Edition)

## Overview

All superpowers skills live in `~/.hermes/skills/`. This skill establishes the rule that you MUST check for applicable skills before responding or acting.

**Core principle:** If there's even a 1% chance a skill might apply, invoke it. Check before every response, every action.

**Announce at start:** "I'm using the using-superpowers skill to check for applicable skills."

## Instruction Priority

Hermes skills override default system prompt behavior, but **user instructions always take precedence**:

1. **User's explicit instructions** — highest priority
2. **Hermes skills** — override default system behavior where they conflict
3. **Default system prompt** — lowest priority

If a user instruction conflicts with a skill, follow the user's instruction. The user is in control.

## How to Access Skills

**In Hermes:** Skills are auto-discovered from the `~/.hermes/skills/` directory. Each skill is a markdown file with YAML frontmatter containing `name` and `description`.

When a skill is invoked, its full content is loaded and presented. Follow it directly.

## Platform Adaptation

Hermes uses its own toolset. Tool equivalents for common operations:

| Action | Hermes Tool |
|--------|-------------|
| Run commands | `terminal()` |
| Read files | `read_file()` |
| Write files | `write_file()` |
| Search files | `search_files()` |
| Web browsing | `browser()` |
| Web search | `web_search()` |
| Linear issues | `mcp_linear_*` tools |
| Create issues | `mcp_linear_save_issue()` |
| Create comments | `mcp_linear_save_comment()` |
| Create documents | `mcp_linear_save_document()` |
| Get issue details | `mcp_linear_get_issue()` |
| List issues | `mcp_linear_list_issues()` |
| Get users | `mcp_linear_get_user()`, `mcp_linear_list_users()` |
| List teams | `mcp_linear_list_teams()` |
| List projects | `mcp_linear_list_projects()` |
| Get project details | `mcp_linear_get_project()` |
| List cycles | `mcp_linear_list_cycles()` |
| List milestones | `mcp_linear_list_milestones()` |
| Get milestone details | `mcp_linear_get_milestone()` |
| List comments | `mcp_linear_list_comments()` |
| Delete comments | `mcp_linear_delete_comment()` |
| List documents | `mcp_linear_list_documents()` |
| Get document | `mcp_linear_get_document()` |
| List attachments | `mcp_linear_list_comments` (on issue) |
| Get attachment | `mcp_linear_get_attachment()` |
| Prepare upload | `mcp_linear_prepare_attachment_upload()` |
| Create attachment | `mcp_linear_create_attachment_from_upload()` |
| Delete attachment | `mcp_linear_delete_attachment()` |
| Create label | `mcp_linear_create_issue_label()` |
| List labels | `mcp_linear_list_issue_labels()` |
| List statuses | `mcp_linear_list_issue_statuses()` |
| Get status | `mcp_linear_get_issue_status()` |
| Save milestone | `mcp_linear_save_milestone()` |
| Save project | `mcp_linear_save_project()` |
| Get diff | `mcp_linear_get_diff()` |
| List diffs | `mcp_linear_list_diffs()` |
| Get diff threads | `mcp_linear_get_diff_threads()` |
| Get team | `mcp_linear_get_team()` |
| Get user by ID | `mcp_linear_get_user()` |
| List users | `mcp_linear_list_users()` |
| Extract images | `mcp_linear_extract_images()` |
| Delete diff | `mcp_linear_get_diff` with review URL |
| Dispatch agent | `delegate()` tool |
| Save memory | `memory()` tool |
| Manage skills | `skills()` tool |
| Text-to-speech | `tts()` tool |
| Video processing | `video()` tool |
| Vision/analyze | `vision_analyze()` |

## The Rule

**Invoke relevant or requested skills BEFORE any response or action.** Even a 1% chance a skill might apply means that you should invoke the skill to check. If an invoked skill turns out to be wrong for the situation, you don't need to use it.

```
User message received → Might any skill apply? → Yes → Invoke skill → Follow skill
                                                                 → No → Respond
```

## Red Flags

These thoughts mean STOP — you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for skills. |
| "Let me gather information first" | Skills tell you HOW to gather information. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "This doesn't count as a task" | Action = task. Check for skills. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action wastes time. Skills prevent this. |
| "I know what that means" | Knowing the concept ≠ using the skill. Invoke it. |

## Skill Priority

When multiple skills could apply, use this order:

1. **Process skills first** (brainstorming, debugging) — these determine HOW to approach the task
2. **Implementation skills second** (frontend-design, mcp-builder) — these guide execution

"Let's build X" → brainstorming first, then implementation skills.
"Fix this bug" → debugging first, then domain-specific skills.

## Skill Types

**Rigid** (TDD, debugging): Follow exactly. Don't adapt away discipline.

**Flexible** (patterns): Adapt principles to context.

The skill itself tells you which.

## User Instructions

Instructions say WHAT, not HOW. "Add X" or "Fix Y" doesn't mean skip workflows.

## Hermes-Specific Skill Locations

All superpowers-derived skills are in:
- `~/.hermes/skills/` — the local skills directory

To list available skills:
```bash
ls ~/.hermes/skills/*/SKILL.md
```

To read a skill:
```bash
cat ~/.hermes/skills/<skill-name>/SKILL.md
```

## The Bottom Line

**Skills are mandatory, not optional.** Check before every action. No excuses. No rationalizing.

If you might need it, use it.

## References
- [obra/superpowers using-superpowers](https://github.com/obra/superpowers) — original skill invocation skill
- `~/.hermes/skills/` — local skills directory
