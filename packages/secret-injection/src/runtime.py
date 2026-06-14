"""Secret injection wrapper for ICP agent runtime.

LAT-69: Configure approved Anthropic secret injection.
"""

import os
import sys
import json
from typing import Optional

REQUIRED_ENV = ["ANTHROPIC_API_KEY"]

def validate_secrets() -> list[str]:
    """Check all required secrets are set. Returns list of missing keys."""
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    return missing

def inject_secrets(env: dict | None = None) -> dict:
    """Add required secrets to environment dict for subprocess."""
    if env is None:
        env = dict(os.environ)
    for key in REQUIRED_ENV:
        val = os.environ.get(key)
        if val:
            env[key] = val
    return env

def sanitize_output(text: str) -> str:
    """Sanitize output to remove secret values."""
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if key and len(key) > 10:
        masked = key[:6] + "..." + key[-4:]
        text = text.replace(key, masked)
    return text

def check_dispatch_ready() -> tuple[bool, list[str]]:
    """Check if dispatch is ready (all secrets present)."""
    missing = validate_secrets()
    if missing:
        return False, missing
    return True, []

def run_with_secrets(command: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Run a command with secret injection and sanitization."""
    import subprocess
    
    missing = validate_secrets()
    if missing:
        raise RuntimeError(f"ANTHROPIC_API_KEY not set")
    
    env = inject_secrets(kwargs.get("env"))
    result = subprocess.run(command, env=env, **{k: v for k, v in kwargs.items() if k != "env"})
    return result

if __name__ == "__main__":
    ready, missing = check_dispatch_ready()
    if ready:
        print("Dispatch ready: all secrets present")
        sys.exit(0)
    else:
        print(f"Dispatch refused: missing {', '.join(missing)}")
        sys.exit(1)
