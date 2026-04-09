from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import InputValidationError
from .schemas import FailureRecord


@dataclass(slots=True)
class RawRecord:
    line_number: int
    payload: dict[str, Any]


class JsonlWriter:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._handle = None

    def __enter__(self) -> "JsonlWriter":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._handle = self.path.open("w", encoding="utf-8")
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._handle is not None:
            self._handle.close()

    def write(self, payload: dict[str, Any]) -> None:
        if self._handle is None:
            raise RuntimeError("JSONL writer is not open.")

        self._handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
        self._handle.flush()


def _apply_default_language_codes(
    payload: dict[str, Any],
    *,
    default_source_lang_code: str | None,
    default_target_lang_code: str | None,
) -> dict[str, Any]:
    updated = dict(payload)
    if default_source_lang_code and "source_lang_code" not in updated:
        updated["source_lang_code"] = default_source_lang_code
    if default_target_lang_code and "target_lang_code" not in updated:
        updated["target_lang_code"] = default_target_lang_code
    return updated


def _load_json_payload(
    payload: Any,
    *,
    default_source_lang_code: str | None,
    default_target_lang_code: str | None,
) -> list[RawRecord]:
    if isinstance(payload, dict):
        return [
            RawRecord(
                line_number=1,
                payload=_apply_default_language_codes(
                    payload,
                    default_source_lang_code=default_source_lang_code,
                    default_target_lang_code=default_target_lang_code,
                ),
            )
        ]

    if isinstance(payload, list):
        records: list[RawRecord] = []
        for index, item in enumerate(payload, start=1):
            if not isinstance(item, dict):
                raise InputValidationError("JSON array input must contain only JSON objects.")
            records.append(
                RawRecord(
                    line_number=index,
                    payload=_apply_default_language_codes(
                        item,
                        default_source_lang_code=default_source_lang_code,
                        default_target_lang_code=default_target_lang_code,
                    ),
                )
            )
        return records

    raise InputValidationError("JSON input must be a JSON object or a JSON array of objects.")


def _load_text_payload(
    path: Path,
    *,
    default_source_lang_code: str | None,
    default_target_lang_code: str | None,
) -> list[RawRecord]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise InputValidationError(f"Text input '{path}' is empty.")
    if not default_source_lang_code or not default_target_lang_code:
        raise InputValidationError(
            "Text input requires `--source` and `--target` for the batch command."
        )

    return [
        RawRecord(
            line_number=1,
            payload={
                "id": path.stem,
                "source_lang_code": default_source_lang_code,
                "target_lang_code": default_target_lang_code,
                "text": text,
            },
        )
    ]


def _load_jsonl_records(
    path: Path,
    *,
    default_source_lang_code: str | None,
    default_target_lang_code: str | None,
) -> tuple[list[RawRecord], list[FailureRecord]]:
    records: list[RawRecord] = []
    failures: list[FailureRecord] = []

    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue

            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                failures.append(
                    FailureRecord(
                        line_number=line_number,
                        record_id=f"line-{line_number}",
                        stage="preprocess",
                        error_type=type(exc).__name__,
                        error_message=f"Line {line_number} is not valid JSON: {exc.msg}.",
                        retryable=False,
                        attempts=1,
                    )
                )
                continue

            if not isinstance(payload, dict):
                failures.append(
                    FailureRecord(
                        line_number=line_number,
                        record_id=f"line-{line_number}",
                        stage="preprocess",
                        error_type="InputValidationError",
                        error_message=f"Line {line_number} must decode to a JSON object.",
                        retryable=False,
                        attempts=1,
                    )
                )
                continue

            records.append(
                RawRecord(
                    line_number=line_number,
                    payload=_apply_default_language_codes(
                        payload,
                        default_source_lang_code=default_source_lang_code,
                        default_target_lang_code=default_target_lang_code,
                    ),
                )
            )

    return records, failures


def load_input_records(
    path: Path,
    *,
    default_source_lang_code: str | None = None,
    default_target_lang_code: str | None = None,
) -> tuple[list[RawRecord], list[FailureRecord]]:
    suffix = path.suffix.lower()

    if suffix in {".txt", ".md"}:
        return _load_text_payload(
            path,
            default_source_lang_code=default_source_lang_code,
            default_target_lang_code=default_target_lang_code,
        ), []

    if suffix == ".json":
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise InputValidationError(f"JSON input '{path}' is invalid: {exc.msg}.") from exc
        return (
            _load_json_payload(
                payload,
                default_source_lang_code=default_source_lang_code,
                default_target_lang_code=default_target_lang_code,
            ),
            [],
        )

    return _load_jsonl_records(
        path,
        default_source_lang_code=default_source_lang_code,
        default_target_lang_code=default_target_lang_code,
    )
