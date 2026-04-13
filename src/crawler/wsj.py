from __future__ import annotations

from urllib.parse import urlsplit

from .base import BaseSiteCrawler
from .schemas import Section


class WallStreetJournalCrawler(BaseSiteCrawler):
    source_name = "wsj"
    base_url = "https://www.wsj.com"
    allowed_hosts = ("wsj.com",)
    title_suffixes = ("WSJ", "The Wall Street Journal")
    sections = (
        Section(name="frontpage", url="https://www.wsj.com/"),
        Section(name="business", url="https://www.wsj.com/business"),
        Section(name="tech", url="https://www.wsj.com/tech"),
        Section(name="lifestyle", url="https://www.wsj.com/lifestyle"),
    )
    _section_roots = {"/", "/business", "/tech", "/lifestyle", "/news", "/markets", "/finance", "/opinion"}
    _denied_paths = {
        "/news/latest-headlines",
    }

    def is_article_url(self, url: str) -> bool:
        parts = urlsplit(url)
        path = parts.path.rstrip("/") or "/"
        if path in self._denied_paths:
            return False
        if path in self._section_roots:
            return False
        if "/articles/" in path:
            return True
        segments = [segment for segment in path.split("/") if segment]
        if len(segments) < 2:
            return False
        leaf = segments[-1]
        return "-" in leaf and len(leaf) >= 16

    def reject_article(
        self,
        *,
        url: str,
        title: str,
        subtitle: str,
        article_text: str,
        paragraphs,
    ) -> str | None:
        path = urlsplit(url).path.rstrip("/") or "/"
        if path in self._denied_paths or title.strip().casefold() == "latest headlines":
            return "rejected WSJ index page instead of an article"
        return None
