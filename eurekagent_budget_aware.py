"""
EurekAgent — Budget-Aware Exploration Pipeline

Reference implementation of the four environment engineering dimensions
from the EurekAgent paper (arXiv:2606.13662).

This module demonstrates:
  1. Permissions engineering — bounded execution with isolated environments
  2. Artifact engineering — filesystem + Git as shared memory
  3. Budget engineering — dual-axis (time + API cost) budget control
  4. Human-in-the-loop — low-friction supervision points

Usage:
    python -m eurekagent_budget_aware \
        --task "26-circle packing" \
        --budget-time 3600 \
        --budget-api 100000 \
        --max-rounds 5 \
        --max-parallel 3 \
        --workspace ./runs/my-run
"""

import argparse
import copy
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any, Optional


# ---------------------------------------------------------------------------
# 1. Permissions Engineering
# ---------------------------------------------------------------------------

class PermissionMode(Enum):
    """Permission boundary mode for agent sessions."""
    RESTRICTED = "restricted"  # Docker/container isolation
    WORKSPACE = "workspace"     # Workspace-level access
    FULL = "full"               # Unbounded access


@dataclass
class PermissionsConfig:
    """Defines permission boundaries for an agent session."""
    mode: PermissionMode = PermissionMode.WORKSPACE
    allowed_tools: list[str] = field(default_factory=lambda: [
        "python", "bash", "read", "write", "edit",
        "web_search", "browser", "git",
    ])
    deny_list: list[str] = field(default_factory=lambda: [
        "/proc", "/sys", "/dev",  # system files
        "evaluator.py",            # hidden evaluator
        "ground_truth.json",       # hidden ground truth
    ])
    gpu_isolation: bool = True
    same_round_isolation: bool = True
    controller_owned_files: list[str] = field(default_factory=lambda: [
        "scores.json",
        "ranked_solutions.json",
        "budget_state.json",
    ])

    def build_isolation_context(self, workspace: Path) -> dict[str, Any]:
        """Build an isolation context for the session."""
        return {
            "mode": self.mode.value,
            "workspace": str(workspace),
            "allowed_tools": self.allowed_tools,
            "deny_list": self.deny_list,
            "gpu_isolation": self.gpu_isolation,
            "same_round_isolation": self.same_round_isolation,
            "controller_owned": self.controller_owned_files,
        }


# ---------------------------------------------------------------------------
# 2. Artifact Engineering
# ---------------------------------------------------------------------------

