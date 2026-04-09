from __future__ import annotations

import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from loguru import logger
from tqdm.auto import tqdm


def format_seconds(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    minutes, remaining_seconds = divmod(total_seconds, 60)
    hours, remaining_minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{remaining_minutes:02d}:{remaining_seconds:02d}"
    return f"{remaining_minutes:02d}:{remaining_seconds:02d}"


class TqdmSink:
    def write(self, message: str) -> None:
        cleaned = message.rstrip("\n")
        if not cleaned:
            return
        if sys.stderr.isatty():
            tqdm.write(cleaned, file=sys.stderr)
        else:
            print(cleaned, file=sys.stderr)

    def flush(self) -> None:
        return None


class PipelineProgress:
    def __init__(self, total_steps: int, enabled: bool) -> None:
        self.total_steps = total_steps
        self.enabled = enabled and sys.stderr.isatty()
        self.start_time = time.monotonic()
        self.completed = 0
        self.bar: Optional[tqdm] = None

    def __enter__(self) -> "PipelineProgress":
        if self.enabled:
            self.bar = tqdm(
                total=self.total_steps,
                position=0,
                leave=True,
                dynamic_ncols=True,
                bar_format="{desc:<32}{bar}| {n_fmt}/{total_fmt} [{elapsed}] {postfix}",
            )
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self.bar is not None:
            self.bar.close()

    def advance(self, article_id: str, stage: str, status: str) -> None:
        self.completed += 1
        elapsed = time.monotonic() - self.start_time
        eta_seconds = 0.0
        if self.completed:
            eta_seconds = max(0.0, elapsed * (self.total_steps - self.completed) / self.completed)

        if self.bar is not None:
            label = f"{article_id}:{stage}"[:32]
            self.bar.set_description(label, refresh=False)
            self.bar.set_postfix_str(f"status={status} eta={format_seconds(eta_seconds)}", refresh=False)
            self.bar.update(1)


def configure_logging(log_level: str, logs_dir: Path) -> Path:
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_file = logs_dir / f"article_pipeline_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.log"

    logger.remove()
    logger.add(
        TqdmSink(),
        level=log_level.upper(),
        colorize=sys.stderr.isatty(),
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | {message}",
    )
    logger.add(
        log_file,
        level=log_level.upper(),
        enqueue=True,
        backtrace=True,
        diagnose=False,
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {message}",
    )
    return log_file
