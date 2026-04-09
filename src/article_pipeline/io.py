from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .schemas import ArticleInput, ArticleState, InputArticlePayload


ROOT_DIR = Path(__file__).resolve().parents[2]
INPUT_DIR = ROOT_DIR / "input"
OUTPUT_DIR = ROOT_DIR / "output"
LOGS_DIR = ROOT_DIR / "logs"


def iso_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_env_file(env_path: Path) -> None:
    import os

    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key.removeprefix("export ").strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "article"


def discover_input_files(input_path: Path) -> list[Path]:
    if input_path.is_file():
        if input_path.suffix.lower() != ".txt":
            raise ValueError(f"Input file '{input_path}' must be a .txt file.")
        return [input_path]

    if not input_path.exists():
        raise FileNotFoundError(f"Input path '{input_path}' does not exist.")

    files = sorted(path for path in input_path.glob("*.txt") if path.is_file())
    if not files:
        raise FileNotFoundError(f"No .txt files were found in '{input_path}'.")
    return files


def load_article_input(path: Path) -> ArticleInput:
    raw_text = path.read_text(encoding="utf-8")
    text = raw_text.strip()
    if not text:
        raise ValueError(f"Input file '{path}' is empty.")

    title_match = re.search(r"(?mi)^\s*Title:\s*(?P<title>.+?)\s*$", raw_text)
    url_match = re.search(r"(?mi)^\s*URL:\s*(?P<url>\S+)\s*$", raw_text)
    article_text_match = re.search(r"(?mis)^\s*Article Text:\s*\n(?P<body>.+)$", raw_text)

    if not (title_match and url_match and article_text_match):
        raise ValueError(
            f"Input file '{path}' must use this format exactly: Title:, URL:, and Article Text: sections."
        )

    payload = InputArticlePayload.model_validate(
        {
            "title": title_match.group("title"),
            "url": url_match.group("url"),
            "raw_article": article_text_match.group("body").strip(),
        }
    )

    return ArticleInput(
        article_id=slugify(path.stem),
        source_path=path,
        title=payload.title,
        url=payload.url,
        raw_article=payload.raw_article,
    )


def save_output(payload: dict[str, Any], output_file: Path) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def build_run_summary(results: list[ArticleState], output_dir: Path, log_file: Path) -> dict[str, Any]:
    return {
        "processed": len(results),
        "succeeded": sum(1 for result in results if not result["errors"]),
        "failed": sum(1 for result in results if result["errors"]),
        "generated_at": iso_timestamp(),
        "log_file": str(log_file),
        "output_dir": str(output_dir),
        "articles": [
            {
                "article_id": result["article_id"],
                "source_path": result["source_path"],
                "url": result["url"],
                "output_path": result["output_path"],
                "error_count": len(result["errors"]),
                "image_path": result.get("image_path"),
            }
            for result in results
        ],
    }
