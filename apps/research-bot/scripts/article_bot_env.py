#!/usr/bin/env python3
"""Environment helpers for article-bot scripts."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def load_root_env() -> None:
    """Load workspace .env.local without overwriting already-exported values."""
    env_path = REPO_ROOT / ".env.local"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.removeprefix("export ").strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value