@dataclass
class ArtifactEntry:
    """An artifact entry in the shared memory."""
    artifact_type: str       # "proposal", "solution", "score", "log"
    round_num: int
    session_id: str
    content: str
    score: Optional[float] = None
    timestamp: str = field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat())
    git_hash: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "ArtifactEntry":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class ArtifactStore:
    """Filesystem + Git-backed shared memory for cross-session communication."""

    workspace: Path
    git_repo: Path

    def __post_init__(self):
        self.artifacts_dir = self.workspace / "artifacts"
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)

    def persist(self, entry: ArtifactEntry) -> str:
        """Persist an artifact and return its ID."""
        artifact_id = hashlib.sha256(
            f"{entry.round_num}:{entry.session_id}:{entry.timestamp}".encode()
        ).hexdigest()[:12]

        artifact_path = self.artifacts_dir / f"{artifact_id}.json"
        artifact_path.write_text(json.dumps(entry.to_dict(), indent=2))

        # Update ranked solutions if scored
        if entry.score is not None and entry.artifact_type == "solution":
            self._update_ranked(entry)

        return artifact_id

    def _update_ranked(self, entry: ArtifactEntry):
        """Update the ranked solutions file."""
        ranked_path = self.artifacts_dir / "ranked_solutions.json"
        ranked = json.loads(ranked_path.read_text()) if ranked_path.exists() else []

        # Remove old entry with same round/session
        ranked = [
            r for r in ranked
            if not (r["round_num"] == entry.round_num and r["session_id"] == entry.session_id)
        ]

        ranked.append(entry.to_dict())
        # Sort by score (higher is better for most tasks)
        ranked.sort(key=lambda r: r.get("score", 0), reverse=True)

        ranked_path.write_text(json.dumps(ranked, indent=2))

    def get_ranked(self) -> list[dict]:
        """Get ranked solutions from previous rounds (excluding current)."""
        ranked_path = self.artifacts_dir / "ranked_solutions.json"
        if not ranked_path.exists():
            return []
        ranked = json.loads(ranked_path.read_text())
        # Exclude current round
        return [r for r in ranked]

    def get_solution_history(self, max_rounds: int = 3) -> list[dict]:
        """Get solution history for proposal context."""
        ranked = self.get_ranked()
        # Return top solutions from recent rounds
        seen_rounds = set()
        result = []
        for entry in ranked:
            if entry["round_num"] not in seen_rounds and len(seen_rounds) < max_rounds:
                seen_rounds.add(entry["round_num"])
                result.append(entry)
        return list(reversed(result))

    def get_preparation_summary(self) -> Optional[str]:
        """Get the preparation stage summary."""
        prep_path = self.artifacts_dir / "preparation_summary.md"
        return prep_path.read_text() if prep_path.exists() else None

    def save_preparation_summary(self, summary: str):
        """Save preparation stage summary."""
        prep_path = self.artifacts_dir / "preparation_summary.md"
        prep_path.write_text(summary)

    def get_hypotheses(self, round_num: int) -> list[str]:
        """Get hypotheses proposed for a specific round."""
        hypotheses_path = self.artifacts_dir / f"round_{round_num}_hypotheses.json"
        if hypotheses_path.exists():
            return json.loads(hypotheses_path.read_text())
        return []

    def save_hypotheses(self, round_num: int, hypotheses: list[str]):
        """Save hypotheses for a round."""
        hypotheses_path = self.artifacts_dir / f"round_{round_num}_hypotheses.json"
        hypotheses_path.write_text(json.dumps(hypotheses, indent=2))


# ---------------------------------------------------------------------------
# 3. Budget Engineering
# ---------------------------------------------------------------------------

@dataclass
class BudgetState:
    """Tracks budget consumption and limits."""
    time_limit: float          # seconds
    api_cost_limit: float      # tokens or arbitrary cost units
    time_elapsed: float = 0.0
    api_cost: float = 0.0

    # Per-stage budgets (override total limits)
    stage_time_limits: dict[str, float] = field(default_factory=dict)
    stage_api_limits: dict[str, float] = field(default_factory=dict)

    # Resumability
    stage: str = ""
    session_id: Optional[str] = None
    interrupted_at: Optional[str] = None

    @property
    def time_remaining(self) -> float:
        return max(0, self.time_limit - self.time_elapsed)

    @property
    def api_remaining(self) -> float:
        return max(0, self.api_cost_limit - self.api_cost)

    @property
    def is_time_exhausted(self) -> bool:
        return self.time_elapsed >= self.time_limit

    @property
    def is_api_exhausted(self) -> bool:
        return self.api_cost >= self.api_cost_limit

    @property
    def is_exhausted(self) -> bool:
        return self.is_time_exhausted or self.is_api_exhausted

    @property
    def time_warning_threshold(self) -> float:
        """Fraction of time remaining before passive warning."""
        return 0.20  # warn when < 20% time remaining

    def check_time_warning(self) -> bool:
        """Check if time warning should be triggered."""
        return (not self.is_time_exhausted and
                self.time_elapsed / self.time_limit >= (1 - self.time_warning_threshold))

    def record_api_cost(self, cost: float):
        """Record API cost consumed."""
        self.api_cost += cost

    def record_time(self, delta: float):
        """Record time elapsed."""
        self.time_elapsed += delta

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "BudgetState":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


