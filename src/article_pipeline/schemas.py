from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, TypedDict

from pydantic import BaseModel, ConfigDict, Field, field_validator
from local_translategemma import DEFAULT_MODEL_ID


class ArticleState(TypedDict, total=False):
    article_id: str
    source_path: str
    output_path: str
    title: str
    subtitle: str
    url: str
    raw_article: str
    refined_title: str
    refined_article: str
    subtitle_ko: str
    paragraphs_en: list[str]
    summary_en: list[str]
    discussion_topics: list[str]
    c1_vocab: list[dict[str, str]]
    atypical_terms: list[dict[str, str]]
    title_ko: str
    paragraphs_ko: list[str]
    summary_ko: list[str]
    translation_meta: dict[str, Any]
    image_prompt: str
    image_url: Optional[str]
    image_path: Optional[str]
    errors: list[dict[str, Any]]
    execution: dict[str, Any]


@dataclass(slots=True)
class PipelineConfig:
    backend: str = "gemma4"
    model: str = "google/gemma-4-E4B-it"
    image_model: str = "gemini-3.1-flash-image-preview"
    image_size: str = "1536x1024"
    max_workers: int = 4
    max_retries: int = 3
    retry_base_delay: float = 1.5
    retry_jitter: float = 0.35
    progress_enabled: bool = True
    generate_image: bool = True
    log_level: str = "INFO"
    input_path: Path = Path("input")
    output_dir: Path = Path("output")


@dataclass(slots=True)
class TranslationConfig:
    source_lang_code: str = "en"
    target_lang_code: str = "ko"
    model_id: str = DEFAULT_MODEL_ID
    retry_attempts: int = 3
    retry_initial_backoff_seconds: float = 1.0
    retry_multiplier: float = 2.0
    retry_max_backoff_seconds: float = 8.0
    max_tokens: int = 3072
    chunk_input_tokens: int = 1536
    context_window_tokens: int = 2048
    prompt_token_reserve: int = 32
    trust_remote_code: bool = False
    offline: bool = False
    warmup: bool = True


@dataclass(slots=True)
class ErrorRecord:
    stage: str
    category: str
    message: str
    retryable: bool
    attempt: int
    traceback: Optional[str] = None


@dataclass(slots=True)
class StageOutcome:
    stage: str
    success: bool
    updates: dict[str, Any]
    duration_seconds: float
    attempts: int
    error: Optional[ErrorRecord] = None
    skipped: bool = False


@dataclass(slots=True)
class ArticleInput:
    article_id: str
    source_path: Path
    title: str
    url: str
    raw_article: str
    subtitle: str = ""


class OutputValidationError(ValueError):
    pass


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class InputArticlePayload(StrictModel):
    title: str = Field(min_length=1)
    subtitle: str = ""
    url: str = Field(min_length=1)
    raw_article: str = Field(min_length=1)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("url must start with http:// or https://")
        return value


class RefinedArticleOutput(StrictModel):
    refined_title: str = Field(min_length=1)
    refined_article: str = Field(min_length=1)


class SummaryOutput(StrictModel):
    summary_en: list[str] = Field(min_length=3, max_length=3)

    @field_validator("summary_en")
    @classmethod
    def validate_summary(cls, value: list[str]) -> list[str]:
        if len(value) != 3:
            raise ValueError(f"summary must contain exactly 3 bullets, got {len(value)}")
        if any(not item.strip() for item in value):
            raise ValueError("summary_en must not contain empty bullets")
        return value


class DiscussionTopicsOutput(StrictModel):
    discussion_topics: list[str] = Field(min_length=8, max_length=8)

    @field_validator("discussion_topics")
    @classmethod
    def validate_prompts(cls, value: list[str]) -> list[str]:
        if len(value) != 8:
            raise ValueError(f"discussion_topics must contain exactly 8 prompts, got {len(value)}")
        cleaned = [item.strip() for item in value]
        if any(not item for item in cleaned):
            raise ValueError("discussion_topics must not contain empty prompts")
        if any(not item.endswith("?") for item in cleaned):
            raise ValueError("each discussion topic must be written as a question ending with '?'")
        if any(any("\uac00" <= char <= "\ud7a3" for char in item) for item in cleaned):
            raise ValueError("discussion_topics must be written in English, not Korean")
        if not any(
            any(keyword in item.lower() for keyword in ("korea", "korean", "south korea", "seoul"))
            for item in cleaned
        ):
            raise ValueError("discussion_topics must include at least one Korea-localized prompt")
        if not any(
            any(
                keyword in item.lower()
                for keyword in (
                    "counterargument",
                    "opposing",
                    "opposite",
                    "disagree",
                    "critics",
                    "downside",
                    "criticism",
                )
            )
            for item in cleaned
        ):
            raise ValueError("discussion_topics must include at least one counterargument or opposing-view prompt")
        if not any(
            any(
                keyword in item.lower() for keyword in ("policy", "government", "regulate", "should", "action")
            )
            for item in cleaned
        ):
            raise ValueError("discussion_topics must include at least one action or policy prompt")
        return cleaned


class C1VocabItem(StrictModel):
    term: str = Field(min_length=1)
    meaning_en: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    example_from_article: str = Field(min_length=1)


class C1VocabOutput(StrictModel):
    c1_vocab: list[C1VocabItem] = Field(min_length=5, max_length=12)


class AtypicalTermItem(StrictModel):
    term: str = Field(min_length=1)
    category: str = Field(min_length=1)
    explanation_en: str = Field(min_length=1)


class AtypicalTermsOutput(StrictModel):
    atypical_terms: list[AtypicalTermItem] = Field(min_length=1)


class TranslationStageOutput(StrictModel):
    title_ko: str = Field(min_length=1)
    subtitle_ko: str = ""
    paragraphs_ko: list[str] = Field(min_length=1)
    summary_ko: list[str] = Field(min_length=1)
    translation_meta: dict[str, Any]


class ImagePromptOutput(StrictModel):
    image_prompt: str = Field(min_length=1)


class GeneratedImageOutput(StrictModel):
    image_url: Optional[str] = None
    image_path: Optional[str] = None
