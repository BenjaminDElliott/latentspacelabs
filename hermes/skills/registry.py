"""
Skill registry for the skill acquisition pipeline (LAT-191).

Manages the skill index (compact metadata for progressive disclosure)
and trust level tracking for all skills across layers.

Architecture:
  ~/.hermes/skills/registry/
    index.json         # Compact skill index (loaded at startup)
    trust_levels.json  # Trust level for each skill
"""

from __future__ import annotations

import datetime
import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from hermes.skills.config import (
    DEFAULT_TRUST_LEVEL,
    SkillSandboxConfig,
    TrustLevel,
)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class SkillMetadata:
    """Compact metadata for a single skill (progressive disclosure index).

    Designed to be ~100 tokens when serialized.
    """

    name: str
    description: str = ""
    version: str = "1.0.0"
    category: str = ""
    origin: str = ""
    source_repo: str = ""
    git_sha: str = ""
    trust_level: str = "intern"
    trigger_patterns: list[str] = field(default_factory=list)
    file_path: str = ""
    content_hash: str = ""
    created_at: str = ""
    updated_at: str = ""
    is_active: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SkillMetadata":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})

    def compute_hash(self) -> str:
        """Generate a hash for change detection."""
        return hashlib.sha256(
            f"{self.name}:{self.version}:{self.description}".encode()
        ).hexdigest()[:16]


@dataclass
class SkillTrustRecord:
    """Trust level and usage tracking for a skill."""

    name: str
    trust_level: str = "intern"
    total_runs: int = 0
    successful_runs: int = 0
    failed_runs: int = 0
    last_run_at: str = ""
    avg_latency_ms: float = 0.0
    success_rate: float = 0.0
    vulnerability_score: float = 0.0
    deprecated: bool = False
    deprecation_reason: str = ""

    @property
    def effective_trust_level(self) -> str:
        """Compute effective trust level based on performance.

        If success rate drops below 60%, demote one level.
        If success rate stays above 95%, promote one level.
        """
        if self.success_rate < 0.60 and self.trust_level != "intern":
            return "intern"
        elif self.success_rate >= 0.95 and self.trust_level == "intern":
            return "junior"
        elif self.success_rate >= 0.95 and self.trust_level == "junior":
            return "senior"
        elif self.success_rate >= 0.95 and self.trust_level == "senior":
            return "principal"
        return self.trust_level

    def record_run(self, success: bool, latency_ms: float) -> None:
        """Record a single skill invocation."""
        self.total_runs += 1
        if success:
            self.successful_runs += 1
        else:
            self.failed_runs += 1
        self.last_run_at = datetime.datetime.utcnow().isoformat()

        # Update success rate
        self.success_rate = (
            self.successful_runs / self.total_runs
            if self.total_runs > 0
            else 0.0
        )

        # Update average latency (running average)
        if self.total_runs == 1:
            self.avg_latency_ms = latency_ms
        else:
            alpha = 0.1  # Exponential moving average
            self.avg_latency_ms = (
                alpha * latency_ms + (1 - alpha) * self.avg_latency_ms
            )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SkillIndex:
    """Complete skill registry index.

    Loaded at startup for progressive disclosure.
    """

    skills: list[SkillMetadata] = field(default_factory=list)
    trust_records: list[SkillTrustRecord] = field(default_factory=list)
    last_updated: str = ""
    version: str = "1.0.0"

    def __post_init__(self):
        if not self.last_updated:
            self.last_updated = datetime.datetime.utcnow().isoformat()

    def add_skill(self, metadata: SkillMetadata) -> bool:
        """Add or update a skill in the index.

        Idempotency: if a skill with the same name+version exists,
        update it in place. Returns True if added/updated, False if no change.

        Args:
            metadata: Skill metadata to add.

        Returns:
            True if the skill was added or updated.
        """
        # Check for existing skill (dedup by name+version)
        for i, existing in enumerate(self.skills):
            if existing.name == metadata.name and existing.version == metadata.version:
                if existing.compute_hash() != metadata.compute_hash():
                    self.skills[i] = metadata
                    self.last_updated = datetime.datetime.utcnow().isoformat()
                    return True
                return False

        self.skills.append(metadata)
        self.last_updated = datetime.datetime.utcnow().isoformat()
        return True

    def remove_skill(self, name: str) -> bool:
        """Remove a skill from the index.

        Args:
            name: Skill name to remove.

        Returns:
            True if removed, False if not found.
        """
        before = len(self.skills)
        self.skills = [s for s in self.skills if s.name != name]
        removed = len(self.skills) < before
        if removed:
            self.last_updated = datetime.datetime.utcnow().isoformat()
        return removed

    def get_skill(self, name: str) -> SkillMetadata | None:
        """Get a skill by name.

        Args:
            name: Skill name.

        Returns:
            SkillMetadata or None if not found.
        """
        for skill in self.skills:
            if skill.name == name and skill.is_active:
                return skill
        return None

    def search(self, query: str) -> list[SkillMetadata]:
        """Search skills by name, description, or trigger patterns.

        Args:
            query: Search query string.

        Returns:
            Matching skills.
        """
        query_lower = query.lower()
        results: list[SkillMetadata] = []
        for skill in self.skills:
            if not skill.is_active:
                continue
            if (
                query_lower in skill.name.lower()
                or query_lower in skill.description.lower()
                or any(query_lower in tp.lower() for tp in skill.trigger_patterns)
            ):
                results.append(skill)
        return results

    def get_active_skills(self) -> list[SkillMetadata]:
        """Get all active (non-deprecated, non-removed) skills.

        Returns:
            List of active skill metadata.
        """
        return [s for s in self.skills if s.is_active]

    def get_compromised_skills(self, threshold: float = 0.261) -> list[str]:
        """Get skills above the community vulnerability threshold.

        Community average is 26.1% vulnerability rate.
        Target: <20%.

        Args:
            threshold: Vulnerability rate threshold.

        Returns:
            List of skill names with high vulnerability rates.
        """
        names: list[str] = []
        for record in self.trust_records:
            if record.vulnerability_score > threshold:
                names.append(record.name)
        return names

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "last_updated": self.last_updated,
            "skills": [s.to_dict() for s in self.skills],
            "trust_records": [r.to_dict() for r in self.trust_records],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SkillIndex":
        index = cls(
            version=data.get("version", "1.0.0"),
            last_updated=data.get("last_updated", ""),
        )
        index.skills = [
            SkillMetadata.from_dict(s) for s in data.get("skills", [])
        ]
        index.trust_records = [
            SkillTrustRecord(**r) for r in data.get("trust_records", [])
        ]
        return index


