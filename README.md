# EurekAgent — Budget-Aware Exploration Pipeline

Reference implementation of the four environment engineering dimensions from the EurekAgent paper:

**"EurekAgent: Agent Environment Engineering is All You Need for Autonomous Scientific Discovery"**
(Amy Xin et al., arXiv:2606.13662, June 2026)

## Overview

EurekAgent demonstrates that as LLM capabilities improve, the bottleneck for autonomous scientific discovery shifts from agent workflow design to **environment design**. The key insight is that building environments that amplify productive behaviors (open-ended exploration, collaboration) while suppressing harmful behaviors (reward hacking, score tampering) is the primary lever for agent capability.

## The Four Dimensions

| Dimension | Description | Implementation |
|-----------|-------------|----------------|
| **Permissions Engineering** | Bounded execution with isolated environments | Docker isolation, hidden evaluators, controller-owned files, GPU default-deny |
| **Artifact Engineering** | Filesystem + Git as shared memory | Structured artifacts dir, ranked solution history, Git commit tracking |
| **Budget Engineering** | Dual-axis budget control (time + API cost) | Active time-check API, passive deadline warnings, resumable checkpoints |
| **Human-in-the-Loop** | Low-friction supervision | Web monitor, terminal UI, preparation stage pause, extra time grants |

## System Loop

```
Prepare → [Propose → {Implement}_p=1..Pr]_r=1..R
```

- **Prepare**: Set up workspace, validate evaluator, install dependencies
- **Propose** (fan-in): Generate diverse hypotheses from ranked history + internet research
- **Implement** (fan-out): Parallel sessions for each hypothesis, with evaluator feedback

## Key Results from the Paper

| Task | EurekAgent Result | Cost |
|------|-------------------|------|
| 26-Circle Packing (SOTA) | 2.635999 | <$11 |
| Erdős Min. Overlap (SOTA) | 0.380870 | included |
| 1st Autocorr. Ineq. (SOTA) | 1.502861 | included |
| GPUMODE TriMul (Rank #1) | 2005.03 μs | included |
| MLE-Bench Lite (Rank #1) | #1 on subset | included |

**Average total API cost: <$17 across all tasks. Training-free (no model fine-tuning).**

## Usage

```bash
# Run with defaults
python -m eurekagent_budget_aware --task "26-circle packing" --workspace ./runs/my-run

# Custom budgets
python -m eurekagent_budget_aware \
    --task "kernel optimization" \
    --budget-time 7200 \
    --budget-api 200000 \
    --max-rounds 10 \
    --max-parallel 5 \
    --workspace ./runs/kernel-opt

# Resume from checkpoint
python -m eurekagent_budget_aware \
    --task "26-circle packing" \
    --workspace ./runs/my-run \
    --resume \
    --extra-time 1800

# Grant extra time via CLI
python -m eurekagent_budget_aware \
    --task "math optimization" \
    --workspace ./runs/math \
    --extra-time 3600
```

## Project Structure

```
eurekagent_budget_aware.py   # Main pipeline implementation
├── PermissionsConfig         # Permission boundaries
├── ArtifactStore             # Filesystem + Git shared memory
├── BudgetEngineer            # Dual-axis budget control
├── Monitor                   # Human-in-the-loop interface
└── EurekAgentPipeline        # Main propose-implement loop
```

## API

### BudgetEngineer

```python
from eurekagent_budget_aware import BudgetEngineer

budget = BudgetEngineer(budget_time=3600, budget_api=100000)
budget.tick(duration=10.0, tool_calls=5)  # Advance budget
if budget.check_passive_warning():
    print("Deadline approaching!")
budget.grant_extra_time(1800)  # Human-in-the-loop extension
```

### ArtifactStore

```python
from eurekagent_budget_aware import ArtifactStore

store = ArtifactStore(workspace=Path("./runs/my-run"), git_repo=Path("./runs/my-run"))
store.persist(ArtifactEntry(
    artifact_type="solution",
    round_num=1,
    session_id="session_1",
    content=code,
    score=2.635,
))
ranked = store.get_ranked()  # Get ranked solutions
```

## Related Work Comparison

| System | Training-Free | Parallel | Artifact Memory | Budget Control |
|--------|:---:|:---:|:---:|:---:|
| AlphaEvolve | ✅ | ❌ | ❌ | ❌ |
| ThetaEvolve | ❌ | ❌ | ❌ | ❌ |
| TTT-Discover | ❌ | ❌ | ❌ | ❌ |
| MLE-STAR | ✅ | ❌ | ❌ | ❌ |
| **EurekAgent** | **✅** | **✅** | **✅** | **✅** |

## License

Open-source (per the original EurekAgent paper).

## References

- arXiv:2606.13662: https://arxiv.org/abs/2606.13662
- GitHub: https://github.com/THU-Team-Eureka/EurekAgent
