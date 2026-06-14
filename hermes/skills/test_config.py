"""
Tests for skill configuration (LAT-191).
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from hermes.skills.config import (
    DEFAULT_REPOS,
    DEFAULT_TRUST_LEVEL,
    ExternalSkillRepo,
    SkillSandboxConfig,
    TrustLevel,
    load_config,
    TRUST_LEVELS,
)


class TestTrustLevels(unittest.TestCase):
    """Tests for trust level definitions."""

    def test_all_trust_levels_defined(self):
        self.assertIn(TrustLevel.INTERN, TRUST_LEVELS)
        self.assertIn(TrustLevel.JUNIOR, TRUST_LEVELS)
        self.assertIn(TrustLevel.SENIOR, TRUST_LEVELS)
        self.assertIn(TrustLevel.PRINCIPAL, TRUST_LEVELS)

    def test_extern_trust_order(self):
        order = [TrustLevel.INTERN, TrustLevel.JUNIOR, TrustLevel.SENIOR, TrustLevel.PRINCIPAL]
        self.assertEqual(list(TRUST_LEVELS.keys()), order)

    def test_intern_permissions(self):
        config = TRUST_LEVELS[TrustLevel.INTERN]
        self.assertEqual(config["permissions"], ["read_only"])
        self.assertEqual(config["sandbox"], "full_isolation")
        self.assertFalse(config["code_execution"])
        self.assertFalse(config["file_system"])

    def test_principal_permissions(self):
        config = TRUST_LEVELS[TrustLevel.PRINCIPAL]
        self.assertIn("filesystem", config["permissions"])
        self.assertTrue(config["code_execution"])
        self.assertTrue(config["file_system"])


class TestExternalSkillRepo(unittest.TestCase):
    """Tests for external repository configuration."""

    def test_create_repo(self):
        repo = ExternalSkillRepo(owner="test", repo="skills-repo")
        self.assertEqual(repo.owner, "test")
        self.assertEqual(repo.repo, "skills-repo")
        self.assertEqual(repo.branch, "main")
        self.assertEqual(repo.skills_path, "skills")

    def test_api_base_url(self):
        repo = ExternalSkillRepo(owner="myorg", repo="myrepo")
        self.assertEqual(repo.api_base_url, "https://api.github.com/repos/myorg/myrepo")

    def test_raw_base_url(self):
        repo = ExternalSkillRepo(owner="myorg", repo="myrepo", branch="dev")
        self.assertEqual(
            repo.raw_base_url,
            "https://raw.githubusercontent.com/myorg/myrepo/dev",
        )

    def test_repo_url(self):
        repo = ExternalSkillRepo(owner="myorg", repo="myrepo")
        self.assertEqual(repo.repo_url, "https://github.com/myorg/myrepo")

    def test_custom_branch(self):
        repo = ExternalSkillRepo(owner="org", repo="repo", branch="develop")
        self.assertEqual(repo.branch, "develop")


class TestSkillSandboxConfig(unittest.TestCase):
    """Tests for sandbox configuration."""

    def test_default_config(self):
        config = SkillSandboxConfig()
        self.assertEqual(config.trust_level, TrustLevel.INTERN)
        self.assertEqual(config.max_memory_mb, 256)
        self.assertEqual(config.timeout_seconds, 30)

    def test_custom_config(self):
        config = SkillSandboxConfig(
            trust_level=TrustLevel.SENIOR,
            max_memory_mb=512,
            timeout_seconds=60,
            network_access=True,
        )
        self.assertEqual(config.trust_level, TrustLevel.SENIOR)
        self.assertEqual(config.max_memory_mb, 512)
        self.assertEqual(config.timeout_seconds, 60)
        self.assertTrue(config.network_access)

    def test_to_dict_roundtrip(self):
        config = SkillSandboxConfig(
            trust_level=TrustLevel.JUNIOR,
            max_memory_mb=256,
            timeout_seconds=45,
            network_access=True,
            env_whitelist=["PATH", "HOME"],
        )
        d = config.to_dict()
        restored = SkillSandboxConfig.from_dict(d)
        self.assertEqual(restored.trust_level, config.trust_level)
        self.assertEqual(restored.max_memory_mb, config.max_memory_mb)
        self.assertEqual(restored.timeout_seconds, config.timeout_seconds)
        self.assertEqual(restored.network_access, config.network_access)
        self.assertEqual(restored.env_whitelist, config.env_whitelist)


class TestLoadConfig(unittest.TestCase):
    """Tests for configuration loading."""

    def test_default_config(self):
        config = load_config()
        self.assertIn("repos", config)
        self.assertIn("trust_levels", config)
        self.assertIn("validation", config)
        self.assertIn("sandbox", config)
        self.assertIn("registry", config)

    def test_default_repos(self):
        self.assertGreater(len(DEFAULT_REPOS), 0)

    def test_default_trust_level(self):
        self.assertEqual(DEFAULT_TRUST_LEVEL, TrustLevel.INTERN)

    def test_config_from_file(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({
                "validation": {
                    "max_skill_size_bytes": 2048,
                },
                "sandbox": {
                    "default_trust_level": "junior",
                },
            }, f)
            f.flush()
            path = Path(f.name)

        try:
            config = load_config(path)
            self.assertEqual(config["validation"]["max_skill_size_bytes"], 2048)
            self.assertEqual(config["sandbox"]["default_trust_level"], "junior")
        finally:
            path.unlink(missing_ok=True)

    def test_config_from_file_invalid_json(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write("{invalid json")
            f.flush()
            path = Path(f.name)

        try:
            config = load_config(path)
            # Should fall back to defaults
            self.assertIn("repos", config)
        finally:
            path.unlink(missing_ok=True)


class TestDefaultRepos(unittest.TestCase):
    """Tests for default repository configuration."""

    def test_ecc_in_defaults(self):
        repo_names = [(r.owner, r.repo) for r in DEFAULT_REPOS]
        self.assertIn(("affaan-m", "ECC"), repo_names)

    def test_all_repos_have_defaults(self):
        for repo in DEFAULT_REPOS:
            self.assertEqual(repo.branch, "main")
            self.assertEqual(repo.skills_path, "skills")
            self.assertEqual(repo.trust_level, "intern")
            self.assertEqual(repo.rate_limit_per_min, 30)


if __name__ == "__main__":
    unittest.main()
