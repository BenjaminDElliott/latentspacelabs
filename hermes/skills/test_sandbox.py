"""
Tests for skill sandboxing (LAT-191).
"""

from __future__ import annotations

import unittest

from hermes.skills.sandbox import (
    SkillEntry,
    TrustLevel,
    apply_trust_sandbox,
    calculate_vulnerability_rate,
    demote_trust_level,
    promote_trust_level,
    scan_vulnerabilities,
    validate_sandbox_config,
)
from hermes.skills.config import SkillSandboxConfig


class TestTrustLevelPromotion(unittest.TestCase):
    """Tests for trust level promotion/demotion."""

    def test_promote_from_intern(self):
        result = promote_trust_level(TrustLevel.INTERN)
        self.assertEqual(result, TrustLevel.JUNIOR)

    def test_promote_from_junior(self):
        result = promote_trust_level(TrustLevel.JUNIOR)
        self.assertEqual(result, TrustLevel.SENIOR)

    def test_promote_from_senior(self):
        result = promote_trust_level(TrustLevel.SENIOR)
        self.assertEqual(result, TrustLevel.PRINCIPAL)

    def test_promote_from_principal_no_change(self):
        result = promote_trust_level(TrustLevel.PRINCIPAL)
        self.assertEqual(result, TrustLevel.PRINCIPAL)

    def test_demote_from_principal(self):
        result = demote_trust_level(TrustLevel.PRINCIPAL)
        self.assertEqual(result, TrustLevel.SENIOR)

    def test_demote_from_senior(self):
        result = demote_trust_level(TrustLevel.SENIOR)
        self.assertEqual(result, TrustLevel.JUNIOR)

    def test_demote_from_junior(self):
        result = demote_trust_level(TrustLevel.JUNIOR)
        self.assertEqual(result, TrustLevel.INTERN)

    def test_demote_from_intern_no_change(self):
        result = demote_trust_level(TrustLevel.INTERN)
        self.assertEqual(result, TrustLevel.INTERN)


class TestVulnerabilityScanning(unittest.TestCase):
    """Tests for vulnerability pattern scanning."""

    def test_no_vulnerabilities(self):
        content = """---
name: clean-skill
description: No risky patterns
---

# Clean Skill

Just a simple description.
"""
        findings = scan_vulnerabilities(content)
        self.assertEqual(len(findings), 0)
        self.assertEqual(calculate_vulnerability_rate(findings), 0.0)

    def test_subprocess_shell(self):
        content = """
import subprocess
subprocess.call("ls -la", shell=True)
"""
        findings = scan_vulnerabilities(content)
        self.assertTrue(any(f["pattern"] == "subprocess_shell" for f in findings))

    def test_os_system(self):
        content = """
import os
os.system("echo hello")
"""
        findings = scan_vulnerabilities(content)
        self.assertTrue(any(f["pattern"] == "os_system" for f in findings))

    def test_eval_usage(self):
        content = """
result = eval(user_input)
"""
        findings = scan_vulnerabilities(content)
        self.assertTrue(any(f["pattern"] == "eval_usage" for f in findings))

    def test_multiple_vulnerabilities(self):
        content = """
import os, subprocess
os.system("cmd")
subprocess.call("ls", shell=True)
x = eval(data)
"""
        findings = scan_vulnerabilities(content)
        self.assertGreater(len(findings), 2)

    def test_vulnerability_rate_calculation(self):
        # Empty = 0
        self.assertEqual(calculate_vulnerability_rate([]), 0.0)

        # Single low severity
        findings = [{"severity": "low"}]
        rate = calculate_vulnerability_rate(findings)
        self.assertGreater(rate, 0.0)
        self.assertLessEqual(rate, 1.0)

    def test_vulnerability_rate_under_target(self):
        # Empty = 0 rate
        findings = []
        rate = calculate_vulnerability_rate(findings)
        self.assertEqual(rate, 0.0)
        self.assertLess(rate, 0.20)  # Under 20% target


