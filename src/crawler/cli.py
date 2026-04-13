from __future__ import annotations

import argparse
import json
from pathlib import Path

from loguru import logger

from .browser import open_browser_context
from .ft import FinancialTimesCrawler
from .pipeline_integration import CrawlerPipelineRunner, PipelineRunnerConfig
from .schemas import DiscoveredLink
from .storage import CrawlStore
from .utils import normalize_url
from .wsj import WallStreetJournalCrawler


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT_DIR / "data" / "crawler.sqlite3"
DEFAULT_INPUT_DIR = ROOT_DIR / "input" / "crawled"
DEFAULT_EXTENSION_DIR = ROOT_DIR / "extensions" / "bypass-chrome"
DEFAULT_PROFILE_DIR = ROOT_DIR / "artifacts" / "crawler" / "profiles"
DEFAULT_PIPELINE_OUTPUT_DIR = ROOT_DIR / "output"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Crawl FT and WSJ top stories into a local SQLite store and pipeline-ready input files."
    )
    parser.add_argument("--source", default="all", choices=["all", "ft", "wsj"])
    parser.add_argument("--section", action="append", choices=["frontpage", "business", "tech", "lifestyle"])
    parser.add_argument("--url", help="Optional direct article URL to extract without running section discovery.")
    parser.add_argument("--migrate-legacy-output", action="store_true")
    parser.add_argument("--limit-per-section", type=int, default=5)
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--extension-dir", type=Path, default=DEFAULT_EXTENSION_DIR)
    parser.add_argument(
        "--profile-dir",
        type=Path,
        default=DEFAULT_PROFILE_DIR,
        help="Base directory for temporary per-run Chromium profiles.",
    )
    parser.add_argument(
        "--chrome-executable-path",
        help="Optional Chromium executable override. Do not point this at branded Google Chrome.",
    )
    parser.add_argument("--timeout-ms", type=int, default=25_000)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--skip-pipeline", action="store_true")
    parser.add_argument("--pipeline-backend", default="gemma4", choices=["gemma4", "openai"])
    parser.add_argument("--pipeline-output-dir", type=Path, default=DEFAULT_PIPELINE_OUTPUT_DIR)
    parser.add_argument("--pipeline-skip-image", action="store_true")
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args()


def configure_logging(log_level: str) -> None:
    logger.remove()
    logger.add(lambda message: print(message, end=""), level=log_level.upper())


def build_crawlers(source: str) -> list[type[FinancialTimesCrawler | WallStreetJournalCrawler]]:
    if source == "ft":
        return [FinancialTimesCrawler]
    if source == "wsj":
        return [WallStreetJournalCrawler]
    return [FinancialTimesCrawler, WallStreetJournalCrawler]