class BudgetEngineer:
    """Implements budget-aware exploration with dual-axis control."""

    def __init__(self, budget_time: float = 3600, budget_api: float = 100000,
                 stage_limits: Optional[dict] = None,
                 workspace: Path = Path(".")):
        self.state = BudgetState(
            time_limit=budget_time,
            api_cost_limit=budget_api,
            stage_time_limits=(stage_limits.get("time") or {}) if stage_limits else {},
            stage_api_limits=(stage_limits.get("api") or {}) if stage_limits else {},
        )
        self.workspace = Path(workspace)
        self.checkpoint_path = self.workspace / "budget_state.json"

    def check_active_budget(self) -> bool:
        """Active check: return True if budget is sufficient."""
        return not self.state.is_exhausted

    def check_passive_warning(self) -> bool:
        """Passive check: return True if time warning should be sent."""
        return self.state.check_time_warning()

    def estimate_api_cost(self, tool_calls: int, avg_tokens: int = 500) -> float:
        """Estimate API cost based on tool call count and token usage."""
        # Simplified cost model (adjust per actual pricing)
        return tool_calls * avg_tokens * 0.001  # $0.001 per 1000 tokens

    def tick(self, duration: float, tool_calls: int = 0, avg_tokens: int = 500):
        """Tick the budget tracker."""
        self.state.record_time(duration)
        cost = self.estimate_api_cost(tool_calls, avg_tokens)
        self.state.record_api_cost(cost)

        if self.check_passive_warning():
            print(f"[BUDGET WARNING] Only {self.state.time_remaining:.0f}s remaining")

    def save_checkpoint(self, stage: str, session_id: Optional[str] = None):
        """Persist budget state for resumability."""
        self.state.stage = stage
        self.state.session_id = session_id
        self.checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        self.checkpoint_path.write_text(json.dumps(self.state.to_dict(), indent=2))

    def load_checkpoint(self) -> bool:
        """Load budget state for resumability. Returns True if checkpoint found."""
        if not self.checkpoint_path.exists():
            return False
        data = json.loads(self.checkpoint_path.read_text())
        self.state = BudgetState.from_dict(data)
        print(f"[BUDGET RESUME] Resuming from stage '{self.state.stage}' "
              f"with {self.state.time_remaining:.0f}s remaining")
        return True

    def grant_extra_time(self, additional_seconds: float):
        """Grant extra time for continued execution (human-in-the-loop)."""
        self.state.time_limit += additional_seconds
        print(f"[BUDGET EXTEND] Added {additional_seconds:.0f}s, new limit: {self.state.time_limit:.0f}s")

    def get_status(self) -> dict:
        """Get current budget status for monitoring."""
        return {
            "time_elapsed": self.state.time_elapsed,
            "time_remaining": self.state.time_remaining,
            "time_limit": self.state.time_limit,
            "api_cost": self.state.api_cost,
            "api_limit": self.state.api_cost_limit,
            "api_remaining": self.state.api_remaining,
            "is_exhausted": self.state.is_exhausted,
            "stage": self.state.stage,
            "session_id": self.state.session_id,
        }


# ---------------------------------------------------------------------------
# 4. Human-in-the-Loop Interface
# ---------------------------------------------------------------------------

@dataclass
class SessionStatus:
    """Status of an agent session for human monitoring."""
    session_id: str
    stage: str
    round_num: int
    status: str  # "running", "completed", "failed", "awaiting_input"
    score: Optional[float] = None
    elapsed_time: float = 0.0
    artifacts: list[str] = field(default_factory=list)


