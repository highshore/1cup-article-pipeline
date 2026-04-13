from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from loguru import logger

from .schemas import CrawledArticle, MediaAsset, ParagraphItem
from .utils import build_article_id, clean_text, normalize_url, slugify


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CrawlStore:
    def __init__(self, db_path: Path, input_dir: Path) -> None:
        self.db_path = db_path
        self.input_dir = input_dir
        self.media_dir = self.input_dir / "_media"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.input_dir.mkdir(parents=True, exist_ok=True)
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(self.db_path)
        self._connection.row_factory = sqlite3.Row
        self._initialize()

    def close(self) -> None:
        self._connection.close()

    def _initialize(self) -> None:
        existing_columns = {
            str(row["name"])
            for row in self._connection.execute("PRAGMA table_info(crawled_articles)").fetchall()
        }
        if existing_columns and ("document_json" not in existing_columns or "phase" not in existing_columns or "updated_at" not in existing_columns):
            self._migrate_legacy_table()

        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS crawled_articles (
                url TEXT PRIMARY KEY,
                article_id TEXT NOT NULL,
                source TEXT NOT NULL,
                section TEXT NOT NULL,
                title TEXT NOT NULL,
                subtitle TEXT NOT NULL DEFAULT '',
                phase TEXT NOT NULL,
                article_text TEXT NOT NULL,
                input_file_path TEXT NOT NULL,
                document_json TEXT NOT NULL,
                crawled_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_crawled_articles_source_section ON crawled_articles (source, section)"
        )
        self._connection.commit()

    def _migrate_legacy_table(self) -> None:
        self._connection.execute("ALTER TABLE crawled_articles RENAME TO crawled_articles_legacy")
        self._connection.execute(
            """
            CREATE TABLE crawled_articles (
                url TEXT PRIMARY KEY,
                article_id TEXT NOT NULL,
                source TEXT NOT NULL,
                section TEXT NOT NULL,
                title TEXT NOT NULL,
                subtitle TEXT NOT NULL DEFAULT '',
                phase TEXT NOT NULL,
                article_text TEXT NOT NULL,
                input_file_path TEXT NOT NULL,
                document_json TEXT NOT NULL,
                crawled_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        rows = self._connection.execute(
            """
            SELECT article_id, source, section, title, url, article_text, input_file_path, crawled_at
            FROM crawled_articles_legacy
            """
        ).fetchall()
        for row in rows:
            input_file_path = Path(str(row["input_file_path"]))
            subtitle = ""
            phase = "crawled"
            document_json = "{}"
            if input_file_path.exists():
                try:
                    payload = json.loads(input_file_path.read_text(encoding="utf-8"))
                    subtitle = clean_text(str(payload.get("subtitle", "")))
                    phase = clean_text(str(payload.get("phase", ""))) or "crawled"
                    document_json = json.dumps(payload, ensure_ascii=False)
                except json.JSONDecodeError:
                    document_json = "{}"
            self._connection.execute(
                """
                INSERT INTO crawled_articles (
                    url, article_id, source, section, title, subtitle, phase,
                    article_text, input_file_path, document_json, crawled_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(row["url"]),
                    str(row["article_id"]),
                    str(row["source"]),
                    str(row["section"]),
                    str(row["title"]),
                    subtitle,
                    phase,
                    str(row["article_text"]),
                    str(input_file_path),
                    document_json,
                    str(row["crawled_at"]),
                    str(row["crawled_at"]),
                ),
            )
        self._connection.execute("DROP TABLE crawled_articles_legacy")
        self._connection.commit()

    def has_url(self, url: str) -> bool:
        normalized_url = normalize_url(url)
        row = self._connection.execute(
            "SELECT url, input_file_path FROM crawled_articles WHERE url = ? LIMIT 1",
            (normalized_url,),
        ).fetchone()
        if row is None:
            return False

        article_file_path = Path(str(row["input_file_path"]))
        if article_file_path.exists():
            return True

        logger.warning("Pruning stale crawl record for {} because {} is missing", normalized_url, article_file_path)
        self._connection.execute("DELETE FROM crawled_articles WHERE url = ?", (normalized_url,))
        self._connection.commit()
        return False

    def load_document(self, url: str) -> dict[str, Any] | None:
        normalized_url = normalize_url(url)
        row = self._connection.execute(
            "SELECT document_json FROM crawled_articles WHERE url = ? LIMIT 1",
            (normalized_url,),
        ).fetchone()
        if row is None:
            return None
        try:
            return json.loads(str(row["document_json"]))
        except json.JSONDecodeError:
            return None

    def save_article(
        self,
        *,
        source: str,
        section: str,
        title: str,
        subtitle: str,
        url: str,
        article_text: str,
        paragraphs: list[ParagraphItem],
        media_assets: list[MediaAsset] | None = None,
    ) -> CrawledArticle:
        normalized_url = normalize_url(url)
        article_id = build_article_id(source, title, normalized_url)
        article_file_path = self.input_dir / f"{article_id}.json"
        crawl_timestamp = utc_now()
        media_assets = media_assets or []
        document = self._build_article_document(
            article_id=article_id,
            source=source,
            section=section,
            title=title.strip(),
            subtitle=subtitle.strip(),
            url=normalized_url,
            article_text=article_text.strip(),
            paragraphs=paragraphs,
            media_assets=media_assets,
            crawl_timestamp=crawl_timestamp,
        )
        document["input_file_path"] = str(article_file_path.resolve())
        article_file_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self._remove_legacy_files(article_id)

        article = CrawledArticle(
            source=source,
            section=section,
            title=title.strip(),
            subtitle=subtitle.strip(),
            url=normalized_url,
            article_text=article_text.strip(),
            article_file_path=article_file_path,
            crawl_timestamp=crawl_timestamp,
            phase="crawled",
            media_count=len(media_assets),
        )
        self._connection.execute(
            """
            INSERT INTO crawled_articles (
                url,
                article_id,
                source,
                section,
                title,
                subtitle,
                phase,
                article_text,
                input_file_path,
                document_json,
                crawled_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(url) DO UPDATE SET
                article_id = excluded.article_id,
                source = excluded.source,
                section = excluded.section,
                title = excluded.title,
                subtitle = excluded.subtitle,
                phase = excluded.phase,
                article_text = excluded.article_text,
                input_file_path = excluded.input_file_path,
                document_json = excluded.document_json,
                crawled_at = excluded.crawled_at,
                updated_at = excluded.updated_at
            """,
            (
                article.url,
                article_id,
                article.source,
                article.section,
                article.title,
                article.subtitle,
                article.phase,
                article.article_text,
                str(article.article_file_path.resolve()),
                json.dumps(document, ensure_ascii=False),
                article.crawl_timestamp,
                article.crawl_timestamp,
            ),
        )
        self._connection.commit()
        return article

    def update_document(
        self,
        *,
        url: str,
        document: dict[str, Any],
        phase: str,
        article_text: str | None = None,
    ) -> None:
        normalized_url = normalize_url(url)
        resolved_article_text = article_text if article_text is not None else self._article_text_from_document(document)
        document["phase"] = phase
        if document.get("input_file_path"):
            document["input_file_path"] = str(Path(str(document["input_file_path"])).resolve())
        self._connection.execute(
            """
            UPDATE crawled_articles
            SET article_id = ?,
                source = ?,
                section = ?,
                title = ?,
                subtitle = ?,
                phase = ?,
                article_text = ?,
                input_file_path = ?,
                document_json = ?,
                updated_at = ?
            WHERE url = ?
            """,
            (
                clean_text(str(document.get("article_id", ""))),
                clean_text(str(document.get("source", ""))),
                clean_text(str(document.get("section", ""))),
                clean_text(str(document.get("title", ""))),
                clean_text(str(document.get("subtitle", ""))),
                phase,
                resolved_article_text,
                str(document.get("input_file_path", "")),
                json.dumps(document, ensure_ascii=False),
                utc_now(),
                normalized_url,
            ),
        )
        self._connection.commit()

    def migrate_legacy_output(self) -> int:
        migrated = 0
        for legacy_path in sorted(self.input_dir.glob("*.txt")):
            migrated += int(self._migrate_legacy_article(legacy_path))
        return migrated

    def _migrate_legacy_article(self, legacy_path: Path) -> bool:
        article_id = legacy_path.stem
        article_json_path = self.input_dir / f"{article_id}.json"
        if article_json_path.exists():
            legacy_path.unlink(missing_ok=True)
            legacy_manifest = self.media_dir / f"{article_id}.media.json"
            legacy_manifest.unlink(missing_ok=True)
            return False

        parsed = self._parse_legacy_text_file(legacy_path)
        if parsed is None:
            logger.warning("Skipping legacy file with unexpected format: {}", legacy_path)
            return False

        media_assets, media_manifest_path = self._load_legacy_media(article_id)
        subtitle, paragraphs = self._extract_legacy_subtitle(parsed["paragraphs"])
        article_text = "\n\n".join(paragraphs).strip()

        row = self._connection.execute(
            "SELECT source, section, crawled_at FROM crawled_articles WHERE url = ? LIMIT 1",
            (normalize_url(parsed["url"]),),
        ).fetchone()
        source = str(row["source"]) if row else parsed["source"]
        section = str(row["section"]) if row else "legacy"
        crawl_timestamp = str(row["crawled_at"]) if row else utc_now()

        document = self._build_article_document(
            article_id=article_id,
            source=source,
            section=section,
            title=parsed["title"],
            subtitle=subtitle,
            url=normalize_url(parsed["url"]),
            article_text=article_text,
            paragraphs=[
                ParagraphItem(paragraph_id=f"paragraph-{index}", text=text, order=index, y=float(index))
                for index, text in enumerate(paragraphs, start=1)
            ],
            media_assets=media_assets,
            crawl_timestamp=crawl_timestamp,
        )
        article_json_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        if row:
            document["input_file_path"] = str(article_json_path.resolve())
            self._connection.execute(
                """
                UPDATE crawled_articles
                SET input_file_path = ?, article_text = ?, document_json = ?, updated_at = ?
                WHERE url = ?
                """,
                (
                    str(article_json_path.resolve()),
                    article_text,
                    json.dumps(document, ensure_ascii=False),
                    utc_now(),
                    normalize_url(parsed["url"]),
                ),
            )
        self._connection.commit()

        legacy_path.unlink(missing_ok=True)
        if media_manifest_path:
            media_manifest_path.unlink(missing_ok=True)
        logger.info("Migrated legacy crawler output {} -> {}", legacy_path, article_json_path)
        return True

    def _build_article_document(
        self,
        *,
        article_id: str,
        source: str,
        section: str,
        title: str,
        subtitle: str,
        url: str,
        article_text: str,
        paragraphs: list[ParagraphItem],
        media_assets: list[MediaAsset],
        crawl_timestamp: str,
    ) -> dict[str, Any]:
        media_entries = self._write_media_assets(article_id=article_id, media_assets=media_assets)
        ordered_content = self._build_ordered_content(paragraphs=paragraphs, media_entries=media_entries, subtitle=subtitle)
        return {
            "crawl_timestamp": crawl_timestamp,
            "phase": "crawled",
            "source": source,
            "section": section,
            "title": title,
            "subtitle": subtitle,
            "url": url,
            "article_id": article_id,
            "article": ordered_content,
        }

    def _article_text_from_document(self, document: dict[str, Any]) -> str:
        article = document.get("article", [])
        if not isinstance(article, list):
            return ""
        paragraphs = [
            clean_text(str(block.get("text", "")))
            for block in article
            if isinstance(block, dict) and block.get("type") == "paragraph" and clean_text(str(block.get("text", "")))
        ]
        return "\n\n".join(paragraphs).strip()

    def _write_media_assets(self, *, article_id: str, media_assets: list[MediaAsset]) -> list[dict[str, Any]]:
        article_media_dir = self.media_dir / article_id
        article_media_dir.mkdir(parents=True, exist_ok=True)
        media_entries: list[dict[str, Any]] = []

        for media in media_assets:
            asset_path: Path | None = None
            if media.screenshot_bytes:
                filename = f"{media.order:02d}-{slugify(media.kind) or 'media'}.png"
                asset_path = article_media_dir / filename
                asset_path.write_bytes(media.screenshot_bytes)

            media_entries.append(
                {
                    "media_id": media.media_id,
                    "kind": media.kind,
                    "kind_source": media.kind_source,
                    "order": media.order,
                    "asset_path": str(asset_path) if asset_path else None,
                    "title": media.title,
                    "source_url": media.src,
                    "alt": media.alt,
                    "caption": media.caption,
                    "credit": media.credit,
                    "preceding_text": media.preceding_text,
                    "following_text": media.following_text,
                    "chart_score": round(media.chart_score, 3),
                    "ocr_word_count": media.ocr_word_count,
                    "ocr_avg_confidence": round(media.ocr_avg_confidence, 3),
                    "ocr_text_excerpt": media.ocr_text_excerpt,
                    "bbox": {
                        "x": round(media.x, 2),
                        "y": round(media.y, 2),
                        "width": round(media.width, 2),
                        "height": round(media.height, 2),
                    },
                }
            )

        return media_entries

    def _build_ordered_content(
        self,
        *,
        paragraphs: list[ParagraphItem],
        media_entries: list[dict[str, Any]],
        subtitle: str,
    ) -> list[dict[str, Any]]:
        if paragraphs and all(abs(paragraph.y - float(paragraph.order)) < 0.001 for paragraph in paragraphs):
            return self._build_anchor_ordered_content(paragraphs=paragraphs, media_entries=media_entries, subtitle=subtitle)

        ordered_blocks: list[dict[str, Any]] = []

        for paragraph in paragraphs:
            ordered_blocks.append(
                {
                    "type": "paragraph",
                    "order": paragraph.order,
                    "paragraph_id": paragraph.paragraph_id,
                    "text": paragraph.text,
                    "_sort_y": paragraph.y,
                    "_sort_x": 0.0,
                }
            )

        for media in media_entries:
            bbox = media.get("bbox") or {}
            media_block = self._build_media_block(media)
            media_block["_sort_y"] = float(bbox.get("y", 0.0) or 0.0)
            media_block["_sort_x"] = float(bbox.get("x", 0.0) or 0.0)
            ordered_blocks.append(media_block)

        ordered_blocks.sort(key=lambda item: (item["_sort_y"], item["_sort_x"], item["type"] != "paragraph", item["order"]))
        for index, block in enumerate(ordered_blocks, start=1):
            block["order"] = index
            block.pop("_sort_y", None)
            block.pop("_sort_x", None)
        return ordered_blocks

    def _build_anchor_ordered_content(
        self,
        *,
        paragraphs: list[ParagraphItem],
        media_entries: list[dict[str, Any]],
        subtitle: str,
    ) -> list[dict[str, Any]]:
        blocks: list[dict[str, Any]] = [
            {
                "type": "paragraph",
                "order": paragraph.order,
                "paragraph_id": paragraph.paragraph_id,
                "text": paragraph.text,
            }
            for paragraph in paragraphs
        ]

        for media in sorted(media_entries, key=lambda item: int(item.get("order", 0) or 0)):
            following_text = clean_text(str(media.get("following_text", "")))
            preceding_text = clean_text(str(media.get("preceding_text", "")))
            media_block = self._build_media_block(media)

            if subtitle and following_text and following_text == subtitle:
                blocks.insert(0, media_block)
                continue

            paragraph_index = self._find_anchor_paragraph_index(blocks, preceding_text=preceding_text, following_text=following_text)
            if paragraph_index is None:
                blocks.append(media_block)
                continue

            self._augment_chart_context(media_block=media_block, blocks=blocks, paragraph_index=paragraph_index)
            insert_index = paragraph_index
            if preceding_text:
                insert_index += 1
                while insert_index < len(blocks) and blocks[insert_index]["type"] == "media":
                    insert_index += 1
            blocks.insert(insert_index, media_block)

        for index, block in enumerate(blocks, start=1):
            block["order"] = index
        return blocks

    def _build_media_block(self, media: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": "media",
            "order": int(media.get("order", 0) or 0),
            "media_id": media["media_id"],
            "kind": media.get("kind"),
            "kind_source": media.get("kind_source"),
            "asset_path": media.get("asset_path"),
            "title": media.get("title"),
            "source_url": media.get("source_url"),
            "alt": media.get("alt"),
            "caption": media.get("caption"),
            "credit": media.get("credit"),
            "preceding_text": media.get("preceding_text"),
            "following_text": media.get("following_text"),
            "chart_score": media.get("chart_score"),
            "ocr_word_count": media.get("ocr_word_count"),
            "ocr_avg_confidence": media.get("ocr_avg_confidence"),
            "ocr_text_excerpt": media.get("ocr_text_excerpt"),
            "bbox": media.get("bbox"),
        }

    def _augment_chart_context(self, *, media_block: dict[str, Any], blocks: list[dict[str, Any]], paragraph_index: int) -> None:
        if media_block.get("kind") != "chart":
            return

        if not clean_text(str(media_block.get("title", ""))):
            derived_title = self._derive_chart_title_from_alt(str(media_block.get("alt", "")))
            if derived_title:
                media_block["title"] = derived_title

        caption_lines: list[str] = []
        existing_caption = clean_text(str(media_block.get("caption", "")))
        if existing_caption:
            caption_lines.append(existing_caption)
        following_text = clean_text(str(media_block.get("following_text", "")))
        if self._looks_like_chart_caption(following_text) and following_text not in caption_lines:
            caption_lines.append(following_text)

        for index in range(paragraph_index + 1, min(len(blocks), paragraph_index + 4)):
            block = blocks[index]
            if block.get("type") != "paragraph":
                continue
            text = clean_text(str(block.get("text", "")))
            if not self._looks_like_chart_caption(text):
                if caption_lines:
                    break
                continue
            if text not in caption_lines:
                caption_lines.append(text)

        if caption_lines:
            media_block["caption"] = clean_text(" ".join(caption_lines))

    def _derive_chart_title_from_alt(self, alt_text: str) -> str:
        normalized = clean_text(alt_text)
        if not normalized:
            return ""

        match = re.search(
            r"(?:showing|shows?)\s+(?P<title>.+?)(?:,\s+for\s+OpenAI|\s+for\s+OpenAI|,\s+including|,\s+represented|\.\s|$)",
            normalized,
            flags=re.IGNORECASE,
        )
        candidate = clean_text(match.group("title")) if match else normalized
        candidate = re.sub(
            r"^(series of [^ ]+ charts showing|two side-by-side bar charts showing)\s+",
            "",
            candidate,
            flags=re.IGNORECASE,
        )
        candidate = clean_text(candidate.rstrip("."))
        if candidate:
            return candidate[0].upper() + candidate[1:]
        return ""

    def _looks_like_chart_caption(self, text: str) -> bool:
        normalized = clean_text(text)
        if not normalized:
            return False
        return bool(
            normalized.startswith(("*", "Note:", "Source:", "Sources:", "Credit:"))
            or "projections are through" in normalized.casefold()
            or "counts sales of its technology through cloud partners" in normalized.casefold()
        )

    def _find_anchor_paragraph_index(
        self,
        blocks: list[dict[str, Any]],
        *,
        preceding_text: str,
        following_text: str,
    ) -> int | None:
        if preceding_text:
            for index in range(len(blocks) - 1, -1, -1):
                block = blocks[index]
                if block["type"] == "paragraph" and clean_text(str(block.get("text", ""))) == preceding_text:
                    return index
        if following_text:
            for index, block in enumerate(blocks):
                if block["type"] == "paragraph" and clean_text(str(block.get("text", ""))) == following_text:
                    return index
        return None

    def _load_legacy_media(self, article_id: str) -> tuple[list[MediaAsset], Path | None]:
        manifest_path = self.media_dir / f"{article_id}.media.json"
        if not manifest_path.exists():
            return [], None

        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            logger.warning("Skipping malformed legacy media manifest {}", manifest_path)
            return [], manifest_path

        media_assets: list[MediaAsset] = []
        for item in payload.get("media", []):
            if not isinstance(item, dict):
                continue
            bbox = item.get("bbox")
            screenshot_path = item.get("screenshot_path")
            screenshot_bytes = None
            if isinstance(screenshot_path, str) and screenshot_path:
                screenshot_file = Path(screenshot_path)
                if screenshot_file.exists():
                    screenshot_bytes = screenshot_file.read_bytes()
            media_assets.append(
                MediaAsset(
                    media_id=str(item.get("media_id", "")).strip() or f"media-{len(media_assets) + 1}",
                    kind=clean_text(str(item.get("kind", "") or "image")).lower() or "image",
                    kind_source=clean_text(str(item.get("kind_source", "") or "legacy")).lower() or "legacy",
                    selector=str(item.get("selector", "")).strip(),
                    order=max(1, int(item.get("order", len(media_assets) + 1))),
                    title=clean_text(str(item.get("title", ""))),
                    src=str(item.get("src", "")).strip(),
                    alt=clean_text(str(item.get("alt", ""))),
                    caption=clean_text(str(item.get("caption", ""))),
                    credit=clean_text(str(item.get("credit", ""))),
                    preceding_text=clean_text(str(item.get("preceding_text", ""))),
                    following_text=clean_text(str(item.get("following_text", ""))),
                    x=self._coerce_float(bbox.get("x")) if isinstance(bbox, dict) else 0.0,
                    y=self._coerce_float(bbox.get("y")) if isinstance(bbox, dict) else 0.0,
                    width=self._coerce_float(bbox.get("width")) if isinstance(bbox, dict) else 0.0,
                    height=self._coerce_float(bbox.get("height")) if isinstance(bbox, dict) else 0.0,
                    chart_score=self._coerce_float(item.get("chart_score")),
                    ocr_word_count=max(0, int(item.get("ocr_word_count", 0) or 0)),
                    ocr_avg_confidence=self._coerce_float(item.get("ocr_avg_confidence")),
                    ocr_text_excerpt=clean_text(str(item.get("ocr_text_excerpt", ""))),
                    screenshot_bytes=screenshot_bytes,
                )
            )
        return media_assets, manifest_path

    def _parse_legacy_text_file(self, path: Path) -> dict[str, Any] | None:
        raw_text = path.read_text(encoding="utf-8").strip()
        title_match = re.search(r"(?mi)^\s*Title:\s*(?P<title>.+?)\s*$", raw_text)
        url_match = re.search(r"(?mi)^\s*URL:\s*(?P<url>\S+)\s*$", raw_text)
        article_text_match = re.search(r"(?mis)^\s*Article Text:\s*\n(?P<body>.+)$", raw_text)
        if not (title_match and url_match and article_text_match):
            return None

        body_lines = [clean_text(line) for line in article_text_match.group("body").splitlines()]
        paragraphs = [line for line in body_lines if line and not self._is_noise_paragraph(line)]
        source = path.stem.split("-", 1)[0] if "-" in path.stem else "legacy"
        return {
            "source": source,
            "title": clean_text(title_match.group("title")),
            "url": clean_text(url_match.group("url")),
            "paragraphs": paragraphs,
        }

    def _extract_legacy_subtitle(self, paragraphs: list[str]) -> tuple[str, list[str]]:
        if not paragraphs:
            return "", []
        first = paragraphs[0].strip()
        if first.lower().startswith("your guide to ") or (len(first) <= 160 and not first.endswith((".", "?", "!"))):
            return first, paragraphs[1:]
        return "", paragraphs

    def _is_noise_paragraph(self, text: str) -> bool:
        normalized = clean_text(text).casefold()
        noise_patterns = (
            "catch up on the headlines",
            "copyright ©",
            "all rights reserved",
            "appeared in the ",
            "corrections & amplifications",
            "news corp, owner of the wall street journal",
            "victoria albert is a reporter",
            "victoria joined the journal",
            "meghan bobrowsky is a technology reporter",
            "in 2022, meghan and two of her colleagues won",
            "meghan previously worked at",
            "zusha elinson is a national reporter",
            "zusha grew up on a dirt road",
        )
        return normalized.startswith(noise_patterns) or normalized.startswith("http://") or normalized.startswith("https://")

    def _remove_legacy_files(self, article_id: str) -> None:
        legacy_text = self.input_dir / f"{article_id}.txt"
        legacy_manifest = self.media_dir / f"{article_id}.media.json"
        legacy_text.unlink(missing_ok=True)
        legacy_manifest.unlink(missing_ok=True)

    def _coerce_float(self, value: Any) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0
