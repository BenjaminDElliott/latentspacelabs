"""CI/CD integration hooks package."""

from benchmark_platform.ci_cd.hooks import CICDHooks
from benchmark_platform.ci_cd.webhook import WebhookHandler

__all__ = ["CICDHooks", "WebhookHandler"]