class Monitor:
    """Web/terminal monitor for human-in-the-loop oversight."""

    def __init__(self, workspace: Path):
        self.workspace = workspace
        self.sessions: dict[str, SessionStatus] = {}

    def register_session(self, session_id: str, stage: str, round_num: int):
        self.sessions[session_id] = SessionStatus(
            session_id=session_id,
            stage=stage,
            round_num=round_num,
            status="running",
        )

    def update_status(self, session_id: str, **kwargs):
        if session_id in self.sessions:
            for k, v in kwargs.items():
                setattr(self.sessions[session_id], k, v)

    def get_overview(self) -> dict:
        """Get overview for web monitor display."""
        return {
            "sessions": {sid: asdict(s) for sid, s in self.sessions.items()},
            "budget": None,  # filled by caller
            "timestamp": datetime.datetime.utcnow().isoformat(),
        }

    def request_human_input(self, session_id: str, prompt: str = "Enter instructions:") -> str:
        """Request input from user for active session (terminal UI)."""
        print(f"\n[{session_id}] {prompt}")
        try:
            user_input = input("> ").strip()
            return user_input
        except (EOFError, KeyboardInterrupt):
            return ""

    def print_scoreboard(self, ranked_solutions: list[dict]):
        """Print current scoreboard to terminal."""
        print("\n" + "=" * 60)
        print("SCOREBOARD — Ranked Solutions")
        print("=" * 60)
        for i, sol in enumerate(ranked_solutions[:10]):
            score = sol.get("score", "N/A")
            print(f"  #{i+1} (Round {sol.get('round_num', '?')}) — Score: {score} "
                  f"Session: {sol.get('session_id', '?')}")
        print("=" * 60)


# ---------------------------------------------------------------------------
# 5. Budget-Aware Exploration Pipeline
# ---------------------------------------------------------------------------

@dataclass
class Hypothesis:
    """A candidate hypothesis for implementation."""
    hypothesis_id: str
    description: str
    initial_code: str = ""


@dataclass
class Solution:
    """An evaluated solution."""
    solution_id: str
    hypothesis_id: str
    round_num: int
    session_id: str
    code: str
    score: float
    evaluation_log: str = ""
    timestamp: str = field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat())

    def to_dict(self) -> dict:
        return asdict(self)


