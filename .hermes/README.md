# Hermes Hook Event System

Pure Python hook event system for Hermes Agent. No Node.js dependency.

## Features

- **Event types**: PreToolUse, PostToolUse, SessionStart, SessionEnd
- **Hook registry**: YAML config → Python handlers
- **Performance**: <100ms per event (verified by tests)
- **Error handling**: Configurable (log, raise, skip modes)

## Quick Start

```python
from hermes_hooks import HookRegistry, HookEngine, SessionStart

# Register a handler
registry = HookRegistry()
registry.register(SessionStart.event_type, lambda event: print(f"Session {event.session_id}"))

# Fire an event
engine = HookEngine(registry)
result = engine.fire(SessionStart(session_id="abc-123"))
print(result)
```

## YAML Configuration

```yaml
hooks:
  PreToolUse:
    - handler: hermes_hooks.handlers.create_logging_handler
  PostToolUse:
    - handler: hermes_hooks.handlers.create_logging_handler
  SessionStart:
    - handler: hermes_hooks.handlers.create_logging_handler
  SessionEnd:
    - handler: hermes_hooks.handlers.create_logging_handler
```

## Loading from YAML

```python
from hermes_hooks import HookRegistry, HookEngine

registry = HookRegistry.from_yaml("hooks.yaml")
engine = HookEngine(registry)
```

## Architecture

```
hermes_hooks/
├── events.py       # Event types (PreToolUse, PostToolUse, SessionStart, SessionEnd)
├── registry.py     # Hook registry: YAML config → Python handlers
├── engine.py       # Hook execution engine with timing
├── handlers/
│   ├── base.py     # BaseHookHandler abstract class
│   ├── logging_handler.py
│   └── timing_handler.py
```

## Tests

```bash
pytest tests/ -v
```
