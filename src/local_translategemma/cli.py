from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from loguru import logger

from .doctor import run_doctor
from .errors import ConfigurationError, ModelAccessError
from .logging_utils import configure_logging
from .retry import RetryPolicy
from .runner import run_batch
from .schemas import BatchConfig, DEFAULT_MODEL_ID, ModelConfig, TranslationTask
from .service import TranslateGemmaService


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local TranslateGemma runner for Apple Silicon.")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging.")

    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor_parser = subparsers.add_parser("doctor", help="Check local environment and Hugging Face access.")
    doctor_parser.add_argument("--model", default=DEFAULT_MODEL_ID, help="Model repo or local path.")
    doctor_parser.add_argument(
        "--offline",
        action="store_true",
        help="Do not contact Hugging Face. Validate only the local cached snapshot or local path.",
    )

    translate_parser = subparsers.add_parser("translate", help="Translate a single text.")
    translate_parser.add_argument("--model", default=DEFAULT_MODEL_ID, help="Model repo or local path.")
    translate_parser.add_argument(
        "--offline",
        action="store_true",
        help="Require local cached/local-path model loading with no network access.",
    )
    translate_parser.add_argument("--source", required=True, help="Source language code.")
    translate_parser.add_argument("--target", required=True, help="Target language code.")
    translate_parser.add_argument("--text", required=True, help="Source text to translate.")
    translate_parser.add_argument("--max-tokens", type=int, default=3072, help="Maximum output tokens per generated chunk.")
    translate_parser.add_argument(
        "--chunk-input-tokens",
        type=int,
        default=1536,
        help="Soft maximum source-text tokens per translation chunk before automatic splitting.",
    )
    translate_parser.add_argument(
        "--trust-remote-code",
        action="store_true",
        help="Pass trust_remote_code through tokenizer configuration if required.",
    )

    batch_parser = subparsers.add_parser("batch", help="Translate a JSONL file.")
    batch_parser.add_argument("--model", default=DEFAULT_MODEL_ID, help="Model repo or local path.")
    batch_parser.add_argument(
        "--offline",
        action="store_true",
        help="Require local cached/local-path model loading with no network access.",
    )
    batch_parser.add_argument(
        "--source",
        help="Default source language code. Required for plain text input files.",
    )
    batch_parser.add_argument(
        "--target",
        help="Default target language code. Required for plain text input files.",
    )
    batch_parser.add_argument("--input", required=True, type=Path, help="Input JSONL file.")
    batch_parser.add_argument("--output", required=True, type=Path, help="Output JSONL file.")
    batch_parser.add_argument("--errors", required=True, type=Path, help="Error JSONL file.")
    batch_parser.add_argument("--audit", type=Path, help="Optional audit JSONL file.")
    batch_parser.add_argument("--max-tokens", type=int, default=3072, help="Maximum output tokens per generated chunk.")
    batch_parser.add_argument(
        "--chunk-input-tokens",
        type=int,
        default=1536,
        help="Soft maximum source-text tokens per translation chunk before automatic splitting.",
    )
    batch_parser.add_argument("--preprocess-workers", type=int, default=4, help="Input prep workers.")
    batch_parser.add_argument("--retry-attempts", type=int, default=3, help="Attempts per item.")
    batch_parser.add_argument(
        "--retry-initial-backoff-seconds",
        type=float,
        default=1.0,
        help="Initial retry backoff.",
    )
    batch_parser.add_argument(
        "--retry-multiplier",
        type=float,
        default=2.0,
        help="Retry backoff multiplier.",
    )
    batch_parser.add_argument(
        "--retry-max-backoff-seconds",
        type=float,
        default=8.0,
        help="Retry backoff cap.",
    )
    batch_parser.add_argument(
        "--trust-remote-code",
        action="store_true",
        help="Pass trust_remote_code through tokenizer configuration if required.",
    )

    return parser


def _build_service(
    model: str,
    max_tokens: int,
    chunk_input_tokens: int,
    trust_remote_code: bool,
    offline: bool,
) -> TranslateGemmaService:
    config = ModelConfig(
        model_id=model,
        max_tokens=max_tokens,
        chunk_input_tokens=chunk_input_tokens,
        trust_remote_code=trust_remote_code,
        offline=offline,
    )
    return TranslateGemmaService(config=config)


def _run_doctor(args: argparse.Namespace) -> int:
    checks = run_doctor(model_id=args.model, offline=args.offline)
    has_failure = False
    for check in checks:
        print(f"[{check.status.upper():4}] {check.name}: {check.detail}")
        if check.status == "fail":
            has_failure = True
    return 1 if has_failure else 0


def _run_single_translation(args: argparse.Namespace) -> int:
    service = _build_service(
        args.model,
        args.max_tokens,
        args.chunk_input_tokens,
        args.trust_remote_code,
        args.offline,
    )
    task = TranslationTask(
        line_number=1,
        record_id="cli",
        source_lang_code=args.source,
        target_lang_code=args.target,
        text=args.text,
    )
    result = service.translate(
        task,
        retry_policy=RetryPolicy(),
    )
    print(
        json.dumps(
            {
                "translation": result.translation,
                "elapsed_seconds": round(result.elapsed_seconds, 4),
                "attempts": result.attempts,
                "model": result.model_id,
                "chunk_count": result.chunk_count,
            },
            ensure_ascii=False,
        )
    )
    return 0


def _run_batch_command(args: argparse.Namespace) -> int:
    service = _build_service(
        args.model,
        args.max_tokens,
        args.chunk_input_tokens,
        args.trust_remote_code,
        args.offline,
    )
    service.warmup()
    summary = run_batch(
        service,
        BatchConfig(
            input_path=args.input,
            output_path=args.output,
            error_path=args.errors,
            audit_path=args.audit,
            default_source_lang_code=args.source,
            default_target_lang_code=args.target,
            preprocess_workers=args.preprocess_workers,
            retry_attempts=args.retry_attempts,
            retry_initial_backoff_seconds=args.retry_initial_backoff_seconds,
            retry_multiplier=args.retry_multiplier,
            retry_max_backoff_seconds=args.retry_max_backoff_seconds,
        ),
    )
    logger.info(
        "Finished batch run: total={} ok={} fail={} elapsed={:.2f}s",
        summary.total,
        summary.succeeded,
        summary.failed,
        summary.elapsed_seconds,
    )
    return 0 if summary.failed == 0 else 2


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    configure_logging(args.verbose)

    try:
        if args.command == "doctor":
            return _run_doctor(args)
        if args.command == "translate":
            return _run_single_translation(args)
        if args.command == "batch":
            return _run_batch_command(args)
    except (ConfigurationError, ModelAccessError) as exc:
        logger.error(str(exc))
        return 1
    except KeyboardInterrupt:
        logger.warning("Interrupted by user.")
        return 130
    except Exception as exc:
        logger.exception("Unhandled error: {}", exc)
        return 1

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
