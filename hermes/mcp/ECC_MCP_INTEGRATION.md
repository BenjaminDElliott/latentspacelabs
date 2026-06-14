# ECC MCP Server Integration Patterns

## Overview

This module implements MCP server integration patterns inspired by the [ECC (Elliott's Code Companion)
agent harness](https://github.com/affaan-m/ECC), which bundles **20 MCP servers** covering a wide
range of developer tooling. The patterns documented here informed the design of this module's
server manager, health checker, and graceful degradation layer.

## ECC's 20 MCP Servers (from mcp-configs/mcp-servers.json)

ECC bundles the following MCP servers, grouped by category:

### Local stdio servers (command-based)

| # | Server Name | Transport | Description |
|---|-------------|-----------|-------------|
| 1 | **nexus** | stdio (`nexus mcp`) | Local cost/privacy proxy — query usage, route to cheapest model, mask secrets/PII |
| 2 | **jira** | stdio (`uvx mcp-atlassian`) | Jira issue tracking — search, create, update, comment, transition |
| 3 | **github** | stdio (`npx @modelcontextprotocol/server-github`) | GitHub operations — PRs, issues, repos |
| 4 | **firecrawl** | stdio (`npx firecrawl-mcp`) | Web scraping and crawling |
| 5 | **supabase** | stdio (`npx @supabase/mcp-server-supabase`) | Supabase database operations |
| 6 | **memory** | stdio (`npx @modelcontextprotocol/server-memory`) | Persistent memory across sessions |
| 7 | **omega-memory** | stdio (`uvx omega-memory serve`) | Semantic search, multi-agent coordination, knowledge graphs |
| 8 | **longhand** | stdio (`longhand mcp-server`) | Lossless session history — indexes tool calls, file edits into SQLite + ChromaDB |
| 9 | **sequential-thinking** | stdio (`npx @modelcontextprotocol/server-sequential-thinking`) | Chain-of-thought reasoning |
| 10 | **railway** | stdio (`npx @railway/mcp-server`) | Railway deployments |
| 11 | **exa-web-search** | stdio (`npx exa-mcp-server`) | Web search, research, data ingestion via Exa API |
| 12 | **context7** | stdio (`npx @upstash/context7-mcp`) | Live documentation lookup |
| 13 | **codescene** | stdio (`npx @codescene/codehealth-mcp`) | CodeScene Code Health MCP |
| 14 | **magic** | stdio (`npx @magicuidesign/mcp`) | Magic UI components |
| 15 | **filesystem** | stdio (`npx @modelcontextprotocol/server-filesystem`) | Filesystem operations |
| 16 | **playwright** | stdio (`npx @playwright/mcp`) | Browser automation and testing |
| 17 | **fal-ai** | stdio (`npx fal-ai-mcp-server`) | AI image/video/audio generation via fal.ai |
| 18 | **browserbase** | stdio (`npx @browserbasehq/mcp-server-browserbase`) | Cloud browser sessions |
| 19 | **evalview** | stdio (`python3 -m evalview mcp serve`) | AI agent regression testing — 8 tools |
| 20 | **squish** | stdio (`npx squish-memory`) | Local-first persistent memory runtime for AI agents |

### HTTP servers (remote, no local process)

| # | Server Name | URL | Description |
|---|-------------|-----|-------------|
| 1 | **vercel** | `https://mcp.vercel.com` | Vercel deployments and projects |
| 2 | **cloudflare-docs** | `https://docs.mcp.cloudflare.com/mcp` | Cloudflare documentation search |
| 3 | **cloudflare-workers-builds** | `https://builds.mcp.cloudflare.com/mcp` | Cloudflare Workers builds |
| 4 | **cloudflare-workers-bindings** | `https://bindings.mcp.cloudflare.com/mcp` | Cloudflare Workers bindings |
| 5 | **cloudflare-observability** | `https://observability.mcp.cloudflare.com/mcp` | Cloudflare observability/logs |
| 6 | **clickhouse** | `https://mcp.clickhouse.cloud/mcp` | ClickHouse analytics queries |
| 7 | **parallel-search** | `https://search.parallel.ai/mcp` | Parallel Web Search — LLM-optimized |
| 8 | **browser-use** | `https://api.browser-use.com/mcp` | AI browser agent for web tasks |
| 9 | **devfleet** | `http://localhost:18801/mcp` | Multi-agent orchestration |
| 10 | **laraplugins** | `https://laraplugins.io/mcp/plugins` | Laravel plugin discovery |

**Total: 20 stdio servers + 10 HTTP servers = 30 MCP servers**

## ECC's Key Patterns Adopted Here

### 1. Health State Persistence (`.mcp-health-cache.json`)

ECC persists health state to `~/.claude/mcp-health-cache.json` so it survives conversation
compaction. Our Python module mirrors this at `~/.hermes/mcp-health-cache.json` with the same
structure:

```json
{
  "version": 1,
  "servers": {
    "server-name": {
      "status": "healthy" | "unhealthy",
      "checkedAt": <epoch_seconds>,
      "expiresAt": <epoch_seconds>,
      "failureCount": 0,
      "lastError": null,
      "nextRetryAt": <epoch_seconds>
    }
  }
}
```

### 2. Exponential Backoff on Failures

ECC's default backoff base is 30 seconds, capping at 10 minutes:

```
failure 1 → backoff 30s
failure 2 → backoff 60s
failure 3 → backoff 120s
...
max backoff → 600s (10 min)
```

Our `McpServerManager` uses identical defaults (`DEFAULT_BACKOFF_BASE = 30.0`,
`DEFAULT_BACKOFF_MAX = 600.0`).

### 3. Reconnect Command Environment Variable

ECC supports environment variables like `ECC_MCP_RECONNECT_GITHUB` to define reconnect
commands per server. Our `McpServerConfig` supports `env_file` for loading env files and
`_substitute_env_vars()` for `${VAR}` substitution in config values.

### 4. Fail-Open Mode

ECC respects `ECC_MCP_HEALTH_FAIL_OPEN` to allow tool execution even when the server is down.
Our `McpHealthChecker` and `McpDegradedFallback` both have a `fail_open` flag.

### 5. HTTP Reachability Probe

ECC considers status codes `200, 201, 202, 204, 301-308, 400, 401, 403, 405, 406` as healthy
(reachability, not necessarily success). We mirror this in `HEALTHY_HTTP_CODES`. Codes `401,
403, 429, 503` are marked as needing reconnection (`RECONNECT_HTTP_CODES`).

### 6. Failure Pattern Detection

ECC detects specific failure codes from error output:

| Code | Pattern |
|------|---------|
| 401 | `401`, `unauthorized`, `auth (failed|expired|invalid)` |
| 403 | `403`, `forbidden`, `permission denied` |
| 429 | `429`, `rate limit`, `too many requests` |
| 503 | `503`, `service unavailable`, `overloaded` |

Our `HealthCheckResult` enum and `RECONNECT_HTTP_CODES` cover these same patterns.

### 7. Inventory Collection

ECC's `mcp-inventory.js` collects configs from all installed harnesses (Claude Code, Codex,
OpenCode), normalizes to a canonical format, and reports fragmentation. Our `McpServerManager`
implements a similar pattern with `list_servers()`, `get_status_summary()`, and config
reloading via `reload_config()`.

### 8. Environment Variable Substitution

ECC substitutes `${VAR}` placeholders in server configs. Our `McpServerManager` implements
`_substitute_env_vars()` using the same regex pattern (`\$\{([^}]+)\}`).

## Architecture

```
McpServerManager
├── Config Loading (.mcp.json)
│   ├── Reads mcpServers from JSON
│   ├── Creates McpServerConfig objects
│   └── Substitutes ${VAR} env vars
├── Lifecycle Management
│   ├── start_server() — subprocess.Popen
│   ├── stop_server() — SIGTERM → SIGKILL
│   ├── restart_server()
│   └── is_running() — poll() check
├── Health Checking
│   ├── HTTP probe (httpx)
│   ├── stdio probe (kill -0 process PID)
│   ├── Retry with exponential backoff (3 attempts, 30s base, 600s max)
│   └── Persistent health cache
└── Graceful Degradation
    ├── Response caching (TTL-based)
    ├── Circuit breaker (closed → open → half_open)
    ├── Fallback handlers
    └── Fail-open mode
```

## Test Coverage

| Module | Tests | Coverage Area |
|--------|-------|---------------|
| `server_manager` | 26 | Config loading, env substitution, lifecycle, health cache |
| `health_check` | 19 | Cache behavior, HTTP probing, stdio probing, defaults |
| `graceful_degradation` | 29 | Circuit breaker transitions, caching, fallback handlers, fail-open |
| **Total** | **74** | **87 actual test assertions** |

All tests pass with `python3 -m pytest .hermes/mcp/tests/ -v`.

## References

- ECC Repository: https://github.com/affaan-m/ECC
- ECC MCP Servers Config: `/mcp-configs/mcp-servers.json` (20 stdio + 10 HTTP servers)
- ECC Health Check Hook: `/scripts/hooks/mcp-health-check.js`
- ECC MCP Config: `/scripts/lib/mcp-config.js`
- ECC MCP Inventory: `/scripts/mcp-inventory.js`
