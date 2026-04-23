#!/usr/bin/env python3
"""Article-bot workflow: crawl, evaluate, process, and create Kakao delivery artifacts."""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, TypedDict

try:
    from langgraph.graph import END, START, StateGraph
except ModuleNotFoundError:  # pragma: no cover - keeps control scripts usable before deps are installed.
    END = START = None
    StateGraph = None  # type: ignore[assignment]

from article_bot_env import load_root_env
from article_bot_store import add_article_evaluation, add_artifact, update_step

load_root_env()

KST = timezone(timedelta(hours=9))
REPO_ROOT = Path(__file__).resolve().parents[3]
CRAWLER_DB_PATH = REPO_ROOT / "data" / "crawler.sqlite3"
CRAWLER_INPUT_DIR = REPO_ROOT / "input" / "crawled"
PIPELINE_OUTPUT_DIR = REPO_ROOT / "output"
EVALUATION_CONFIG_PATH = REPO_ROOT / "apps" / "research-bot" / "config" / "evaluation-criteria.json"


class ArticleGraphState(TypedDict, total=False):
    request_id: int
    run_id: int
    request_payload: dict[str, Any]
    criteria: list[str]
    sources: list[str]
    crawled_summary: dict[str, Any]
    evaluated_articles: list[dict[str, Any]]
    delivery_message: str


