from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import InputValidationError

DEFAULT_MODEL_ID = "mlx-community/translategemma-12b-it-4bit"

REQUIRED_INPUT_FIELDS = ("source_lang_code", "target_lang_code", "text")


def _require_non_empty_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str):
        raise InputValidationError(f"Field '{field_name}' must be a string.")

    normalized = value.strip()
    if not normalized:
        raise InputValidationError(f"Field '{field_name}' must not be empty.")

    return normalized


@dataclass(slots=True)
class TranslationTask:
    line_number: int
    record_id: str
    source_lang_code: str
    target_lang_code: str
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: dict[str, Any], line_number: int) -> "TranslationTask":
        source_lang_code = _require_non_empty_string(payload.get("source_lang_code"), "source_lang_code")
        target_lang_code = _require_non_empty_string(payload.get("target_lang_code"), "target_lang_code")
        text = _require_non_empty_string(payload.get("text"), "text")

        raw_record_id = payload.get("id")
        record_id = (
            raw_record_id.strip()
            if isinstance(raw_record_id, str) and raw_record_id.strip()
            else f"line-{line_number}"
        )

        metadata = {
            key: value
            for key, value in payload.items()
            if key not in {"id", "source_lang_code", "target_lang_code", "text"}
        }

        return cls(
            line_number=line_number,
            record_id=record_id,
            source_lang_code=source_lang_code,
            target_lang_code=target_lang_code,
            text=text,
            metadata=metadata,
        )


@dataclass(slots=True)
class ModelConfig:
    model_id: str = DEFAULT_MODEL_ID
    max_tokens: int = 3072
    chunk_input_tokens: int = 1536
    context_window_tokens: int = 2048
    prompt_token_reserve: int = 32
    trust_remote_code: bool = False
    offline: bool = False
    suppress_known_tokenizer_warning: bool = True


@dataclass(slots=True)
class BatchConfig:
    input_path: Path
    output_path: Path
    error_path: Path
    audit_path: Path | None = None
    default_source_lang_code: str | None = None
    default_target_lang_code: str | None = None
    preprocess_workers: int = 4
    retry_attempts: int = 3
    retry_initial_backoff_seconds: float = 1.0
    retry_multiplier: float = 2.0
    retry_max_backoff_seconds: float = 8.0


@dataclass(slots=True)
class TranslationResult:
    task: TranslationTask
    translation: str
    elapsed_seconds: float
    attempts: int
    model_id: str
    prompt_characters: int
    chunk_count: int = 1

    def to_json_dict(self) -> dict[str, Any]:
        return {
            "id": self.task.record_id,
            "line_number": self.task.line_number,
            "source_lang_code": self.task.source_lang_code,
            "target_lang_code": self.task.target_lang_code,
            "text": self.task.text,
            "translation": self.translation,
            "elapsed_seconds": round(self.elapsed_seconds, 4),
            "attempts": self.attempts,
            "model": self.model_id,
            "prompt_characters": self.prompt_characters,
            "chunk_count": self.chunk_count,
            **self.task.metadata,
        }


@dataclass(slots=True)
class FailureRecord:
    line_number: int
    record_id: str
    stage: str
    error_type: str
    error_message: str
    retryable: bool
    attempts: int

    def to_json_dict(self) -> dict[str, Any]:
        return {
            "id": self.record_id,
            "line_number": self.line_number,
            "stage": self.stage,
            "error_type": self.error_type,
            "error_message": self.error_message,
            "retryable": self.retryable,
            "attempts": self.attempts,
        }


@dataclass(slots=True)
class RunSummary:
    total: int
    succeeded: int
    failed: int
    elapsed_seconds: float
    output_path: Path
    error_path: Path
    audit_path: Path | None
