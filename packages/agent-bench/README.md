# Agent Benchmark Evaluation Platform

A Python-based evaluation hub that runs agent tests across benchmarks (SWE-bench, AgentBench, WebArena, GAIA, ToolBench) with cost tracking, scoring, and a FastAPI server for CI/CD integration.

## Architecture

```
┌─────────────┐     ┌────────────────┐     ┌─────────────┐
│  Benchmarks │────▶│  Orchestrator  │────▶│  Scorecard  │
│ (SWE/Agent/ │     │ + Worker Pool  │     │  + Reports  │
│  WebArena/  │     └────────────────┘     └─────────────┘
│   GAIA/     │            │                        │
│  ToolBench) │            ▼                        ▼
└─────────────┘     ┌────────────────┐     ┌─────────────┐
                    │   Cost Tracker │────▶│   FastAPI   │
                    │   Progress     │     │   Server    │
                    └────────────────┘     └─────────────┘
```

## Quick Start

```bash
# Install
pip install -e .

# Run FastAPI server
python -m agent_bench.server

# Or via CLI
agent-bench
```

## API Endpoints

- `POST /v1/evaluate` — Trigger a benchmark evaluation
- `GET /v1/evaluate/{run_id}/status` — Get evaluation status
- `GET /v1/evaluate/{run_id}/scorecard` — Get generated scorecard
- `GET /v1/evaluate/{run_id}/report?format=json|csv` — Download report
- `GET /v1/benchmarks` — List supported benchmarks
- `GET /v1/history` — Historical trends

## Supported Benchmarks

- **SWE-bench** — Software engineering task resolution
- **AgentBench** — AI agent capability evaluation
- **WebArena** — Web navigation benchmark
- **GAIA** — General AI assistant evaluation
- **ToolBench** — Tool use evaluation

## MQA Scoring

Scorecards use Multi-Quality Assessment facets:

- **Architecture** (0-100) — System design quality
- **Tests** (0-100) — Test coverage and quality
- **Quality** (0-100) — Code quality, readability, maintainability
- **Correctness** (0-100) — Pass rate on benchmark tasks
