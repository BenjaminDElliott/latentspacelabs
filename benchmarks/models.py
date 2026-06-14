"""
Shared data models for the Agent Benchmark Evaluation Platform.

Defines core data classes used across benchmark runners, parsers,
analytics, and regression detection modules.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum, auto
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ProblemType(Enum):
    """Types of benchmark problems."""
    CODE_FIX = auto()          # SWE-bench style code repair
    WEB_NAVIGATION = auto()    # WebArena, AgentBench web tasks
    KNOWLEDGE_QA = auto()      # GAIA knowledge questions
    TOOL_USAGE = auto()        # ToolBench API/tool call tasks
    CONVERSATION = auto()      # Multi-turn conversation benchmarks
    ROUTING = auto()           # Task routing / capability classification
    HIERARCHICAL = auto()      # Multi-level agent delegation
    FUNCTION_CALLING = auto()  # Structured function calling
    MEMORY = auto()            # Working memory / long-term retention
    REASONING = auto()         # Chain-of-thought reasoning
    EMBEDDING = auto()         # Semantic similarity / retrieval
    PLANNING = auto()          # Multi-step planning tasks
    SELF_REFLECTION = auto()   # Self-evaluation and correction


class AgentType(Enum):
    """Classification of agent architectures."""
    SINGLE_AGENT = auto()
    MULTI_AGENT = auto()
    HIERARCHICAL = auto()
    ROUTER = auto()
    REACT = auto()
    FUNCTION_CALLING = auto()
    TOOL_USING = auto()
    UNKNOWN = auto()


class RegressionSeverity(Enum):
    """Severity levels for detected regressions."""
    MINOR = auto()       # < 5% accuracy drop
    MODERATE = auto()    # 5-15% accuracy drop
    SIGNIFICANT = auto() # 15-30% accuracy drop
    CRITICAL = auto()    # > 30% accuracy drop


# ---------------------------------------------------------------------------
# Core Data Classes
# ---------------------------------------------------------------------------

@dataclass
class AgentAction:
    """Represents a single action taken by an agent during benchmark execution."""
    action_type: str              # e.g., "read_file", "edit", "bash", "call_api"
    params: dict[str, Any] = field(default_factory=dict)
    result: Any = None
    timestamp: datetime = field(default_factory=datetime.utcnow)
    latency_ms: float = 0.0
    cost_usd: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict (timestamp as ISO string)."""
        return {
            "action_type": self.action_type,
            "params": self.params,
            "result": self._serialize(self.result),
            "timestamp": self.timestamp.isoformat(),
            "latency_ms": self.latency_ms,
            "cost_usd": self.cost_usd,
        }

    @staticmethod
    def _serialize(obj: Any) -> Any:
        """Convert non-serializable objects for JSON output."""
        if isinstance(obj, datetime):
            return obj.isoformat()
        if hasattr(obj, "to_dict"):
            return obj.to_dict()
        return obj


@dataclass
class CostBreakdown:
    """Tracks costs across different dimensions of a benchmark run."""
    total_usd: float = 0.0
    model_costs: dict[str, float] = field(default_factory=dict)  # model_name -> cost
    api_call_costs: dict[str, float] = field(default_factory=dict)  # endpoint -> cost
    token_costs: dict[str, int] = field(default_factory=dict)  # model_name -> tokens
    action_costs: dict[str, float] = field(default_factory=dict)  # action_type -> cost
    error_costs: float = 0.0  # cost from failed/retried calls

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_usd": round(self.total_usd, 6),
            "model_costs": {k: round(v, 6) for k, v in self.model_costs.items()},
            "api_call_costs": {k: round(v, 6) for k, v in self.api_call_costs.items()},
            "token_costs": dict(self.token_costs),
            "action_costs": {k: round(v, 6) for k, v in self.action_costs.items()},
            "error_costs": round(self.error_costs, 6),
        }


@dataclass
class TrialResult:
    """Result from a single trial (attempt) on a benchmark problem."""
    problem_id: str
    trial_index: int
    success: bool
    score: float = 0.0                     # normalized score [0, 1]
    expected_output: Any = None            # ground truth or reference
    actual_output: Any = None              # agent's output
    actions: list[AgentAction] = field(default_factory=list)
    cost: CostBreakdown = field(default_factory=CostBreakdown)
    duration_seconds: float = 0.0
    error_message: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict[str, Any]:
        return {
            "problem_id": self.problem_id,
            "trial_index": self.trial_index,
            "success": self.success,
            "score": self.score,
            "expected_output": self._serialize(self.expected_output),
            "actual_output": self._serialize(self.actual_output),
            "actions": [a.to_dict() for a in self.actions],
            "cost": self.cost.to_dict(),
            "duration_seconds": self.duration_seconds,
            "error_message": self.error_message,
            "metadata": self.metadata,
            "timestamp": self.timestamp.isoformat(),
        }

    @staticmethod
    def _serialize(obj: Any) -> Any:
        if isinstance(obj, datetime):
            return obj.isoformat()
        if hasattr(obj, "to_dict"):
            return obj.to_dict()
        if isinstance(obj, (list, tuple)):
            return [TrialResult._serialize(i) for i in obj]
        if isinstance(obj, dict):
            return {k: TrialResult._serialize(v) for k, v in obj.items()}
        return obj


