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

from .run_request import (
    AgentType,
    AutonomyLevel,
    RunRequest,
    RunRequestValidationError,
    create_run_request,
    validate_run_request,
    validate_ticket_id,
    validate_repo,
    validate_agent_type,
    validate_autonomy_level,
    validate_priority,
    validate_timeout,
    validate_environment,
    validate_custom_config,
    _DEFAULTS,
    _REQUIRED_FIELDS,
    _OPTIONAL_FIELDS,
)

# RunRequestModel only available when pydantic is installed.
try:
    from .run_request import RunRequestModel
    _RUN_REQUEST_MODEL_AVAILABLE = True
except ImportError:
    RunRequestModel = None  # type: ignore[misc, assignment]
    _RUN_REQUEST_MODEL_AVAILABLE = False

__all__ = [
    "TaskState",
    "TaskStatus",
    "TaskStateModel",
    "StepEntry",
    "create_task_state",
    "state_to_json",
    "state_from_json",
    # LAT-171: RunRequest
    "AgentType",
    "AutonomyLevel",
    "RunRequest",
    "RunRequestValidationError",
    "create_run_request",
    "validate_run_request",
    "validate_ticket_id",
    "validate_repo",
    "validate_agent_type",
    "validate_autonomy_level",
    "validate_priority",
    "validate_timeout",
    "validate_environment",
    "validate_custom_config",
    "_DEFAULTS",
    "_REQUIRED_FIELDS",
    "_OPTIONAL_FIELDS",
]

if _RUN_REQUEST_MODEL_AVAILABLE:
    __all__.append("RunRequestModel")
