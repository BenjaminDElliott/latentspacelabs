"""
Hermes Agent Skill Acquisition Pipeline (LAT-191)

Layer 1: External Skill Ingestion
- Fetch SKILL.md from GitHub repos
- Validate against agentskills.io spec
- Enforce trust-based sandboxing
- Manage skill registry with progressive disclosure

Layer 2: Skill Evolution (future)
- Pattern detection from experience logs
- Candidate skill generation
- Feedback loop

Layer 3: Skill Composition (future)
- Compose primitive skills into compound capabilities
- Skill deprecation

Architecture:
~/.hermes/skills/
  layers/
    external/          # Ingested from GitHub
    discovered/        # Auto-discovered from experience
    composed/          # Compound skills
  registry/
    index.json         # Compact skill index (loaded at startup)
    trust_levels.json  # Trust level for each skill
  feedback/
    usage_metrics.json # Per-skill usage stats

Usage:
    python3 -m hermes.skills.ingest          # Run full ingestion pipeline
    python3 -m hermes.skills.ingest --dry-run  # Preview without writing
    python3 -m hermes.skills.ingest --repo owner/repo  # Specific repo
    python3 -m hermes.skills.ingest --trust-level intern  # Override trust level
"""

from __future__ import annotations

from hermes.skills.config import (
    DEFAULT_TRUST_LEVEL,
    TRUST_LEVELS,
    ExternalSkillRepo,
    SkillSandboxConfig,
    TrustLevel,
    load_config,
)
from hermes.skills.fetcher import (
    GitHubSkillFetcher,
    fetch_skill_from_github,
)
from hermes.skills.registry import (
    SkillIndex,
    get_registry,
    load_index,
    save_index,
)
from hermes.skills.sandbox import (
    apply_trust_sandbox,
    get_trust_level,
    validate_sandbox_config,
)
from hermes.skills.validator import (
    SkillValidationError,
    SkillValidator,
    validate_agentskills_io_spec,
    validate_skill_file,
)

__all__ = [
    # Config
    "DEFAULT_TRUST_LEVEL",
    "TRUST_LEVELS",
    "ExternalSkillRepo",
    "SkillSandboxConfig",
    "TrustLevel",
    "load_config",
    # Fetcher
    "GitHubSkillFetcher",
    "fetch_skill_from_github",
    # Registry
    "SkillIndex",
    "get_registry",
    "load_index",
    "save_index",
    # Sandbox
    "apply_trust_sandbox",
    "get_trust_level",
    "validate_sandbox_config",
    # Validator
    "SkillValidationError",
    "SkillValidator",
    "validate_agentskills_io_spec",
    "validate_skill_file",
]
