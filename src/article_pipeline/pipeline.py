from __future__ import annotations

import concurrent.futures as futures
import json
import random
import re
import time
import traceback
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from loguru import logger
from openai import (
    APIConnectionError,
    APIError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    PermissionDeniedError,
    RateLimitError,
)
from pydantic import ValidationError

from local_translategemma.errors import ConfigurationError as TranslateGemmaConfigurationError
from local_translategemma.errors import ModelAccessError
from local_translategemma.retry import RetryExhaustedError

from .io import iso_timestamp
from .logging_utils import PipelineProgress
from .openai_backend import ArticleBackend
from .schemas import (
    ArticleInput,
    ArticleState,
    C1VocabOutput,
    DiscussionTopicsOutput,
    ErrorRecord,
    GeneratedImageOutput,
    ImagePromptOutput,
    OutputValidationError,
    PipelineConfig,
    RefinedArticleOutput,
    StageOutcome,
    SummaryOutput,
    TranslationStageOutput,
    AtypicalTermsOutput,
)
from .translator import TranslateGemmaTranslator


TOKEN_PATTERN = re.compile(r"[A-Za-z]+")


def _trim_final_double_consonant(stem: str) -> str:
    if len(stem) >= 2 and stem[-1] == stem[-2] and stem[-1] not in "aeiou":
        return stem[:-1]
    return stem


def _normalize_c1_token(token: str) -> str:
    lower = token.lower()

    if len(lower) <= 3:
        return lower

    if lower.endswith("ies") and len(lower) > 4:
        return lower[:-3] + "y"

    if lower.endswith("ing") and len(lower) > 5:
        return _trim_final_double_consonant(lower[:-3])

    if lower.endswith("ed") and len(lower) > 4:
        stem = lower[:-2]
        if stem.endswith("i") and len(stem) > 2:
            return stem[:-1] + "y"
        return _trim_final_double_consonant(stem)

    return lower


def _normalize_c1_term(term: str) -> str:
    def normalize_match(match: re.Match[str]) -> str:
        return _normalize_c1_token(match.group(0))

    normalized = TOKEN_PATTERN.sub(normalize_match, term.strip())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    phrasal_match = re.fullmatch(r"([a-z]+) (off|out|up|down|in|on|over|away|back)", normalized)
    if phrasal_match:
        return f"{phrasal_match.group(1)}-{phrasal_match.group(2)}"
    return normalized


class CriticalPathState(TypedDict, total=False):
    article_id: str
    title: str
    subtitle: str
    url: str
    raw_article: str
    refined_title: str
    refined_article: str
    paragraphs_en: list[str]
    summary_en: list[str]
    raw_summary_response: dict[str, Any]
    summary_validation_feedback: str | None
    summary_retry_count: int
    summary_total_duration: float
    summary_request_count: int
    refine_outcome: StageOutcome
    summary_outcome: StageOutcome
    failed_stage: str | None
    next_step: Literal["summarize_request", "done", "failed"]


