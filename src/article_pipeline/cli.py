from __future__ import annotations

import argparse
import json
from pathlib import Path

from loguru import logger

from .io import (
    INPUT_DIR,
    LOGS_DIR,
    OUTPUT_DIR,
    ROOT_DIR,
    build_run_summary,
    discover_input_files,
    load_article_input,
    load_env_file,
    save_output,
)
from .logging_utils import PipelineProgress, configure_logging
from .openai_backend import build_backend
from .pipeline import ArticlePipeline
from .schemas import ArticleState, PipelineConfig, TranslationConfig
from .translator import build_translator


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Article enrichment pipeline with OpenAI generation and local TranslateGemma translation."
    )
    parser.add_argument("--input-path", type=Path, default=INPUT_DIR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--backend", default="gemma4", choices=["gemma4", "openai"])
    parser.add_argument("--model", default="google/gemma-4-E4B-it")
    parser.add_argument("--image-model", default="gemini-3.1-flash-image-preview")
    parser.add_argument("--image-size", default="1536x1024")
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--max-retries", type=int, default=3)
    parser.add_argument("--log-level", default="INFO")
    parser.add_argument("--disable-progress", action="store_true")
    parser.add_argument("--skip-image", action="store_true")
    parser.add_argument("--translator-model")
    parser.add_argument("--translator-source", default="en")
    parser.add_argument("--translator-target", default="ko")
    parser.add_argument("--translator-offline", action="store_true")
    parser.add_argument("--skip-translator-warmup", action="store_true")
    parser.add_argument("--translator-chunk-input-tokens", type=int, default=1536)
    parser.add_argument("--translator-context-window-tokens", type=int, default=2048)
    parser.add_argument("--translator-max-tokens", type=int, default=3072)
    return parser.parse_args()


def build_pipeline_config(args: argparse.Namespace) -> PipelineConfig:
    return PipelineConfig(
        backend=args.backend,
        model=args.model,
        image_model=args.image_model,
        image_size=args.image_size,
        max_workers=max(1, args.max_workers),
        max_retries=max(0, args.max_retries),
        progress_enabled=not args.disable_progress,
        generate_image=not args.skip_image,
        log_level=args.log_level,
        input_path=args.input_path,
        output_dir=args.output_dir,
    )


def build_translation_config(args: argparse.Namespace) -> TranslationConfig:
    config = TranslationConfig(
        source_lang_code=args.translator_source,
        target_lang_code=args.translator_target,
        max_tokens=args.translator_max_tokens,
        chunk_input_tokens=args.translator_chunk_input_tokens,
        context_window_tokens=args.translator_context_window_tokens,
        offline=args.translator_offline,
        warmup=not args.skip_translator_warmup,
    )
    if args.translator_model:
        config.model_id = args.translator_model
    return config


def main() -> int:
    args = parse_args()
    pipeline_config = build_pipeline_config(args)
    translation_config = build_translation_config(args)
    log_file = configure_logging(pipeline_config.log_level, LOGS_DIR)

    try:
        load_env_file(ROOT_DIR / ".env.local")
        input_files = discover_input_files(pipeline_config.input_path)
        articles = [load_article_input(path) for path in input_files]

        backend = build_backend(pipeline_config)
        translator = build_translator(translation_config)
        pipeline = ArticlePipeline(
            backend=backend,
            translator=translator,
            config=pipeline_config,
            log_file=log_file,
        )

        results: list[ArticleState] = []
        total_steps = len(articles) * ArticlePipeline.TOTAL_STAGES

        with PipelineProgress(total_steps=total_steps, enabled=pipeline_config.progress_enabled) as progress:
            for article in articles:
                output_path = pipeline_config.output_dir / f"{article.article_id}.json"
                image_output_path = pipeline_config.output_dir / "images" / f"{article.article_id}.png"
                result = pipeline.run(
                    article=article,
                    output_path=output_path,
                    image_output_path=image_output_path,
                    progress=progress,
                )
                save_output(result, output_path)
                logger.info("Wrote article output for '{}' to '{}'", article.article_id, output_path)
                results.append(result)

        run_summary = build_run_summary(results, pipeline_config.output_dir, log_file)
        run_summary_path = pipeline_config.output_dir / "run_summary.json"
        save_output(run_summary, run_summary_path)
        print(json.dumps(run_summary, ensure_ascii=False, indent=2))
        logger.info("Wrote run summary to '{}'", run_summary_path)
        return 0 if all(not result["errors"] for result in results) else 1
    except Exception:
        logger.exception("Pipeline terminated with an unrecoverable top-level error")
        return 1
