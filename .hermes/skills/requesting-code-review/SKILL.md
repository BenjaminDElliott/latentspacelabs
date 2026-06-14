---
name: requesting-code-review
description: Use when completing tasks, implementing major features, or before merging to verify work meets requirements — dispatches a code reviewer subagent to catch issues before they cascade
---

# Requesting Code Review

## Overview

Dispatch a code reviewer subagent to catch issues before they cascade. The reviewer gets precisely crafted context for evaluation — never your session's history. This keeps the reviewer focused on the work product, not your thought process, and preserves your own context for continued work.

**Core principle:** Review early, review often.

**Announce at start:** "I'm using the requesting-code-review skill to dispatch a code review."

## When to Request Review

**Mandatory:**
- After each task in subagent-driven development
- After completing major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

## How to Request

**1. Get git SHAs:**
```bash
BASE_SHA=$(git rev-parse HEAD~1)  # or origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

**2. Prepare context:**
Gather the information the reviewer needs:
- **Description:** Brief summary of what you built (2-3 sentences)
- **Plan/Requirements:** What it should do (reference Linear issue: `get_issue(LAT-NNN)`)
- **Tests:** What tests cover this work
- **Known trade-offs:** Any intentional compromises

**3. Dispatch code reviewer subagent:**

Use the `delegate` tool or `save_issue` with a reviewer task:

```python
# Using delegate tool
delegate(
    task="Review changes between BASE_SHA and HEAD_SHA",
    context={
        "description": DESCRIPTION,
        "requirements": PLAN_OR_REQUIREMENTS,
        "base_sha": BASE_SHA,
        "head_sha": HEAD_SHA,
        "files_changed": [...],
        "test_results": "..."
    }
)
```

**Placeholders:**
- `{DESCRIPTION}` — Brief summary of what you built
- `{PLAN_OR_REQUIREMENTS}` — What it should do (from Linear issue)
- `{BASE_SHA}` — Starting commit
- `{HEAD_SHA}` — Ending commit

**4. Act on feedback:**
- Fix Critical issues immediately
- Fix Important issues before proceeding
- Note Minor issues for later
- Push back if reviewer is wrong (with reasoning)

## Hermes-Specific Patterns

### Using Linear for Review Tracking
1. Create review comment on the issue: `save_comment(issueId="LAT-NNN", body=feedback_summary)`
2. Link the reviewer's findings as a sub-task: `save_issue(parentId="LAT-NNN", ...)`
3. Update issue state when review feedback is addressed

### Using Documents for Review Context
1. Create a review document: `save_document(title="Review: LAT-NNN — <feature>", content=...)`
2. Include diffs, test results, and review findings
3. Link from issue comment: `save_comment(issueId, body="[Review document](url)")`

### Using Terminal for Diff Analysis
```bash
# Get detailed diff for reviewer context
git diff --stat BASE_SHA..HEAD_SHA
git diff BASE_SHA..HEAD_SHA > /tmp/review-diff.patch
# Pass diff content to reviewer subagent
```

## Example

```
[Just completed Task 2: Add verification function]

You: Let me request code review before proceeding.

BASE_SHA=$(git log --oneline | grep "Task 1" | head -1 | awk '{print $1}')
HEAD_SHA=$(git rev-parse HEAD)

[Dispatch code reviewer subagent]
  DESCRIPTION: Added verifyIndex() and repairIndex() with 4 issue types
  PLAN_OR_REQUIREMENTS: Task 2 from Linear issue LAT-123
  BASE_SHA: a7981ec
  HEAD_SHA: 3df7661

[Subagent returns]:
  Strengths: Clean architecture, real tests
  Issues:
    Important: Missing progress indicators
    Minor: Magic number (100) for reporting interval
  Assessment: Ready to proceed

You: [Fix progress indicators]
[Continue to Task 3]
```

## Integration with Workflows

**Subagent-Driven Development:**
- Review after EACH task
- Catch issues before they compound
- Fix before moving to next task

**Executing Plans:**
- Review after each task or at natural checkpoints
- Get feedback, apply, continue

**Ad-Hoc Development:**
- Review before merge
- Review when stuck

## Red Flags

**Never:**
- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

**If reviewer wrong:**
- Push back with technical reasoning
- Show code/tests that prove it works
- Request clarification

## References
- [obra/superpowers requesting-code-review](https://github.com/obra/superpowers) — original review dispatch skill
