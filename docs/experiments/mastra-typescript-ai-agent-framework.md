---
title: "Mastra — TypeScript AI Agent Framework with MCP"
date: "2026-06-14"
source: "GitHub mastra-ai/mastra, mastra.ai docs, npm, CLI"
signal: "GitHub(25052+stars)"
relevance: 5
related: ["[[Tool Use Patterns for Agents]]", "[[Agent Memory Architectures]]", "[[Structured Output Patterns]]"]
---

# Mastra — TypeScript AI Agent Framework with MCP

## Summary

Mastra is a TypeScript-first framework for building AI-powered applications and agents, created by the Gatsby team (Y Combinator W25). At 25,052 stars on GitHub, it is one of the most popular TypeScript AI agent frameworks. It provides a unified toolkit for agents, workflows, memory/RAG, evals, observability, TTS, MCP server generation, and multi-model routing — all with first-class TypeScript support. Key differentiator: it ships with a built-in MCP server generator that exposes agents, tools, and workflows as MCP endpoints for any MCP client.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture & Package Ecosystem](#architecture--package-ecosystem)
3. [Core Features](#core-features)
4. [MCP Server Integration](#mcp-server-integration)
5. [Agent Architecture](#agent-architecture)
6. [Workflow Engine](#workflow-engine)
7. [Memory & RAG](#memory--rag)
8. [Evals & Observability](#evals--observability)
9. [Deployment & CLI](#deployment--cli)
10. [Comparison: Mastra vs. Python Frameworks](#comparison-mastra-vs-python-frameworks)
11. [Comparison with Other TypeScript Frameworks](#comparison-with-other-typescript-frameworks)
12. [TypeScript vs. Python Agent Patterns](#typescript-vs-python-agent-patterns)
13. [Suitability for Latent Space Labs](#suitability-for-latent-space-labs)
14. [Actionable Insights](#actionable-insights)
15. [Sources](#sources)

---

## Overview

| Attribute | Value |
|---|---|
| GitHub | [mastra-ai/mastra](https://github.com/mastra-ai/mastra) |
| Stars | 25,052 |
| Created | August 2024 |
| Language | TypeScript |
| License | Dual (Apache-2.0 + Mastra Enterprise License) |
| Y Combinator | W25 cohort |
| Homepage | https://mastra.ai |
| Topics | agents, ai, chatbots, evals, javascript, llm, mcp, nextjs, nodejs, reactjs, tts, typescript, workflows |

Mastra is purpose-built for TypeScript and designed around established AI patterns. It provides everything from early prototyping to production deployment in a single framework.

---

## Architecture & Package Ecosystem

Mastra is organized as a **monorepo** with 27+ packages under `packages/`. The core provides the foundation; specialized packages extend functionality.

### Package Structure

```
packages/
├── core              # @mastra/core — Agents, workflows, LLM routing, MCP base, evals
├── mcp               # @mastra/mcp — Full MCP server implementation (stdio/SSE/HTTP)
├── memory            # @mastra/memory — Conversation history, working memory, semantic recall
├── rag               # @mastra/rag — Document processing, GraphRAG, reranking, tools
├── evals             # @mastra/evals — Agent evaluation framework with prebuilt scorers
├── workflows         # (inside core) — Graph-based workflow engine
├── agent-builder     # CLI agent scaffolding
├── auth              # Enterprise auth with FGA (Fine-Grained Access)
├── cli               # @mastra/cli — `npm create mastra`, dev server, deployment
├── codemod           # Schema migration codemods
├── create-mastra     # Project scaffolding (`npm create mastra`)
├── deployer          # Deployment target abstraction
├── editor            # Visual agent/editor tools
├── fastembed         # Embedding generation via fastembed (Rust-based)
├── loggers           # Structured logging
├── mcp-docs-server   # MCP server for documentation search
├── mcp-registry-registry # MCP package registry
├── playground        # Web-based agent playground
├── playground-ui     # React UI components for the playground
├── rag               # RAG pipeline: documents, GraphRAG, reranking, vector tools
├── schema-compat     # Cross-version schema compatibility (AI SDK v4/v5/v6)
├── server            # Node.js/Next.js server utilities
├── _changeset-cli    # Versioning tooling
├── _config           # Internal config utilities
├── _external-types   # External type definitions
├── _internal-core    # Shared internal primitives
├── _internals        # AI SDK version-agnostic internal abstractions
├── _llm-recorder     # LLM call recording/tracing
├── _test-utils       # Testing utilities
├── _types-builder    # Type generation utilities
└── _vendored         # Vendored dependencies
```

### Dependency Stack

The core package reveals Mastra's dependency choices:

- **AI SDK Integration**: Wraps Vercel's AI SDK (v4, v5, and v6) for model interoperability
- **MCP SDK**: `@modelcontextprotocol/sdk ^1.29.0` — official MCP SDK for server implementation
- **A2A Protocol**: `@a2a-js/sdk ~0.3.13` — Agent-to-Agent protocol support
- **Schema Validation**: Zod v4, Standard Schema, Ajv (JSON Schema)
- **Concurrency**: `fastq`, `p-map`, `p-retry` — robust async execution
- **Observability**: PostHog analytics, structured tracing spans
- **Storage**: `@isaacs/ttlcache`, LRU cache — in-memory state management

---

## Core Features

### 1. Model Routing (40+ Providers)

Mastra provides a unified interface to 40+ LLM providers (OpenAI, Anthropic, Gemini, etc.) through a single standard interface. The `ModelRouterLanguageModel` class handles provider selection, version compatibility (AI SDK v4/v5/v6), and model configuration merging.

### 2. Agents

Mastra agents are autonomous LLM-based entities that:
- Reason about goals and decide which tools to use
- Iterate internally until emitting a final answer or meeting a stopping condition
- Support streaming responses, background tasks, and signal-based interruption
- Include built-in memory integration (conversation, working, semantic)
- Support multi-agent patterns via `SubAgent` and `DurableAgent`
- Feature goal-driven execution with `GoalSignalProvider`
- Support delegation between agents (`DelegationConfig`)
- Include trip-wire mechanisms for early task completion

### 3. Workflows

Graph-based workflow engine with intuitive syntax:
- `.then()` for sequential steps
- `.branch()` for conditional routing
- `.parallel()` for concurrent execution
- `.loop()` for iterative processing
- **Human-in-the-loop**: Suspend/resume workflows, await user input
- Cron-based scheduling via `croner`
- Time-travel execution for replay/debugging
- Step-level type inference from Zod schemas

### 4. Memory System

Three-tier memory architecture:
- **Conversation History**: Full message history with thread management
- **Working Memory**: Short-term, task-specific context (injected as tools)
- **Semantic Recall**: Embedding-based retrieval for long-term knowledge
- **Observational Memory**: Chunked observation storage with buffer management

### 5. TTS (Text-to-Speech)

Built-in TTS capabilities via `MastraVoice` interface with `DefaultVoice` implementation.

### 6. LLM Abstraction

Version-agnostic LLM interface supporting AI SDK v4, v5, and v6 through `MastraLLMV1`, `MastraLLMVNext`, and `ModelRouterLanguageModel` classes.

---

## MCP Server Integration

This is Mastra's most significant differentiator. The `@mastra/mcp` package provides a full-featured MCP server implementation.

### MCP Server Capabilities

The `MCPServer` class exposes Mastra capabilities to any MCP client:

```typescript
// Expose tools as MCP tools
const server = new MCPServer({
  name: 'My Agent Server',
  version: '1.0.0',
  tools: { weatherTool },
});

// Expose agents as MCP tools (auto-named 'ask_<agentName>')
const server = new MCPServer({
  name: 'Agent Server',
  version: '1.0.0',
  agents: { myAgent },
});

// Expose workflows as MCP tools (auto-named 'run_<workflowKey>')
const server = new MCPServer({
  name: 'Workflow Server',
  version: '1.0.0',
  workflows: { myWorkflow },
});
```

### Transport Support

| Transport | Protocol | Use Case |
|---|---|---|
| Stdio | Subprocess IPC | CLI tools, Codex, Claude Code |
| SSE | Server-Sent Events | HTTP-based MCP clients |
| Streamable HTTP | Streamable HTTP (MCP 2025-03-26) | Modern MCP clients |
| Hono SSE | Hono framework SSE | Web application integration |

### MCP Features

- **Tools**: Convert Mastra tools to MCP tool definitions with JSON Schema
- **Agents**: Auto-convert agents to `ask_<name>` tools with full streaming support
- **Workflows**: Auto-convert workflows to `run_<name>` tools
- **Prompts**: MCP prompt templates with variable substitution
- **Resources**: MCP resources with URI support (`file://`, `ui://`)
- **Subscriptions**: SSE resource change notifications
- **Elicitation**: User confirmation prompts via MCP `ElicitRequest`
- **FGA (Fine-Grained Access)**: Per-tool authorization mapped to Mastra's FGA system
- **MCP Registry**: Self-registering servers with package metadata, versioning, and remote endpoints
- **Auth**: OAuth middleware, `MCPAuthInfoToUserMapper` for identity resolution

### MCP Registry Integration

Mastra servers can self-publish to an MCP registry with:
- Package metadata (npm, docker, pypi, crates.io)
- Command-line deployment instructions
- Environment variable documentation
- Remote endpoint configuration (SSE, Streamable HTTP)

---

## Agent Architecture

Mastra's agent model is the most sophisticated in the TypeScript ecosystem.

### Agent Configuration

```typescript
import { Agent } from '@mastra/core/agent';

const myAgent = new Agent({
  name: 'ResearchAgent',
  instructions: 'You are a research assistant...',
  model: openai('gpt-4o'),
  tools: { searchTool, summarizeTool },
  memory: memory,
  workflow: myWorkflow,
  signals: [GoalSignalProvider],
  processors: [SkillsProcessor, WorkspaceInstructionsProcessor],
  backgroundTasks: { enabled: true },
  network: { enabled: true },
});
```

### Key Agent Features

1. **MessageList**: Unified message handling with type detection across AI SDK versions
2. **Processors**: Pluggable input/output transformation pipeline (skills, workspace instructions, custom processors)
3. **Signals**: Event-driven interruption system (goal completion, notifications, webhooks)
4. **SubAgents**: Hierarchical agent delegation with streaming support
5. **Network Loop**: Multi-agent collaboration with routing
6. **DurableAgent**: Persisted agent state for long-running operations
7. **Evaluation Hooks**: Integrated scorers for real-time quality assessment
8. **Voice Integration**: Text-to-speech output via `MastraVoice` interface
9. **Browser Support**: Built-in browser automation via `MastraBrowser`
10. **Background Tasks**: Async task execution without blocking agent responses

### Execution Model

```
Agent Execution Pipeline:
  Input → InputProcessor → Model Router → Tool Selection → Tool Execution
     ↓                                                                    ↓
  OutputProcessor ← Scorer Evaluation ← Model Response ← Tool Results
     ↓
  Output → OutputProcessor → Memory Update → Signal Check → Response
```

---

## Workflow Engine

Mastra's workflow engine is a **directed graph executor** with TypeScript-first type safety.

### Workflow Patterns

| Pattern | Method | Description |
|---|---|---|
| Sequential | `.then(step)` | Linear execution chain |
| Branching | `.branch(condition, onTrue, onFalse)` | Conditional routing |
| Parallel | `.parallel([stepA, stepB])` | Concurrent step execution |
| Loop | `.loop(condition)` | Iterative processing |
| Suspend | `.suspend()` | Wait for external input |
| Resume | `.resume(data)` | Continue after suspension |
| Cron | `.cron(schedule)` | Scheduled execution |

### Step Types

- **ToolStep**: Wraps Mastra tools for workflow execution
- **AgentStep**: Wraps agent calls within workflows
- **Custom Step**: Any async function with typed inputs/outputs
- **Processor Step**: Data transformation steps
- **Workflow Step**: Nested workflow invocation

### State Management

- Workflow state is persisted via Mastra's storage layer
- Time-travel execution for replay and debugging
- Serialized step flow for state persistence
- State reader for querying historical execution

---

## Memory & RAG

### Memory System

Mastra's memory system (`@mastra/memory`) provides:

- **Thread-based conversations**: Persistent conversation threads with metadata
- **Working memory**: Short-term context injection via dedicated tools
- **Semantic recall**: Embedding-based retrieval from historical messages
- **Observational memory**: Chunked memory storage with buffered writes
- **Multi-provider storage**: Pluggable storage backends (InMemoryStore, PostgreSQL, etc.)

### RAG Pipeline

The `@mastra/rag` package provides a complete RAG implementation:

- **Document processing**: Chunking, embedding, vector storage
- **GraphRAG**: Knowledge graph-based retrieval for connected reasoning
- **Reranking**: Relevance-based result reordering
- **Vector tools**: Built-in search tools for agent use
- **Embedding integration**: Via `@mastra/fastembed` (Rust-based for performance)

---

## Evals & Observability

### Evaluation Framework

`@mastra/evals` provides structured evaluation for AI agents:

- **Prebuilt scorers**: Code accuracy, tool call accuracy, format compliance
- **Custom scorers**: Pluggable scoring functions
- **Agent hooks**: Real-time scoring during agent execution
- **Sampling support**: Configurable sampling for expensive evaluations

### Observability

- **Structured tracing**: OpenTelemetry-compatible span system
- **Event system**: PubSub-based event bus for cross-component communication
- **PostHog integration**: Analytics and feature flag support
- **Request context**: Scoped context propagation across async boundaries
- **LLM recording**: Call recording for debugging and analysis

---

## Deployment & CLI

### CLI Commands

Mastra provides a comprehensive CLI via `@mastra/cli`:

```bash
npm create mastra@latest          # Scaffold new project
mastra init                       # Initialize project
mastra dev                        # Start development server
mastra build                      # Build for production
mastra start                      # Start production server
mastra lint                       # Lint project configuration
mastra migrate                    # Migrate schema/data
mastra studio                     # Launch visual editor
mastra scorer add <name>         # Add evaluation scorer
mastra deploy                    # Deploy to hosting
```

### Deployment Targets

- **Node.js**: Standard Node.js server deployment
- **Next.js**: Full-stack React/Next.js application deployment
- **Standalone server**: Deploy agents/workflows as isolated endpoints
- **Vercel/Cloud**: Cloud deployment via deployer abstraction
- **Docker**: Containerized deployment support

### Development Tools

- **Playground**: Web-based interactive agent playground
- **Studio**: Visual editor for agent configuration
- **Dev Server**: Hot-reload development with live agent iteration

---

## Comparison: Mastra vs. Python Frameworks

### Mastra vs. LangGraph (Python)

| Aspect | Mastra | LangGraph |
|---|---|---|
| Language | TypeScript | Python |
| Graph execution | `.then()`, `.branch()`, `.parallel()` | State graph with nodes/edges |
| Agent model | Autonomous with tool reasoning | State-machine agents |
| MCP support | Native MCP server generation | MCP via community integrations |
| Memory | Built-in (3-tier) | Via LangChain memory or custom |
| Evals | Built-in scorer framework | Via LangSmith or custom |
| Type safety | Full TypeScript inference | Pydantic + type hints |
| Streaming | Built-in stream support | Stream via LangChain |
| Human-in-loop | Native suspend/resume | State checkpointing |
| Ecosystem | Growing (Y Combinator backed) | Mature (LangChain ecosystem) |
| Deployment | CLI + multi-target | Custom (FastAPI, LangServe) |
| Model routing | Unified 40+ provider interface | Via LangChain ChatModel |
| RAG | Built-in GraphRAG | Via LangChain Document Loaders |
| TTS | Built-in | Via third-party |

**Key insight**: Mastra is more opinionated and integrated — everything ships together. LangGraph is more modular and Python-native but requires more assembly.

### Mastra vs. CrewAI (Python)

| Aspect | Mastra | CrewAI |
|---|---|---|
| Architecture | Single-agent + workflows | Multi-agent crew orchestration |
| Agent model | Autonomous tool reasoning | Role-based task delegation |
| Communication | SubAgent + Network loop | Shared context + tool results |
| MCP support | Native server generation | Community integrations |
| Type safety | TypeScript-first | Python + Pydantic |
| Workflow graph | Built-in graph engine | Sequential/parallel task chains |
| Deployment | CLI + multi-target | Custom FastAPI |
| Maturity | Growing rapidly (2024+) | Mature (2023+) |

**Key insight**: CrewAI specializes in multi-agent orchestration with role-based delegation. Mastra excels in single-agent depth with workflow integration and MCP support.

### Mastra vs. AutoGen (Microsoft)

| Aspect | Mastra | AutoGen |
|---|---|---|
| Language | TypeScript | Python/C# |
| Architecture | Agent + workflows unified | Multi-agent conversation |
| MCP support | Native | Community |
| Human-in-loop | Native suspend/resume | Conversation-based |
| Type safety | Full TypeScript | Python type hints |
| Graph execution | Built-in workflow engine | Conversation-based coordination |

### Mastra vs. Python MCP SDK

| Aspect | Mastra MCP | Python MCP SDK |
|---|---|---|
| Implementation | `@mastra/mcp` | `mcp` PyPI package |
| Agent integration | Auto-convert agents to tools | Manual tool registration |
| Transport | stdio, SSE, Streamable HTTP, Hono | stdio, SSE, Streamable HTTP |
| FGA support | Built-in fine-grained access | Custom implementation |
| Registry | Self-publishing registry | Custom registry |
| Workflow integration | Auto-convert workflows to tools | Manual |
| Ecosystem | Full-stack AI framework | Protocol-only |

**Key insight**: Mastra's MCP is not just a protocol implementation — it's a full agent-to-MCP bridge. Python MCP SDK is the reference implementation but requires more manual wiring.

---

## Comparison with Other TypeScript Frameworks

### Mastra vs. Vercel AI SDK

| Aspect | Mastra | Vercel AI SDK |
|---|---|---|
| Scope | Full agent framework | Streaming/UI primitives |
| Agents | Autonomous agents with tools | Chat completions |
| Workflows | Graph-based execution | None |
| MCP | Native server generation | None |
| Memory | Built-in memory system | Via integration |
| Evals | Built-in evaluation | Via integration |
| Model routing | 40+ providers | 40+ providers |
| Use case | Complex agent apps | Chat UI components |

**Key insight**: Vercel AI SDK is the foundation; Mastra builds a complete framework on top of it. AI SDK handles streaming and UI; Mastra handles agents, workflows, and deployment.

### Mastra vs. Botpress

| Aspect | Mastra | Botpress |
|---|---|---|
| Architecture | Code-first TypeScript | Visual builder + code |
| Agent model | Autonomous with tool reasoning | Intent-based conversation |
| MCP support | Native | Via adapters |
| Flexibility | Full code control | Visual editor constraints |
| Deployment | Multi-target (Node, Next, standalone) | Botpress Cloud/Hosted |
| Open source | Apache-2.0 | Dual license |

### Mastra vs. Inngest AI

| Aspect | Mastra | Inngest AI |
|---|---|---|
| Execution model | Graph-based workflows | Event-driven functions |
| Agent model | Autonomous agents | Step-based AI functions |
| MCP support | Native | Via integration |
| Persistence | Built-in storage | External |
| Best for | Complex agent orchestration | Event-driven AI pipelines |

---

## TypeScript vs. Python Agent Patterns

### Type Safety Advantages

| Pattern | TypeScript (Mastra) | Python (LangGraph/CrewAI) |
|---|---|---|
| Step inputs/outputs | Full compile-time inference | Runtime validation (Pydantic) |
| Tool schemas | Zod v4 → JSON Schema → MCP | Pydantic → JSON Schema |
| Workflow graph | Type-safe step composition | Dict-based graph definition |
| Agent state | Typed state interfaces | TypedDict or Pydantic models |
| Memory records | Strongly typed message types | Dict-based message handling |
| MCP tool definitions | Auto-generated from Zod | Manual JSON Schema writing |

### Performance Characteristics

| Aspect | TypeScript (Node.js) | Python |
|---|---|---|
| Startup time | ~50-200ms (Node.js) | ~200-500ms (Python) |
| Concurrent handling | Event-loop (async/await) | GIL-limited (threading/multiprocessing) |
| Memory overhead | Lower per-connection | Higher per-thread |
| Streaming | Native (ReadableStream) | Async generators |
| WASM integration | Native (wasmer, wasmtime) | via PyO3 |

### Developer Experience

| Aspect | TypeScript (Mastra) | Python |
|---|---|---|
| IDE support | VS Code (intellisense everywhere) | VS Code/PyCharm (good, not perfect) |
| Refactoring | Full symbol-based refactoring | Partial (flake8-mypy) |
| Testing | Jest/Vitest with full types | pytest (types optional) |
| Build time | Fast (esbuild/swc) | Slower (compilation + imports) |
| Learning curve | Higher (generics, types) | Lower (dynamic typing) |

---

## Suitability for Latent Space Labs

### Alignment with Current Stack

Our project uses:
- Python backend with `packages/` and `hermes/` structure
- Hermes agent framework with MCP server integration
- Python-based agent dispatch system
- SQLite-backed idempotency management

### Where Mastra Adds Value

1. **MCP Server Generation**: Mastra's `MCPServer` can expose our Python agents as MCP endpoints. The auto-conversion of agents/workflows to MCP tools reduces boilerplate significantly.

2. **TypeScript Frontend Integration**: Our project already uses `package.json` and `node_modules` — Mastra integrates seamlessly with Next.js/React for building agent UIs.

3. **Workflow Orchestration**: Mastra's graph-based workflow engine with suspend/resume capabilities could replace ad-hoc Python workflow patterns.

4. **Evals Integration**: Built-in evaluation framework with prebuilt scorers for agent quality measurement.

5. **Multi-model Routing**: Unified interface to 40+ providers with model routing — valuable for agent cost optimization.

6. **Memory System**: Three-tier memory (conversation, working, semantic) with observational memory — directly applicable to agent memory patterns.

### Potential Integration Approaches

1. **Standalone MCP Server**: Run Mastra as a separate Node.js process that wraps Python agents via MCP tool calls.

2. **Hybrid Architecture**: Use Mastra for agent orchestration/UI layer, Python for heavy computation.

3. **MCP Bridge**: Use Mastra's MCP server to expose our existing Hermes agents to MCP clients.

### Tradeoffs

| Factor | Pros | Cons |
|---|---|---|
| Learning curve | TypeScript developers can use it directly | Python-heavy team needs transition |
| Runtime | Node.js is lightweight | Additional runtime in deployment |
| Ecosystem | Rapidly growing, YC-backed | Smaller than Python LangChain ecosystem |
| Integration | MCP-native, great for our use case | Python interop via subprocess/API |
| Performance | Event-loop concurrency | Not ideal for CPU-heavy workloads |

---

## Actionable Insights

### For Hermes Agent Architecture

1. **Adopt Mastra for MCP server generation**: Use `@mastra/mcp` to create a standardized MCP server that exposes Hermes agents. This gives us first-class MCP client compatibility (Claude, Cursor, Codex, Windsurf).

2. **Use Mastra's workflow engine for agent orchestration**: The graph-based workflow engine with suspend/resume is ideal for our agent dispatch patterns. Replace ad-hoc Python workflows with Mastra workflows for type safety and better observability.

3. **Integrate Mastra evals for agent quality**: Use `@mastra/evals` prebuilt scorers to evaluate our agents during development and production monitoring.

4. **Leverage model routing**: Use Mastra's unified model interface for A/B testing different LLM providers and implementing cost-optimized routing.

### Implementation Priority

1. **Phase 1 (Week 1-2)**: Create a Mastra MCP server that wraps our existing Hermes agents. Test with Claude Code, Cursor, and Codex.

2. **Phase 2 (Week 3-4)**: Implement workflow orchestration in Mastra for our most complex agent dispatch patterns.

3. **Phase 3 (Week 5-6)**: Integrate Mastra evals for agent quality measurement and build the agent UI with the playground components.

4. **Phase 4 (Week 7+)**: Evaluate production deployment patterns (standalone server, Next.js app, Docker).

### Decision Matrix

| Criteria | Weight | Score (1-10) | Notes |
|---|---|---|---|
| MCP support | 25% | 9 | Native, comprehensive, auto-generates |
| TypeScript integration | 20% | 8 | Excellent, but team is Python-heavy |
| Agent capabilities | 20% | 9 | Most sophisticated TS agent model |
| Ecosystem maturity | 15% | 6 | Growing rapidly but younger than LangChain |
| Deployment flexibility | 10% | 8 | Multi-target (Node, Next, standalone) |
| Python interop | 10% | 6 | Requires subprocess/API bridge |

**Weighted score: 8.0/10** — Recommended for MCP server layer and frontend agent integration.

---

## Sources

1. [mastra-ai/mastra](https://github.com/mastra-ai/mastra) — GitHub, 25,052 stars, TypeScript, Apache-2.0 + Enterprise License, created August 2024, YC W25
2. [Mastra Documentation](https://mastra.ai/docs) — Official docs covering agents, workflows, MCP, memory, evals, RAG, observability
3. [Mastra Installation](https://mastra.ai/docs/getting-started/installation) — CLI setup and manual installation guide
4. [Mastra Agents](https://mastra.ai/docs/agents/overview) — Agent architecture and configuration
5. [Mastra Workflows](https://mastra.ai/docs/workflows/overview) — Graph-based workflow engine documentation
6. [Mastra MCP Servers](https://mastra.ai/docs/tools-mcp/mcp-overview) — MCP server implementation and configuration
7. [Mastra Memory](https://mastra.ai/docs/memory/conversation-history) — Conversation history, working memory, semantic recall
8. [Mastra Evals](https://mastra.ai/docs/evals/overview) — Evaluation framework and scoring
9. [Mastra Observability](https://mastra.ai/docs/observability/overview) — Tracing, logging, analytics
10. [Mastra RAG](https://mastra.ai/docs/rag/overview) — RAG pipeline and GraphRAG
11. [Mastra GitHub Package Structure](https://github.com/mastra-ai/mastra/tree/main/packages) — Monorepo package listing
12. [Mastra Core Package.json](https://github.com/mastra-ai/mastra/blob/main/packages/core/package.json) — Core dependencies and exports
13. [Mastra MCP Server](https://github.com/mastra-ai/mastra/blob/main/packages/mcp/src/server/server.ts) — MCP server implementation source
14. [Mastra Agent Source](https://github.com/mastra-ai/mastra/blob/main/packages/core/src/agent/agent.ts) — Agent architecture source
15. [Mastra Workflow Source](https://github.com/mastra-ai/mastra/blob/main/packages/core/src/workflows/workflow.ts) — Workflow engine implementation
16. [Mastra MCP Types](https://github.com/mastra-ai/mastra/blob/main/packages/core/src/mcp/types.ts) — MCP configuration and type definitions
17. [Mastra Memory Source](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/index.ts) — Memory system implementation
18. [Mastra RAG Source](https://github.com/mastra-ai/mastra/blob/main/packages/rag/src/index.ts) — RAG pipeline implementation

---

## Related Research

- **Follow-Up Research**: [[~/.hermes/vault/research/mastra-ai-agent-framework-mcp.md]] (to be created)
- **PRD**: [[~/.hermes/vault/prds/mastra-ai-agent-framework-mcp.md]] (to be created)
- **Linear issue**: LAT-336 — Mastra TypeScript AI Agent Framework with MCP experiment
