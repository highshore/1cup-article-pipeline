from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from loguru import logger

from article_pipeline.io import LOGS_DIR, ROOT_DIR, load_env_file
from article_pipeline.logging_utils import PipelineProgress
from article_pipeline.openai_backend import build_backend
from article_pipeline.pipeline import ArticlePipeline
from article_pipeline.schemas import ArticleInput, PipelineConfig, TranslationConfig
from article_pipeline.translator import build_translator


@dataclass(slots=True)
class PipelineRunnerConfig:
    backend: str = "gemma4"
    model: str = "google/gemma-4-E4B-it"
    image_model: str = "gemini-3.1-flash-image-preview"
    image_size: str = "1536x1024"
    max_workers: int = 4
    max_retries: int = 3
    generate_image: bool = True
    log_level: str = "INFO"
    output_dir: Path = ROOT_DIR / "output"
    translator_model: str | None = None
    translator_source: str = "en"
    translator_target: str = "ko"
    translator_offline: bool = False
    translator_warmup: bool = True
    translator_chunk_input_tokens: int = 1536
    translator_context_window_tokens: int = 2048
    translator_max_tokens: int = 3072


class CrawlerPipelineRunner:
    def __init__(self, config: PipelineRunnerConfig) -> None:
        self.config = config
        load_env_file(ROOT_DIR / ".env.local")
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        self.log_file = LOGS_DIR / f"article_pipeline_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.log"
        self.log_sink_id = logger.add(
            self.log_file,
            level=config.log_level.upper(),
            enqueue=True,
            backtrace=True,
            diagnose=False,
            format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {message}",
        )

        pipeline_config = PipelineConfig(
            backend=config.backend,
            model=config.model,
            image_model=config.image_model,
            image_size=config.image_size,
            max_workers=max(1, config.max_workers),
            max_retries=max(0, config.max_retries),
            progress_enabled=False,
            generate_image=config.generate_image,
            log_level=config.log_level,
            input_path=Path("."),
            output_dir=config.output_dir,
        )
        translation_config = TranslationConfig(
            source_lang_code=config.translator_source,
            target_lang_code=config.translator_target,
            max_tokens=config.translator_max_tokens,
            chunk_input_tokens=config.translator_chunk_input_tokens,
            context_window_tokens=config.translator_context_window_tokens,
            offline=config.translator_offline,
            warmup=config.translator_warmup,
        )
        if config.translator_model:
            translation_config.model_id = config.translator_model

        backend = build_backend(pipeline_config)
        translator = build_translator(translation_config)
        self.pipeline = ArticlePipeline(
            backend=backend,
            translator=translator,
            config=pipeline_config,
            log_file=self.log_file,
        )

    def close(self) -> None:
        logger.remove(self.log_sink_id)

    def process_document(self, document_path: Path) -> dict[str, Any]:
        document = json.loads(document_path.read_text(encoding="utf-8"))
        article_input = self._build_article_input(document_path, document)
        image_output_path = self.config.output_dir / "images" / f"{article_input.article_id}.png"
        with PipelineProgress(total_steps=ArticlePipeline.TOTAL_STAGES, enabled=False) as progress:
            state = self.pipeline.run(
                article=article_input,
                output_path=document_path,
                image_output_path=image_output_path,
                progress=progress,
            )

        merged = dict(document)
        merged.update(state)
        merged["phase"] = "processed"
        merged["input_file_path"] = str(document_path.resolve())
        return merged

    def _build_article_input(self, document_path: Path, document: dict[str, Any]) -> ArticleInput:
        article_blocks = document.get("article", [])
        raw_paragraphs = [
            str(block.get("text", "")).strip()
            for block in article_blocks
            if isinstance(block, dict) and block.get("type") == "paragraph" and str(block.get("text", "")).strip()
        ]
        raw_article = "\n\n".join(raw_paragraphs).strip()
        return ArticleInput(
            article_id=str(document.get("article_id", document_path.stem)).strip(),
            source_path=document_path.resolve(),
            title=str(document.get("title", "")).strip(),
            subtitle=str(document.get("subtitle", "")).strip(),
            url=str(document.get("url", "")).strip(),
            raw_article=raw_article,
        )
