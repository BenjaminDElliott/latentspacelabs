"""State management for agentic loops.

Exported for convenience so callers can ``from .hermes.state import TaskState``.
"""

from .task_state import (
    TaskState,
    TaskStatus,
    TaskStateModel,
    StepEntry,
    create_task_state,
    state_to_json,
    state_from_json,
)

__all__ = [
    "TaskState",
    "TaskStatus",
    "TaskStateModel",
    "StepEntry",
    "create_task_state",
    "state_to_json",
    "state_from_json",
]
