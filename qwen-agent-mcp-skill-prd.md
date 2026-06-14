# PRD: MCP Tool Discovery Skill (Port of Qwen-Agent Pattern)

**Title:** MCP Tool Discovery and Registration via Qwen-Agent MCPManager Pattern  
**Status:** Proposed  
**Date:** 2026-06-14  
**Related:** LAT-258 (Qwen-Agent Framework Experiment)

---

## Problem

Hermes currently registers MCP tools manually. Adding a new MCP server requires:
1. Writing a skill class for each tool
2. Registering the skill
3. Updating schemas when tools change

## Solution

Port Qwen-Agent's `MCPManager` pattern:
1. Read MCP config (JSON)
2. Auto-discover tools from each server
3. Generate skill classes dynamically at runtime

## Architecture

```
MCPToolDiscovery (Skill)
├── MCPConfigLoader → Read/validate config
├── MCPManager → Singleton event loop + connections
└── ToolRegistrar → Register generated tools as skills
```

## Config Format

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    },
    "github": {
      "url": "http://localhost:3000/mcp",
      "type": "sse",
      "headers": {"Authorization": "Bearer $TOKEN"}
    }
  }
}
```

## Requirements
- Support stdio, SSE, streamable-HTTP
- Auto-reconnect on dead sessions
- Tool names: `<server>-<tool_name>`
- Process cleanup on shutdown
- Thread-safe tool invocation

## Success Metrics
1. MCP tool added in < 1 minute (config only)
2. 100% tool discovery coverage
3. >95% auto-reconnect success rate

## Timeline
- Week 1: Config loader + stdio
- Week 2: SSE/HTTP + auto-reconnect  
- Week 3: Tool registration + integration
- Week 4: Cleanup + docs
