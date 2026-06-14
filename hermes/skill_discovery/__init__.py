"""Hermes Agent — Automated Skill Discovery and Self-Improvement System (LAT-307).

Core components:
1. Pattern Mining — extract recurring tool call sequences & error handling from logs
2. LLM Synthesis — generate candidate SKILL.md files with proper frontmatter & triggers
3. Quality Scoring — evaluate correctness, completeness, novelty before review
4. Experience Library — SQLite-based tracking of discovered skills and performance
5. Sandbox Execution — new skills run with read-only tools until validated
"""

from hermes.skill_discovery.pattern_mining import PatternMiner
from hermes.skill_discovery.llm_synthesis import SkillSynthesizer
from hermes.skill_discovery.quality_scoring import QualityScorer
from hermes.skill_discovery.experience_library import ExperienceLibrary
from hermes.skill_discovery.sandbox_execution import SandboxExecutor

__all__ = [
    "PatternMiner",
    "SkillSynthesizer",
    "QualityScorer",
    "ExperienceLibrary",
    "SandboxExecutor",
]
