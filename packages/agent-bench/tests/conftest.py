"""Shared test fixtures."""

from unittest.mock import patch

import pytest

from agent_bench.models import AgentConfig, BenchmarkConfig, BenchmarkType


@pytest.fixture()
def agent_config() -> AgentConfig:
    return AgentConfig(
        model="test-model",
        temperature=0.2,
        system_prompt="Test agent",
    )


@pytest.fixture()
def swe_bench_config(agent_config: AgentConfig) -> BenchmarkConfig:
    return BenchmarkConfig(
        benchmark_type=BenchmarkType.SWE_BENCH,
        agent_config=agent_config,
        subset_size=10,
        max_concurrent=2,
    )


@pytest.fixture()
def agent_bench_config(agent_config: AgentConfig) -> BenchmarkConfig:
    return BenchmarkConfig(
        benchmark_type=BenchmarkType.AGENT_BENCH,
        agent_config=agent_config,
        subset_size=10,
        max_concurrent=2,
    )


@pytest.fixture()
def webarena_config(agent_config: AgentConfig) -> BenchmarkConfig:
    return BenchmarkConfig(
        benchmark_type=BenchmarkType.WEBARENA,
        agent_config=agent_config,
        subset_size=10,
        max_concurrent=2,
    )
