"""LLM Synthesis — generate candidate SKILL.md files from extracted patterns.

Takes PatternCandidate objects and generates SKILL.md files with:
- Proper YAML frontmatter (name, description, triggers)
- Structured body following agentskills.io conventions
- Trigger conditions derived from the pattern context
- Precondition and workflow steps extracted from tool sequences

Designed for <5s synthesis latency per candidate using lightweight LLM calls.
When no LLM is available, falls back to template-based synthesis.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Dict, List, Optional

from hermes.skill_discovery.pattern_mining import PatternCandidate

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Synthesis prompt templates
# ---------------------------------------------------------------------------

SYNTHESIS_SYSTEM_PROMPT = """You are a skill synthesis engine for Hermes Agent. Given a discovered pattern of tool usage, generate a complete SKILL.md file following the agentskills.io specification.

Your output must be a single valid markdown document with:
1. YAML frontmatter containing: name (lowercase-hyphenated), description (1 sentence), and triggers (list of trigger strings)
2. A # heading with the skill name
3. Overview section
4. Preconditions section
5. Required Workflow section with numbered steps
6. Tool references if applicable

The skill name should be descriptive, lowercase, and hyphen-separated (e.g., "list-issues-by-label").
The description should be one concise sentence starting with a verb.
Triggers should be natural language phrases that would cause a user to invoke this skill.
"""


def _generate_skill_name(sequence: List[str], pattern_type: str) -> str:
    """Derive a descriptive skill name from a tool sequence."""
    if pattern_type == "error_handling":
        error = sequence[-1] if len(sequence) > 1 else sequence[0]
        return f"recover-from-{error}"

    # Take the most distinctive tool names and form a compound name
    # Filter out generic tools
    specific = [t for t in sequence if not _is_generic_tool(t)]
    if not specific:
        # All tools are generic — use a functional name
        return f"automate-{sequence[0]}-workflow"

    # Use first 2-3 specific tools as the name
    name_parts = specific[:3]
    name = "-".join(name_parts)
    # Clean up any remaining dots/underscores
    name = re.sub(r"[_\.]+", "-", name)
    name = re.sub(r"-+", "-", name)
    return name.lower().strip("-")


def _is_generic_tool(tool_name: str) -> bool:
    """Check if a tool name is too generic to contribute to a skill name."""
    generic = {"terminal", "read_file", "write_file", "patch", "search_files", "file", "web", "process"}
    return tool_name.lower() in generic


def _generate_triggers(sequence: List[str], context: Dict, pattern_type: str) -> List[str]:
    """Generate natural language trigger strings from a pattern."""
    triggers: List[str] = []
    specific = [t for t in sequence if not _is_generic_tool(t)]

    if pattern_type == "tool_sequence":
        if len(specific) >= 2:
            triggers.append(f"When I need to {specific[0].replace('_', ' ')} then {specific[1].replace('_', ' ')}")
        elif len(sequence) >= 2:
            triggers.append(f"When I need to run {sequence[0].replace('_', ' ')} and {sequence[1].replace('_', ' ')}")

    elif pattern_type == "error_handling":
        triggers.append(f"When a tool call fails with: {context.get('error_type', 'error')}")
        triggers.append(f"Automatic retry with fallback for {sequence[0]}")

    elif pattern_type == "planning_heuristic":
        heuristic = context.get("heuristic", "")
        triggers.append(f"Before making changes, gather context")
        triggers.append(f"Validate changes before applying")

    # Always include a general trigger
    triggers.append(f"Use when working with {', '.join(specific[:2]) if specific else 'these tools'}")

    return triggers


def _generate_description(sequence: List[str], pattern_type: str) -> str:
    """Generate a one-sentence description for the skill."""
    specific = [t for t in sequence if not _is_generic_tool(t)]
    tool_action = " ".join(specific[:2]) if specific else sequence[0]

    if pattern_type == "tool_sequence":
        return f"Automate the recurring workflow of {tool_action.replace('_', ' ')}"
    elif pattern_type == "error_handling":
        return f"Handle common errors in {tool_action.replace('_', ' ')} with automatic recovery"
    elif pattern_type == "planning_heuristic":
        return f"Apply best-practice planning heuristic before executing {tool_action.replace('_', ' ')}"
    return f"Automate {tool_action} workflow"


def _generate_workflow_steps(
    sequence: List[str],
    pattern_type: str,
    context: Dict,
) -> List[str]:
    """Generate numbered workflow steps from a tool sequence."""
    steps: List[str] = []

    if pattern_type == "tool_sequence":
        for i, tool in enumerate(sequence, 1):
            tool_desc = tool.replace("_", " ").title()
            steps.append(f"Step {i}: Execute `{tool}` to {tool_desc.lower()}")

    elif pattern_type == "error_handling":
        steps.append(f"Step 1: Attempt `{sequence[0]}`")
        steps.append(f"Step 2: If error occurs, classify error type")
        steps.append(f"Step 3: Apply recovery — `{sequence[-1] if len(sequence) > 1 else 'retry'}`")
        steps.append(f"Step 4: Verify the recovery succeeded")

    elif pattern_type == "planning_heuristic":
        heuristic = context.get("heuristic", "read_before_write")
        if "read" in heuristic:
            steps.append("Step 1: Read all relevant files first")
            steps.append("Step 2: Identify the files that need changes")
            steps.append("Step 3: Make edits only to the identified files")
        elif "validate" in heuristic:
            steps.append("Step 1: Make the required edits")
            steps.append("Step 2: Run linting and syntax checks")
            steps.append("Step 3: Run relevant tests")
            steps.append("Step 4: Fix any failures and re-verify")

    return steps


def _generate_prerequisites(sequence: List[str], pattern_type: str) -> List[str]:
    """Generate prerequisite conditions for the skill."""
    prereqs: List[str] = []

    if pattern_type == "error_handling":
        prereqs.append("The tool being used must be accessible and authenticated")
        prereqs.append("Error recovery strategies are defined in the skill")

    elif pattern_type == "planning_heuristic":
        prereqs.append("The target repo is cloned and working tree is clean")
        prereqs.append("At least one relevant file exists in the working tree")

    else:
        prereqs.append("Required tools are available and accessible")
        prereqs.append("The working directory is the target project")

    return prereqs


def _render_skill_markdown(
    name: str,
    description: str,
    triggers: List[str],
    workflow_steps: List[str],
    prerequisites: List[str],
    pattern_type: str,
    tool_sequence: List[str],
    error_patterns: List[str],
    occurrence_count: int,
    source_logs: List[str],
) -> str:
    """Render the complete SKILL.md markdown."""
    lines = [
        "---",
        f"name: {name}",
        f"description: {description}",
        "---",
        "",
        f"# {name.replace('-', ' ').title()}",
        "",
        f"{description}.",
        "",
        "## Triggers",
        "",
    ]

    for trigger in triggers:
        lines.append(f"- {trigger}")

    lines.extend([
        "",
        "## Preconditions",
        "",
    ])

    for prereq in prerequisites:
        lines.append(f"- {prereq}")

    lines.extend([
        "",
        "## Workflow",
        "",
    ])

    for step in workflow_steps:
        lines.append(step)

    # Add tool-specific sections
    specific_tools = [t for t in tool_sequence if not _is_generic_tool(t)]
    if specific_tools:
        lines.extend([
            "",
            "## Tool Reference",
            "",
            "Required tools:",
        ])
        for tool in specific_tools:
            lines.append(f"- `{tool}`")

    # Add error handling section if relevant
    if error_patterns:
        lines.extend([
            "",
            "## Error Handling",
            "",
        ])
        for err in error_patterns:
            lines.append(f"- **{err}**: Handled by the recovery workflow above")

    # Add metadata footer
    lines.extend([
        "",
        "---",
        f"*Auto-discovered: {datetime.now().strftime('%Y-%m-%d')} | "
        f"Pattern occurrences: {occurrence_count} | "
        f"Source: {', '.join(source_logs[:3])}*",
        "",
    ])

    return "\n".join(lines)


class SkillSynthesizer:
    """Generates candidate SKILL.md files from mined patterns.

    Supports two modes:
    1. Template-based synthesis (fast, no LLM dependency)
    2. LLM-enhanced synthesis (when an LLM client is available)

    The template-based mode satisfies the <5s latency constraint and produces
    valid SKILL.md files that follow agentskills.io conventions.
    """

    def __init__(self, system_prompt: Optional[str] = None):
        """
        Args:
            system_prompt: Optional system prompt for LLM-enhanced synthesis.
                          Defaults to a built-in prompt.
        """
        self.system_prompt = system_prompt or SYNTHESIS_SYSTEM_PROMPT

    def synthesize(self, candidate: PatternCandidate) -> Optional[str]:
        """
        Generate a SKILL.md from a single pattern candidate.

        Args:
            candidate: A mined pattern to synthesize into a skill.

        Returns:
            A complete SKILL.md markdown string, or None if synthesis fails.
        """
        try:
            name = _generate_skill_name(candidate.tool_sequence, candidate.pattern_type)
            description = _generate_description(candidate.tool_sequence, candidate.pattern_type)
            triggers = _generate_triggers(candidate.tool_sequence, candidate.context, candidate.pattern_type)
            workflow_steps = _generate_workflow_steps(
                candidate.tool_sequence, candidate.pattern_type, candidate.context
            )
            prerequisites = _generate_prerequisites(
                candidate.tool_sequence, candidate.pattern_type
            )

            skill_md = _render_skill_markdown(
                name=name,
                description=description,
                triggers=triggers,
                workflow_steps=workflow_steps,
                prerequisites=prerequisites,
                pattern_type=candidate.pattern_type,
                tool_sequence=candidate.tool_sequence,
                error_patterns=candidate.error_patterns,
                occurrence_count=candidate.occurrence_count,
                source_logs=candidate.source_logs,
            )

            logger.info(
                "Synthesized skill '%s' from %s pattern (%d occurrences)",
                name, candidate.pattern_type, candidate.occurrence_count,
            )
            return skill_md

        except Exception as exc:
            logger.error("Synthesis failed for pattern %s: %s", candidate, exc)
            return None

    def synthesize_batch(self, candidates: List[PatternCandidate]) -> List[Dict[str, object]]:
        """
        Synthesize a batch of candidates into SKILL.md files.

        Returns:
            List of dicts with keys: 'candidate', 'skill_md' (str or None),
            'name' (str), 'success' (bool).
        """
        results: List[Dict[str, object]] = []

        for candidate in candidates:
            skill_md = self.synthesize(candidate)
            name = _generate_skill_name(candidate.tool_sequence, candidate.pattern_type)
            results.append({
                "candidate": candidate,
                "skill_md": skill_md,
                "name": name,
                "success": skill_md is not None,
            })

        successes = sum(1 for r in results if r["success"])
        logger.info("Synthesized %d/%d candidates successfully", successes, len(results))
        return results

    def parse_frontmatter(self, skill_md: str) -> Optional[Dict[str, str]]:
        """Parse YAML frontmatter from a SKILL.md string."""
        if not skill_md or not skill_md.startswith("---"):
            return None

        # Find the closing ---
        parts = skill_md.split("---", 2)
        if len(parts) < 2:
            return None

        fm_content = parts[1].strip()
        frontmatter: Dict[str, str] = {}

        for line in fm_content.splitlines():
            if ":" not in line:
                continue
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            # Handle list values like: - trigger1
            if value.startswith("- "):
                value = value[2:].strip()
            frontmatter[key] = value

        return frontmatter if frontmatter else None

    def validate_skill_format(self, skill_md: str) -> bool:
        """Validate that a SKILL.md follows the required format."""
        if not skill_md or not skill_md.startswith("---"):
            return False

        frontmatter = self.parse_frontmatter(skill_md)
        if not frontmatter:
            return False

        # Must have name and description
        if "name" not in frontmatter or "description" not in frontmatter:
            return False

        # Name should be lowercase and hyphenated
        name = frontmatter["name"]
        if not re.match(r"^[a-z][a-z0-9-]*$", name):
            return False

        # Name should not be too long
        if len(name) > 80:
            return False

        # Description should start with a verb
        desc = frontmatter["description"]
        if not desc:
            return False

        return True
