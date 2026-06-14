---
name: writing-plans
description: Structured technical planning skill for designing solutions before implementation. Inspired by obra/superpowers writing-plans skill. Creates detailed implementation plans with architecture, tasks, estimates, and dependencies. Use before starting any significant coding work.
---

# Writing Plans Skill

## Overview
A disciplined approach to creating implementation plans before coding begins. Inspired by [obra/superpowers](https://github.com/obra/superpowers) writing-plans skill. Plans reduce ambiguity, improve estimation accuracy, and enable parallel work through clear task decomposition. A plan is a living document — update it as you learn.

## When to Use
- "Write a plan for building X"
- Before starting work on any issue that takes more than 2 hours
- When an issue has unclear requirements or multiple approaches
- Before delegating work to agents
- When a project spans multiple modules or teams
- After receiving feedback that changes the approach

## Workflow

### Phase 1: Problem Analysis
1. **Read the requirements**: Get the Linear issue (`get_issue`), PRD (`get_document`), or feature spec
2. **Clarify scope**: What's in and what's out? What are the explicit and implicit requirements?
3. **Identify constraints**: Tech stack, deadlines, team capacity, existing code, dependencies
4. **List unknowns**: What do you need to research? What decisions need to be made?
5. **Check related work**: `list_issues` with relevant queries, `search_files` for existing patterns

### Phase 2: Architecture Design
1. **High-level approach**: Describe the overall solution in plain language
2. **Component diagram**: List all modules, services, or components involved
3. **Data model**: Define key data structures, types, and relationships
4. **API contracts**: If applicable, define interfaces between components
5. **Technology choices**: Justify each library, framework, or tool decision
6. **Risks**: Identify technical risks and mitigations

### Phase 3: Task Decomposition
1. **Break into tasks**: Each task should be:
   - Atomic (can be done by one agent in one session)
   - Independent (minimal dependency on other tasks)
   - Estatable (can be assigned story points)
   - Testable (has clear acceptance criteria)
2. **Order by dependency**: Create a dependency graph. Tasks with no blockers go first
3. **Identify parallelizable work**: Tasks that can run simultaneously
4. **Estimate effort**: Use Fibonacci scale (1, 2, 3, 5, 8, 13). Consider:
   - Familiarity with codebase
   - Complexity of logic
   - Integration points
   - Testing requirements
   - Deployment steps

### Phase 4: Plan Document
1. **Create the plan**: Write a detailed plan document
2. **Structure**: Follow the plan template (see below)
3. **Save**: To `~/.hermes/vault/plans/<project-slug>.md` or as a Linear document
4. **Link**: Reference the plan in the Linear issue description or comments

### Phase 5: Review and Iterate
1. **Self-review**: Walk through the plan — are there gaps? Ambiguities?
2. **Check dependencies**: Are all prerequisite tasks identified?
3. **Validate estimates**: Would this take longer or shorter than estimated?
4. **Update as you learn**: Plans change. Update them when you discover new information

## Plan Document Template

```markdown
# Plan: [Project/Feature Name]

## Problem Statement
[One paragraph describing the problem being solved]

## Requirements
### Functional
- [Requirement 1]
- [Requirement 2]

### Non-Functional
- [Performance, security, scalability requirements]

## Architecture
[High-level description of the solution approach]

### Components
1. [Component 1]: [description]
2. [Component 2]: [description]

### Data Model
[Key data structures and relationships]

### API Contracts
[If applicable: endpoints, request/response formats]

## Task Breakdown
### Phase 1: Foundation (Estimate: X points)
- [ ] Task 1: [description] — [points] pts — [dependencies]
- [ ] Task 2: [description] — [points] pts — [dependencies]

### Phase 2: Core Implementation (Estimate: X points)
- [ ] Task 3: [description] — [points] pts — [depends on 1, 2]
- [ ] Task 4: [description] — [points] pts — [depends on 1]

### Phase 3: Integration & Testing (Estimate: X points)
- [ ] Task 5: [description] — [points] pts — [depends on 3, 4]

### Phase 4: Polish & Documentation (Estimate: X points)
- [ ] Task 6: [description] — [points] pts — [depends on 5]

## Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| [Risk 1] | High | Medium | [Mitigation] |

## Open Decisions
1. [Decision 1]: [options considered, pending decision]
2. [Decision 2]: [options considered, pending decision]

## References
- Linear issue: [LINK]
- Related issues: [LINKS]
- Research notes: [PATHS]
```

## Hermes-Specific Patterns

### Creating Plans in Linear
1. **Create as a document**: Use `save_document` with `title: "Plan: [Topic]"` attached to the issue
2. **Create as issue comments**: Use `save_comment` with `issueId` for shorter plans
3. **Link to tasks**: Reference Linear issue IDs in task descriptions
4. **Use labels**: Label planning issues with `planning` for easy discovery

### Planning for Delegation
When the plan will be executed by agents:
1. Each task should have its own Linear issue
2. Use `blocks` to define dependencies between tasks
3. Include full context in each task's description
4. Reference the master plan document in each task

### Using Search for Plan Validation
1. `search_files` for existing patterns in the codebase
2. `web_search` for best practices on chosen technologies
3. `browser` to check documentation for APIs being used
4. `list_issues` to verify related work isn't already done

## Pitfalls
- **Planning for too long**: If a plan takes more than 2 hours to write, it's over-engineered. A good plan takes 30-90 minutes for most projects
- **Ignoring dependencies**: The #1 reason projects stall is hidden dependencies. Map all dependencies explicitly
- **Underestimating testing**: Testing is a task, not an afterthought. Include it in the plan with its own estimate
- **Not leaving room for surprises**: Add 20% buffer to estimates. Plans are predictions, not guarantees
- **Creating plans nobody reads**: If the plan isn't linked to the Linear issue, it might as not exist. Save to vault AND link in Linear
- **Over-composing the plan**: The plan is a tool, not a deliverable. If it's 50 pages, it's too detailed. Focus on decisions, not implementation details
- **Stale plans**: Plans drift. If work has been going on for more than a day, update the plan. If it's been a week, rewrite it
- **Forgetting edge cases**: Plans often assume happy paths. Include error handling, migration, and rollback in the plan
- **Not updating on feedback**: When a reviewer says "this won't scale" or "use library X instead", update the plan — don't just implement and note it later
- **Plan vs. code confusion**: The plan describes WHAT and WHY. The code is HOW. Don't put implementation details in the plan

## References
- [obra/superpowers writing-plans](https://github.com/obra/superpowers) — original planning skill
- `~/.hermes/vault/plans/` — directory for plan artifacts
- [Mike Cohn's Success Cases](https://www.softwareengineerdaily.com/software-engineering-books/success-cases-mike-cohn) — user story estimation techniques