class TestApplyTrustSandbox(unittest.TestCase):
    """Tests for trust-based sandbox application."""

    def test_intern_sandbox(self):
        skill = SkillEntry(name="test", trust_level="intern")
        config = apply_trust_sandbox(skill)
        self.assertEqual(config.trust_level, TrustLevel.INTERN)
        self.assertEqual(config.max_memory_mb, 128)
        self.assertFalse(config.network_access)

    def test_junior_sandbox(self):
        skill = SkillEntry(name="test", trust_level="junior")
        config = apply_trust_sandbox(skill)
        self.assertEqual(config.trust_level, TrustLevel.JUNIOR)
        self.assertEqual(config.max_memory_mb, 256)
        self.assertTrue(config.network_access)

    def test_senior_sandbox(self):
        skill = SkillEntry(name="test", trust_level="senior")
        config = apply_trust_sandbox(skill)
        self.assertEqual(config.trust_level, TrustLevel.SENIOR)
        self.assertEqual(config.timeout_seconds, 60)

    def test_principal_sandbox(self):
        skill = SkillEntry(name="test", trust_level="principal")
        config = apply_trust_sandbox(skill)
        self.assertEqual(config.trust_level, TrustLevel.PRINCIPAL)
        self.assertEqual(config.max_memory_mb, 1024)

    def test_explicit_config_override(self):
        skill = SkillEntry(name="test", trust_level="intern")
        custom = SkillSandboxConfig(trust_level=TrustLevel.SENIOR)
        config = apply_trust_sandbox(skill, custom)
        self.assertEqual(config.trust_level, TrustLevel.SENIOR)


class TestValidateSandboxConfig(unittest.TestCase):
    """Tests for sandbox config validation."""

    def test_valid_config(self):
        config = SkillSandboxConfig(
            trust_level=TrustLevel.INTERN,
            max_memory_mb=256,
            timeout_seconds=30,
        )
        errors = validate_sandbox_config(config)
        self.assertEqual(errors, [])

    def test_invalid_trust_level(self):
        config = SkillSandboxConfig(trust_level="invalid")
        errors = validate_sandbox_config(config)
        self.assertTrue(any("trust level" in e for e in errors))

    def test_memory_too_small(self):
        config = SkillSandboxConfig(max_memory_mb=0)
        errors = validate_sandbox_config(config)
        self.assertTrue(any("max_memory_mb" in e for e in errors))

    def test_memory_too_large(self):
        config = SkillSandboxConfig(max_memory_mb=5000)
        errors = validate_sandbox_config(config)
        self.assertTrue(any("max_memory_mb" in e for e in errors))

    def test_timeout_zero(self):
        config = SkillSandboxConfig(timeout_seconds=0)
        errors = validate_sandbox_config(config)
        self.assertTrue(any("timeout" in e for e in errors))


class TestRunSkillScript(unittest.TestCase):
    """Tests for skill script execution."""

    def test_unsupported_script_type(self):
        from hermes.skills.sandbox import run_skill_script
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".xyz", delete=False) as f:
            f.write(b"test content")
            path = f.name

        result = run_skill_script(type("P", (), {"suffix": ".xyz", "__str__": lambda s: path})())
        self.assertEqual(result["status"], "error")

        import os
        os.unlink(path)

    def test_timeout_handling(self):
        from hermes.skills.sandbox import run_skill_script, SkillSandboxConfig
        import tempfile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".sh", delete=False) as f:
            f.write("#!/bin/bash\nsleep 100\n")
            f.flush()
            path = f.name

        config = SkillSandboxConfig(timeout_seconds=1)
        result = run_skill_script(type("P", (), {"suffix": ".sh", "__str__": lambda s: path})(), config)
        self.assertEqual(result["status"], "timeout")

        import os
        os.unlink(path)


if __name__ == "__main__":
    unittest.main()
