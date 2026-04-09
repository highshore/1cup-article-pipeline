from __future__ import annotations

from time import perf_counter

from tqdm import tqdm


def format_duration(seconds: float | None) -> str:
    if seconds is None:
        return "--:--"

    total_seconds = max(int(seconds), 0)
    minutes, seconds_remainder = divmod(total_seconds, 60)
    hours, minutes_remainder = divmod(minutes, 60)

    if hours:
        return f"{hours:d}:{minutes_remainder:02d}:{seconds_remainder:02d}"

    return f"{minutes_remainder:02d}:{seconds_remainder:02d}"


class BatchProgress:
    def __init__(self, total: int) -> None:
        self.total = total
        self.started_at = perf_counter()
        self.bar = tqdm(
            total=total,
            desc="translate",
            leave=True,
            dynamic_ncols=True,
        )

    def update(self, succeeded: int, failed: int) -> None:
        self.bar.update(1)
        completed = self.bar.n
        elapsed = perf_counter() - self.started_at
        average_seconds = (elapsed / completed) if completed else None
        remaining = (self.total - completed) if self.total else 0
        eta_seconds = average_seconds * remaining if average_seconds is not None else None
        self.bar.set_postfix_str(
            f"ok={succeeded} fail={failed} eta={format_duration(eta_seconds)}",
            refresh=False,
        )

    def close(self) -> None:
        self.bar.close()