class ArticlePipeline:
    CRITICAL_STAGES = (
        "refine_article",
        "summarize_article",
    )
    PARALLEL_STAGES = (
        "extract_discussion_topics",
        "extract_c1_vocab",
        "extract_atypical_terms",
        "translate_to_korean",
        "build_image_prompt",
    )
    IMAGE_STAGE = "generate_image"
    TOTAL_STAGES = len(CRITICAL_STAGES) + len(PARALLEL_STAGES) + 1

    def __init__(
        self,
        backend: ArticleBackend,
        translator: TranslateGemmaTranslator,
        config: PipelineConfig,
        log_file: Path,
    ) -> None:
        self.backend = backend
        self.translator = translator
        self.config = config
        self.log_file = log_file
        self.critical_graph = self._build_critical_graph()

    def run(
        self,
        article: ArticleInput,
        output_path: Path,
        image_output_path: Path,
        progress: PipelineProgress,
    ) -> ArticleState:
        state: ArticleState = {
            "article_id": article.article_id,
            "source_path": str(article.source_path),
            "output_path": str(output_path),
            "title": article.title,
            "subtitle": article.subtitle,
            "url": article.url,
            "raw_article": article.raw_article,
            "errors": [],
            "execution": {
                "backend": self.backend.name,
                "translator_model": self.translator.config.model_id,
                "started_at": iso_timestamp(),
                "stage_timings": {},
                "stage_status": {},
                "log_file": str(self.log_file),
            },
        }

        logger.info("Starting article pipeline for '{}'", article.article_id)

        if not self._run_critical_path(state, progress):
            self._skip_downstream_after_critical_failure(state, progress)
            return self._finalize(state)

        with futures.ThreadPoolExecutor(
            max_workers=max(1, min(self.config.max_workers, len(self.PARALLEL_STAGES))),
            thread_name_prefix="article-stage",
        ) as executor:
            parallel_plan = {
                "extract_discussion_topics": lambda: self._validate_discussion_topics(
                    self.backend.extract_discussion_topics(state["refined_title"], state["summary_en"])
                ),
                "extract_c1_vocab": lambda: self._validate_c1_vocab(
                    self.backend.extract_c1_vocab(state["refined_title"], state["paragraphs_en"])
                ),
                "extract_atypical_terms": lambda: self._validate_atypical_terms(
                    self.backend.extract_atypical_terms(state["refined_title"], state["paragraphs_en"])
                ),
                "translate_to_korean": lambda: self._validate_translation(
                    self.translator.translate_article(
                        article_id=article.article_id,
                        title=state["refined_title"],
                        subtitle=state["subtitle"],
                        paragraphs=state["paragraphs_en"],
                        summary=state["summary_en"],
                    ),
                    state["paragraphs_en"],
                    state["summary_en"],
                ),
                "build_image_prompt": lambda: self._validate_image_prompt(
                    self.backend.build_image_prompt(state["refined_title"], state["summary_en"])
                ),
            }

            future_map = {
                executor.submit(self._execute_stage, article.article_id, stage_name, operation): stage_name
                for stage_name, operation in parallel_plan.items()
            }
            for future in futures.as_completed(future_map):
                outcome = future.result()
                self._apply_outcome(state, progress, outcome)

            if self.config.generate_image and state.get("image_prompt"):
                outcome = self._execute_stage(
                    article.article_id,
                    self.IMAGE_STAGE,
                    lambda: self._validate_generated_image(
                        self.backend.generate_image(state["image_prompt"], image_output_path)
                    ),
                )
            else:
                reason = "image generation disabled" if not self.config.generate_image else "image_prompt unavailable"
                outcome = self._skip_stage(self.IMAGE_STAGE, reason)

            self._apply_outcome(state, progress, outcome)

        return self._finalize(state)

    def _build_critical_graph(self):
        builder = StateGraph(CriticalPathState)
        builder.add_node("refine_article", self._refine_article_node)
        builder.add_node("summarize_request", self._summarize_request_node)
        builder.add_node("validate_summary", self._validate_summary_node)

        builder.add_edge(START, "refine_article")
        builder.add_conditional_edges(
            "refine_article",
            self._route_after_refine,
            {
                "summarize_request": "summarize_request",
                "failed": END,
            },
        )
        builder.add_edge("summarize_request", "validate_summary")
        builder.add_conditional_edges(
            "validate_summary",
            self._route_after_summary_validation,
            {
                "summarize_request": "summarize_request",
                "done": END,
                "failed": END,
            },
        )
        return builder.compile()

    def _run_critical_path(self, state: ArticleState, progress: PipelineProgress) -> bool:
        graph_state = self.critical_graph.invoke(
            {
                "article_id": state["article_id"],
                "title": state["title"],
                "subtitle": state["subtitle"],
                "url": state["url"],
                "raw_article": state["raw_article"],
                "paragraphs_en": [paragraph.strip() for paragraph in state["raw_article"].split("\n\n") if paragraph.strip()],
                "summary_retry_count": 0,
                "summary_total_duration": 0.0,
                "summary_request_count": 0,
                "summary_validation_feedback": None,
                "failed_stage": None,
                "next_step": "summarize_request",
            }
        )

        for stage_name, outcome_key in (
            ("refine_article", "refine_outcome"),
            ("summarize_article", "summary_outcome"),
        ):
            outcome = graph_state.get(outcome_key)
            if outcome is None:
                continue
            self._apply_outcome(state, progress, outcome)
            if not outcome.success:
                logger.error("Stopping pipeline after critical stage '{}' failed for '{}'", stage_name, state["article_id"])
                return False

        for field_name in ("refined_title", "refined_article", "paragraphs_en", "summary_en"):
            if field_name in graph_state:
                state[field_name] = graph_state[field_name]

        return True

    def _refine_article_node(self, graph_state: CriticalPathState) -> CriticalPathState:
        outcome = self._execute_stage(
            graph_state["article_id"],
            "refine_article",
            lambda: self._validate_refine_article(
                self.backend.refine_article(
                    graph_state["title"],
                    graph_state["url"],
                    graph_state["raw_article"],
                )
            ),
        )
        updates: CriticalPathState = {"refine_outcome": outcome}
        if outcome.success:
            updates.update(outcome.updates)
            updates["failed_stage"] = None
        else:
            updates["failed_stage"] = "refine_article"
        return updates

    def _route_after_refine(self, graph_state: CriticalPathState) -> str:
        return "failed" if graph_state.get("failed_stage") else "summarize_request"

    def _summarize_request_node(self, graph_state: CriticalPathState) -> CriticalPathState:
        outcome = self._execute_stage(
            graph_state["article_id"],
            "summarize_article",
            lambda: self.backend.summarize_article(
                graph_state["refined_title"],
                graph_state["paragraphs_en"],
                validation_feedback=graph_state.get("summary_validation_feedback"),
            ),
        )

        if outcome.success:
            return {
                "raw_summary_response": outcome.updates,
                "summary_total_duration": graph_state.get("summary_total_duration", 0.0) + outcome.duration_seconds,
                "summary_request_count": graph_state.get("summary_request_count", 0) + outcome.attempts,
                "failed_stage": None,
            }

        failed_outcome = StageOutcome(
            stage="summarize_article",
            success=False,
            updates={},
            duration_seconds=graph_state.get("summary_total_duration", 0.0) + outcome.duration_seconds,
            attempts=graph_state.get("summary_request_count", 0) + outcome.attempts,
            error=outcome.error,
        )
        return {
            "summary_outcome": failed_outcome,
            "failed_stage": "summarize_article",
            "next_step": "failed",
        }

    def _validate_summary_node(self, graph_state: CriticalPathState) -> CriticalPathState:
        try:
            parsed = SummaryOutput.model_validate(graph_state["raw_summary_response"])
        except ValidationError as exc:
            feedback = self._validation_feedback(exc)
            retry_count = graph_state.get("summary_retry_count", 0)
            logger.warning(
                "Validation failed for '{}:summarize_article' attempt {}: {}",
                graph_state["article_id"],
                retry_count + 1,
                feedback,
            )
            if retry_count < self.config.max_retries:
                return {
                    "summary_retry_count": retry_count + 1,
                    "summary_validation_feedback": feedback,
                    "next_step": "summarize_request",
                    "failed_stage": None,
                }

            failure = StageOutcome(
                stage="summarize_article",
                success=False,
                updates={},
                duration_seconds=graph_state.get("summary_total_duration", 0.0),
                attempts=graph_state.get("summary_request_count", 0),
                error=ErrorRecord(
                    stage="summarize_article",
                    category="output_validation",
                    message=feedback,
                    retryable=False,
                    attempt=retry_count + 1,
                ),
            )
            return {
                "summary_outcome": failure,
                "failed_stage": "summarize_article",
                "next_step": "failed",
            }

        success = StageOutcome(
            stage="summarize_article",
            success=True,
            updates={"summary_en": parsed.summary_en},
            duration_seconds=graph_state.get("summary_total_duration", 0.0),
            attempts=graph_state.get("summary_request_count", 0),
        )
        return {
            "summary_en": parsed.summary_en,
            "summary_outcome": success,
            "summary_validation_feedback": None,
            "next_step": "done",
            "failed_stage": None,
        }

    def _route_after_summary_validation(self, graph_state: CriticalPathState) -> str:
        return graph_state.get("next_step", "failed")

    def _skip_downstream_after_critical_failure(self, state: ArticleState, progress: PipelineProgress) -> None:
        for stage_name in [*self.PARALLEL_STAGES, self.IMAGE_STAGE]:
            self._apply_outcome(state, progress, self._skip_stage(stage_name, "upstream critical stage failed"))

    def _execute_stage(
        self,
        article_id: str,
        stage_name: str,
        operation: Callable[[], dict[str, Any]],
    ) -> StageOutcome:
        stage_start = time.monotonic()
        for attempt in range(1, self.config.max_retries + 2):
            logger.info("Stage '{}:{}' attempt {}/{}", article_id, stage_name, attempt, self.config.max_retries + 1)
            try:
                updates = operation()
                duration = time.monotonic() - stage_start
                logger.info("Stage '{}:{}' completed in {:.2f}s", article_id, stage_name, duration)
                return StageOutcome(
                    stage=stage_name,
                    success=True,
                    updates=updates,
                    duration_seconds=duration,
                    attempts=attempt,
                )
            except Exception as exc:
                error = self._triage_error(stage_name, exc, attempt)
                if attempt > self.config.max_retries or not error.retryable:
                    duration = time.monotonic() - stage_start
                    logger.error(
                        "Stage '{}:{}' failed after {} attempt(s): [{}] {}",
                        article_id,
                        stage_name,
                        attempt,
                        error.category,
                        error.message,
                    )
                    return StageOutcome(
                        stage=stage_name,
                        success=False,
                        updates={},
                        duration_seconds=duration,
                        attempts=attempt,
                        error=error,
                    )

                delay = self._retry_delay(attempt)
                logger.warning(
                    "Stage '{}:{}' hit retryable '{}' on attempt {}. Retrying in {:.2f}s",
                    article_id,
                    stage_name,
                    error.category,
                    attempt,
                    delay,
                )
                time.sleep(delay)

        raise RuntimeError(f"Unreachable retry loop for stage '{stage_name}'")

    def _apply_outcome(self, state: ArticleState, progress: PipelineProgress, outcome: StageOutcome) -> None:
        execution = state["execution"]
        execution["stage_timings"][outcome.stage] = round(outcome.duration_seconds, 3)

        if outcome.success:
            state.update(outcome.updates)
            execution["stage_status"][outcome.stage] = "success"
            progress.advance(state["article_id"], outcome.stage, "ok")
            return

        if outcome.skipped:
            execution["stage_status"][outcome.stage] = "skipped"
            progress.advance(state["article_id"], outcome.stage, "skipped")
            logger.warning("Stage '{}:{}' skipped: {}", state["article_id"], outcome.stage, outcome.error.message)
            return

        execution["stage_status"][outcome.stage] = "failed"
        state["errors"].append(asdict(outcome.error) if outcome.error else {"stage": outcome.stage})
        progress.advance(state["article_id"], outcome.stage, "failed")

    def _skip_stage(self, stage_name: str, reason: str) -> StageOutcome:
        return StageOutcome(
            stage=stage_name,
            success=False,
            updates={},
            duration_seconds=0.0,
            attempts=0,
            error=ErrorRecord(
                stage=stage_name,
                category="skipped",
                message=reason,
                retryable=False,
                attempt=0,
            ),
            skipped=True,
        )

    def _triage_error(self, stage_name: str, exc: Exception, attempt: int) -> ErrorRecord:
        category = "unexpected"
        retryable = True

        if isinstance(exc, RateLimitError):
            message = str(exc).lower()
            if "insufficient_quota" in message or "exceeded your current quota" in message:
                category = "quota_exceeded"
                retryable = False
            else:
                category = "transient_api"
        elif isinstance(exc, (APIConnectionError, APITimeoutError)):
            category = "transient_api"
        elif isinstance(exc, AuthenticationError):
            category = "authentication"
            retryable = False
        elif isinstance(exc, PermissionDeniedError):
            category = "permission_denied"
            retryable = False
        elif isinstance(exc, BadRequestError):
            category = "bad_request"
            retryable = False
        elif isinstance(exc, APIStatusError):
            category = "api_status_error"
            retryable = getattr(exc, "status_code", None) in {408, 409}
        elif isinstance(exc, APIError):
            category = "api_error"
        elif isinstance(exc, RetryExhaustedError):
            category = "translation_retry_exhausted"
            retryable = False
        elif isinstance(exc, (TranslateGemmaConfigurationError, ModelAccessError)):
            category = "translation_configuration"
            retryable = False
        elif isinstance(exc, ValidationError):
            category = "output_validation"
            retryable = False
        elif isinstance(exc, (json.JSONDecodeError, KeyError, TypeError)):
            category = "response_parsing"
        elif isinstance(exc, OutputValidationError):
            category = "output_validation"
            retryable = False
        elif isinstance(exc, ValueError):
            category = "value_error"
            retryable = False

        stack_trace = None
        if category == "unexpected":
            logger.exception("Unexpected error in stage '{}'", stage_name)
            stack_trace = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))

        return ErrorRecord(
            stage=stage_name,
            category=category,
            message=str(exc),
            retryable=retryable,
            attempt=attempt,
            traceback=stack_trace,
        )

    def _retry_delay(self, attempt: int) -> float:
        backoff = self.config.retry_base_delay ** max(0, attempt - 1)
        jitter = random.uniform(0.0, self.config.retry_jitter)
        return backoff + jitter

    def _validation_feedback(self, exc: ValidationError) -> str:
        return "; ".join(error["msg"] for error in exc.errors())

    def _validate_refine_article(self, data: dict[str, Any]) -> dict[str, Any]:
        return RefinedArticleOutput.model_validate(data).model_dump()

    def _validate_c1_vocab(self, data: dict[str, Any]) -> dict[str, Any]:
        validated = C1VocabOutput.model_validate(data)
        normalized_items = []
        for item in validated.c1_vocab:
            payload = item.model_dump()
            payload["term"] = _normalize_c1_term(payload["term"])
            normalized_items.append(payload)
        return {"c1_vocab": normalized_items}

    def _validate_discussion_topics(self, data: dict[str, Any]) -> dict[str, Any]:
        validated = DiscussionTopicsOutput.model_validate(data)
        return {"discussion_topics": validated.discussion_topics}

    def _validate_atypical_terms(self, data: dict[str, Any]) -> dict[str, Any]:
        validated = AtypicalTermsOutput.model_validate(data)
        return {"atypical_terms": [item.model_dump() for item in validated.atypical_terms]}

    def _validate_translation(
        self,
        data: dict[str, Any],
        paragraphs_en: list[str],
        summary_en: list[str],
    ) -> dict[str, Any]:
        validated = TranslationStageOutput.model_validate(data)
        if len(validated.paragraphs_ko) != len(paragraphs_en):
            raise OutputValidationError("Korean paragraph count does not match the English paragraph count")
        if len(validated.summary_ko) != len(summary_en):
            raise OutputValidationError("Korean summary count does not match the English summary count")
        return validated.model_dump()

    def _validate_image_prompt(self, data: dict[str, Any]) -> dict[str, Any]:
        return ImagePromptOutput.model_validate(data).model_dump()

    def _validate_generated_image(self, data: dict[str, Any]) -> dict[str, Any]:
        return GeneratedImageOutput.model_validate(data).model_dump()

    def _finalize(self, state: ArticleState) -> ArticleState:
        finished_at = iso_timestamp()
        started = datetime.fromisoformat(state["execution"]["started_at"])
        finished = datetime.fromisoformat(finished_at)
        state["execution"]["completed_at"] = finished_at
        state["execution"]["duration_seconds"] = round((finished - started).total_seconds(), 3)
        state["execution"]["error_count"] = len(state["errors"])
        return state
