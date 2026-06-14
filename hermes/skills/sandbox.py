"""
Trust-level sandboxing for skills (LAT-191).

Implements the CSA Intern-to-Principal trust model:
- Intern: read-only tools, full sandbox isolation
- Junior: read + limited write, process isolation
- Senior: full tool access, shared environment
- Principal: all tools + filesystem, minimal sandbox

Skills are assigned trust levels dynamically based on their source,
usage history, and validation results.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from hermes.skills.config import (
    DEFAULT_TRUST_LEVEL,
    TRUST_LEVEL_ORDER,
    TRUST_LEVELS,
    SkillSandboxConfig,
    TrustLevel,
)


# ---------------------------------------------------------------------------
# Vulnerability scoring
# ---------------------------------------------------------------------------

# Known vulnerability patterns in skill content
VULNERABILITY_PATTERNS: dict[str, dict[str, Any]] = {
    "subprocess_shell": {
        "pattern": r"subprocess\.call\([^)]*shell\s*=\s*True\)|subprocess\.run\([^)]*shell\s*=\s*True\)",
        "severity": "high",
        "description": "Subprocess with shell=True (injection risk)",
    },
    "os_system": {
        "pattern": r"os\.system\(|os\.popen\(",
        "severity": "medium",
        "description": "os.system/popen usage (potential injection)",
    },
    "eval_usage": {
        "pattern": r"\beval\s*\(",
        "severity": "high",
        "description": "eval() usage (code injection risk)",
    },
    "exec_usage": {
        "pattern": r"\bexec\s*\(",
        "severity": "high",
        "description": "exec() usage (code injection risk)",
    },
    "pickle_unsafe": {
        "pattern": r"pickle\.load\(|pickle\.loads\(|dill\.load\(|dill\.loads\(",
        "severity": "medium",
        "description": "Pickle deserialization (untrusted code execution)",
    },
    "urllib_open": {
        "pattern": r"urllib\.request\.urlopen\(|urllib\.urlretrieve\(",
        "severity": "low",
        "description": "Raw network fetch (potential data exfiltration)",
    },
    "path_traversal": {
        "pattern": r"\.\./|\\.\\\\.\\.",
        "severity": "medium",
        "description": "Path traversal pattern detected",
    },
    "http_server": {
        "pattern": r"HTTPServer|http\.server|SimpleHTTPRequestHandler",
        "severity": "medium",
        "description": "HTTP server started (network exposure)",
    },
    "import_dynamic": {
        "pattern": r"importlib\.import_module\(\s*[^'\"]|__import__\(",
        "severity": "medium",
        "description": "Dynamic import (potential code injection)",
    },
    "file_write": {
        "pattern": r"open\([^,]+,\s*['\"]w",
        "severity": "low",
        "description": "File write operation detected",
    },
}


# ---------------------------------------------------------------------------
# Trust level management
# ---------------------------------------------------------------------------


def get_trust_level(skill_entry: SkillEntry) -> TrustLevel:
    """Determine the trust level for a skill based on its source.

    Rules:
    - Skills from well-known repos with valid frontmatter: Intern
    - Skills from unknown repos: Intern
    - Skills with validation warnings only: Junior
    - Skills with no errors and >10 verified runs: Senior

    Args:
        skill_entry: The skill entry to evaluate.

    Returns:
        The determined trust level.
    """
    # Check explicit trust level first
    if hasattr(skill_entry, "trust_level") and skill_entry.trust_level:
        try:
            return TrustLevel(skill_entry.trust_level)
        except ValueError:
            pass

    # Default to intern for new skills
    return DEFAULT_TRUST_LEVEL


def promote_trust_level(current: TrustLevel) -> TrustLevel:
    """Promote a skill to the next higher trust level.

    Args:
        current: Current trust level.

    Returns:
        Next higher trust level, or current if already at max.
    """
    idx = TRUST_LEVEL_ORDER.index(current)
    if idx < len(TRUST_LEVEL_ORDER) - 1:
        return TRUST_LEVEL_ORDER[idx + 1]
    return current


def demote_trust_level(current: TrustLevel) -> TrustLevel:
    """Demote a skill to the next lower trust level.

    Args:
        current: Current trust level.

    Returns:
        Next lower trust level, or current if already at min.
    """
    idx = TRUST_LEVEL_ORDER.index(current)
    if idx > 0:
        return TRUST_LEVEL_ORDER[idx - 1]
    return current


# ---------------------------------------------------------------------------
# Vulnerability scanning
# ---------------------------------------------------------------------------


def scan_vulnerabilities(content: str) -> list[dict[str, Any]]:
    """Scan skill content for known vulnerability patterns.

    Returns a list of vulnerability findings with severity, pattern, and line number.

    Args:
        content: Skill SKILL.md content.

    Returns:
        List of vulnerability findings.
    """
    findings: list[dict[str, Any]] = []
    lines = content.split("\n")

    for pattern_name, pattern_info in VULNERABILITY_PATTERNS.items():
        pattern = re.compile(pattern_info["pattern"])
        for line_num, line in enumerate(lines, 1):
            if pattern.search(line):
                findings.append({
                    "pattern": pattern_name,
                    "severity": pattern_info["severity"],
                    "description": pattern_info["description"],
                    "line": line_num,
                    "content": line.strip()[:200],
                })

    return findings


def calculate_vulnerability_rate(findings: list[dict[str, Any]]) -> float:
    """Calculate vulnerability rate from findings.

    Returns a score between 0 and 1, where:
    - 0 = no vulnerabilities
    - 1 = heavily vulnerable

    Severity weights: high=3, medium=2, low=1
    Target: <0.20 (20%) vs community avg of 0.261

    Args:
        findings: List of vulnerability findings.

    Returns:
        Vulnerability rate (0.0 to 1.0).
    """
    if not findings:
        return 0.0

    severity_weights = {"high": 3, "medium": 2, "low": 1}
    total_weight = sum(
        severity_weights.get(f["severity"], 1) for f in findings
    )
    max_possible = max(total_weight, 1)

    rate = min(1.0, total_weight / (max_possible * 3))
    return round(rate, 4)


# ---------------------------------------------------------------------------
# Sandbox enforcement
# ---------------------------------------------------------------------------


@dataclass
class SkillEntry:
    """A skill entry with trust and sandbox information."""

    name: str
    trust_level: str = "intern"
    vulnerability_score: float = 0.0
    is_valid: bool = True
    validation_errors: list[str] = field(default_factory=list)
    validation_warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def apply_trust_sandbox(
    skill: SkillEntry,
    sandbox_config: SkillSandboxConfig | None = None,
) -> SkillSandboxConfig:
    """Apply sandboxing configuration based on a skill's trust level.

    Args:
        skill: The skill entry to sandbox.
        sandbox_config: Optional override configuration.

    Returns:
        Applied sandbox configuration.
    """
    # Use explicit config trust level if provided and not INTERN default
    if sandbox_config is not None and sandbox_config.trust_level != TrustLevel.INTERN:
        config = sandbox_config
    else:
        config = SkillSandboxConfig()

    # If no explicit trust level was set, derive from skill
    if config.trust_level == TrustLevel.INTERN and sandbox_config is None:
        config.trust_level = get_trust_level(skill)
    elif sandbox_config is not None and sandbox_config.trust_level == TrustLevel.INTERN:
        config.trust_level = get_trust_level(skill)

    # Apply trust level constraints
    level_config = TRUST_LEVELS[config.trust_level]

    if config.trust_level == TrustLevel.INTERN:
        config.max_memory_mb = 128
        config.timeout_seconds = 15
        config.network_access = False
    elif config.trust_level == TrustLevel.JUNIOR:
        config.max_memory_mb = 256
        config.timeout_seconds = 30
        config.network_access = True
    elif config.trust_level == TrustLevel.SENIOR:
        config.max_memory_mb = 512
        config.timeout_seconds = 60
        config.network_access = True
    elif config.trust_level == TrustLevel.PRINCIPAL:
        config.max_memory_mb = 1024
        config.timeout_seconds = 120
        config.network_access = True

    return config


def validate_sandbox_config(config: SkillSandboxConfig) -> list[str]:
    """Validate a sandbox configuration for safety.

    Args:
        config: Sandbox configuration to validate.

    Returns:
        List of validation errors (empty if valid).
    """
    errors: list[str] = []

    if config.trust_level not in TrustLevel:
        errors.append(f"Invalid trust level: {config.trust_level}")

    if config.max_memory_mb <= 0 or config.max_memory_mb > 4096:
        errors.append(f"max_memory_mb out of range: {config.max_memory_mb} (must be 1-4096)")

    if config.timeout_seconds <= 0 or config.timeout_seconds > 300:
        errors.append(f"timeout_seconds out of range: {config.timeout_seconds} (must be 1-300)")

    return errors


# ---------------------------------------------------------------------------
# Execution sandboxing
# ---------------------------------------------------------------------------


def run_skill_script(
    script_path: Path,
    sandbox_config: SkillSandboxConfig | None = None,
    timeout: int | None = None,
) -> dict[str, Any]:
    """Execute a skill script within the configured sandbox.

    Args:
        script_path: Path to the script file.
        sandbox_config: Sandbox configuration (uses trust level default if None).
        timeout: Override timeout in seconds.

    Returns:
        Result dict with status, stdout, stderr, exit_code.
    """
    config = sandbox_config or SkillSandboxConfig()
    effective_timeout = timeout or config.timeout_seconds

    # Build environment with whitelist
    env = {k: os.environ[k] for k in config.env_whitelist if k in os.environ}

    # Build command based on script extension
    if script_path.suffix == ".py":
        cmd = ["python3", str(script_path)]
    elif script_path.suffix == ".sh":
        cmd = ["bash", str(script_path)]
    else:
        return {
            "status": "error",
            "stderr": f"Unsupported script type: {script_path.suffix}",
            "exit_code": 1,
        }

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=effective_timeout,
            env=env,
        )
        return {
            "status": "success" if result.returncode == 0 else "failure",
            "stdout": result.stdout[:4096],
            "stderr": result.stderr[:4096],
            "exit_code": result.returncode,
            "timeout": False,
        }
    except subprocess.TimeoutExpired:
        return {
            "status": "timeout",
            "stdout": "",
            "stderr": f"Script timed out after {effective_timeout}s",
            "exit_code": -1,
            "timeout": True,
        }
    except Exception as exc:
        return {
            "status": "error",
            "stdout": "",
            "stderr": str(exc),
            "exit_code": -1,
            "timeout": False,
        }


# ---------------------------------------------------------------------------
# Import os at module level for env access
# ---------------------------------------------------------------------------

import os  # noqa: E402 (after SkillEntry definition)
