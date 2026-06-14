---
name: subagent-driven-development
description: Architectural oversight skill where the orchestrator designs and delegates to specialized subagents. Inspired by obra/superpowers subagent-driven-development skill. The orchestrator remains focused on architecture, reviews subagent output, and integrates pieces. Use for large projects spanning multiple domains or when parallel development is needed.
---

# Subagent-Driven Development (SDD) Skill

## Overview
A hierarchical development approach where an orchestrator designs the solution, delegates implementation to specialized subagents, and integrates their work. Inspired by [obra/superpowers](https://github.com/obra/superpowers) subagent-driven-development skill. The orchestrator stays in the big picture — subagents handle the details. This enables parallel work across domains while maintaining architectural consistency.

## When to Use
- "Build X" on a project larger than what one agent can reasonably do in a session
- Projects spanning multiple modules, services, or technologies
- When different sub-features can be developed independently
- When the orchestrator needs to maintain architectural overview
- Large refactors across multiple files
- Building a complete feature set from a plan

## Workflow

### Phase 1: Architecture Design (Orchestrator)
1. **Understand requirements**: Read Linear issue (`get_issue`), plan document, or feature spec
2. **Define the system**: Identify components, modules, and interfaces
3. **Create a task breakdown**: Decompose the project into independent sub-tasks
4. **Define contracts**: Specify input/output for each module (types, APIs, file formats)
5. **Identify dependencies**: Which tasks can run in parallel? Which must wait?
6. **Create Linear issues**: Each sub-task gets its own issue (`save_issue`) with clear requirements

### Phase 2: Subagent Selection & Delegation (Orchestrator)
1. **Choose the right tools**: Match each task to the appropriate toolset:
   - `terminal` + `file` — code implementation
   - `terminal` + `file` + `web` — research-then-implement tasks
   - `linear` — Linear-specific tasks
   - `browser` + `file` — UI or web scraping tasks
2. **Prepare subagent context**: Each delegation should include:
   - Goal (what to build)
   - Context (file paths, existing code references, Linear issue)
   - Toolsets (which tools the subagent needs)
   - Acceptance criteria (how to verify it works)
3. **Batch delegates**: Use `delegate_task(tasks=[...])` for parallel work. Max 4 per batch.
4. **Set expectations**: Include branch naming, commit conventions, and where to save output

### Phase 3: Subagent Execution (Subagents)
1. **Independent work**: Each subagent works in its own worktree/branch
2. **Follow conventions**: Use established patterns from the codebase
3. **Report progress**: Subagents should leave notes in their worktree or Linear comments
4. **Commit incrementally**: Small, focused commits with clear messages
5. **Handle errors**: If a subagent hits a blocker, note it and try alternatives

### Phase 4: Integration (Orchestrator)
1. **Review subagent output**: Check each subagent's work:
   - Does it compile/build? Run `terminal` commands to verify
   - Does it match the contract? Check inputs/outputs
   - Is it tested? Verify test coverage
   - Is the code clean? Follow code style guidelines
2. **Merge work**: Combine subagent branches into the main branch
3. **Resolve conflicts**: If branches touch the same files, merge carefully
4. **Run full suite**: Execute all tests, lint checks, and build commands
5. **Update tracking**: Update Linear issues with completion status

### Phase 5: Iteration (Orchestrator)
1. **Assess integration**: Does the combined work function correctly?
2. **Identify gaps**: What's missing or broken?
3. **Delegate fixes**: Create new sub-tasks for any remaining work
4. **Document decisions**: Record architectural decisions and their rationale

## Subagent Delegation Patterns

### Pattern 1: Parallel Module Development
When modules are independent:
```
delegate_task(tasks=[
    {
        "goal": "Implement the User model with create, read, update, delete operations",
        "context": "File: models/user.py, test file: tests/test_user.py, Linear: LAT-326",
        "toolsets": ["terminal", "file"]
    },
    {
        "goal": "Implement the API endpoints for user CRUD operations",
        "context": "File: api/users.py, depends on models/user.py, Linear: LAT-327",
        "toolsets": ["terminal", "file"]
    },
    {
        "goal": "Create frontend components for user management UI",
        "context": "File: src/components/UserManager.jsx, uses models/user API, Linear: LAT-328",
        "toolsets": ["terminal", "file"]
    }
])
```

### Pattern 2: Sequential Dependencies
When tasks depend on each other, delegate sequentially:
```
# Step 1: Foundation
delegate_task(tasks=[{"goal": "...", ...}])
# Wait for completion, then:
# Step 2: Depends on step 1
delegate_task(tasks=[{"goal": "...", ...}])
```

### Pattern 3: Research + Implementation
```
delegate_task(tasks=[
    {
        "goal": "Research best practices for Redis caching patterns",
        "context": "Project: caching layer, save findings to vault",
        "toolsets": ["web", "terminal"]
    },
    {
        "goal": "Implement Redis caching layer based on research",
        "context": "Findings in ~/.hermes/vault/research/caching.md, code in services/cache.py",
        "toolsets": ["terminal", "file"]
    }
])
```

## Orchestrator Checklist

### Before Delegating
- [ ] Each task has clear acceptance criteria
- [ ] Tasks don't conflict (different files, modules, or well-defined interfaces)
- [ ] Branch names follow convention: `herman/LAT-XXX-description`
- [ ] Each task has a Linear issue with full context
- [ ] Dependencies are mapped and communicated

### After Delegation
- [ ] All subagent branches exist and have commits
- [ ] Subagents pushed their work to origin
- [ ] Linear issues are updated with subagent progress
- [ ] Any blockers identified and addressed

### Before Integration
- [ ] Each subagent's code builds/compiles
- [ ] Tests pass for each module individually
- [ ] Code style is consistent
- [ ] Documentation is updated

### After Integration
- [ ] Full test suite passes
- [ ] No merge conflicts remain
- [ ] All Linear issues are updated
- [ ] PR is created with integration summary

## Pitfalls
- **Too many subagents at once**: Max 4 per batch. More creates integration complexity and merge conflicts
- **Shared file contention**: If multiple subagents edit the same file, they'll conflict. Assign ownership clearly
- **Orchestrator doing subagent work**: Don't implement in the subagent's place. Delegate and review
- **Missing integration testing**: Each module works independently — that doesn't mean they work together. Integration tests are mandatory
- **Inconsistent code style**: Each subagent may have different formatting. Run lint/formatter after integration
- **Orphaned branches**: Subagents push to their branches — the orchestrator must merge them. Don't let branches linger
- **Context loss**: Each subagent needs full context. Don't assume it knows about decisions made for other modules
- **Test fragmentation**: Subagents test their own modules, but integration tests need to be written by the orchestrator
- **Linear issue sprawl**: Don't create more Linear issues than necessary. If a sub-task takes <30 minutes, it doesn't need its own issue
- **Over-delegation**: If the orchestrator is spending more time managing subagents than designing, delegate less and implement more
- **MCP timeout on large batches**: If 4 subagents all take 600s, you could wait 4+ minutes. Stagger starts or reduce batch size if timeout is a concern
- **Branch naming collisions**: Ensure each subagent uses a unique branch name. Use the format `herman/LAT-XXX-task-description`

## References
- [obra/superpowers subagent-driven-development](https://github.com/obra/superpowers) — original SDD skill
- `~/.hermes/skills/dispatch-harness/SKILL.md` — parallel dispatch patterns
- [Google's SRE book](https://sre.google/sre-book/table-of-contents/) — hierarchical system design