@dataclass
class BenchmarkProblem:
    """A single problem/task within a benchmark suite."""
    problem_id: str
    suite: str                                  # e.g., "swe_bench", "webarena"
    problem_type: ProblemType
    difficulty: str = "medium"                  # easy / medium / hard
    description: str = ""
    input_data: dict[str, Any] = field(default_factory=dict)
    expected_output: Any = None
    metadata: dict[str, Any] = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "problem_id": self.problem_id,
            "suite": self.suite,
            "problem_type": self.problem_type.name,
            "difficulty": self.difficulty,
            "description": self.description,
            "input_data": self.input_data,
            "expected_output": self._serialize(self.expected_output),
            "metadata": self.metadata,
            "tags": self.tags,
        }

    @staticmethod
    def _serialize(obj: Any) -> Any:
        if isinstance(obj, datetime):
            return obj.isoformat()
        if hasattr(obj, "to_dict"):
            return obj.to_dict()
        if isinstance(obj, (list, tuple)):
            return [BenchmarkProblem._serialize(i) for i in obj]
        if isinstance(obj, dict):
            return {k: BenchmarkProblem._serialize(v) for k, v in obj.items()}
        return obj


@dataclass
class BenchmarkResult:
    """Aggregated results across all problems in a benchmark run."""
    run_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    suite: str = ""                             # benchmark suite name
    agent_type: AgentType = AgentType.UNKNOWN
    model_name: str = ""                        # underlying LLM/model used
    problems: list[BenchmarkProblem] = field(default_factory=list)
    trials: list[TrialResult] = field(default_factory=list)
    summary: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    started_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None

    @property
    def duration_seconds(self) -> float:
        if self.completed_at is None:
            return 0.0
        return (self.completed_at - self.started_at).total_seconds()

    @property
    def success_rate(self) -> float:
        if not self.trials:
            return 0.0
        return sum(1 for t in self.trials if t.success) / len(self.trials)

    @property
    def average_score(self) -> float:
        if not self.trials:
            return 0.0
        return sum(t.score for t in self.trials) / len(self.trials)

    @property
    def total_cost(self) -> float:
        return sum(t.cost.total_usd for t in self.trials)

    @property
    def total_duration(self) -> float:
        return sum(t.duration_seconds for t in self.trials)

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "suite": self.suite,
            "agent_type": self.agent_type.name,
            "model_name": self.model_name,
            "problems": [p.to_dict() for p in self.problems],
            "trials": [t.to_dict() for t in self.trials],
            "summary": self.summary,
            "metadata": self.metadata,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "duration_seconds": self.duration_seconds,
            "success_rate": self.success_rate,
            "average_score": self.average_score,
            "total_cost": self.total_cost,
            "total_duration": self.total_duration,
        }

    def save_json(self, path: str | Path) -> None:
        """Save results to a JSON file."""
        import json
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2, default=str)

    @classmethod
    def load_json(cls, path: str | Path) -> BenchmarkResult:
        """Load results from a JSON file."""
        import json
        path = Path(path)
        with open(path) as f:
            data = json.load(f)
        result = cls()
        result.run_id = data["run_id"]
        result.suite = data["suite"]
        result.model_name = data["model_name"]
        result.started_at = datetime.fromisoformat(data["started_at"])
        if data.get("completed_at"):
            result.completed_at = datetime.fromisoformat(data["completed_at"])
        # Restore problems
        for pd in data.get("problems", []):
            p = BenchmarkProblem(
                problem_id=pd["problem_id"],
                suite=pd["suite"],
                problem_type=ProblemType[pd["problem_type"]],
                difficulty=pd.get("difficulty", "medium"),
                description=pd.get("description", ""),
                input_data=pd.get("input_data", {}),
                metadata=pd.get("metadata", {}),
                tags=pd.get("tags", []),
            )
            result.problems.append(p)
        # Restore trials
        for td in data.get("trials", []):
            cost = CostBreakdown(**td.get("cost", {}))
            t = TrialResult(
                problem_id=td["problem_id"],
                trial_index=td["trial_index"],
                success=td["success"],
                score=td["score"],
                expected_output=td.get("expected_output"),
                actual_output=td.get("actual_output"),
                actions=[
                    AgentAction(
                        action_type=a["action_type"],
                        params=a.get("params", {}),
                        result=a.get("result"),
                        timestamp=datetime.fromisoformat(a["timestamp"]),
                        latency_ms=a.get("latency_ms", 0.0),
                        cost_usd=a.get("cost_usd", 0.0),
                    )
                    for a in td.get("actions", [])
                ],
                cost=cost,
                duration_seconds=td.get("duration_seconds", 0.0),
                error_message=td.get("error_message"),
                metadata=td.get("metadata", {}),
            )
            result.trials.append(t)
        result.summary = data.get("summary", {})
        result.metadata = data.get("metadata", {})
        return result


@dataclass
class BenchmarkRun:
    """Metadata and configuration for a benchmark run."""
    run_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    suite: str = ""
    model_name: str = ""
    agent_type: str = ""
    config: dict[str, Any] = field(default_factory=dict)
    environment: dict[str, Any] = field(default_factory=dict)
    started_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None
    result_path: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "suite": self.suite,
            "model_name": self.model_name,
            "agent_type": self.agent_type,
            "config": self.config,
            "environment": self.environment,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "result_path": self.result_path,
        }
