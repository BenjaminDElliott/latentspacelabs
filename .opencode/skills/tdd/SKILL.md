---
name: tdd
description: Test-Driven Development skill following red-green-refactor cycle. Inspired by obra/superpowers TDD skill. Write tests before implementation, implement to pass tests, refactor with confidence. Use when building new features, adding functionality, or improving code quality.
---

# Test-Driven Development (TDD) Skill

## Overview
A disciplined red-green-refactor cycle for building reliable code. Inspired by [obra/superpowers](https://github.com/obra/superpowers) TDD skill. Each unit of functionality follows: write failing test → write minimal code to pass → refactor. Reduces bugs, improves design, and creates living documentation.

## When to Use
- "Build X using TDD"
- "Add a new feature to module Y"
- "Refactor module Z with tests"
- Adding functionality to an existing codebase
- Building libraries or utilities from scratch
- When code quality and reliability matter more than speed

## Workflow

### Phase 0: Setup
1. **Understand requirements**: Read Linear issue description (`get_issue`), acceptance criteria, and any linked documents
2. **Identify the module**: Where will this code live? Search the workspace (`search_files`) for existing patterns
3. **Check existing tests**: Look for existing test files and patterns (convention, framework, structure)
4. **Verify tooling**: Ensure test framework is available (`python3 -m pytest --version`, `npm test`, etc.)
5. **Create the test file**: Before writing any production code, create the test file with the first failing test

### Phase 1: RED — Write a Failing Test
1. **Start small**: The first test should be the simplest possible assertion
2. **Name clearly**: Use descriptive test names (e.g., `test_create_user_returns_id`, not `test_1`)
3. **One assertion per test**: Each test verifies one behavior
4. **Run the test first**: Confirm it fails (red). If it passes, it was too easy
5. **Save and run**: Use `terminal` to run the test suite: `python3 -m pytest tests/ -v`

### Phase 2: GREEN — Write Minimal Code
1. **Make it pass**: Write the absolute minimum code to make the test pass — no more
2. **No abstractions yet**: Don't create classes, modules, or utilities unless the test demands them
3. **Hardcode if needed**: Temporary hardcoding is fine in the green phase — refactor later
4. **Run tests**: Confirm it passes (green). Run the full test suite, not just the new test
5. **Commit**: `git commit -m "feat: add [test name]"`

### Phase 3: REFACTOR — Clean Up
1. **Deduplicate**: If code appears in multiple places, extract a common function
2. **Improve naming**: Rename variables, functions, and files for clarity
3. **Apply patterns**: Use established patterns from the codebase (check existing files for conventions)
4. **Check coverage**: Run coverage tool to ensure new code is exercised
5. **Run full suite**: All tests must still pass after refactoring
6. **Commit**: `git commit -m "refactor: clean up [module]"`

### Phase 4: Repeat
1. Move to the next test case (edge case, error handling, next feature)
2. Repeat red-green-refactor for each test
3. After the full cycle, step back and assess: is the design clean? Does it follow single responsibility?

## TDD Test Categories

### Happy Path Tests
- Normal input produces expected output
- Core functionality works as specified
- Integration with existing modules succeeds

### Edge Case Tests
- Empty input, null values, zero-length strings
- Maximum sizes, boundary values
- Invalid but expected types (type coercion)
- Concurrent access, race conditions

### Error Path Tests
- Invalid input raises appropriate errors
- Timeout handling
- Resource cleanup on failure
- Network failures (if applicable)

### Integration Tests
- End-to-end flows across modules
- API contracts
- Database interactions
- File I/O

## Hermes-Specific Patterns

### Testing Python Projects
```bash
# Run tests
python3 -m pytest tests/ -v
# Run with coverage
python3 -m pytest tests/ --cov=. --cov-report=term-missing -v
# Run a single test file
python3 -m pytest tests/test_module.py::test_function -v
```

### Testing JavaScript/TypeScript Projects
```bash
# Run tests
npm test -- --verbose
# Run with coverage
npm test -- --coverage
# Run a single test file
npm test -- test/module.test.js
```

### Using Linear for TDD Tracking
1. **Link tests to issues**: Reference the Linear issue in test comments or docstrings
2. **Update issue on completion**: Set issue state to Done when all tests pass
3. **Comment on progress**: Use `save_comment` with `issueId` to log TDD progress
4. **Branch naming**: Follow workspace convention (e.g., `herman/LAT-326-feature-name`)

### Using Browser for Web Projects
1. Open the app in browser to verify UI tests visually
2. Use `mcp_linear_extract_images` to capture test results
3. Run visual regression tests if available

### Delegation for TDD
For large TDD sessions, delegate test-writing to agents:
```python
delegate_task(tasks=[
    {
        "goal": "Write TDD cycle for User model: tests for create, validate, update, delete",
        "context": "File: models/user.py, Test file: tests/test_user.py, Linear: LAT-326",
        "toolsets": ["terminal", "file", "web"]
    }
])
```

## Test File Conventions

### Python (pytest)
```python
import pytest
from module import target_function

class TestTargetFunction:
    def test_happy_path(self):
        assert target_function(valid_input) == expected_output

    def test_edge_case_empty(self):
        assert target_function("") == expected_empty_output

    def test_error_path_invalid(self):
        with pytest.raises(ValueError):
            target_function(invalid_input)
```

### JavaScript (Jest/Vitest)
```javascript
import { targetFunction } from '../module';

describe('targetFunction', () => {
    test('returns expected output for valid input', () => {
        expect(targetFunction(validInput)).toEqual(expectedOutput);
    });

    test('handles empty input', () => {
        expect(targetFunction('')).toEqual(expectedEmptyOutput);
    });

    test('throws on invalid input', () => {
        expect(() => targetFunction(invalidInput)).toThrow(ValueError);
    });
});
```

## Pitfalls
- **Writing production code before tests**: The golden rule — test first. If you write code first, you risk biasing the test to match the implementation
- **Testing implementation details**: Test behavior, not internals. If you refactor internal structure, tests should still pass
- **Over-testing**: Not everything needs tests. Focus on business logic, public APIs, and complex algorithms
- **Tight coupling between tests**: Tests should be independent. One test's setup shouldn't affect another's results
- **Ignoring coverage gaps**: Use coverage tools regularly. Aim for >80% on critical paths
- **Running only new tests**: Always run the full test suite — the green phase can break existing functionality
- **Skipping refactoring**: The refactor phase is where technical debt is eliminated. Don't skip it
- **Forgetting error cases**: Happy-path-only tests give false confidence. Edge cases and error paths catch 80% of production bugs
- **Test files in wrong location**: Check existing project conventions. Python: `tests/` at repo root or alongside source. JavaScript: `__tests__/` or `test/` alongside source
- **MCP unreachable during test runs**: If pytest fails with "MCP server 'linear' is unreachable", it's likely a timeout, not a test failure. Check the actual test output, not the MCP connection

## References
- [obra/superpowers TDD](https://github.com/obra/superpowers) — original TDD skill
- Python documentation: [pytest](https://docs.pytest.org/)
- Red-Green-Refactor: [Martin Fowler's article](https://martinfowler.com/bliki/TestDrivenDevelopment.html)
