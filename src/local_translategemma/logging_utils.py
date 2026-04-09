from __future__ import annotations

from loguru import logger
from tqdm import tqdm


class TqdmSink:
    def write(self, message: str) -> None:
        text = message.rstrip()
        if text:
            tqdm.write(text)

    def flush(self) -> None:
        return None


def configure_logging(verbose: bool) -> None:
    logger.remove()
    logger.add(
        TqdmSink(),
        level="DEBUG" if verbose else "INFO",
        colorize=False,
        format="{time:YYYY-MM-DD HH:mm:ss} | {level:<8} | {message}",
    )

