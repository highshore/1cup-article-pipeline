from __future__ import annotations

from time import perf_counter
from typing import Any

from loguru import logger

from .errors import ConfigurationError, ModelAccessError
from .model_locator import resolve_model_reference
from .retry import RetryExhaustedError, RetryPolicy, retry_call
from .schemas import InferenceResult, ModelConfig


def _is_retryable_error(exc: Exception) -> bool:
    retryable_types = (TimeoutError, ConnectionError, BrokenPipeError, InterruptedError, OSError)
    if isinstance(exc, retryable_types):
        return True
    message = str(exc).lower()
    return any(m in message for m in ("timed out", "temporarily unavailable", "connection reset"))


class Gemma4Service:
    def __init__(self, config: ModelConfig) -> None:
        self.config = config
        self._model = None
        self._processor = None
        self._resolved_model_id = config.model_id

    def warmup(self) -> None:
        self._ensure_loaded()

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return

        try:
            from mlx_vlm import load
        except ImportError as exc:
            raise ConfigurationError(
                "mlx-vlm is not installed. Run `uv sync` before starting the service."
            ) from exc

        resolved = resolve_model_reference(self.config.model_id, offline=self.config.offline)
        try:
            logger.info(
                "Loading Gemma 4 model {} [{} -> {}]",
                resolved.resolved,
                resolved.requested,
                resolved.source,
            )
            self._model, self._processor = load(resolved.resolved)
            self._resolved_model_id = resolved.requested
        except Exception as exc:
            message = str(exc)
            if any(m in message.lower() for m in ("gated", "401", "403", "unauthorized")):
                raise ModelAccessError(
                    "Model access failed. Accept the Gemma license on HuggingFace and run `hf auth login`."
                ) from exc
            raise ModelAccessError(f"Failed to load model '{self.config.model_id}': {message}") from exc

        logger.info("Gemma 4 model loaded.")

    def generate(self, messages: list[dict[str, Any]]) -> InferenceResult:
        self._ensure_loaded()

        try:
            from mlx_vlm import generate
            from mlx_vlm.prompt_utils import apply_chat_template
        except ImportError as exc:
            raise ConfigurationError(
                "mlx-vlm is not installed. Run `uv sync` before starting the service."
            ) from exc

        prompt = apply_chat_template(self._processor, self._model.config, messages)

        retry_policy = RetryPolicy(
            attempts=self.config.retry_attempts,
            initial_backoff_seconds=self.config.retry_initial_backoff_seconds,
            multiplier=self.config.retry_multiplier,
            max_backoff_seconds=self.config.retry_max_backoff_seconds,
        )

        def _run() -> Any:
            return generate(
                model=self._model,
                processor=self._processor,
                prompt=prompt,
                max_tokens=self.config.max_tokens,
                temperature=self.config.temperature,
                top_p=self.config.top_p,
                top_k=self.config.top_k,
                verbose=False,
            )

        started_at = perf_counter()
        mlx_result, _ = retry_call(
            _run,
            policy=retry_policy,
            is_retryable=_is_retryable_error,
            on_retry=lambda attempt, exc, delay: logger.warning(
                "Retrying generation after attempt {} failed: {}. Sleeping {:.1f}s.",
                attempt,
                exc,
                delay,
            ),
        )
        elapsed = perf_counter() - started_at

        return InferenceResult(
            text=mlx_result.text,
            model_id=self._resolved_model_id,
            elapsed_seconds=elapsed,
            prompt_tokens=mlx_result.prompt_tokens,
            generation_tokens=mlx_result.generation_tokens,
        )
