"""
GitHub skill fetching for the skill acquisition pipeline (LAT-191).

Fetches SKILL.md files from configurable GitHub repositories,
handles rate limiting, and supports both directory listings and
direct file fetches.
"""

from __future__ import annotations

import base64
import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from hermes.skills.config import ExternalSkillRepo, load_config
from hermes.skills.validator import (
    SkillValidator,
    parse_frontmatter,
    validate_skill_file,
)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class SkillFile:
    """A single file entry returned from the GitHub API."""

    name: str
    path: str
    sha: str
    size: int
    download_url: str


@dataclass
class SkillEntry:
    """A skill after fetching its SKILL.md content."""

    name: str
    description: str = ""
    version: str = "1.0.0"
    category: str = ""
    origin: str = ""
    raw_content: str = ""
    git_sha: str = ""
    repo_owner: str = ""
    repo_name: str = ""
    branch: str = ""
    validation_errors: list[str] = field(default_factory=list)
    validation_warnings: list[str] = field(default_factory=list)


@dataclass
class FetchResult:
    """Result of fetching skills from a repository."""

    repo: str  # "owner/repo"
    skills_fetched: int = 0
    skills_valid: int = 0
    skills_invalid: int = 0
    skills: list[SkillEntry] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# GitHub API client
# ---------------------------------------------------------------------------


