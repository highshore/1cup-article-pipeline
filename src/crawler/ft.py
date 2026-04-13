from __future__ import annotations

import re

from loguru import logger
from playwright.sync_api import Error as PlaywrightError

from .base import BaseSiteCrawler
from .schemas import Section


class FinancialTimesCrawler(BaseSiteCrawler):
    source_name = "ft"
    base_url = "https://www.ft.com"
    allowed_hosts = ("ft.com",)
    title_suffixes = ("Financial Times",)
    sections = (
        Section(name="frontpage", url="https://www.ft.com/"),
        Section(name="business", url="https://www.ft.com/companies"),
        Section(name="tech", url="https://www.ft.com/technology"),
        Section(name="lifestyle", url="https://www.ft.com/life-arts"),
    )
    _article_pattern = re.compile(r"^https://(?:www\.)?ft\.com/content/[0-9a-f-]+$", re.IGNORECASE)

    def is_article_url(self, url: str) -> bool:
        return bool(self._article_pattern.match(url))

    def _settle_page(self) -> None:
        super()._settle_page()
        self._accept_cookie_prompt()

    def _accept_cookie_prompt(self) -> None:
        selectors = (
            "button[title='Accept cookies']",
            "button[data-trackable='accept-cookies']",
            "#consent-accept-all",
            "[data-testid='uc-accept-all-button']",
            "button:has-text('Accept cookies')",
            "button:has-text('Accept all')",
            "button:has-text('Allow all')",
            "button:has-text('I accept')",
        )

        for frame in (self.page.main_frame, *self.page.frames):
            for selector in selectors:
                try:
                    button = frame.locator(selector).first
                    if not button.is_visible(timeout=1_000):
                        continue
                    button.click(timeout=2_000)
                    self.page.wait_for_timeout(750)
                    logger.debug("Accepted FT cookie prompt via {}", selector)
                    return
                except PlaywrightError:
                    continue
