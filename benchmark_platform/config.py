"""
Central configuration for the benchmark evaluation platform.

Loads settings from YAML config, environment variables, and defaults.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

class ProviderConfig(BaseModel):
    """Configuration for an LLM provider."""
    name: str = "openai"
    api_key_env: str = "OPENAI_API_KEY"
    base_url: Optional[str] = None
    max_retries: int = 3


class AgentConfig(BaseModel):
    """Agent configuration — model, temperature, system prompt, etc."""
    name: str
    provider: ProviderConfig = Field(default_factory=lambda: ProviderConfig())
    model: str = "gpt-4"
    temperature: float = 0.0
    max_tokens: int = 4096
    system_prompt: str = ""


class BenchmarkConfig(BaseModel):
    """Configuration for a single benchmark runner."""
    name: str  # e.g. "swe-bench", "agent-bench"
    enabled: bool = True
    subset: str = "verified"  # full / verified / lite
    max_instances: int = 100
    timeout_minutes: int = 1440  # 24 h
    agent: AgentConfig = Field(default_factory=lambda: AgentConfig(name="default"))


class AnalyticsConfig(BaseModel):
    """Cost/accuracy analytics settings."""
    track_tokens: bool = True
    track_cost_usd: bool = True
    cost_per_1m_input_tokens: float = 15.0  # default for premium models
    cost_per_1m_output_tokens: float = 60.0
    cost_currency: str = "USD"
    retention_days: int = 90


class RegressionConfig(BaseModel):
    """Regression detection settings."""
    enabled: bool = True
    threshold_percent: float = 5.0  # >5% drop triggers alert
    lookback_runs: int = 5
    alert_channels: List[str] = Field(default_factory=lambda: ["console"])


class CICDConfig(BaseModel):
    """CI/CD integration settings."""
    webhook_url: Optional[str] = None
    webhook_headers: Dict[str, str] = Field(default_factory=dict)
    slack_webhook_url: Optional[str] = None
    linear_api_key: Optional[str] = None
    linear_team: Optional[str] = None


class PlatformConfig(BaseModel):
    """Top-level platform configuration."""

    output_dir: str = "./benchmark_output"
    log_level: str = "INFO"
    max_concurrent_runs: int = 4
    cost_cap_usd: float = 200.0
    benchmarks: Dict[str, BenchmarkConfig] = Field(default_factory=dict)
    analytics: AnalyticsConfig = Field(default_factory=AnalyticsConfig)
    regression: RegressionConfig = Field(default_factory=RegressionConfig)
    cicd: CICDConfig = Field(default_factory=CICDConfig)
    default_agent: AgentConfig = Field(
        default_factory=lambda: AgentConfig(name="default")
    )

    @classmethod
    def load(cls, path: Optional[str] = None) -> "PlatformConfig":
        """Load configuration from a YAML file or environment."""
        if path and os.path.isfile(path):
            with open(path) as f:
                data = yaml.safe_load(f) or {}
            return cls(**data)
        # Fallback to env vars
        return cls()

    def save(self, path: str) -> None:
        """Serialize to YAML."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(yaml.dump(self.model_dump(mode="json", exclude_unset=True), indent=2))


# ---------------------------------------------------------------------------
# Default config template
# ---------------------------------------------------------------------------

DEFAULT_CONFIG: Dict[str, Any] = {
    "output_dir": "./benchmark_output",
    "log_level": "INFO",
    "max_concurrent_runs": 4,
    "cost_cap_usd": 200.0,
    "default_agent": {
        "name": "default",
        "provider": {"name": "openai", "api_key_env": "OPENAI_API_KEY"},
        "model": "gpt-4",
        "temperature": 0.0,
        "max_tokens": 4096,
    },
    "benchmarks": {
        "swe-bench": {"enabled": True, "subset": "verified", "max_instances": 100, "timeout_minutes": 1440},
        "agent-bench": {"enabled": True, "subset": "all", "max_instances": 50, "timeout_minutes": 720},
        "webarena": {"enabled": True, "subset": "default", "max_instances": 80, "timeout_minutes": 720},
        "gaia": {"enabled": True, "subset": "default", "max_instances": 50, "timeout_minutes": 720},
        "toolbench": {"enabled": True, "subset": "all", "max_instances": 60, "timeout_minutes": 720},
    },
    "analytics": {
        "track_tokens": True,
        "track_cost_usd": True,
        "cost_per_1m_input_tokens": 15.0,
        "cost_per_1m_output_tokens": 60.0,
        "retention_days": 90,
    },
    "regression": {
        "enabled": True,
        "threshold_percent": 5.0,
        "lookback_runs": 5,
        "alert_channels": ["console"],
    },
    "cicd": {
        "alert_channels": ["console"],
    },
}


def default_config() -> PlatformConfig:
    """Return a PlatformConfig with sensible defaults."""
    return PlatformConfig(**DEFAULT_CONFIG)
