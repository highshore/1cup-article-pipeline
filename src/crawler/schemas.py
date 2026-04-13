from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Section:
    name: str
    url: str


@dataclass(frozen=True, slots=True)
class DiscoveredLink:
    url: str
    title_hint: str
    section: str


@dataclass(frozen=True, slots=True)
class MediaAsset:
    media_id: str
    kind: str
    kind_source: str
    selector: str
    order: int
    title: str
    src: str
    alt: str
    caption: str
    credit: str
    preceding_text: str
    following_text: str
    x: float
    y: float
    width: float
    height: float
    chart_score: float = 0.0
    ocr_word_count: int = 0
    ocr_avg_confidence: float = 0.0
    ocr_text_excerpt: str = ""
    screenshot_bytes: bytes | None = None


@dataclass(frozen=True, slots=True)
class ParagraphItem:
    paragraph_id: str
    text: str
    order: int
    y: float


@dataclass(frozen=True, slots=True)
class CrawledArticle:
    source: str
    section: str
    title: str
    subtitle: str
    url: str
    article_text: str
    article_file_path: Path
    crawl_timestamp: str
    phase: str = "crawled"
    media_count: int = 0


@dataclass(frozen=True, slots=True)
class CrawlResult:
    discovered: int = 0
    skipped_existing: int = 0
    crawled: int = 0
    failed: int = 0
