from __future__ import annotations

from loguru import logger

from local_translategemma.retry import RetryPolicy
from local_translategemma.schemas import ModelConfig, TranslationTask
from local_translategemma.service import TranslateGemmaService

from ._mlx_lock import MLX_LOCK
from .schemas import TranslationConfig


class TranslateGemmaTranslator:
    def __init__(self, config: TranslationConfig) -> None:
        self.config = config
        self.retry_policy = RetryPolicy(
            attempts=config.retry_attempts,
            initial_backoff_seconds=config.retry_initial_backoff_seconds,
            multiplier=config.retry_multiplier,
            max_backoff_seconds=config.retry_max_backoff_seconds,
        )
        self.service = TranslateGemmaService(
            ModelConfig(
                model_id=config.model_id,
                max_tokens=config.max_tokens,
                chunk_input_tokens=config.chunk_input_tokens,
                context_window_tokens=config.context_window_tokens,
                prompt_token_reserve=config.prompt_token_reserve,
                trust_remote_code=config.trust_remote_code,
                offline=config.offline,
            )
        )

    def warmup(self) -> None:
        logger.info("Warming up TranslateGemma model '{}'", self.config.model_id)
        self.service.warmup()

    def translate_article(
        self,
        article_id: str,
        title: str,
        paragraphs: list[str],
        summary: list[str],
    ) -> dict[str, object]:
        title_result = self._translate_text(article_id=article_id, section="title", order=1, text=title)
        paragraph_results = [
            self._translate_text(article_id=article_id, section="paragraph", order=index, text=paragraph)
            for index, paragraph in enumerate(paragraphs, start=1)
        ]
        summary_results = [
            self._translate_text(article_id=article_id, section="summary", order=index, text=bullet)
            for index, bullet in enumerate(summary, start=1)
        ]

        all_results = [title_result, *paragraph_results, *summary_results]
        return {
            "title_ko": title_result.translation,
            "paragraphs_ko": [result.translation for result in paragraph_results],
            "summary_ko": [result.translation for result in summary_results],
            "translation_meta": {
                "model": title_result.model_id,
                "segments": len(all_results),
                "elapsed_seconds": round(sum(result.elapsed_seconds for result in all_results), 4),
                "attempts": sum(result.attempts for result in all_results),
                "chunk_count": sum(result.chunk_count for result in all_results),
            },
        }

    def _translate_text(self, article_id: str, section: str, order: int, text: str):
        task = TranslationTask(
            line_number=order,
            record_id=f"{article_id}:{section}:{order}",
            source_lang_code=self.config.source_lang_code,
            target_lang_code=self.config.target_lang_code,
            text=text,
        )
        with MLX_LOCK:
            return self.service.translate(task, retry_policy=self.retry_policy)


def build_translator(config: TranslationConfig) -> TranslateGemmaTranslator:
    translator = TranslateGemmaTranslator(config)
    if config.warmup:
        translator.warmup()
    return translator
