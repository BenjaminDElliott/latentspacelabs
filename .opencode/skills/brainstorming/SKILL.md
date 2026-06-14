---
name: brainstorming
description: Divergent-convergent ideation skill for generating, evaluating, and refining ideas. Inspired by obra/superpowers brainstorming skill. Use when exploring solutions, designing features, selecting approaches, or breaking through blocks.
---

# Brainstorming Skill

## Overview
A structured divergent-then-convergent ideation process. Inspired by [obra/superpowers](https://github.com/obra/superpowers) brainstorming skill. Generates many options, then systematically evaluates and narrows them using evidence, constraints, and Hermes capabilities.

## When to Use
- "Brainstorm solutions for X"
- "What are the approaches to build Y?"
- "Help me choose between options A, B, C"
- Designing a new system or architecture
- Feature ideation for product roadmaps
- Breaking through a blocker by exploring alternatives
- Before creating Linear issues — validate direction first

## Workflow

### Phase 1: Context Gathering
1. **Understand the problem**: Ask clarifying questions if context is unclear. Use `get_issue` for existing issue context.
2. **Check existing work**: Search Linear for related issues (`list_issues` with query). Check documents (`list_documents` with query). Look for prior research or PRDs.
3. **Identify constraints**: What's the tech stack? Any libraries/tools already chosen? Budget, timeline, team capacity?
4. **Define success criteria**: What does "good" look like? What metrics matter?

### Phase 2: Divergent Generation
1. **Broad ideation**: Generate 10-20 raw ideas without filtering. Think in categories:
   - **Quick wins** (fast, low effort, high impact)
   - **Bold moves** (high risk, high reward, transformative)
   - **Safe bets** (proven, incremental, low risk)
   - **Wildcard ideas** (novel, unconventional, out-of-the-box)
2. **Use these generation techniques**:
   - *SCAMPER*: Substitute, Combine, Adapt, Modify, Put to another use, Eliminate, Reverse
   - *First Principles*: Break the problem to fundamentals, rebuild from scratch
   - *Analogous domains*: How would similar problems be solved in other fields?
   - *Constraint inversion*: What if we had infinite time? Infinite budget? No code?
3. **Record all ideas**: Save to `~/.hermes/vault/brainstorming/<topic-slug>.md` or as a Linear document.

### Phase 3: Rapid Prototyping (Optional)
For the top 3-5 ideas, do quick feasibility checks:
1. **Technical feasibility**: Check if key libraries exist (`web_search` or `browser`)
2. **Existing code**: Search the workspace (`search_files`) for reusable components
3. **Estimate effort**: Rough complexity assessment using Hermes estimation heuristics
4. **Check Linear**: See if similar work already exists to avoid duplication

### Phase 4: Convergent Evaluation
1. **Scoring matrix**: Evaluate each idea against criteria:
   - Impact (1-10): How much value does it deliver?
   - Effort (1-10): How much work is needed? (lower = better)
   - Risk (1-10): How uncertain is the outcome? (lower = better)
   - Alignment (1-10): Does it match project goals and roadmap?
   - **Score** = Impact × Alignment − (Effort + Risk)
2. **Filter to top 3**: Keep only ideas scoring in the top quartile
3. **Compare pairwise**: For each pair, ask: "If I can only do one, which?"
4. **Select winner**: The idea that wins most pairwise comparisons

### Phase 5: Refinement
1. **Strengthen weaknesses**: For the selected idea, identify its top 2 weaknesses and brainstorm mitigations
2. **Combine strengths**: Can elements from #2 or #3 improve the winner?
3. **Define next steps**: What's the smallest meaningful step to validate this idea?
4. **Create tracking**: If decision is to proceed, create Linear issue with `save_issue` referencing this brainstorm.

## Hermes-Specific Patterns

### Using Linear for Brainstorming
1. Create a temporary issue with label `brainstorming` to host the discussion
2. Use `save_comment` to add ideas as the brainstorm progresses
3. Use `save_document` for structured brainstorm outputs (links, comparisons, matrices)
4. Convert selected ideas to Linear issues with `save_issue`
5. Use `delegate_task` to assign prototype tasks to coding agents

### Using Documents
1. Create a brainstorming document: `save_document` with `title: "Brainstorm: <topic>"`
2. Structure as: problem statement → ideas → evaluation → decision → next steps
3. Share via comment on related Linear issue: `save_comment` with `issueId`
4. Reference in future discussions

### Web Research Integration
1. Use `web_search` or `browser` to check existing solutions for each idea
2. Look for similar projects on GitHub (search repos)
3. Check for recent developments or best practices
4. Validate assumptions with real-world examples

## Output Format

```
# Brainstorm: [Topic]

## Context
- Problem: [description]
- Constraints: [tech, budget, timeline]
- Success criteria: [metrics]

## Ideas Generated
### Quick Wins
1. [Idea] — Impact: X, Effort: Y, Score: Z
2. [Idea]

### Bold Moves
1. [Idea]

### Safe Bets
1. [Idea]

### Wildcards
1. [Idea]

## Evaluation Matrix
| Idea | Impact | Effort | Risk | Alignment | Score |
|------|--------|--------|------|-----------|-------|
| ...  |        |        |      |           |       |

## Decision
**Selected**: [Idea name]
**Rationale**: [Why this won]
**Weaknesses addressed**: [Mitigations]

## Next Steps
1. [Immediate action]
2. [Follow-up]
```

## Pitfalls
- **Analysis paralysis**: Set a time limit. If you can't decide in 30 minutes, pick the highest-scored option and proceed
- **Recency bias**: The last idea generated often gets disproportionate weight. Number all ideas and evaluate in random order
- **Solution looking for a problem**: Ensure each idea directly addresses a defined constraint or goal
- **Ignoring existing work**: Always check Linear for prior brainstorming or related issues before starting from scratch
- **Too many ideas**: Divergent phase max 25 ideas. Convergent phase max 5 candidates
- **Forgetting feasibility**: An idea scores 10/10 but has no libraries, no team, no infrastructure — it's not viable. Always check technical feasibility
- **Linear issue duplication**: Before creating issues from brainstorm results, search existing issues to avoid duplicates
- **Hermes overthinking**: Use `delegate_task` to offload prototyping. Don't try to build everything yourself in the brainstorm phase

## References
- [obra/superpowers brainstorming](https://github.com/obra/superpowers) — original divergent-convergent framework
- `~/.hermes/vault/brainstorming/` — directory for brainstorm artifacts
