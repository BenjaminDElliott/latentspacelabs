"""
Configuration for the skill acquisition pipeline (LAT-191).

Defines external skill repository sources, trust level hierarchy,
and sandboxing parameters. Uses the CSA Intern-to-Principal trust model.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Trust Levels (CSA Intern-to-Principal Model)
# ---------------------------------------------------------------------------


class TrustLevel(str, Enum):
    """Trust levels following the CSA Intern-to-Principal model.

    - Intern: New, unproven skills — read-only tools, full isolation
    - Junior: Few verified runs — read + limited write, process isolation
    - Senior: Established track record — full tool access, shared env
    - Principal: Trusted, audited — all tools + filesystem, minimal sandbox
    """

    INTERN = "intern"
    JUNIOR = "junior"
    SENIOR = "senior"
    PRINCIPAL = "principal"


# Default trust level for newly ingested skills
DEFAULT_TRUST_LEVEL = TrustLevel.INTERN

# Trust level ordering (lower index = more restricted)
TRUST_LEVEL_ORDER = [
    TrustLevel.INTERN,
    TrustLevel.JUNIOR,
    TrustLevel.SENIOR,
    TrustLevel.PRINCIPAL,
]

# Human-readable trust level descriptions
TRUST_LEVELS: dict[TrustLevel, dict[str, Any]] = {
    TrustLevel.INTERN: {
        "name": "Intern",
        "permissions": ["read_only"],
        "sandbox": "full_isolation",
        "max_nested_calls": 3,
        "code_execution": False,
        "file_system": False,
        "description": "New, unproven skills. Read-only tools, full sandbox isolation.",
    },
    TrustLevel.JUNIOR: {
        "name": "Junior",
        "permissions": ["read", "limited_write"],
        "sandbox": "process_isolation",
        "max_nested_calls": 5,
        "code_execution": False,
        "file_system": False,
        "description": "Few verified runs. Read + limited write, process isolation.",
    },
    TrustLevel.SENIOR: {
        "name": "Senior",
        "permissions": ["read", "write", "execute"],
        "sandbox": "shared_environment",
        "max_nested_calls": 10,
        "code_execution": True,
        "file_system": False,
        "description": "Established track record. Full tool access, shared environment.",
    },
    TrustLevel.PRINCIPAL: {
        "name": "Principal",
        "permissions": ["read", "write", "execute", "filesystem"],
        "sandbox": "minimal",
        "max_nested_calls": 20,
        "code_execution": True,
        "file_system": True,
        "description": "Trusted, audited. All tools + file system, minimal sandbox.",
    },
}


# ---------------------------------------------------------------------------
# External Repository Configuration
# ---------------------------------------------------------------------------


@dataclass
class ExternalSkillRepo:
    """A GitHub repository that hosts skills.

    Attributes:
        owner: GitHub owner/organization name.
        repo: Repository name.
        branch: Git branch to fetch from (default: main).
        skills_path: Path within the repo where skills live (default: skills/).
        trust_level: Default trust level for skills from this repo.
        rate_limit_per_min: API rate limit (requests per minute).
    """

    owner: str
    repo: str
    branch: str = "main"
    skills_path: str = "skills"
    trust_level: str = "intern"
    rate_limit_per_min: int = 30

    @property
    def api_base_url(self) -> str:
        return f"https://api.github.com/repos/{self.owner}/{self.repo}"

    @property
    def raw_base_url(self) -> str:
        return f"https://raw.githubusercontent.com/{self.owner}/{self.repo}/{self.branch}"

    @property
    def repo_url(self) -> str:
        return f"https://github.com/{self.owner}/{self.repo}"


# Default curated repositories for initial ingestion
DEFAULT_REPOS: list[ExternalSkillRepo] = [
    ExternalSkillRepo(
        owner="affaan-m",
        repo="ECC",
        branch="main",
        skills_path="skills",
        trust_level="intern",
        rate_limit_per_min=30,
    ),
    ExternalSkillRepo(
        owner="anthropics",
        repo="skills-library",
        branch="main",
        skills_path="skills",
        trust_level="intern",
        rate_limit_per_min=30,
    ),
]


# ---------------------------------------------------------------------------
# Sandbox Configuration
# ---------------------------------------------------------------------------


@dataclass
class SkillSandboxConfig:
    """Runtime sandboxing configuration for a skill.

    Attributes:
        trust_level: The skill's current trust level.
        max_memory_mb: Maximum memory usage in MB.
        timeout_seconds: Execution timeout in seconds.
        network_access: Whether the skill can access the network.
        env_whitelist: Environment variables the skill can read.
    """

    trust_level: TrustLevel = TrustLevel.INTERN
    max_memory_mb: int = 256
    timeout_seconds: int = 30
    network_access: bool = False
    env_whitelist: list[str] = field(default_factory=lambda: ["PATH", "HOME", "LANG"])

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dictionary for JSON storage."""
        return {
            "trust_level": self.trust_level.value,
            "max_memory_mb": self.max_memory_mb,
            "timeout_seconds": self.timeout_seconds,
            "network_access": self.network_access,
            "env_whitelist": self.env_whitelist,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SkillSandboxConfig":
        """Deserialize from dictionary."""
        return cls(
            trust_level=TrustLevel(data.get("trust_level", "intern")),
            max_memory_mb=data.get("max_memory_mb", 256),
            timeout_seconds=data.get("timeout_seconds", 30),
            network_access=data.get("network_access", False),
            env_whitelist=data.get("env_whitelist", ["PATH", "HOME", "LANG"]),
        )


# ---------------------------------------------------------------------------
# Pipeline Configuration
# ---------------------------------------------------------------------------


def load_config(config_path: str | Path | None = None) -> dict[str, Any]:
    """Load pipeline configuration.

    Checks for a config file at:
    1. Explicit path (if provided)
    2. ~/.hermes/skills_config.json
    3. Environment variable HERMES_SKILLS_CONFIG

    Returns default configuration if no file found.

    Returns:
        Configuration dictionary with keys:
        - repos: List of ExternalSkillRepo dicts
        - trust_levels: Trust level settings
        - validation: Validation settings
        - sandbox: Sandbox configuration
        - registry: Registry paths
    """
    config: dict[str, Any] = {
        "repos": [
            {
                "owner": r.owner,
                "repo": r.repo,
                "branch": r.branch,
                "skills_path": r.skills_path,
                "trust_level": r.trust_level,
                "rate_limit_per_min": r.rate_limit_per_min,
            }
            for r in DEFAULT_REPOS
        ],
        "trust_levels": TRUST_LEVELS,
        "validation": {
            "require_name": True,
            "require_description": True,
            "require_version": False,
            "max_skill_size_bytes": 1024 * 1024,  # 1 MB
            "max_nested_calls": 5,
        },
        "sandbox": {
            "default_trust_level": DEFAULT_TRUST_LEVEL.value,
            "max_memory_mb": 256,
            "timeout_seconds": 30,
            "network_access": False,
        },
        "registry": {
            "base_path": str(Path.home() / ".hermes" / "skills"),
            "index_file": "registry/index.json",
            "trust_file": "registry/trust_levels.json",
            "feedback_file": "feedback/usage_metrics.json",
        },
    }

    # Load from config file if available
    path = config_path or os.environ.get(
        "HERMES_SKILLS_CONFIG",
        str(Path.home() / ".hermes" / "skills_config.json"),
    )
    config_file = Path(path)
    if config_file.exists():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                user_config = json.load(f)
            # Merge user config into defaults
            for key in user_config:
                if key in config:
                    if isinstance(config[key], dict) and isinstance(user_config[key], dict):
                        config[key].update(user_config[key])
                    else:
                        config[key] = user_config[key]
        except (json.JSONDecodeError, OSError) as exc:
            print(f"WARNING: Failed to load skills config from {path}: {exc}")

    return config
