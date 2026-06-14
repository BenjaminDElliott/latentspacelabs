---
name: systematic-debugging
description: Methodical debugging skill using hypothesis-driven investigation. Inspired by obra/superpowers systematic-debugging skill. Form hypotheses, isolate variables, test systematically. Never guess — always verify. Use when something is broken, behaving unexpectedly, or failing intermittently.
---

# Systematic Debugging Skill

## Overview
A hypothesis-driven approach to debugging. Inspired by [obra/superpowers](https://github.com/obra/superpowers) systematic-debugging skill. Never guess — always verify. Each debugging session follows: observe → hypothesize → experiment → conclude → fix. Reduces time-to-resolution and prevents regression.

## When to Use
- "Debug why X is broken"
- "Why does Y fail intermittently?"
- "This worked yesterday but not today"
- Performance regression investigation
- Error logs that don't clearly indicate the root cause
- After a fix that didn't resolve the issue
- Before creating a bug report — gather reproducible steps

## Workflow

### Phase 1: Observe — Gather Evidence
1. **Reproduce the bug**: Confirm it's reproducible. If intermittent, identify conditions.
2. **Collect logs**: Terminal output, error messages, stack traces
3. **Check recent changes**: What changed recently? (`git log`, Linear issues recently closed)
4. **Check system state**: Disk space, memory, network, dependencies
5. **Define expected vs actual**: What should happen vs what does happen
6. **Save evidence**: `save_comment` on the Linear issue with observations, or save to `~/.hermes/vault/debugging/<issue-slug>.md`

### Phase 2: Hypothesize — Generate Candidates
1. **List possible causes**: From most likely to least likely
2. **Consider categories**:
   - **Code bug**: Logic error, off-by-one, type mismatch, null pointer
   - **Configuration**: Wrong env vars, config file, deployment settings
   - **Dependency**: Outdated library, breaking change in a dependency
   - **Environment**: Different in production vs development
   - **Timing**: Race condition, timeout, order of operations
   - **Data**: Corrupted input, unexpected format, missing field
3. **Prioritize**: Rank by likelihood AND ease of testing

### Phase 3: Experiment — Test Each Hypothesis
For each hypothesis, in priority order:

1. **Design the test**: What minimal change or query isolates this hypothesis?
2. **Run the test**: Use `terminal` for commands, `browser` for visual checks, `search_files` for code inspection
3. **Record the result**: Pass, fail, or inconclusive? What did you learn?
4. **Update the hypothesis list**: Eliminate confirmed causes, promote promising candidates
5. **Narrow the scope**: Each test should reduce uncertainty

#### Test Techniques
- **Binary search**: Comment out half the code, see if the bug persists
- **Minimal reproduction**: Create a minimal test case that isolates the issue
- **Compare working vs broken**: What's different between the working state and the broken state?
- **Check invariants**: What should always be true? Assert those.

### Phase 4: Conclude — Identify Root Cause
1. **The bug is**: [one-sentence description of root cause]
2. **Where**: [file, line, function, module]
3. **Why it happens**: [mechanism — e.g., "null pointer because function A doesn't check for X before calling B"]
4. **Why it wasn't caught**: [missing test, wrong assumption, edge case]
5. **How to verify the fix**: [specific steps to confirm]

### Phase 5: Fix — Implement and Verify
1. **Implement the fix**: Minimal change to address root cause
2. **Run reproduction test**: Verify the bug is fixed
3. **Run full suite**: Ensure no regressions
4. **Add a regression test**: Prevents this from happening again
5. **Update documentation**: If the fix changes behavior, update docs
6. **Update Linear issue**: Set to Done, add comment with fix summary

## Debugging Decision Tree

```
Something is broken
│
├── Is it reproducible?
│   ├── Yes → Go to Phase 2 (Hypothesize)
│   └── No → Add logging, wait for next occurrence, check timing patterns
│
├── Did it work before?
│   ├── Yes → Check recent changes (git log, PRs, dep updates)
│   └── No → Check configuration, dependencies, environment
│
├── Is it environment-specific?
│   ├── Yes → Compare dev vs prod vs CI environments
│   └── No → Go to Phase 2 (Hypothesize)
│
└── Is it timing-dependent?
    ├── Yes → Look for race conditions, timeouts, ordering issues
    └── No → Go to Phase 2 (Hypothesize)
```

## Common Bug Patterns

### Null/Undefined Issues
```python
# Check before accessing
if obj is None:
    logger.error(f"obj is None at {caller}")
# Or use safe access
value = obj.get('key') if obj else default
```

### Race Conditions
- Check for missing locks/synchronization
- Look for async operations without await
- Check for callbacks firing in wrong order
- Verify file I/O isn't concurrent

### Type Mismatches
- Check for string vs int comparisons
- Verify API response types match expectations
- Check for None being passed where object expected

### Configuration Drift
- Verify env vars in each environment
- Check config file paths
- Look for hardcoded values that should be configurable

### Dependency Issues
- Check lock files vs actual installed versions
- Look for transitive dependency conflicts
- Check for breaking changes in recent updates

## Hermes-Specific Debugging

### Using Terminal for Debugging
```bash
# Run with verbose output
python3 -m pytest tests/ -v -s
# Run with debugger
python3 -m pdb script.py
# Check process state
ps aux | grep <process>
# Check ports
lsof -i :<port>
# Network debugging
curl -v http://localhost:<port>/endpoint
# Check file permissions
ls -la /path/to/file
# Check disk/memory
df -h && free -h
```

### Using Linear for Bug Tracking
1. **Create the issue**: `save_issue` with clear reproduction steps
2. **Add observations**: `save_comment` with `issueId` as you investigate
3. **Link related issues**: `relatedTo` field for related bugs or fixes
4. **Update status**: Track investigation progress via status changes
5. **Reference the debug doc**: Link to `~/.hermes/vault/debugging/` notes

### Using Search for Debugging
1. `search_files` to find where values are set or used
2. `search_files` with regex to find patterns (e.g., `TODO:`, `FIXME:`, `print(`)
3. `search_files` to find similar error messages in the codebase

### Using Browser for Visual Debugging
1. Open the app to reproduce UI bugs visually
2. Use browser dev tools for client-side debugging
3. Screenshot evidence with `mcp_linear_extract_images`

### Using Delegation for Large Debugging Sessions
When a debugging session spans multiple areas:
```python
delegate_task(tasks=[
    {
        "goal": "Debug the 500 error on /api/users endpoint",
        "context": "Error logged in services/api.py:42, stack trace points to models/user.py",
        "toolsets": ["terminal", "file", "web"]
    }
])
```

## Debugging Output Format

```
# Debug: [Issue Description]

## Observed Behavior
- **Expected**: [what should happen]
- **Actual**: [what happens]
- **Reproducible**: Yes/No (conditions: [details])

## Evidence Collected
- [Log snippet 1]
- [Error message]
- [Stack trace]
- [Recent changes: git log output]

## Hypotheses (Ranked by Likelihood)
1. **Hypothesis 1**: [description]
   - Evidence for: [what supports it]
   - Evidence against: [what contradicts it]
   - Test: [how to verify]
   - Result: [pass/fail/inconclusive]

2. **Hypothesis 2**: [description]
   - Test: ...
   - Result: ...

## Root Cause
[One-sentence description]

## Fix
[What was changed and why]

## Verification
[Steps to confirm the fix works]

## Regression Test Added
[Description of new test]
```

## Pitfalls
- **Debugging in production**: Always reproduce in dev/staging first if possible
- **Fixing symptoms, not causes**: If you patch the error message but the underlying logic is wrong, the bug will reappear
- **Assuming the error message is accurate**: Error messages sometimes lie (e.g., "connection refused" when the server is actually OOM)
- **Too many variables at once**: Change only one thing per test. If you change two things and the bug is fixed, you don't know which change fixed it
- **Ignoring the obvious**: Sometimes it's just a wrong config file or missing env var. Check the basics before the complex
- **Not saving evidence**: If you fix it but don't save the debug notes, the next person (or you in 2 weeks) will re-debug from scratch
- **Fixing in production**: Always test the fix first. A bad production fix can take hours to roll back
- **Forgetting about side effects**: The fix works for the bug but breaks something else. Always run the full test suite
- **Over-engineering the fix**: The simplest fix is usually the best. Don't add complexity unless required
- **MCP errors masquerading as bugs**: "MCP server 'linear' is unreachable after N consecutive failures" is often a transient network issue, not a bug in the code. Check connectivity before creating a Linear bug
- **Test environment staleness**: If you're debugging in a container or VM, it may have outdated packages. Check `pip list --outdated` or `npm outdated`
- **Python version mismatch**: Ensure the Python version matches what the project expects (check `.python-version`, `pyproject.toml`, or `requirements.txt`)

## References
- [obra/superpowers systematic-debugging](https://github.com/obra/superpowers) — original hypothesis-driven debugging skill
- `~/.hermes/vault/debugging/` — directory for debug artifacts
- [The Art of Debugging](https://www.amazon.com/Art-Debugging-Nicholas-Carrington/dp/159327276X) — systematic debugging techniques
- [Martin Thompson's Debugging](https://blog.8thlight.com/) — binary search debugging, hypothesis testing
