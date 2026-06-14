"""
Tests for skill registry (LAT-191).
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from hermes.skills.registry import (
    SkillIndex,
    SkillMetadata,
    SkillTrustRecord,
    load_index,
    save_index,
)


class TestSkillMetadata(unittest.TestCase):
    """Tests for SkillMetadata."""

    def test_create_metadata(self):
        meta = SkillMetadata(
            name="test-skill",
            description="A test skill",
            version="1.0.0",
        )
        self.assertEqual(meta.name, "test-skill")
        self.assertEqual(meta.trust_level, "intern")
        self.assertTrue(meta.is_active)

    def test_to_dict_roundtrip(self):
        meta = SkillMetadata(
            name="roundtrip-test",
            description="Test roundtrip",
            version="2.0.0",
            category="testing",
            trigger_patterns=["test *", "check *"],
        )
        d = meta.to_dict()
        meta2 = SkillMetadata.from_dict(d)
        self.assertEqual(meta2.name, meta.name)
        self.assertEqual(meta2.version, meta.version)
        self.assertEqual(meta2.trigger_patterns, meta.trigger_patterns)

    def test_compute_hash(self):
        meta1 = SkillMetadata(name="same", description="desc", version="1.0.0")
        meta2 = SkillMetadata(name="same", description="desc", version="1.0.0")
        meta3 = SkillMetadata(name="same", description="different", version="1.0.0")
        self.assertEqual(meta1.compute_hash(), meta2.compute_hash())
        self.assertNotEqual(meta1.compute_hash(), meta3.compute_hash())


class TestSkillTrustRecord(unittest.TestCase):
    """Tests for SkillTrustRecord."""

    def test_initial_state(self):
        record = SkillTrustRecord(name="test")
        self.assertEqual(record.trust_level, "intern")
        self.assertEqual(record.total_runs, 0)
        self.assertEqual(record.success_rate, 0.0)

    def test_record_success_run(self):
        record = SkillTrustRecord(name="test")
        record.record_run(success=True, latency_ms=100.0)
        record.record_run(success=True, latency_ms=200.0)
        record.record_run(success=True, latency_ms=150.0)
        self.assertEqual(record.total_runs, 3)
        self.assertEqual(record.successful_runs, 3)
        self.assertEqual(record.failed_runs, 0)
        self.assertEqual(record.success_rate, 1.0)

    def test_record_failure_run(self):
        record = SkillTrustRecord(name="test")
        record.record_run(success=True, latency_ms=100.0)
        record.record_run(success=False, latency_ms=500.0)
        self.assertEqual(record.success_rate, 0.5)

    def test_promotion_on_high_success_rate(self):
        record = SkillTrustRecord(name="test", trust_level="intern")
        for _ in range(100):
            record.record_run(success=True, latency_ms=50.0)
        # intern→junior at 100 runs with 100% success
        self.assertEqual(record.effective_trust_level, "junior")
        # Run another 100 to reach senior
        for _ in range(100):
            record.record_run(success=True, latency_ms=50.0)
        self.assertEqual(record.effective_trust_level, "senior")

    def test_demotion_on_low_success_rate(self):
        record = SkillTrustRecord(name="test", trust_level="senior")
        record.success_rate = 0.50  # Simulate low success
        self.assertEqual(record.effective_trust_level, "intern")

    def test_average_latency_ema(self):
        record = SkillTrustRecord(name="test")
        record.record_run(success=True, latency_ms=100.0)
        record.record_run(success=True, latency_ms=200.0)
        # EMA with alpha=0.1: 0.1*200 + 0.9*100 = 20 + 90 = 110
        self.assertAlmostEqual(record.avg_latency_ms, 110.0, places=1)

    def test_to_dict_roundtrip(self):
        record = SkillTrustRecord(
            name="test",
            trust_level="junior",
            total_runs=10,
            vulnerability_score=0.15,
        )
        d = record.to_dict()
        record2 = SkillTrustRecord(**d)
        self.assertEqual(record2.trust_level, "junior")
        self.assertEqual(record2.total_runs, 10)


class TestSkillIndex(unittest.TestCase):
    """Tests for SkillIndex."""

    def test_create_empty_index(self):
        index = SkillIndex()
        self.assertEqual(len(index.skills), 0)
        self.assertEqual(len(index.trust_records), 0)

    def test_add_skill(self):
        index = SkillIndex()
        meta = SkillMetadata(name="new-skill", description="A skill")
        result = index.add_skill(meta)
        self.assertTrue(result)
        self.assertEqual(len(index.skills), 1)

    def test_add_duplicate_no_change(self):
        index = SkillIndex()
        meta1 = SkillMetadata(name="dup-skill", description="desc", version="1.0.0")
        meta2 = SkillMetadata(name="dup-skill", description="desc", version="1.0.0")
        index.add_skill(meta1)
        result = index.add_skill(meta2)
        self.assertFalse(result)  # No change since hash is same
        self.assertEqual(len(index.skills), 1)

    def test_add_duplicate_different_hash(self):
        index = SkillIndex()
        meta1 = SkillMetadata(name="update-skill", description="old", version="1.0.0")
        meta2 = SkillMetadata(name="update-skill", description="new", version="1.0.0")
        index.add_skill(meta1)
        result = index.add_skill(meta2)
        self.assertTrue(result)
        self.assertEqual(len(index.skills), 1)
        self.assertEqual(index.skills[0].description, "new")

    def test_remove_skill(self):
        index = SkillIndex()
        index.add_skill(SkillMetadata(name="to-remove", description="x"))
        self.assertTrue(index.remove_skill("to-remove"))
        self.assertEqual(len(index.skills), 0)
        self.assertFalse(index.remove_skill("to-remove"))  # Already removed

    def test_get_skill(self):
        index = SkillIndex()
        index.add_skill(SkillMetadata(name="find-me", description="x"))
        skill = index.get_skill("find-me")
        self.assertIsNotNone(skill)
        self.assertEqual(skill.name, "find-me")
        self.assertIsNone(index.get_skill("nonexistent"))

    def test_search_by_name(self):
        index = SkillIndex()
        index.add_skill(SkillMetadata(name="auth-util", description="Auth utilities"))
        index.add_skill(SkillMetadata(name="db-helper", description="Database helper"))
        results = index.search("auth")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].name, "auth-util")

    def test_search_by_description(self):
        index = SkillIndex()
        index.add_skill(SkillMetadata(name="my-skill", description="Security scanner"))
        results = index.search("security")
        self.assertEqual(len(results), 1)

    def test_get_active_skills(self):
        index = SkillIndex()
        index.add_skill(SkillMetadata(name="active-1", description="x"))
        inactive = SkillMetadata(name="inactive-1", description="x", is_active=False)
        index.add_skill(inactive)
        active = index.get_active_skills()
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0].name, "active-1")

    def test_get_compromised_skills(self):
        index = SkillIndex()
        index.trust_records.append(SkillTrustRecord(
            name="clean-skill", vulnerability_score=0.10
        ))
        index.trust_records.append(SkillTrustRecord(
            name="risky-skill", vulnerability_score=0.30
        ))
        compromised = index.get_compromised_skills(threshold=0.261)
        self.assertEqual(len(compromised), 1)
        self.assertEqual(compromised[0], "risky-skill")

    def test_to_dict_roundtrip(self):
        index = SkillIndex()
        index.add_skill(SkillMetadata(name="test", description="desc"))
        index.trust_records.append(SkillTrustRecord(name="test"))
        d = index.to_dict()
        index2 = SkillIndex.from_dict(d)
        self.assertEqual(len(index2.skills), 1)
        self.assertEqual(len(index2.trust_records), 1)
        self.assertEqual(index2.skills[0].name, "test")


class TestIndexPersistence(unittest.TestCase):
    """Tests for save/load index to/from disk."""

    def test_save_and_load(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = Path(f.name)

        try:
            index = SkillIndex()
            index.add_skill(SkillMetadata(name="persist-test", description="x"))

            save_index(index, path)
            loaded = load_index(path)

            self.assertEqual(len(loaded.skills), 1)
            self.assertEqual(loaded.skills[0].name, "persist-test")
        finally:
            path.unlink(missing_ok=True)

    def test_load_nonexistent(self):
        result = load_index(Path("/nonexistent/path/index.json"))
        self.assertEqual(len(result.skills), 0)

    def test_load_invalid_json(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write("{invalid json content")
            f.flush()
            path = Path(f.name)

        try:
            result = load_index(path)
            self.assertEqual(len(result.skills), 0)  # Should return empty index
        finally:
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