class GitHubSkillFetcher:
    """Fetches skills from GitHub repositories.

    Handles API rate limiting, authentication, and content decoding.
    """

    def __init__(self, token: str | None = None):
        """Initialize the fetcher.

        Args:
            token: GitHub personal access token (optional, for higher rate limits).
        """
        self.token = token or os.environ.get("GITHUB_TOKEN", "")
        self._rate_limit_remaining: int | None = None
        self._rate_limit_reset: float = 0.0
        self._request_count: int = 0

    def _get_headers(self) -> dict[str, str]:
        """Build request headers."""
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "HermesSkillAcquisition/1.0 (LAT-191)",
        }
        if self.token:
            headers["Authorization"] = f"token {self.token}"
        return headers

    def _api_request(self, url: str) -> Any:
        """Make a GET request to the GitHub API and return parsed JSON.

        Args:
            url: API endpoint URL.

        Returns:
            Parsed JSON response.
        """
        self._request_count += 1

        # Respect rate limit resets
        if (
            self._rate_limit_remaining is not None
            and self._rate_limit_remaining <= 5
            and time.time() < self._rate_limit_reset
        ):
            wait_seconds = max(1, int(self._rate_limit_reset - time.time()))
            print(f"  Rate limit approaching. Waiting {wait_seconds}s...")
            time.sleep(wait_seconds)

        req = urllib.request.Request(url, headers=self._get_headers())
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read().decode("utf-8")

                # Parse rate limit headers
                rate_remaining = resp.headers.get("X-RateLimit-Remaining")
                rate_reset = resp.headers.get("X-RateLimit-Reset")
                if rate_remaining:
                    self._rate_limit_remaining = int(rate_remaining)
                if rate_reset:
                    self._rate_limit_reset = float(rate_reset)

                return json.loads(data)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")

            # Handle rate limiting
            if exc.code == 403 and "rate limit" in body.lower():
                reset_time = exc.headers.get("X-RateLimit-Reset", "0")
                wait = max(1, int(float(reset_time) - time.time()))
                print(f"  Rate limit hit. Reset at {reset_time}. Waiting {wait}s...")
                time.sleep(wait)
                return self._api_request(url)

            if exc.code == 404:
                return None  # Not found is normal for non-existent files

            raise
        except urllib.error.URLError as exc:
            raise ConnectionError(f"GitHub API connection failed: {exc}") from exc

    def list_skill_directories(self, repo: ExternalSkillRepo) -> list[SkillFile]:
        """List skill directories in a GitHub repository.

        Args:
            repo: Repository configuration.

        Returns:
            List of SkillFile entries for directories.
        """
        url = f"{repo.api_base_url}/contents/{repo.skills_path}"
        result = self._api_request(url)

        if result is None:
            return []
        if not isinstance(result, list):
            return []

        skills: list[SkillFile] = []
        for entry in result:
            if entry.get("type") == "dir":
                skills.append(
                    SkillFile(
                        name=entry["name"],
                        path=entry["path"],
                        sha=entry["sha"],
                        size=entry.get("size", 0),
                        download_url=entry.get("download_url", ""),
                    )
                )
        return skills

    def fetch_skill_content(self, repo: ExternalSkillRepo, skill_name: str) -> SkillEntry | None:
        """Fetch SKILL.md content for a specific skill.

        Args:
            repo: Repository configuration.
            skill_name: Name of the skill directory.

        Returns:
            SkillEntry with content, or None if not found.
        """
        raw_url = f"{repo.raw_base_url}/{repo.skills_path}/{skill_name}/SKILL.md"
        api_url = f"{repo.api_base_url}/contents/{repo.skills_path}/{skill_name}/SKILL.md"

        # Try API first (gives us SHA)
        data = self._api_request(api_url)
        if data is None or not isinstance(data, dict):
            return None

        raw_b64 = data.get("content", "")
        raw_bytes = base64.b64decode(raw_b64) if raw_b64 else b""
        raw_text = raw_bytes.decode("utf-8", errors="replace")

        # Parse frontmatter for metadata
        fields, _body = parse_frontmatter(raw_text)

        return SkillEntry(
            name=fields.get("name", skill_name),
            description=fields.get("description", ""),
            version=fields.get("version", "1.0.0"),
            category=fields.get("category", repo.repo),
            origin=f"{repo.owner}/{repo.repo}",
            raw_content=raw_text,
            git_sha=data.get("sha", ""),
            repo_owner=repo.owner,
            repo_name=repo.repo,
            branch=repo.branch,
        )

    def fetch_all_skills(self, repo: ExternalSkillRepo, curated_names: list[str] | None = None) -> FetchResult:
        """Fetch all skills from a repository.

        Args:
            repo: Repository configuration.
            curated_names: Optional subset of skills to fetch.

        Returns:
            FetchResult with all fetched skills and any errors.
        """
        result = FetchResult(repo=f"{repo.owner}/{repo.repo}")

        try:
            skill_dirs = self.list_skill_directories(repo)
        except Exception as exc:
            result.errors.append(f"Failed to list skill directories: {exc}")
            return result

        result.warnings.append(f"Found {len(skill_dirs)} potential skill directories")

        # Filter to curated subset if specified
        if curated_names:
            available_names = {s.name for s in skill_dirs}
            missing = [s for s in curated_names if s not in available_names]
            if missing:
                result.warnings.extend(
                    [f"Skill not found in repo: {s}" for s in missing]
                )
            target_names = [s for s in curated_names if s in available_names]
            target_dirs = [d for d in skill_dirs if d.name in target_names]
        else:
            target_dirs = skill_dirs

        # Fetch each skill
        for skill_dir in target_dirs:
            try:
                # Small delay between requests to avoid rate limiting
                if self._request_count > 0 and self._request_count % 10 == 0:
                    time.sleep(0.5)

                entry = self.fetch_skill_content(repo, skill_dir.name)
                if entry is None:
                    result.errors.append(f"Failed to fetch SKILL.md for {skill_dir.name}")
                    result.skills_invalid += 1
                    continue

                # Validate the skill content
                validator = SkillValidator()
                vr = validator.validate_full(entry.raw_content)

                entry.validation_errors = [e.message for e in vr.errors]
                entry.validation_warnings = [w.message for w in vr.warnings]

                if vr.valid:
                    result.skills.append(entry)
                    result.skills_valid += 1
                else:
                    result.skills.append(entry)
                    result.skills_invalid += 1

            except Exception as exc:
                result.errors.append(f"{skill_dir.name}: {exc}")
                result.skills_invalid += 1

        result.skills_fetched = len(result.skills)
        return result


# ---------------------------------------------------------------------------
# Convenience function
# ---------------------------------------------------------------------------


def fetch_skill_from_github(
    repo: ExternalSkillRepo,
    curated_names: list[str] | None = None,
    token: str | None = None,
) -> FetchResult:
    """Fetch skills from a GitHub repository.

    Args:
        repo: Repository configuration.
        curated_names: Optional subset of skills to fetch.
        token: GitHub token (optional).

    Returns:
        FetchResult with fetched skills.
    """
    fetcher = GitHubSkillFetcher(token=token)
    return fetcher.fetch_all_skills(repo, curated_names)
