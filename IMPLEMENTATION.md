# Budget-Aware Exploration — Implementation Reference

This document describes the implementation of budget-aware exploration in the
EurekAgent pipeline, following the environment engineering thesis from
arXiv:2606.13662.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    EurekAgent Pipeline                        │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────────┐   │
│  │ Prepare  │───▶│  Propose │───▶│   Implement (xP)     │   │
│  │ (once)   │    │  (fan-in)│    │   (fan-out, parallel)│   │
│  └──────────┘    └──────────┘    └──────────┬───────────┘   │
│                                              │               │
│                              ┌───────────────┘               │
│                              │                                │
│                   ┌──────────▼──────────┐                    │
│                   │   Environment Layer  │                    │
│                   │                      │                    │
│                   │  ┌──────────────┐    │                    │
│                   │  │Permissions    │    │                    │
│                   │  │  Engineering  │    │                    │
│                   │  └──────────────┘    │                    │
│                   │  ┌──────────────┐    │                    │
│                   │  │Artifact      │    │                    │
│                   │  │  Engineering │    │                    │
│                   │  └──────────────┘    │                    │
│                   │  ┌──────────────┐    │                    │
│                   │  │Budget        │    │                    │
│                   │  │  Engineering │    │                    │
│                   │  └──────────────┘    │                    │
│                   │  ┌──────────────┐    │                    │
│                   │  │Human-in-Loop │    │                    │
│                   │  │  Engineering │    │                    │
│                   │  └──────────────┘    │                    │
│                   └──────────────────────┘                    │
└──────────────────────────────────────────────────────────────┘
```

## 1. Permissions Engineering

### PermissionMode
Three modes of isolation:
- **RESTRICTED**: Docker/container isolation (default for production)
- **WORKSPACE**: Workspace-level access with file boundaries
- **FULL**: Unbounded access for exploration

### PermissionsConfig
```python
@dataclass
class PermissionsConfig:
    mode: PermissionMode
    allowed_tools: list[str]        # Tools granted to agent
    deny_list: list[str]            # Files/dirs blocked
    gpu_isolation: bool             # GPU default-deny policy
    same_round_isolation: bool      # Parallel sessions isolated
    controller_owned_files: list[str]  # Auto-updated by system
```

### Key Design Decisions
1. Hidden evaluator outside agent workspace → prevents score tampering
2. Controller-owned result files → agent cannot overwrite official scores
3. Same-round isolation → prevents premature convergence to single direction
4. GPU lock ownership → prevents contention between parallel sessions

## 2. Artifact Engineering

### ArtifactStore
The filesystem + Git-backed shared memory system:

```python
store = ArtifactStore(workspace=Path("./runs/my-run"), git_repo=Path("./runs/my-run"))
```

### Artifact Types
- **preparation_summary.md**: Setup context for all subsequent sessions
- **round_N_hypotheses.json**: Proposals for round N
- **ranked_solutions.json**: Auto-ranked history of all scored solutions
- **artifacts/*.json**: Individual solution artifacts with scores

### Ranked History
The `get_solution_history(max_rounds)` method returns the top solution from
each of the most recent rounds, providing context for the proposal stage:

```
Round 3: Score=2.630 (Greedy placement)
Round 2: Score=2.630 (Hex lattice)
Round 1: Score=2.630 (Random init + gradient)
```

This enables **compound learning** — each round builds on empirical progress
from all previous rounds.

## 3. Budget Engineering

### BudgetState
Tracks dual-axis limits:
- **Wall-clock time**: Separate limits per stage (proposal vs. implementation)
- **API cost**: Accumulated token usage across sessions

```python
@dataclass
class BudgetState:
    time_limit: float           # Total wall-clock time budget
    api_cost_limit: float       # Total API cost budget
    time_elapsed: float
    api_cost: float
    stage_time_limits: dict[str, float]   # Per-stage overrides
    stage_api_limits: dict[str, float]
```

### Active vs. Passive Control

**Active mechanisms:**
- `tick(duration, tool_calls, avg_tokens)` — manual advancement
- `estimate_api_cost(tool_calls, avg_tokens)` — cost estimation
- `check_active_budget()` — check before starting work

**Passive mechanisms:**
- `check_passive_warning()` — returns True when <20% time remaining
- Automatic warning injection to agent session
- Run abort + workspace preservation when budget exhausted

### Resumability
```python
budget.save_checkpoint("round_3", session_id="impl_r3_0")
# ... process interrupted ...
budget.load_checkpoint()  # Returns True, restores state
```

### Extra Time Extension
```python
budget.grant_extra_time(1800)  # +30 min for continued execution
```

## 4. Human-in-the-Loop Interface

### Monitor
Provides oversight without high-friction intervention:

```python
monitor = Monitor(workspace=Path("./runs/my-run"))
monitor.print_scoreboard(ranked_solutions)  # Terminal display
monitor.request_human_input(session_id)      # Interactive input
monitor.update_status(session_id, score=2.635)  # Live updates
```

### Integration Points
1. **Preparation pause**: Agent can request human clarification
2. **Terminal UI**: `request_human_input()` for active session guidance
3. **Scoreboard**: `print_scoreboard()` for round-end review
4. **Extra time**: `grant_extra_time()` for continued execution

## 5. The Main Pipeline Loop

```python
pipeline = EurekAgentPipeline(
    task_name="26-circle packing",
    workspace=Path("./runs/my-run"),
    budget_time=3600,
    budget_api=100000,
    max_rounds=5,
    max_parallel=3,
)
status = pipeline.run()
```

### Round Loop
```
for round 1..R:
    if budget exhausted: break

    1. PROPOSE (fan-in):
       - Read ranked history + prep summary
       - Generate P diverse hypotheses

    2. IMPLEMENT (fan-out, parallel):
       - For each hypothesis:
         - Launch session with permission boundaries
         - Iteratively refine with evaluator feedback
         - Score and persist as artifact
       - Rank all valid submissions

    3. UPDATE:
       - Add to ranked solution history
       - Save budget checkpoint
       - Update monitor status
```

## Testing

```bash
# Run a quick test with 3 rounds
python -m eurekagent_budget_aware \
    --task "26-circle packing" \
    --budget-time 300 \
    --budget-api 50000 \
    --max-rounds 3 \
    --max-parallel 3 \
    --workspace ./runs/test-run
```

## Adaptation for Production

To connect to actual LLM agents:

1. **Replace `_generate_hypotheses()`** with an LLM call using the proposal prompt template
2. **Replace `_run_session()`** with a CLI agent session (Claude Code, etc.)
3. **Connect to real evaluator** instead of simulated scoring
4. **Add Docker isolation** for RESTRICTED mode
5. **Set up MCP tools** (Web Search, Playwright) for web research