class EurekAgentPipeline:
    """
    The main pipeline implementing the EurekAgent propose-implement loop
    with all four environment engineering dimensions.

    Loop: Prepare → [Propose → {Implement}_p=1..Pr]_r=1..R
    """

    def __init__(
        self,
        task_name: str,
        workspace: Path,
        budget_time: float = 3600,
        budget_api: float = 100000,
        max_rounds: int = 5,
        max_parallel: int = 3,
        permissions: Optional[PermissionsConfig] = None,
    ):
        self.task_name = task_name
        self.workspace = Path(workspace)
        self.workspace.mkdir(parents=True, exist_ok=True)

        # Environment engineering components
        self.permissions = permissions or PermissionsConfig()
        self.artifacts = ArtifactStore(
            workspace=self.workspace,
            git_repo=self.workspace,
        )
        self.budget = BudgetEngineer(
            budget_time=budget_time,
            budget_api=budget_api,
            workspace=self.workspace,
        )
        self.monitor = Monitor(workspace=self.workspace)

        # Pipeline config
        self.max_rounds = max_rounds
        self.max_parallel = max_parallel
        self.round_num = 0

        # Results
        self.solutions: list[Solution] = []
        self.ranked_history: list[dict] = []

    # --- Stage 1: Prepare ---

    def prepare(self) -> str:
        """
        Prepare stage: set up workspace, validate evaluator, install deps.
        Writes preparation summary and completion artifact.
        """
        print("\n[STAGE: PREPARE] Setting up execution environment...")
        self.budget.state.stage = "prepare"
        self.budget.save_checkpoint("prepare")

        # Simulate preparation work
        prep_start = time.time()

        # Create workspace structure
        (self.workspace / "rounds").mkdir(exist_ok=True)
        (self.workspace / "eval").mkdir(exist_ok=True)

        # Write preparation summary
        summary = f"""# Preparation Summary: {self.task_name}
- Workspace: {self.workspace}
- Permissions mode: {self.permissions.mode.value}
- Budget: {self.budget.state.time_limit:.0f}s time, {self.budget.state.api_cost_limit:.0f} API cost
- Max rounds: {self.max_rounds}, Max parallel: {self.max_parallel}
- Git tracking enabled
- Same-round isolation: {self.permissions.same_round_isolation}
- GPU isolation: {self.permissions.gpu_isolation}

## Environment Setup Complete
- Python environment ready
- Shell access configured
- Web search tools available
- Evaluator service initialized
"""
        self.artifacts.save_preparation_summary(summary)

        # Track budget
        self.budget.tick(time.time() - prep_start, tool_calls=2)
        self.budget.save_checkpoint("prepare")

        print(f"  Preparation complete in {time.time() - prep_start:.1f}s")
        return summary

    # --- Stage 2: Propose ---

    def propose(self) -> list[Hypothesis]:
        """
        Propose stage: generate diverse hypotheses based on ranked history.
        Acts as the fan-in step.
        """
        round_id = f"r{self.round_num}"
        session_id = f"propose-{round_id}"

        print(f"\n[STAGE: PROPOSE Round {self.round_num}] Generating hypotheses...")
        self.monitor.register_session(session_id, "propose", self.round_num)
        self.budget.state.stage = "propose"

        # Get context: ranked history + preparation summary
        ranked = self.artifacts.get_ranked()
        prep_summary = self.artifacts.get_preparation_summary()

        # Build proposal context
        context_parts = [f"# Task: {self.task_name}\n"]
        if prep_summary:
            context_parts.append("## Preparation Summary\n")
            context_parts.append(prep_summary)
        if ranked:
            context_parts.append(f"\n## Prior Solutions ({len(ranked)} rounds completed)\n")
            for sol in ranked:
                context_parts.append(
                    f"- Round {sol['round_num']}: Score={sol['score']} "
                    f"Session={sol['session_id']}\n"
                )

        # Simulate hypothesis generation (replace with LLM call in production)
        start = time.time()
        hypotheses = self._generate_hypotheses(
            context="".join(context_parts),
            max_count=self.max_parallel,
        )

        # Save hypotheses as artifacts
        self.artifacts.save_hypotheses(self.round_num, [h.hypothesis_id for h in hypotheses])

        # Budget tracking
        self.budget.tick(time.time() - start, tool_calls=len(hypotheses))

        if self.budget.check_passive_warning():
            print("  [BUDGET WARNING] Deadline approaching — generating artifacts")

        # Save checkpoint
        self.budget.save_checkpoint("propose", session_id)
        hyp_ids = [h.hypothesis_id for h in hypotheses]
        self.monitor.update_status(session_id, status="completed", artifacts=hyp_ids)

        print(f"  Generated {len(hypotheses)} hypotheses in {time.time() - start:.1f}s")
        return hypotheses

    def _generate_hypotheses(self, context: str, max_count: int) -> list[Hypothesis]:
        """Generate hypotheses based on context (simulated LLM call)."""
        # In production, this calls the LLM with context to generate hypotheses
        # For reference implementation, generate template hypotheses

        hypothesis_templates = [
            ("Greedy placement strategy",
             "# Place circles using greedy max-radius algorithm\n"
             "def solve(n_circles=26):\n"
             "    circles = []\n"
             "    positions = [(0.5, 0.5)]\n"
             "    for i in range(n_circles):\n"
             "        r = min(min(x, y) for x, y in positions)\n"
             "        circles.append((positions[i][0], positions[i][1], r))\n"
             "    return circles"),
            ("Hexagonal lattice with refinement",
             "# Start with hexagonal lattice, refine positions\n"
             "def solve(n_circles=26):\n"
             "    # Hexagonal grid initialization\n"
             "    import math\n"
             "    lattice = []\n"
             "    r = 1.0 / (1 + 2/math.sqrt(3))\n"
             "    for row in range(n_circles):\n"
             "        for col in range(n_circles - row):\n"
             "            x = 0.15 + col * r * 1.5\n"
             "            y = 0.15 + row * r * math.sqrt(3) + (col % 2) * r * math.sqrt(3) / 2\n"
             "            if 0 < x < 1 and 0 < y < 1:\n"
             "                lattice.append((x, y, r))\n"
             "    return lattice[:n_circles]"),
            ("Random initial placement + gradient descent",
             "# Random initialization followed by local optimization\n"
             "def solve(n_circles=26):\n"
             "    import random\n"
             "    circles = []\n"
             "    for i in range(n_circles):\n"
             "        x, y = random.random(), random.random()\n"
             "        r = min(x, 1-x, y, 1-y) / 2\n"
             "        circles.append((x, y, r))\n"
             "    # Local optimization step\n"
             "    for _ in range(100):\n"
             "        for i in range(n_circles):\n"
             "            circles[i] = optimize(circles, i)\n"
             "    return circles"),
            ("Simulated annealing approach",
             "# SA-based optimization for circle packing\n"
             "def solve(n_circles=26):\n"
             "    import random\n"
             "    import math\n"
             "    # Random initialization\n"
             "    positions = [(random.random(), random.random()) for _ in range(n_circles)]\n"
             "    radii = [0.1] * n_circles\n"
             "    # Simulated annealing loop\n"
             "    T = 1.0\n"
             "    while T > 0.01:\n"
             "        for i in range(n_circles):\n"
             "            dx, dy = random.gauss(0, 0.1), random.gauss(0, 0.1)\n"
             "            new_pos = (positions[i][0] + dx, positions[i][1] + dy)\n"
             "            if 0 < new_pos[0] < 1 and 0 < new_pos[1] < 1:\n"
             "                positions[i] = new_pos\n"
             "        T *= 0.99\n"
             "    return [(x, y, 0.1) for x, y in positions]"),
            ("Force-directed placement",
             "# Force-based optimization for non-overlapping circles\n"
             "def solve(n_circles=26):\n"
             "    import random\n"
             "    positions = [(random.random(), random.random()) for _ in range(n_circles)]\n"
             "    radii = [0.1] * n_circles\n"
             "    # Iterative force minimization\n"
             "    for step in range(500):\n"
             "        forces = [(0, 0)] * n_circles\n"
             "        for i in range(n_circles):\n"
             "            for j in range(i+1, n_circles):\n"
             "                dx = positions[j][0] - positions[i][0]\n"
             "                dy = positions[j][1] - positions[i][1]\n"
             "                dist = math.sqrt(dx*dx + dy*dy)\n"
             "                if dist < radii[i] + radii[j]:\n"
             "                    push = (radii[i] + radii[j] - dist) / dist\n"
             "                    forces[i] = (forces[i][0] - dx*push, forces[i][1] - dy*push)\n"
             "                    forces[j] = (forces[j][0] + dx*push, forces[j][1] + dy*push)\n"
             "        for i in range(n_circles):\n"
             "            positions[i] = (\n"
             "                max(0.01, min(0.99, positions[i][0] + forces[i][0]*0.01)),\n"
             "                max(0.01, min(0.99, positions[i][1] + forces[i][1]*0.01))\n"
             "            )\n"
             "    return [(x, y, 0.05) for x, y in positions]"),
        ]

        results = []
        for i in range(min(max_count, len(hypothesis_templates))):
            name, code = hypothesis_templates[i]
            results.append(Hypothesis(
                hypothesis_id=f"hyp_{self.round_num}_{i}",
                description=name,
                initial_code=code,
            ))
        return results

    # --- Stage 3: Implement ---

    def implement(self, hypotheses: list[Hypothesis]) -> list[Solution]:
        """
        Implement stage: parallel sessions for each hypothesis.
        Acts as the fan-out step.
        """
        print(f"\n[STAGE: IMPLEMENT Round {self.round_num}] Running {len(hypotheses)} parallel sessions...")
        self.budget.state.stage = "implement"
        self.budget.save_checkpoint("implement")

        solutions = []
        impl_start = time.time()

        for h in hypotheses:
            if self.budget.state.is_exhausted:
                print(f"  Budget exhausted, stopping implementation")
                break

            session_id = f"impl_{self.round_num}_{h.hypothesis_id}"
            self.monitor.register_session(session_id, "implement", self.round_num)

            print(f"  [IMPLEMENT] Session {session_id} for '{h.description}'...")
            sol = self._run_session(
                hypothesis=h,
                session_id=session_id,
                ranked_history=self.artifacts.get_solution_history(),
            )

            if sol and sol.score is not None:
                # Persist as artifact
                self.artifacts.persist(ArtifactEntry(
                    artifact_type="solution",
                    round_num=self.round_num,
                    session_id=session_id,
                    content=sol.code,
                    score=sol.score,
                ))
                solutions.append(sol)
                self.solutions.append(sol)
                print(f"    Score: {sol.score:.6f}")

            # Budget tracking per session
            elapsed = time.time() - impl_start
            self.budget.tick(elapsed, tool_calls=5)
            impl_start = time.time()

            if self.budget.check_passive_warning():
                print("  [BUDGET WARNING] Deadline approaching — stopping sessions")

        # Rank solutions
        solutions.sort(key=lambda s: s.score, reverse=True)
        self._update_ranked_history(solutions)

        self.monitor.print_scoreboard(
            [s.to_dict() for s in solutions]
        )

        self.budget.save_checkpoint("implement")

        print(f"  Implemented {len(solutions)} solutions in {time.time() - impl_start:.1f}s")
        return solutions

    def _run_session(self, hypothesis: Hypothesis, session_id: str,
                     ranked_history: list[dict]) -> Optional[Solution]:
        """Run a single implementation session with permission boundaries."""
        start = time.time()

        # Simulate LLM-based solution iteration
        # In production: Claude Code / CLI agent with evaluator feedback loop
        context = f"""
# Hypothesis: {hypothesis.description}
## Initial Code
{hypothesis.initial_code}
## Prior Best Solutions
"""
        for sol in ranked_history:
            context += f"- Round {sol['round_num']}: Score={sol['score']}\n"

        # Simulate iterative refinement (5 iterations)
        best_score = 0.0
        code = hypothesis.initial_code

        for iteration in range(5):
            # Simulate evaluator feedback
            improvement = 0.00001 * (1 + iteration * 0.5)
            base_score = 2.630 + improvement  # Simulate getting closer to SOTA
            noise = (hash(session_id + str(iteration)) % 100) / 1_000_0000
            score = min(base_score + noise, 2.635999)  # Cap at theoretical max

            if score > best_score:
                best_score = score
                code = f"{hypothesis.initial_code}\n# Iteration {iteration}: optimized"

            elapsed = time.time() - start
            self.budget.tick(0.1, tool_calls=3, avg_tokens=300)

            if self.budget.state.is_exhausted:
                break

        # Git commit for evolution tracking
        git_hash = hashlib.sha256(f"{session_id}:{best_score}".encode()).hexdigest()[:8]

        # Record result
        solution = Solution(
            solution_id=f"sol_{self.round_num}_{hash(session_id) % 10000}",
            hypothesis_id=hypothesis.hypothesis_id,
            round_num=self.round_num,
            session_id=session_id,
            code=code,
            score=best_score,
            evaluation_log=f"5 iterations, best score={best_score:.6f}",
            timestamp=datetime.datetime.utcnow().isoformat(),
        )

        self.monitor.update_status(session_id, status="completed", score=best_score)

        return solution

    def _update_ranked_history(self, solutions: list[Solution]):
        """Update ranked solution history after a round."""
        ranked = self.artifacts.get_ranked()
        for sol in solutions:
            ranked.append(sol.to_dict())
        ranked.sort(key=lambda r: r.get("score", 0), reverse=True)
        self.ranked_history = ranked

    # --- Main Loop ---

    def run(self) -> dict:
        """Execute the full EurekAgent pipeline."""
        print("=" * 60)
        print(f"EurekAgent Pipeline — Task: {self.task_name}")
        print(f"Workspace: {self.workspace}")
        print("=" * 60)

        # Try to resume from checkpoint
        checkpointed = self.budget.load_checkpoint()

        # Stage 1: Prepare (skip if resuming after prepare)
        if not checkpointed or self.budget.state.stage == "prepare":
            if checkpointed and self.budget.state.stage == "prepare":
                print("\n[RESUME] Skipping prepare stage (already completed)")
            else:
                self.prepare()
        else:
            self.prepare()

        # Stages 2+3: Propose-Implement loop
        while self.round_num < self.max_rounds and not self.budget.state.is_exhausted:
            self.round_num += 1

            # Check budget before each round
            if self.budget.state.is_exhausted:
                print(f"\n[BUDGET] Exhausted after round {self.round_num - 1}")
                break

            # Propose stage (fan-in)
            hypotheses = self.propose()
            if not hypotheses:
                print("  No hypotheses generated, ending pipeline")
                break

            # Implement stage (fan-out)
            solutions = self.implement(hypotheses)

            if not solutions:
                print("  No valid solutions, ending pipeline")
                break

            # Save budget state between rounds
            self.budget.save_checkpoint(f"round_{self.round_num}")

        # Final status
        status = self.budget.get_status()
        status["total_rounds"] = self.round_num
        status["total_solutions"] = len(self.solutions)
        status["best_score"] = max((s.score for s in self.solutions), default=None)

        # Write final report
        self._write_report(status)

        return status

    def _write_report(self, status: dict):
        """Write a final execution report."""
        report = f"""# EurekAgent Execution Report
## Task: {self.task_name}
## Status: {'Completed' if status['is_exhausted'] else 'Finished'}

### Budget Usage
- Time: {status['time_elapsed']:.0f}s / {status['time_limit']:.0f}s
- API Cost: {status['api_cost']:.1f} / {status['api_limit']:.0f}

### Results
- Rounds completed: {status['total_rounds']}
- Total solutions: {status['total_solutions']}
- Best score: {status['best_score']}

### Ranked Solutions (Top 5)
"""
        ranked = self.ranked_history[:5]
        for i, sol in enumerate(ranked):
            report += f"{i+1}. Score={sol['score']:.6f} (Round {sol['round_num']})\n"

        report_path = self.workspace / "report.md"
        report_path.write_text(report)
        print(f"\nReport saved to: {report_path}")


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="EurekAgent Budget-Aware Exploration Pipeline")
    parser.add_argument("--task", type=str, required=True, help="Task name (e.g., '26-circle packing')")
    parser.add_argument("--workspace", type=str, default="./runs/eurekagent-run",
                        help="Workspace directory for artifacts")
    parser.add_argument("--budget-time", type=float, default=3600,
                        help="Wall-clock time budget in seconds (default: 3600)")
    parser.add_argument("--budget-api", type=float, default=100000,
                        help="API cost budget (token units) (default: 100000)")
    parser.add_argument("--max-rounds", type=int, default=5,
                        help="Maximum number of propose-implement rounds (default: 5)")
    parser.add_argument("--max-parallel", type=int, default=3,
                        help="Maximum parallel implementation sessions (default: 3)")
    parser.add_argument("--resume", action="store_true",
                        help="Resume from last checkpoint")
    parser.add_argument("--extra-time", type=float, default=0,
                        help="Extra time to grant for continued execution (human-in-the-loop)")

    args = parser.parse_args()

    pipeline = EurekAgentPipeline(
        task_name=args.task,
        workspace=Path(args.workspace),
        budget_time=args.budget_time,
        budget_api=args.budget_api,
        max_rounds=args.max_rounds,
        max_parallel=args.max_parallel,
    )

    if args.extra_time > 0:
        pipeline.budget.grant_extra_time(args.extra_time)

    status = pipeline.run()
    print(f"\nDone. Status: {json.dumps(status, indent=2)}")


if __name__ == "__main__":
    main()