def safe_json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def load_criteria() -> list[str]:
    try:
        config = json.loads(EVALUATION_CONFIG_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    criteria = config.get("criteria")
    if not isinstance(criteria, list):
        return []
    return [str(item.get("label", "")).strip() for item in criteria if isinstance(item, dict) and str(item.get("label", "")).strip()]


def load_recent_articles(limit: int = 20) -> list[sqlite3.Row]:
    if not CRAWLER_DB_PATH.exists():
        return []
    conn = sqlite3.connect(CRAWLER_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(
            """
            SELECT article_id, source, section, title, subtitle, phase, url, article_text, input_file_path, document_json, crawled_at
            FROM crawled_articles
            ORDER BY crawled_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    finally:
        conn.close()


def score_article(row: sqlite3.Row, criteria: list[str]) -> tuple[float, dict[str, float], str]:
    haystack = f"{row['title']} {row['subtitle']} {row['article_text']}".lower()
    document = safe_json_loads(str(row["document_json"] or "{}"), {})
    media_count = 0
    if isinstance(document, dict):
        article_blocks = document.get("article")
        if isinstance(article_blocks, list):
            media_count = sum(1 for block in article_blocks if isinstance(block, dict) and block.get("type") == "media")

    signals = {
        "C1 vocabulary density": min(1.0, sum(1 for token in ["policy", "regulatory", "inflation", "earnings", "outlook", "scrutiny"] if token in haystack) / 4),
        "Discussion readiness": min(1.0, sum(1 for token in ["debate", "risk", "why", "could", "should", "future"] if token in haystack) / 4),
        "Korean translation quality": 0.75 if any(token in haystack for token in ["quote", "said", "according", "expects"]) else 0.45,
        "Business relevance": min(1.0, sum(1 for token in ["market", "company", "business", "economy", "bank", "technology", "ai"] if token in haystack) / 4),
        "Chart / media usefulness": min(1.0, media_count / 3),
    }
    active = criteria or list(signals)
    score = round(100 * sum(signals.get(label, 0.4) for label in active) / max(1, len(active)), 2)
    notes = ", ".join(f"{label}: {signals.get(label, 0.4):.2f}" for label in active)
    return score, signals, notes


def node_load_settings(state: ArticleGraphState) -> ArticleGraphState:
    update_step(state["conn"], state["run_id"], "load_settings", "running")  # type: ignore[index]
    payload = state["request_payload"]
    criteria = [str(value) for value in payload.get("criteria", []) if str(value).strip()] or load_criteria()
    sources = [str(value) for value in payload.get("sources", []) if str(value).strip()] or ["wsj.com", "ft.com"]
    update_step(state["conn"], state["run_id"], "load_settings", "success")  # type: ignore[index]
    return {**state, "criteria": criteria, "sources": sources}


def node_crawl_sources(state: ArticleGraphState) -> ArticleGraphState:
    update_step(state["conn"], state["run_id"], "crawl_sources", "running")  # type: ignore[index]
    if os.environ.get("ARTICLE_BOT_DRY_RUN") == "1":
        summary = {"dryRun": True, "saved_count": 0, "saved_articles": []}
        add_artifact(state["conn"], state["run_id"], "crawler-dry-run", json.dumps(summary, ensure_ascii=False))  # type: ignore[index]
        update_step(state["conn"], state["run_id"], "crawl_sources", "success")  # type: ignore[index]
        return {**state, "crawled_summary": summary}

    args = [
        "uv",
        "run",
        "article-crawler",
        "--source",
        "all",
        "--limit-per-section",
        str(state["request_payload"].get("limitPerSection", 5)),
        "--db-path",
        str(CRAWLER_DB_PATH),
        "--input-dir",
        str(CRAWLER_INPUT_DIR),
        "--pipeline-output-dir",
        str(PIPELINE_OUTPUT_DIR),
        "--pipeline-backend",
        os.environ.get("ARTICLE_BOT_PIPELINE_BACKEND", "gemma4"),
        "--log-level",
        "INFO",
    ]
    if os.environ.get("ARTICLE_BOT_SKIP_IMAGE") == "1":
        args.append("--pipeline-skip-image")

    completed = subprocess.run(args, cwd=REPO_ROOT, text=True, capture_output=True, check=False)
    add_artifact(
        state["conn"],  # type: ignore[index]
        state["run_id"],
        "crawler-output",
        json.dumps({"stdout": completed.stdout[-12000:], "stderr": completed.stderr[-12000:], "exitCode": completed.returncode}, ensure_ascii=False),
    )
    if completed.returncode != 0:
        update_step(state["conn"], state["run_id"], "crawl_sources", "failed")  # type: ignore[index]
        raise RuntimeError(f"article-crawler exited with {completed.returncode}")

    summary = safe_json_loads(completed.stdout[completed.stdout.find("{") :] if "{" in completed.stdout else "", {})
    update_step(state["conn"], state["run_id"], "crawl_sources", "success")  # type: ignore[index]
    return {**state, "crawled_summary": summary}


def node_normalize_articles(state: ArticleGraphState) -> ArticleGraphState:
    update_step(state["conn"], state["run_id"], "normalize_articles", "running")  # type: ignore[index]
    articles = load_recent_articles()
    add_artifact(
        state["conn"],  # type: ignore[index]
        state["run_id"],
        "normalized-articles",
        json.dumps({"count": len(articles), "articleIds": [row["article_id"] for row in articles[:20]]}, ensure_ascii=False),
    )
    update_step(state["conn"], state["run_id"], "normalize_articles", "success")  # type: ignore[index]
    return state


def node_evaluate_articles(state: ArticleGraphState) -> ArticleGraphState:
    update_step(state["conn"], state["run_id"], "evaluate_articles", "running")  # type: ignore[index]
    criteria = state.get("criteria", [])
    evaluated: list[dict[str, Any]] = []
    conn = state["conn"]  # type: ignore[index]
    for row in load_recent_articles():
        score, signals, notes = score_article(row, criteria)
        payload = {
            "articleId": row["article_id"],
            "url": row["url"],
            "title": row["title"],
            "source": row["source"],
            "score": score,
            "signals": signals,
            "notes": notes,
        }
        evaluated.append(payload)
        add_article_evaluation(
            conn,
            run_id=state["run_id"],
            article_id=row["article_id"],
            url=row["url"],
            title=row["title"],
            source=row["source"],
            score=score,
            criteria=signals,
            notes=notes,
        )
    evaluated.sort(key=lambda item: float(item["score"]), reverse=True)
    add_artifact(conn, state["run_id"], "article-evaluations", json.dumps(evaluated[:20], ensure_ascii=False))
    update_step(conn, state["run_id"], "evaluate_articles", "success")
    return {**state, "evaluated_articles": evaluated}


def node_process_articles(state: ArticleGraphState) -> ArticleGraphState:
    update_step(state["conn"], state["run_id"], "process_articles", "running")  # type: ignore[index]
    processed_count = sum(1 for row in load_recent_articles() if str(row["phase"]) == "processed")
    add_artifact(
        state["conn"],  # type: ignore[index]
        state["run_id"],
        "processing-summary",
        json.dumps({"processedRecentArticles": processed_count}, ensure_ascii=False),
    )
    update_step(state["conn"], state["run_id"], "process_articles", "success")  # type: ignore[index]
    return state


def build_delivery_message(state: ArticleGraphState) -> str:
    top_articles = state.get("evaluated_articles", [])[:5]
    lines = ["1Cup article bot brief", f"Run #{state['run_id']} completed at {datetime.now(KST).strftime('%Y-%m-%d %H:%M')}"]
    if not top_articles:
        lines.append("No evaluated articles were available yet.")
        return "\n".join(lines)
    for index, article in enumerate(top_articles, start=1):
        lines.append(f"{index}. [{article['score']:.0f}] {article['title']} - {article['url']}")
    return "\n".join(lines)


def node_deliver_kakao(state: ArticleGraphState) -> ArticleGraphState:
    update_step(state["conn"], state["run_id"], "deliver_kakao", "running")  # type: ignore[index]
    message = build_delivery_message(state)
    webhook_url = os.environ.get("KAKAO_WEBHOOK_URL", "")
    delivery_status = "dry-run"
    if webhook_url:
        body = json.dumps({"text": message}, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(webhook_url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
            delivery_status = f"sent:{response.status}"
    add_artifact(
        state["conn"],  # type: ignore[index]
        state["run_id"],
        "kakao-payload",
        json.dumps({"status": delivery_status, "message": message}, ensure_ascii=False),
    )
    update_step(state["conn"], state["run_id"], "deliver_kakao", "success")  # type: ignore[index]
    return {**state, "delivery_message": message}


def build_graph():
    if StateGraph is None:
        return SequentialArticleGraph()

    graph = StateGraph(ArticleGraphState)
    graph.add_node("load_settings", node_load_settings)
    graph.add_node("crawl_sources", node_crawl_sources)
    graph.add_node("normalize_articles", node_normalize_articles)
    graph.add_node("evaluate_articles", node_evaluate_articles)
    graph.add_node("process_articles", node_process_articles)
    graph.add_node("deliver_kakao", node_deliver_kakao)
    graph.add_edge(START, "load_settings")
    graph.add_edge("load_settings", "crawl_sources")
    graph.add_edge("crawl_sources", "normalize_articles")
    graph.add_edge("normalize_articles", "evaluate_articles")
    graph.add_edge("evaluate_articles", "process_articles")
    graph.add_edge("process_articles", "deliver_kakao")
    graph.add_edge("deliver_kakao", END)
    return graph.compile()


class SequentialArticleGraph:
    def invoke(self, state: ArticleGraphState) -> ArticleGraphState:
        for node in [
            node_load_settings,
            node_crawl_sources,
            node_normalize_articles,
            node_evaluate_articles,
            node_process_articles,
            node_deliver_kakao,
        ]:
            state = node(state)
        return state


def run_article_research_graph(*, conn: Any, request: dict[str, Any], run_id: int) -> dict[str, Any]:
    raw_payload = request.get("payload_json")
    payload = raw_payload if isinstance(raw_payload, dict) else safe_json_loads(str(raw_payload or "{}"), {})
    graph = build_graph()
    result = graph.invoke(
        {
            "conn": conn,
            "request_id": int(request["id"]),
            "run_id": run_id,
            "request_payload": payload,
        }
    )
    return {
        "runId": run_id,
        "evaluatedCount": len(result.get("evaluated_articles", [])),
        "delivered": bool(result.get("delivery_message")),
    }
