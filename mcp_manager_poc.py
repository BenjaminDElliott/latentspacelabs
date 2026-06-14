"""Proof of Concept: Hermes MCP Tool Discovery (port of Qwen-Agent MCPManager).

This demonstrates the core pattern: read MCP config → discover tools → generate
callable skill objects at runtime.

Run: python mcp_manager_poc.py
"""

import asyncio
import atexit
import json
import threading
import uuid
from typing import Any, Dict, List, Optional, Union


# --- Simulated MCP Client (no actual server required) ---
class SimulatedMCPTool:
    """Simulated MCP tool for POC purposes."""
    def __init__(self, name: str, description: str, input_schema: dict):
        self.name = name
        self.description = description
        self.inputSchema = input_schema


class SimulatedMCPClient:
    """Simulates connecting to an MCP server and listing tools."""

    def __init__(self, server_name: str, config: dict):
        self.server_name = server_name
        self.config = config
        self.client_id = f"{server_name}_{uuid.uuid4().hex[:8]}"
        self.tools: list = []
        self.resources = False

    def discover_tools(self) -> list:
        """Simulate tool discovery based on server name."""
        # In production, this would be: await session.list_tools()
        simulated_tools = self._get_simulated_tools()
        self.tools = simulated_tools
        return simulated_tools

    def _get_simulated_tools(self) -> list:
        """Return simulated tools based on server type."""
        if self.server_name == "filesystem":
            return [
                SimulatedMCPTool(
                    "read_file",
                    "Read the contents of a file at the given path.",
                    {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "The path to the file to read"
                            }
                        },
                        "required": ["path"]
                    }
                ),
                SimulatedMCPTool(
                    "write_file",
                    "Write content to a file at the given path.",
                    {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "The path to the file"
                            },
                            "content": {
                                "type": "string",
                                "description": "The content to write"
                            }
                        },
                        "required": ["path", "content"]
                    }
                ),
            ]
        elif self.server_name == "sqlite":
            return [
                SimulatedMCPTool(
                    "read_query",
                    "Execute a SELECT query on the SQLite database.",
                    {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "SELECT SQL query to execute"
                            }
                        },
                        "required": ["query"]
                    }
                ),
                SimulatedMCPTool(
                    "write_query",
                    "Execute an INSERT/UPDATE/DELETE query on the SQLite database.",
                    {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "SQL query to execute"
                            }
                        },
                        "required": ["query"]
                    }
                ),
            ]
        else:
            return [
                SimulatedMCPTool(
                    f"tool_{self.server_name}",
                    f"Tool from {self.server_name} server.",
                    {"type": "object", "properties": {}, "required": []}
                )
            ]


# --- POC MCPManager (port of Qwen-Agent's MCPManager) ---
class MCPManager:
    """Port of Qwen-Agent's MCPManager for Hermes.

    Pattern:
    1. Read MCP config JSON
    2. For each server: connect, discover tools
    3. Generate BaseTool subclasses dynamically
    4. Register tools with Hermes skill system

    This is a simplified POC — production version would use
    the real `mcp` Python package for actual server connections.
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if not hasattr(self, 'clients'):
            self.clients: Dict[str, SimulatedMCPClient] = {}
            self.event_loop = asyncio.new_event_loop()
            self.loop_thread = threading.Thread(target=self._start_loop, daemon=True)
            self.loop_thread.start()
            atexit.register(self.shutdown)

    def _start_loop(self):
        asyncio.set_event_loop(self.event_loop)
        self.event_loop.run_forever()

    def load_config(self, config_path: str) -> dict:
        """Load and validate MCP config from file."""
        with open(config_path) as f:
            config = json.load(f)
        self._validate_config(config)
        return config

    def _validate_config(self, config: dict):
        """Validate MCP server config structure."""
        if not isinstance(config, dict) or 'mcpServers' not in config:
            raise ValueError("Config must have 'mcpServers' key")
        for name, server in config['mcpServers'].items():
            if not isinstance(server, dict):
                raise ValueError(f"Server '{name}' must be a dict")
            if 'command' in server:
                if not isinstance(server['command'], str):
                    raise ValueError(f"Server '{name}' command must be a string")
                if 'args' not in server or not isinstance(server['args'], list):
                    raise ValueError(f"Server '{name}' args must be a list")

    def discover_all_tools(self, config: dict) -> list:
        """Connect to all configured MCP servers and discover tools."""
        all_tools = []
        servers = config['mcpServers']

        print(f"\n{'='*60}")
        print("MCP Tool Discovery (Hermes POC)")
        print(f"{'='*60}\n")

        for server_name in servers:
            server_config = servers[server_name]
            print(f"[*] Connecting to MCP server: {server_name}")

            client = SimulatedMCPClient(server_name, server_config)
            tools = client.discover_tools()

            # Store client
            client_id = f"{server_name}_{uuid.uuid4().hex[:8]}"
            client.client_id = client_id
            self.clients[client_id] = client

            # Generate Hermes skill objects
            for tool in tools:
                params = tool.inputSchema
                if 'required' not in params:
                    params['required'] = []

                register_name = f"{server_name}-{tool.name}"

                # Generate a callable skill instance
                skill = self._create_skill_class(
                    register_name=register_name,
                    client_id=client_id,
                    tool_name=tool.name,
                    description=tool.description,
                    parameters=params
                )
                all_tools.append(skill)
                print(f"    ✓ Discovered: {register_name}")
                print(f"      Description: {tool.description}")
                print(f"      Schema: {json.dumps(params, indent=6)}\n")

        print(f"[+] Total tools discovered: {len(all_tools)}\n")
        return all_tools

    def _create_skill_class(self, register_name, client_id, tool_name, description, parameters):
        """Port of Qwen-Agent's create_tool_class().

        Generates a callable class with Hermes-style skill interface.
        """
        class HermesMCPSkill:
            def __init__(self):
                self.name = register_name
                self.description = description
                self.parameters = parameters
                self.client_id = client_id
                self._function_schema = {
                    'name': self.name,
                    'description': self.description,
                    'parameters': self.parameters,
                }

            def call(self, params: Union[str, dict], **kwargs) -> str:
                """Execute the MCP tool call."""
                if isinstance(params, str):
                    params = json.loads(params)
                return f"[MCP-{self.name}] Called with: {json.dumps(params)}"

            @property
            def function(self) -> dict:
                """OpenAI-compatible function schema."""
                return self._function_schema

        return HermesMCPSkill()

    def shutdown(self):
        """Cleanup all MCP connections."""
        for client_id in list(self.clients.keys()):
            del self.clients[client_id]
        self.event_loop.call_soon_threadsafe(self.event_loop.stop)
        self.loop_thread.join(timeout=5)


# --- Demo ---
def demo():
    """Demonstrate the POC with simulated MCP servers."""

    # Sample config (matches Qwen-Agent format)
    config = {
        "mcpServers": {
            "filesystem": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
            },
            "sqlite": {
                "command": "uvx",
                "args": ["mcp-server-sqlite", "--db-path", "/tmp/test.db"]
            },
        }
    }

    manager = MCPManager()
    tools = manager.discover_all_tools(config)

    # Test calling a discovered tool
    print("\n--- Testing Discovered Tools ---\n")
    for tool in tools:
        test_params = {"path": "/tmp/test.txt"}
        result = tool.call(json.dumps(test_params))
        print(f"[{tool.name}] → {result}")
        print(f"  function() → {json.dumps(tool.function, indent=2)}\n")

    print("[+] POC complete. Pattern ready for production integration.\n")


if __name__ == '__main__':
    demo()
