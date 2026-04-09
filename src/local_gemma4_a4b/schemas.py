from __future__ import annotations

from dataclasses import dataclass
from typing import Any

DEFAULT_MODEL_ID = "mlx-community/gemma-4-26b-a4b-it-4bit"


@dataclass(slots=True)
class ModelConfig:
    model_id: str = DEFAULT_MODEL_ID
    max_tokens: int = 4096
    temperature: float = 1.0
    top_p: float = 0.95
    top_k: int = 64
    offline: bool = False
    retry_attempts: int = 3
    retry_initial_backoff_seconds: float = 1.0
    retry_multiplier: float = 2.0
    retry_max_backoff_seconds: float = 8.0


@dataclass(slots=True)
class InferenceResult:
    text: str
    model_id: str
    elapsed_seconds: float
    prompt_tokens: int
    generation_tokens: int
