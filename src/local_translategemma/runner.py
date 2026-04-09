from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from datetime import UTC, datetime
from time import perf_counter

from loguru import logger

from .errors import InputValidationError
from .io import JsonlWriter, RawRecord, load_input_records
from .progress import BatchProgress
from .retry import RetryExhaustedError, RetryPolicy
from .schemas import BatchConfig, FailureRecord, RunSummary, TranslationTask
from .service import TranslateGemmaService, is_retryable_inference_error


def _prepare_task(raw_record: RawRecord) -> TranslationTask | FailureRecord:
    try:
        return TranslationTask.from_payload(raw_record.payload, raw_record.line_number)
    except InputValidationError as exc:
        return FailureRecord(
            line_number=raw_record.line_number,
            record_id=f"line-{raw_record.line_number}",
            stage="preprocess",
            error_type=type(exc).__name__,
            error_message=str(exc),
            retryable=False,
            attempts=1,
        )


def _audit_success_event(result) -> dict[str, object]:
    return {
        "timestamp": datetime.now(UTC).isoformat(),
        "status": "ok",
        "id": result.task.record_id,
        "line_number": result.task.line_number,
        "attempts": result.attempts,
        "elapsed_seconds": round(result.elapsed_seconds, 4),
    }


def _audit_failure_event(failure: FailureRecord) -> dict[str, object]:
    return {
        "timestamp": datetime.now(UTC).isoformat(),
        "status": "error",
        **failure.to_json_dict(),
    }


def run_batch(service: TranslateGemmaService, config: BatchConfig) -> RunSummary:
    records, preload_failures = load_input_records(
        config.input_path,
        default_source_lang_code=config.default_source_lang_code,
        default_target_lang_code=config.default_target_lang_code,
    )
    total = len(records) + len(preload_failures)
    retry_policy = RetryPolicy(
        attempts=config.retry_attempts,
        initial_backoff_seconds=config.retry_initial_backoff_seconds,
        multiplier=config.retry_multiplier,
        max_backoff_seconds=config.retry_max_backoff_seconds,
    )

    started_at = perf_counter()
    succeeded = 0
    failed = 0
    progress = BatchProgress(total=total)

    audit_context = JsonlWriter(config.audit_path) if config.audit_path is not None else nullcontext(None)

    try:
        with JsonlWriter(config.output_path) as output_writer, JsonlWriter(config.error_path) as error_writer, audit_context as audit_writer:
            for failure in preload_failures:
                error_writer.write(failure.to_json_dict())
                if audit_writer is not None:
                    audit_writer.write(_audit_failure_event(failure))
                failed += 1
                progress.update(succeeded=succeeded, failed=failed)

            with ThreadPoolExecutor(max_workers=max(config.preprocess_workers, 1)) as executor:
                prepared_items = executor.map(_prepare_task, records)

                for item in prepared_items:
                    if isinstance(item, FailureRecord):
                        error_writer.write(item.to_json_dict())
                        if audit_writer is not None:
                            audit_writer.write(_audit_failure_event(item))
                        failed += 1
                        progress.update(succeeded=succeeded, failed=failed)
                        continue

                    try:
                        result = service.translate(item, retry_policy=retry_policy)
                    except RetryExhaustedError as exc:
                        last_exception = exc.last_exception
                        failure = FailureRecord(
                            line_number=item.line_number,
                            record_id=item.record_id,
                            stage="inference",
                            error_type=type(last_exception).__name__,
                            error_message=str(last_exception),
                            retryable=is_retryable_inference_error(last_exception),
                            attempts=exc.attempts,
                        )
                        logger.error("Translation failed for {} after {} attempts.", item.record_id, exc.attempts)
                        error_writer.write(failure.to_json_dict())
                        if audit_writer is not None:
                            audit_writer.write(_audit_failure_event(failure))
                        failed += 1
                    except Exception as exc:
                        failure = FailureRecord(
                            line_number=item.line_number,
                            record_id=item.record_id,
                            stage="inference",
                            error_type=type(exc).__name__,
                            error_message=str(exc),
                            retryable=is_retryable_inference_error(exc),
                            attempts=1,
                        )
                        logger.error("Translation failed for {}: {}", item.record_id, exc)
                        error_writer.write(failure.to_json_dict())
                        if audit_writer is not None:
                            audit_writer.write(_audit_failure_event(failure))
                        failed += 1
                    else:
                        output_writer.write(result.to_json_dict())
                        if audit_writer is not None:
                            audit_writer.write(_audit_success_event(result))
                        succeeded += 1

                    progress.update(succeeded=succeeded, failed=failed)
    finally:
        progress.close()

    elapsed_seconds = perf_counter() - started_at
    return RunSummary(
        total=total,
        succeeded=succeeded,
        failed=failed,
        elapsed_seconds=elapsed_seconds,
        output_path=config.output_path,
        error_path=config.error_path,
        audit_path=config.audit_path,
    )
