from __future__ import annotations

from dataclasses import dataclass
from time import sleep
from typing import Callable, TypeVar

T = TypeVar("T")


@dataclass(slots=True)
class RetryPolicy:
    attempts: int = 3
    initial_backoff_seconds: float = 1.0
    multiplier: float = 2.0
    max_backoff_seconds: float = 8.0


class RetryExhaustedError(Exception):
    def __init__(self, attempts: int, last_exception: Exception) -> None:
        super().__init__(str(last_exception))
        self.attempts = attempts
        self.last_exception = last_exception


def retry_call(
    operation: Callable[[], T],
    *,
    policy: RetryPolicy,
    is_retryable: Callable[[Exception], bool],
    on_retry: Callable[[int, Exception, float], None] | None = None,
) -> tuple[T, int]:
    backoff_seconds = policy.initial_backoff_seconds

    for attempt in range(1, policy.attempts + 1):
        try:
            return operation(), attempt
        except Exception as exc:
            if attempt >= policy.attempts or not is_retryable(exc):
                raise RetryExhaustedError(attempts=attempt, last_exception=exc) from exc

            if on_retry is not None:
                on_retry(attempt, exc, backoff_seconds)

            sleep(backoff_seconds)
            backoff_seconds = min(backoff_seconds * policy.multiplier, policy.max_backoff_seconds)

    raise RuntimeError("Retry loop reached an impossible state.")
