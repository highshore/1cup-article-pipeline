from __future__ import annotations

import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import BrowserContext, Error, sync_playwright


@contextmanager
def open_browser_context(
    *,
    extension_dir: Path,
    profile_dir: Path,
    headless: bool,
    executable_path: str | None,
    timeout_ms: int,
) -> Iterator[BrowserContext]:
    extension_dir = extension_dir.resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)
    temp_profile = tempfile.TemporaryDirectory(dir=profile_dir, prefix="session-")
    user_data_dir = Path(temp_profile.name)

    launch_args = [
        f"--disable-extensions-except={extension_dir}",
        f"--load-extension={extension_dir}",
        "--disable-blink-features=AutomationControlled",
        "--start-maximized",
    ]

    with sync_playwright() as playwright:
        attempts: list[dict[str, object]] = []
        if executable_path:
            attempts.append({"executable_path": executable_path})
        else:
            attempts.append({"channel": "chromium"})
            attempts.append({})

        last_error: Exception | None = None
        for attempt in attempts:
            try:
                context = playwright.chromium.launch_persistent_context(
                    user_data_dir=str(user_data_dir),
                    headless=headless,
                    args=launch_args,
                    ignore_default_args=["--disable-extensions"],
                    no_viewport=True,
                    **attempt,
                )
                context.set_default_timeout(timeout_ms)
                _ensure_extension_loaded(context, timeout_ms=timeout_ms)
                try:
                    yield context
                finally:
                    context.close()
                    temp_profile.cleanup()
                return
            except Error as exc:
                last_error = exc
        temp_profile.cleanup()

        raise RuntimeError(
            "Failed to launch Chromium with the bypass extension. "
            "Playwright does not support side-loading extensions into Google Chrome or Microsoft Edge anymore."
        ) from last_error


def _ensure_extension_loaded(context: BrowserContext, *, timeout_ms: int) -> None:
    if context.service_workers:
        return

    try:
        context.wait_for_event("serviceworker", timeout=timeout_ms)
    except Error as exc:
        raise RuntimeError(
            "Browser launched, but the bypass extension did not load. "
            "Use Playwright's Chromium build instead of Google Chrome."
        ) from exc