def maybe_process_article(
    *,
    runner: CrawlerPipelineRunner | None,
    store: CrawlStore,
    article_file_path: Path,
    url: str,
) -> dict[str, object]:
    if runner is None:
        document = store.load_document(url) or {}
        return {
            "phase": str(document.get("phase", "crawled")),
            "pipeline_error_count": 0,
        }

    try:
        processed_document = runner.process_document(article_file_path)
    except Exception as exc:
        logger.exception("Pipeline processing failed for {}", article_file_path)
        processed_document = store.load_document(url) or {}
        existing_errors = processed_document.get("errors")
        errors = list(existing_errors) if isinstance(existing_errors, list) else []
        errors.append(
            {
                "stage": "pipeline_integration",
                "category": "unexpected",
                "message": str(exc),
                "retryable": False,
                "attempt": 1,
                "traceback": None,
            }
        )
        processed_document["errors"] = errors
        processed_document["phase"] = "processed"
        processed_document["input_file_path"] = str(article_file_path.resolve())
    article_file_path.write_text(json.dumps(processed_document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    store.update_document(url=url, document=processed_document, phase="processed")
    errors = processed_document.get("errors", [])
    error_count = len(errors) if isinstance(errors, list) else 0
    return {
        "phase": "processed",
        "pipeline_error_count": error_count,
    }


def main() -> int:
    args = parse_args()
    configure_logging(args.log_level)

    if args.url and args.source == "all":
        raise ValueError("When using --url, set --source to ft or wsj.")

    if not args.extension_dir.exists():
        raise FileNotFoundError(f"Chrome extension directory not found: {args.extension_dir}")

    store = CrawlStore(db_path=args.db_path, input_dir=args.input_dir)
    pipeline_runner: CrawlerPipelineRunner | None = None
    summary: dict[str, object] = {
        "source": args.source,
        "sections": args.section or ["frontpage", "business", "tech", "lifestyle"],
        "db_path": str(args.db_path),
        "input_dir": str(args.input_dir),
        "saved_articles": [],
    }

    try:
        if not args.skip_pipeline:
            pipeline_runner = CrawlerPipelineRunner(
                PipelineRunnerConfig(
                    backend=args.pipeline_backend,
                    output_dir=args.pipeline_output_dir,
                    generate_image=not args.pipeline_skip_image,
                    log_level=args.log_level,
                )
            )
        if args.migrate_legacy_output:
            migrated_count = store.migrate_legacy_output()
            print(
                json.dumps(
                    {
                        "input_dir": str(args.input_dir),
                        "migrated_count": migrated_count,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0

        with open_browser_context(
            extension_dir=args.extension_dir,
            profile_dir=args.profile_dir,
            headless=args.headless,
            executable_path=args.chrome_executable_path,
            timeout_ms=args.timeout_ms,
        ) as context:
            for crawler_class in build_crawlers(args.source):
                crawler = crawler_class(
                    context=context,
                    store=store,
                    limit_per_section=max(1, args.limit_per_section),
                )
                if args.url:
                    normalized_url = normalize_url(args.url)
                    payload = crawler.extract_article(
                        DiscoveredLink(
                            url=normalized_url,
                            title_hint="",
                            section=(args.section[0] if args.section else "manual"),
                        )
                    )
                    article = store.save_article(
                        source=crawler.source_name,
                        section=args.section[0] if args.section else "manual",
                        title=payload["title"],
                        subtitle=payload["subtitle"],
                        url=payload["url"],
                        article_text=payload["article_text"],
                        paragraphs=payload["paragraphs"],
                        media_assets=payload["media_assets"],
                    )
                    processing_meta = maybe_process_article(
                        runner=pipeline_runner,
                        store=store,
                        article_file_path=article.article_file_path,
                        url=article.url,
                    )
                    cast_list = summary["saved_articles"]
                    assert isinstance(cast_list, list)
                    cast_list.append(
                        {
                            "source": article.source,
                            "section": article.section,
                            "title": article.title,
                            "subtitle": article.subtitle,
                            "url": article.url,
                            "article_file_path": str(article.article_file_path),
                            "crawl_timestamp": article.crawl_timestamp,
                            "media_count": article.media_count,
                            "phase": processing_meta["phase"],
                            "pipeline_error_count": processing_meta["pipeline_error_count"],
                        }
                    )
                    break

                selected_sections = set(args.section) if args.section else None
                articles = crawler.crawl(selected_sections=selected_sections)
                for article in articles:
                    processing_meta = maybe_process_article(
                        runner=pipeline_runner,
                        store=store,
                        article_file_path=article.article_file_path,
                        url=article.url,
                    )
                    cast_list = summary["saved_articles"]
                    assert isinstance(cast_list, list)
                    cast_list.append(
                        {
                            "source": article.source,
                            "section": article.section,
                            "title": article.title,
                            "subtitle": article.subtitle,
                            "url": article.url,
                            "article_file_path": str(article.article_file_path),
                            "crawl_timestamp": article.crawl_timestamp,
                            "media_count": article.media_count,
                            "phase": processing_meta["phase"],
                            "pipeline_error_count": processing_meta["pipeline_error_count"],
                        }
                    )

        saved_articles = summary["saved_articles"]
        assert isinstance(saved_articles, list)
        summary["saved_count"] = len(saved_articles)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    finally:
        if pipeline_runner is not None:
            pipeline_runner.close()
        store.close()
