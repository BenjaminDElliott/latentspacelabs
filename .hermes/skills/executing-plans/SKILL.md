---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints — loads plan, reviews critically, executes all tasks, reports when complete
---

# Executing Plans (Hermes Edition)

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Note:** Hermes works best with subagent support. If subagents are available, use `superpowers:subagent-driven-development` instead of this skill for higher quality output.

## The Process

### Step 1: Load and Review Plan

1. Read plan file (from Linear document, ticket pack, or attached plan)
2. Review critically — identify any questions or concerns about the plan
3. If concerns: Raise them with your human partner before starting
4. If no concerns: Create todos and proceed

**Loading the plan from Linear:**
- Plans are often stored as Linear documents: `mcp_linear_get_document(id)`
- Plans may be in issue descriptions: `mcp_linear_get_issue(id)`
- Plans may be in ticket packs: `docs/templates/opencode-ticket-pack.md`

### Step 2: Execute Tasks

For each task in order:

1. **Mark as in_progress:** Use `mcp_linear_save_comment` to note starting the task
2. **Follow each step exactly** — the plan has bite-sized steps
3. **Run verifications as specified** in the plan
4. **Mark as completed:** Update todo list and note completion

**Using Linear for task tracking:**
- Create sub-issues for each task: `mcp_linear_save_issue(parentId="LAT-NNN", ...)`
- Use `mcp_linear_save_comment` to record progress
- Update issue status as you complete tasks

### Step 3: Complete Development

After all tasks complete and verified:

- Announce: "I'm using the finishing-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use `finishing-development-branch`
- Follow that skill to verify tests, present options, execute choice

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** — stop and ask.

## Remember

- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent

## Integration with Workflows

**With subagent-driven-development:**
- Plan created by `writing-plans` skill
- Tasks dispatched to subagents via `delegate`
- Code review between tasks via `requesting-code-review`

**With Linear:**
- Plan stored as Linear document or ticket pack
- Progress tracked via issue comments
- Completion reported via issue status update

## Hermes-Specific Patterns

### Loading Plans from Linear
```python
# Get plan from Linear document
document = mcp_linear_get_document(id="plan-slug")

# Or from issue description
issue = mcp_linear_get_issue(id="LAT-NNN")

# Extract plan steps from description
plan_steps = parse_plan(issue.description)
```

### Tracking Progress via Linear
```python
# Record task start
mcp_linear_save_comment(issueId="LAT-NNN", body="[In progress] Task 3: Implement API endpoint")

# Record task completion
mcp_linear_save_comment(issueId="LAT-NNN", body="[Complete] Task 3: Implemented API endpoint with tests")
```

### Creating Sub-Tasks
```python
# Create sub-issue for tracking
mcp_linear_save_issue(
    parentId="LAT-NNN",
    title="Task 3: Implement API endpoint",
    team="backend"
)
```

## Required Workflow Skills

- **`using-git-worktrees`** — Ensures isolated workspace (creates one or verifies existing)
- **`writing-plans`** — Creates the plan this skill executes
- **`finishing-development-branch`** — Complete development after all tasks
- **`verification-before-completion`** — Verify each task before proceeding

## References
- [obra/superpowers executing-plans](https://github.com/obra/superpowers) — original plan execution skill
