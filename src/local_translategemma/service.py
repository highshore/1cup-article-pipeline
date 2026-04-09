from __future__ import annotations

import re
import os
from contextlib import nullcontext
from time import perf_counter
from typing import Any

from loguru import logger

from .errors import ConfigurationError, ModelAccessError
from .model_locator import resolve_model_reference
from .retry import RetryExhaustedError, RetryPolicy, retry_call
from .schemas import ModelConfig, TranslationResult, TranslationTask

TURN_MARKER_PATTERN = re.compile(r"(?:<end_of_turn>|<eos>)+\s*$")
TURN_MARKERS = ("<end_of_turn>", "<eos>")
SENTENCE_SPLIT_PATTERN = re.compile(r"(?<=[.!?。！？])\s+")


def is_retryable_inference_error(exc: Exception) -> bool:
    retryable_types = (TimeoutError, ConnectionError, BrokenPipeError, InterruptedError, OSError)
    if isinstance(exc, retryable_types):
        return True

    message = str(exc).lower()
    retryable_markers = ("timed out", "temporarily unavailable", "connection reset")
    return any(marker in message for marker in retryable_markers)


class TranslateGemmaService:
    def __init__(self, config: ModelConfig) -> None:
        self.config = config
        self._model = None
        self._tokenizer = None
        self._resolved_model_id = config.model_id

    def warmup(self) -> None:
        self._ensure_loaded()

    @staticmethod
    def _stderr_filter_context(enabled: bool):
        if not enabled:
            return nullcontext()

        class _FilteredStderr:
            def __enter__(self):
                self._saved_stderr_fd = os.dup(2)
                self._null_fd = os.open(os.devnull, os.O_WRONLY)
                os.dup2(self._null_fd, 2)
                return self

            def __exit__(self, exc_type, exc, tb) -> None:
                os.dup2(self._saved_stderr_fd, 2)
                os.close(self._saved_stderr_fd)
                os.close(self._null_fd)

        return _FilteredStderr()

    def _ensure_loaded(self) -> tuple[Any, Any]:
        if self._model is not None and self._tokenizer is not None:
            return self._model, self._tokenizer

        try:
            from mlx_lm import load
        except ImportError as exc:
            raise ConfigurationError(
                "mlx-lm is not installed. Run `uv sync` before starting the service."
            ) from exc

        load_kwargs: dict[str, Any] = {}
        tokenizer_config: dict[str, Any] = {}
        if self.config.trust_remote_code:
            tokenizer_config["trust_remote_code"] = True
        if tokenizer_config:
            load_kwargs["tokenizer_config"] = tokenizer_config

        resolved_model = resolve_model_reference(self.config.model_id, offline=self.config.offline)
        try:
            logger.info(
                "Loading model {} [{} -> {}]",
                resolved_model.resolved,
                resolved_model.requested,
                resolved_model.source,
            )
            with self._stderr_filter_context(self.config.suppress_known_tokenizer_warning):
                self._model, self._tokenizer = load(resolved_model.resolved, **load_kwargs)
            self._resolved_model_id = resolved_model.requested
        except Exception as exc:
            message = str(exc)
            if any(marker in message.lower() for marker in ("gated", "401", "403", "unauthorized")):
                raise ModelAccessError(
                    "Model access failed. Make sure you accepted the Gemma license and ran `hf auth login`."
                ) from exc
            raise ModelAccessError(f"Failed to load model '{self.config.model_id}': {message}") from exc

        self._register_stop_tokens(self._tokenizer)

        return self._model, self._tokenizer

    @staticmethod
    def _register_stop_tokens(tokenizer: Any) -> None:
        add_eos_token = getattr(tokenizer, "add_eos_token", None)
        if callable(add_eos_token):
            add_eos_token("<end_of_turn>")

    @staticmethod
    def _clean_translation_text(text: str) -> str:
        cleaned = text.strip()
        cleaned = TURN_MARKER_PATTERN.sub("", cleaned).strip()

        for marker in TURN_MARKERS:
            marker_index = cleaned.find(marker)
            if marker_index != -1:
                cleaned = cleaned[:marker_index].rstrip()

        return cleaned

    @staticmethod
    def build_messages(task: TranslationTask) -> list[dict[str, Any]]:
        return [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "source_lang_code": task.source_lang_code,
                        "target_lang_code": task.target_lang_code,
                        "text": task.text,
                    }
                ],
            }
        ]

    def build_prompt(self, task: TranslationTask) -> str:
        _, tokenizer = self._ensure_loaded()
        messages = self.build_messages(task)

        if not hasattr(tokenizer, "apply_chat_template"):
            raise ConfigurationError("Loaded tokenizer does not expose apply_chat_template().")

        try:
            prompt = tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        except TypeError:
            prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True)

        if not isinstance(prompt, str) or not prompt.strip():
            raise ConfigurationError("Chat template did not produce a valid prompt string.")

        return prompt

    def _count_text_tokens(self, text: str) -> int:
        _, tokenizer = self._ensure_loaded()
        return len(tokenizer.encode(text, add_special_tokens=False))

    def _count_prompt_tokens_for_text(self, task: TranslationTask, text: str) -> int:
        _, tokenizer = self._ensure_loaded()
        prompt_task = TranslationTask(
            line_number=task.line_number,
            record_id=task.record_id,
            source_lang_code=task.source_lang_code,
            target_lang_code=task.target_lang_code,
            text=text,
            metadata=task.metadata,
        )
        prompt = self.build_prompt(prompt_task)
        token_count = len(tokenizer.encode(prompt, add_special_tokens=False))
        bos_token = str(getattr(tokenizer, "bos_token", "") or "")
        if bos_token and not prompt.startswith(bos_token):
            token_count += 1
        return token_count

    def _fits_chunk_constraints(self, task: TranslationTask, text: str) -> bool:
        if self._count_text_tokens(text) > self.config.chunk_input_tokens:
            return False

        max_prompt_tokens = max(
            self.config.context_window_tokens - self.config.prompt_token_reserve,
            1,
        )
        return self._count_prompt_tokens_for_text(task, text) <= max_prompt_tokens

    def _split_paragraph(self, task: TranslationTask, paragraph: str) -> list[str]:
        normalized = " ".join(paragraph.split())
        if not normalized:
            return []

        if self._fits_chunk_constraints(task, normalized):
            return [normalized]

        sentences = [segment.strip() for segment in SENTENCE_SPLIT_PATTERN.split(normalized) if segment.strip()]
        if len(sentences) > 1:
            chunks: list[str] = []
            current_segments: list[str] = []
            current_text = ""

            for sentence in sentences:
                candidate = sentence if not current_text else f"{current_text} {sentence}"
                if self._fits_chunk_constraints(task, candidate):
                    current_segments.append(sentence)
                    current_text = candidate
                    continue

                if current_segments:
                    chunks.append(" ".join(current_segments))

                if self._fits_chunk_constraints(task, sentence):
                    current_segments = [sentence]
                    current_text = sentence
                    continue

                chunks.extend(self._split_by_words(task, sentence))
                current_segments = []
                current_text = ""

            if current_segments:
                chunks.append(" ".join(current_segments))

            return chunks

        return self._split_by_words(task, normalized)

    def _split_by_words(self, task: TranslationTask, text: str) -> list[str]:
        words = text.split()
        if not words:
            return []

        chunks: list[str] = []
        current_words: list[str] = []
        current_text = ""

        for word in words:
            candidate = word if not current_text else f"{current_text} {word}"
            if self._fits_chunk_constraints(task, candidate):
                current_words.append(word)
                current_text = candidate
                continue

            if current_words:
                chunks.append(" ".join(current_words))

            if self._fits_chunk_constraints(task, word):
                current_words = [word]
                current_text = word
                continue

            token_chunks = self._split_by_token_ids(word, self.config.chunk_input_tokens)
            chunks.extend(token_chunks)
            current_words = []
            current_text = ""

        if current_words:
            chunks.append(" ".join(current_words))

        return chunks

    def _split_by_token_ids(self, text: str, token_budget: int) -> list[str]:
        _, tokenizer = self._ensure_loaded()
        token_ids = tokenizer.encode(text, add_special_tokens=False)
        if not token_ids:
            return []

        chunks: list[str] = []
        for start in range(0, len(token_ids), token_budget):
            chunk_ids = token_ids[start : start + token_budget]
            chunk_text = tokenizer.decode(chunk_ids).strip()
            if chunk_text:
                chunks.append(chunk_text)
        return chunks

    def _build_text_chunks(self, task: TranslationTask) -> list[str]:
        text = task.text
        if self._fits_chunk_constraints(task, text):
            return [text]

        paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n+", text.strip()) if paragraph.strip()]
        if not paragraphs:
            return [text.strip()]

        chunks: list[str] = []
        current_paragraphs: list[str] = []
        current_text = ""

        for paragraph in paragraphs:
            if not self._fits_chunk_constraints(task, paragraph):
                if current_paragraphs:
                    chunks.append("\n\n".join(current_paragraphs))
                    current_paragraphs = []
                    current_text = ""

                chunks.extend(self._split_paragraph(task, paragraph))
                continue

            candidate = paragraph if not current_text else f"{current_text}\n\n{paragraph}"
            if self._fits_chunk_constraints(task, candidate):
                current_paragraphs.append(paragraph)
                current_text = candidate
            else:
                if current_paragraphs:
                    chunks.append("\n\n".join(current_paragraphs))
                current_paragraphs = [paragraph]
                current_text = paragraph

        if current_paragraphs:
            chunks.append("\n\n".join(current_paragraphs))

        return chunks

    def _generate_translation(
        self,
        prompt: str,
        source_text: str,
        retry_policy: RetryPolicy,
        record_id: str,
    ) -> tuple[str, int]:
        model, tokenizer = self._ensure_loaded()

        try:
            from mlx_lm import generate
        except ImportError as exc:
            raise ConfigurationError(
                "mlx-lm is not installed. Run `uv sync` before starting the service."
            ) from exc

        source_tokens = len(tokenizer.encode(source_text, add_special_tokens=False))
        generation_max_tokens = min(
            self.config.max_tokens,
            max(256, int(source_tokens * 1.5)),
        )

        def _run_generation() -> str:
            return generate(
                model,
                tokenizer,
                prompt=prompt,
                max_tokens=generation_max_tokens,
                verbose=False,
            ).strip()

        return retry_call(
            _run_generation,
            policy=retry_policy,
            is_retryable=is_retryable_inference_error,
            on_retry=lambda attempt, exc, delay: logger.warning(
                "Retrying {} after attempt {} failed: {}. Sleeping {:.1f}s.",
                record_id,
                attempt,
                exc,
                delay,
            ),
        )

    def translate(self, task: TranslationTask, retry_policy: RetryPolicy) -> TranslationResult:
        started_at = perf_counter()
        text_chunks = self._build_text_chunks(task)
        translations: list[str] = []
        total_attempts = 0
        total_prompt_characters = 0

        if len(text_chunks) > 1:
            logger.info(
                "Split {} into {} translation chunks (source_budget={} prompt_budget={}).",
                task.record_id,
                len(text_chunks),
                self.config.chunk_input_tokens,
                self.config.context_window_tokens - self.config.prompt_token_reserve,
            )

        try:
            for chunk_index, chunk_text in enumerate(text_chunks, start=1):
                chunk_task = TranslationTask(
                    line_number=task.line_number,
                    record_id=f"{task.record_id}#chunk-{chunk_index}",
                    source_lang_code=task.source_lang_code,
                    target_lang_code=task.target_lang_code,
                    text=chunk_text,
                    metadata=task.metadata,
                )
                prompt = self.build_prompt(chunk_task)
                translation, attempts = self._generate_translation(
                    prompt,
                    chunk_text,
                    retry_policy=retry_policy,
                    record_id=chunk_task.record_id,
                )
                cleaned = self._clean_translation_text(translation)
                if not cleaned:
                    raise ValueError("Model returned an empty translation.")

                translations.append(cleaned)
                total_attempts += attempts
                total_prompt_characters += len(prompt)
        except RetryExhaustedError:
            raise

        elapsed_seconds = perf_counter() - started_at
        translation = "\n\n".join(translations).strip()
        if not translation:
            raise ValueError("Model returned an empty translation.")

        return TranslationResult(
            task=task,
            translation=translation,
            elapsed_seconds=elapsed_seconds,
            attempts=total_attempts,
            model_id=self._resolved_model_id,
            prompt_characters=total_prompt_characters,
            chunk_count=len(text_chunks),
        )
