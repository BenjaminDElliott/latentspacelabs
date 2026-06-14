"""
Abstract base class for all benchmark runners.

Each concrete benchmark (SWE-bench, AgentBench, WebArena, GAIA, ToolBench)
extends this class and implements the required methods.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, List, Optional

from benchmark_platform.config import AgentConfig, BenchmarkConfig
from benchmark_platform.models.schemas import (
    AgentStatus,
    BenchmarkName,
    BenchmarkResult,
    CostBreakdown,
    EvaluationRun,
    RunStatus,
    TokenUsage,
)

logger = logging.getLogger(__name__)


class BaseBenchmarkRunner(ABC):
    """Abstract base for benchmark runners.

    Implements shared lifecycle (start, run instances, finalize, cost tracking)
    and delegates benchmark-specific logic to abstract methods.
    """

    benchmark: BenchmarkName

    def __init__(
        self,
        benchmark_config: BenchmarkConfig,
        agent_config: AgentConfig,
        output_dir: str = "./benchmark_output",
    ) -> None:
        self.benchmark_config = benchmark_config
        self.agent_config = agent_config
        self.output_dir = output_dir
        self._run: Optional[EvaluationRun] = None

    # ------------------------------------------------------------------
    # Public lifecycle
    # ------------------------------------------------------------------

    def start(self, total_instances: int) -> EvaluationRun:
        """Start a new evaluation run and return the run object."""
        now = datetime.utcnow()
        self._run = EvaluationRun(
            benchmark=self.benchmark,
            agent_name=self.agent_config.name,
            model=self.agent_config.model,
            status=RunStatus.RUNNING,
            started_at=now,
            total_instances=total_instances,
        )
        logger.info(
            "Starting %s run for agent '%s' (%d instances)",
            self.benchmark.value,
            self.agent_config.name,
            total_instances,
        )
        return self._run

    @property
    def run(self) -> EvaluationRun:
        if self._run is None:
            raise RuntimeError("Call start() before accessing run.")
        return self._run

    def finalize(self, status: RunStatus = RunStatus.COMPLETED) -> EvaluationRun:
        """Mark the run as completed/failed/cancelled."""
        assert self._run is not None  # finalized must be called after start
        self._run.status = status
        self._run.completed_at = datetime.utcnow()
        # Recalculate aggregate score
        if self._run.results:
            self._run.aggregate_score = sum(
                r.score for r in self._run.results
            ) / len(self._run.results)
        logger.info(
            "Finished %s run: status=%s, score=%.3f, cost=$%.2f",
            self.benchmark.value,
            status.value,
            self._run.aggregate_score,
            self._run.cost.total_cost_usd,
        )
        return self._run

    # ------------------------------------------------------------------
    # Instance execution
    # ------------------------------------------------------------------

    def run_instance(self, instance_id: str, **kwargs: Any) -> BenchmarkResult:
        """Run a single instance and return the result."""
        from datetime import datetime as dt

        logger.debug("Running instance %s", instance_id)
        result = BenchmarkResult(
            instance_id=instance_id,
            benchmark=self.benchmark,
            started_at=dt.utcnow(),
        )
        try:
            result = self._execute_instance(instance_id, **kwargs)
            result.completed_at = dt.utcnow()
        except TimeoutError:
            result.status = AgentStatus.TIMEOUT
            result.completed_at = dt.utcnow()
        except Exception as exc:
            result.status = AgentStatus.ERROR
            result.details["error"] = str(exc)
            result.completed_at = dt.utcnow()
            logger.exception("Instance %s failed: %s", instance_id, exc)
        finally:
            self._run.results.append(result)
            # Update counters
            if result.status == AgentStatus.PASS:
                self._run.passed_instances += 1
            elif result.status == AgentStatus.TIMEOUT:
                self._run.timeout_instances += 1
            elif result.status == AgentStatus.ERROR:
                self._run.error_instances += 1
            else:
                self._run.failed_instances += 1
            # Accumulate tokens / cost
            self._accumulate_cost(result.tokens_used)
        return result

    def run_all(self, instance_ids: List[str]) -> EvaluationRun:
        """Run all instances sequentially (override for parallel)."""
        for iid in instance_ids:
            self.run_instance(iid)
        self.finalize()
        assert self._run is not None
        return self._run

    # ------------------------------------------------------------------
    # Abstract methods — implement in subclasses
    # ------------------------------------------------------------------

    @abstractmethod
    def discover_instances(self) -> List[str]:
        """Return list of instance IDs to evaluate."""
        ...

    @abstractmethod
    def _execute_instance(self, instance_id: str, **kwargs: Any) -> BenchmarkResult:
        """Execute a single benchmark instance."""
        ...

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _accumulate_cost(self, tokens: TokenUsage) -> None:
        """Add token usage to the run's cost tracker."""
        self._run.cost.input_tokens += tokens.prompt_tokens
        self._run.cost.output_tokens += tokens.completion_tokens
        self._run.cost.total_tokens = (
            self._run.cost.input_tokens + self._run.cost.output_tokens
        )
        self._run.cost.input_cost_usd = (
            self._run.cost.input_tokens / 1_000_000
        ) * self.agent_config.provider.cost_per_1m_input_tokens
        self._run.cost.output_cost_usd = (
            self._run.cost.output_tokens / 1_000_000
        ) * self.agent_config.provider.cost_per_1m_output_tokens
        self._run.cost.total_cost_usd = (
            self._run.cost.input_cost_usd + self._run.cost.output_cost_usd
        )

    def get_progress(self) -> Dict[str, Any]:
        """Return current progress dict for real-time tracking."""
        run = self._run
        return {
            "benchmark": self.benchmark.value,
            "agent": self.agent_config.name,
            "status": run.status.value,
            "completed": len(run.results),
            "total": run.total_instances,
            "pass_rate": (
                run.passed_instances / max(1, run.total_instances)
            ),
            "completion_pct": run.completion_pct,
            "cost_usd": run.cost.total_cost_usd,
        }