# ---------------------------------------------------------------------------
# File-based registry operations
# ---------------------------------------------------------------------------


def _get_base_path() -> Path:
    """Get the base path for the skill registry."""
    return Path.home() / ".hermes" / "skills"


def _get_index_path() -> Path:
    return _get_base_path() / "registry" / "index.json"


def _get_trust_path() -> Path:
    return _get_base_path() / "registry" / "trust_levels.json"


def load_index(path: Path | None = None) -> SkillIndex:
    """Load the skill index from disk.

    Args:
        path: Optional custom path. Defaults to ~/.hermes/skills/registry/index.json.

    Returns:
        SkillIndex instance (empty if file doesn't exist).
    """
    index_path = path or _get_index_path()
    if not index_path.exists():
        return SkillIndex()

    try:
        content = index_path.read_text(encoding="utf-8")
        data = json.loads(content)
        return SkillIndex.from_dict(data)
    except (json.JSONDecodeError, OSError) as exc:
        print(f"WARNING: Failed to load skill index from {index_path}: {exc}")
        return SkillIndex()


def save_index(index: SkillIndex, path: Path | None = None) -> None:
    """Save the skill index to disk.

    Args:
        index: SkillIndex to save.
        path: Optional custom path.
    """
    index_path = path or _get_index_path()
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(
        json.dumps(index.to_dict(), indent=2) + "\n",
        encoding="utf-8",
    )


def get_registry() -> SkillIndex:
    """Get the current registry instance (convenience function).

    Returns:
        Current SkillIndex.
    """
    return load_index()
