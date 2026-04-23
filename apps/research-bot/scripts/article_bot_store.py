#!/usr/bin/env python3
"""SQLite queue/control helpers owned by apps/research-bot."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

KST = timezone(timedelta(hours=9))
REPO_ROOT = Path(__file__).resolve().parents[3]
DB_PATH = Path(os.environ.get("ARTICLE_BOT_DB_PATH", REPO_ROOT / "apps" / "research-bot" / "data" / "article-dashboard.sqlite"))
PIPELINE_KEY = "article-bot"
DAILY_WORKFLOW_KEY = "article-bot.daily-brief"
WEEKLY_WORKFLOW_KEY = "article-bot.weekly-brief"

DEFAULT_TARGET_SOURCES = ["wsj.com", "ft.com"]
DEFAULT_PRIORITY_TARGETS = [
    "C1 vocabulary density",
    "Discussion readiness",
    "Korean translation quality",
    "Business relevance",
    "Chart / media usefulness",
]
DEFAULT_PIPELINE_SCHEDULES = [
    {
        "schedule_key": "daily_kakao_report",
        "report_type": "daily-kakao-report",
        "cadence": "daily",
        "weekdays": [],
        "time_of_day": "09:00",
    },
    {
        "schedule_key": "weekly_kakao_report",
        "report_type": "weekly-kakao-report",
        "cadence": "weekly",
        "weekdays": [],
        "time_of_day": "09:00",
    },
]

PIPELINE_STAGES = [
    {
        "stage_key": "load_settings",
        "stage_label": "Load criteria",
        "stage_detail": "Read target sources, evaluation criteria, schedule metadata, and run options.",
    },
    {
        "stage_key": "crawl_sources",
        "stage_label": "Crawl WSJ / FT",
        "stage_detail": "Collect fresh stories from Wall Street Journal and Financial Times sections.",
    },
    {
        "stage_key": "normalize_articles",
        "stage_label": "Normalize articles",
        "stage_detail": "Canonicalize URLs, fold duplicates, and prepare crawler rows for evaluation.",
    },
    {
        "stage_key": "evaluate_articles",
        "stage_label": "Evaluate fit",
        "stage_detail": "Score articles against lesson value, C1 vocabulary, discussion potential, and business relevance.",
    },
    {
        "stage_key": "process_articles",
        "stage_label": "Process outputs",
        "stage_detail": "Run translation, summaries, discussion prompts, vocabulary extraction, and media sidecars.",
    },
    {
        "stage_key": "deliver_kakao",
        "stage_label": "Notify Kakao",
        "stage_detail": "Build a compact Kakao-ready brief with links back to the dashboard.",
    },
]


def now_iso() -> str:
    return datetime.now(KST).replace(microsecond=0).isoformat()


def run_date() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    target_sources_existed = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'target_sources' LIMIT 1"
    ).fetchone()

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS priority_targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          label TEXT NOT NULL COLLATE NOCASE UNIQUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS target_sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          domain TEXT NOT NULL COLLATE NOCASE UNIQUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS pipeline_schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          schedule_key TEXT NOT NULL COLLATE NOCASE UNIQUE,
          report_type TEXT NOT NULL,
          cadence TEXT NOT NULL,
          weekdays_json TEXT NOT NULL DEFAULT '[]',
          time_of_day TEXT NOT NULL DEFAULT '09:00',
          timezone_name TEXT NOT NULL DEFAULT 'Asia/Seoul',
          last_enqueued_slot TEXT,
          last_enqueued_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS pipeline_run_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pipeline_key TEXT NOT NULL,
          workflow_key TEXT NOT NULL,
          trigger_source TEXT NOT NULL,
          requested_by TEXT,
          executor TEXT NOT NULL DEFAULT 'local',
          status TEXT NOT NULL,
          payload_json TEXT,
          requested_at TEXT NOT NULL,
          claimed_at TEXT,
          started_at TEXT,
          finished_at TEXT,
          cancel_requested_at TEXT,
          cancel_requested_by TEXT,
          collection_run_id INTEGER,
          backend_metadata_json TEXT,
          error_text TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS collection_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id INTEGER,
          cadence TEXT NOT NULL,
          run_date TEXT NOT NULL,
          status TEXT NOT NULL,
          source_scope TEXT NOT NULL,
          executor TEXT,
          started_at TEXT,
          finished_at TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS pipeline_run_steps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL,
          stage_key TEXT NOT NULL,
          stage_label TEXT NOT NULL,
          stage_detail TEXT NOT NULL,
          stage_order INTEGER NOT NULL,
          status TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS artifacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER,
          artifact_type TEXT NOT NULL,
          content TEXT,
          file_path TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS article_evaluations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER,
          article_id TEXT NOT NULL,
          url TEXT NOT NULL,
          title TEXT NOT NULL,
          source TEXT NOT NULL,
          score REAL NOT NULL,
          criteria_json TEXT NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_priority_targets_sort_order ON priority_targets(sort_order, id);
        CREATE INDEX IF NOT EXISTS idx_target_sources_sort_order ON target_sources(sort_order, id);
        CREATE INDEX IF NOT EXISTS idx_pipeline_schedules_cadence ON pipeline_schedules(cadence, schedule_key);
        CREATE INDEX IF NOT EXISTS idx_pipeline_run_requests_status ON pipeline_run_requests(status, requested_at DESC);
        CREATE INDEX IF NOT EXISTS idx_collection_runs_status ON collection_runs(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_pipeline_run_steps_run_order ON pipeline_run_steps(run_id, stage_order);
        CREATE INDEX IF NOT EXISTS idx_article_evaluations_run_score ON article_evaluations(run_id, score DESC);
        """
    )

    count = conn.execute("SELECT COUNT(*) AS count FROM priority_targets").fetchone()["count"]
    if int(count) == 0:
        for index, label in enumerate(DEFAULT_PRIORITY_TARGETS):
            conn.execute(
                "INSERT OR IGNORE INTO priority_targets (label, sort_order) VALUES (?, ?)",
                (label, index),
            )

    if target_sources_existed is None:
        for index, domain in enumerate(DEFAULT_TARGET_SOURCES):
            conn.execute(
                "INSERT OR IGNORE INTO target_sources (domain, sort_order) VALUES (?, ?)",
                (domain, index),
            )

    for schedule in DEFAULT_PIPELINE_SCHEDULES:
        conn.execute(
            """
            INSERT OR IGNORE INTO pipeline_schedules (
              schedule_key, report_type, cadence, weekdays_json, time_of_day, timezone_name, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                schedule["schedule_key"],
                schedule["report_type"],
                schedule["cadence"],
                json.dumps(schedule["weekdays"]),
                schedule["time_of_day"],
                "Asia/Seoul",
                now_iso(),
            ),
        )
    conn.commit()


def normalize_target_source_domain(value: str) -> str:
    collapsed = " ".join(str(value).strip().split()).lower()
    if not collapsed:
        return ""
    parsed = urlparse(collapsed if "://" in collapsed else f"https://{collapsed}")
    host = (parsed.netloc or parsed.path or "").split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    return host.replace("www.", "", 1).strip(".")


def load_target_sources(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute("SELECT domain FROM target_sources ORDER BY sort_order, id").fetchall()
    return [str(row["domain"]).strip().lower() for row in rows if str(row["domain"]).strip()]


def load_priority_targets(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute("SELECT label FROM priority_targets ORDER BY sort_order, id").fetchall()
    return [str(row["label"]).strip() for row in rows if str(row["label"]).strip()]


def normalize_schedule_weekdays(values: list[object], *, allow_multiple: bool) -> list[int]:
    normalized: list[int] = []
    for value in values:
        try:
            weekday = int(str(value).strip())
        except ValueError:
            continue
        if 0 <= weekday <= 6 and weekday not in normalized:
            normalized.append(weekday)
    normalized.sort()
    return normalized if allow_multiple else normalized[:1]


def normalize_time_of_day(value: str) -> str:
    try:
        return datetime.strptime(str(value).strip(), "%H:%M").strftime("%H:%M")
    except ValueError:
        return ""


def most_recent_due_slot(weekdays: list[int], time_of_day: str, *, reference: datetime | None = None) -> str | None:
    if not weekdays:
        return None
    normalized_time = normalize_time_of_day(time_of_day)
    if not normalized_time:
        return None
    now = (reference or datetime.now(KST)).astimezone(KST).replace(second=0, microsecond=0)
    hour, minute = map(int, normalized_time.split(":"))
    latest_due: datetime | None = None
    for offset in range(0, 8):
        candidate = now - timedelta(days=offset)
        if candidate.weekday() not in weekdays:
            continue
        slot = candidate.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if slot <= now and (latest_due is None or slot > latest_due):
            latest_due = slot
    return latest_due.isoformat() if latest_due else None


def workflow_key_for_cadence(cadence: str) -> str:
    return WEEKLY_WORKFLOW_KEY if cadence == "weekly" else DAILY_WORKFLOW_KEY


def _has_active_pipeline_work(conn: sqlite3.Connection) -> bool:
    active_request = conn.execute(
        """
        SELECT 1 FROM pipeline_run_requests
        WHERE status IN ('requested', 'claimed', 'submitted', 'running', 'cancelling')
        LIMIT 1
        """
    ).fetchone()
    if active_request is not None:
        return True
    return conn.execute("SELECT 1 FROM collection_runs WHERE status IN ('queued', 'running') LIMIT 1").fetchone() is not None


def enqueue_pipeline_run_request(
    *,
    trigger_source: str,
    requested_by: str,
    cadence: str = "daily",
    workflow_key: str | None = None,
    payload_updates: dict[str, object] | None = None,
    metadata_updates: dict[str, object] | None = None,
) -> dict[str, object]:
    conn = get_connection()
    try:
        with conn:
            if _has_active_pipeline_work(conn):
                return {"ok": False, "reason": "active-run-exists"}
            target_sources = load_target_sources(conn)
            priority_targets = load_priority_targets(conn)
            resolved_workflow_key = workflow_key or workflow_key_for_cadence(cadence)
            payload: dict[str, object] = {
                "cadence": cadence,
                "workflowKey": resolved_workflow_key,
                "requestedFrom": trigger_source,
                "sources": target_sources,
                "targetSourceDomains": target_sources,
                "criteria": priority_targets,
                "sections": ["frontpage", "business", "tech", "lifestyle"],
                "limitPerSection": 5,
                "notification": "kakao",
            }
            if payload_updates:
                payload.update(payload_updates)
            metadata: dict[str, object] = {"submissionMode": "dispatcher", "dispatcher": "article-bot"}
            if metadata_updates:
                metadata.update(metadata_updates)
            conn.execute(
                """
                INSERT INTO pipeline_run_requests (
                  pipeline_key, workflow_key, trigger_source, requested_by, executor, status,
                  payload_json, requested_at, backend_metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    PIPELINE_KEY,
                    resolved_workflow_key,
                    trigger_source,
                    requested_by,
                    "local",
                    "requested",
                    json.dumps(payload, ensure_ascii=False),
                    now_iso(),
                    json.dumps(metadata, ensure_ascii=False),
                ),
            )
            request_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
            return {"ok": True, "requestId": request_id}
    finally:
        conn.close()


def cancel_active_pipeline_request(*, requested_by: str) -> dict[str, object]:
    conn = get_connection()
    timestamp = now_iso()
    try:
        with conn:
            row = conn.execute(
                """
                SELECT id, status, collection_run_id
                FROM pipeline_run_requests
                WHERE status IN ('requested', 'claimed', 'submitted', 'running', 'cancelling')
                ORDER BY requested_at DESC, id DESC
                LIMIT 1
                """
            ).fetchone()
            if row is None:
                return {"ok": False, "reason": "no-active-request"}
            request_id = int(row["id"])
            if str(row["status"]) in {"requested", "claimed"}:
                conn.execute(
                    """
                    UPDATE pipeline_run_requests
                    SET status = 'cancelled',
                        finished_at = COALESCE(finished_at, ?),
                        cancel_requested_at = COALESCE(cancel_requested_at, ?),
                        cancel_requested_by = COALESCE(cancel_requested_by, ?),
                        error_text = COALESCE(error_text, ?)
                    WHERE id = ?
                    """,
                    (timestamp, timestamp, requested_by, f"Cancelled from {requested_by}", request_id),
                )
                return {"ok": True, "requestId": request_id, "status": "cancelled"}
            conn.execute(
                """
                UPDATE pipeline_run_requests
                SET status = 'cancelling',
                    cancel_requested_at = COALESCE(cancel_requested_at, ?),
                    cancel_requested_by = COALESCE(cancel_requested_by, ?)
                WHERE id = ?
                """,
                (timestamp, requested_by, request_id),
            )
            return {"ok": True, "requestId": request_id, "status": "cancelling"}
    finally:
        conn.close()


def add_priority_target(label: str) -> dict[str, object]:
    normalized = " ".join(str(label).strip().split())[:60]
    if not normalized:
        return {"ok": False, "reason": "empty-label"}
    conn = get_connection()
    try:
        with conn:
            result = conn.execute(
                """
                INSERT OR IGNORE INTO priority_targets (label, sort_order)
                VALUES (?, COALESCE((SELECT MAX(sort_order) + 1 FROM priority_targets), 0))
                """,
                (normalized,),
            )
            return {"ok": result.rowcount > 0}
    finally:
        conn.close()


def delete_priority_target(target_id: int) -> dict[str, object]:
    conn = get_connection()
    try:
        with conn:
            result = conn.execute("DELETE FROM priority_targets WHERE id = ?", (target_id,))
            return {"ok": result.rowcount > 0}
    finally:
        conn.close()


def add_target_source(domain: str) -> dict[str, object]:
    normalized = normalize_target_source_domain(domain)
    if not normalized:
        return {"ok": False, "reason": "empty-domain"}
    conn = get_connection()
    try:
        with conn:
            result = conn.execute(
                """
                INSERT OR IGNORE INTO target_sources (domain, sort_order)
                VALUES (?, COALESCE((SELECT MAX(sort_order) + 1 FROM target_sources), 0))
                """,
                (normalized,),
            )
            return {"ok": result.rowcount > 0}
    finally:
        conn.close()


def delete_target_source(target_source_id: int) -> dict[str, object]:
    conn = get_connection()
    try:
        with conn:
            result = conn.execute("DELETE FROM target_sources WHERE id = ?", (target_source_id,))
            return {"ok": result.rowcount > 0}
    finally:
        conn.close()


def upsert_pipeline_schedule(*, schedule_key: str, weekdays: list[object], time_of_day: str) -> dict[str, object]:
    default = next((schedule for schedule in DEFAULT_PIPELINE_SCHEDULES if schedule["schedule_key"] == schedule_key), None)
    if default is None:
        return {"ok": False, "reason": "invalid-schedule-key"}
    normalized_time = normalize_time_of_day(time_of_day)
    if not normalized_time:
        return {"ok": False, "reason": "invalid-time"}
    cadence = str(default["cadence"])
    normalized_weekdays = normalize_schedule_weekdays(weekdays, allow_multiple=cadence == "daily")
    baseline_slot = most_recent_due_slot(normalized_weekdays, normalized_time)
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                UPDATE pipeline_schedules
                SET weekdays_json = ?,
                    time_of_day = ?,
                    last_enqueued_slot = ?,
                    updated_at = ?
                WHERE schedule_key = ?
                """,
                (json.dumps(normalized_weekdays), normalized_time, baseline_slot, now_iso(), schedule_key),
            )
            return {"ok": True}
    finally:
        conn.close()


def process_due_pipeline_schedules(conn: sqlite3.Connection) -> list[dict[str, object]]:
    enqueued: list[dict[str, object]] = []
    rows = conn.execute("SELECT * FROM pipeline_schedules ORDER BY id").fetchall()
    for row in rows:
        cadence = str(row["cadence"] or "daily")
        try:
            parsed_weekdays = json.loads(str(row["weekdays_json"] or "[]"))
        except json.JSONDecodeError:
            parsed_weekdays = []
        weekdays = normalize_schedule_weekdays(parsed_weekdays if isinstance(parsed_weekdays, list) else [], allow_multiple=cadence == "daily")
        due_slot = most_recent_due_slot(weekdays, str(row["time_of_day"] or ""))
        if due_slot is None or str(row["last_enqueued_slot"] or "") == due_slot:
            continue
        result = enqueue_pipeline_run_request(
            trigger_source="scheduler",
            requested_by=f"schedule:{row['schedule_key']}",
            cadence=cadence,
            workflow_key=workflow_key_for_cadence(cadence),
            payload_updates={
                "scheduleKey": str(row["schedule_key"]),
                "reportType": str(row["report_type"]),
                "scheduledFor": due_slot,
            },
        )
        if result.get("ok"):
            conn.execute(
                """
                UPDATE pipeline_schedules
                SET last_enqueued_slot = ?,
                    last_enqueued_at = ?,
                    updated_at = ?
                WHERE schedule_key = ?
                """,
                (due_slot, now_iso(), now_iso(), str(row["schedule_key"])),
            )
            enqueued.append({"scheduleKey": str(row["schedule_key"]), "requestId": result.get("requestId"), "dueSlot": due_slot})
    return enqueued


def claim_next_request(conn: sqlite3.Connection) -> sqlite3.Row | None:
    row = conn.execute(
        """
        SELECT *
        FROM pipeline_run_requests
        WHERE status = 'requested'
        ORDER BY requested_at ASC, id ASC
        LIMIT 1
        """
    ).fetchone()
    if row is None:
        return None
    conn.execute(
        """
        UPDATE pipeline_run_requests
        SET status = 'claimed',
            claimed_at = ?
        WHERE id = ?
          AND status = 'requested'
        """,
        (now_iso(), int(row["id"])),
    )
    conn.commit()
    return conn.execute("SELECT * FROM pipeline_run_requests WHERE id = ?", (int(row["id"]),)).fetchone()


def create_collection_run(conn: sqlite3.Connection, request: sqlite3.Row) -> int:
    payload = json.loads(str(request["payload_json"] or "{}"))
    cadence = str(payload.get("cadence") or "daily")
    source_scope = ",".join(payload.get("sources") or DEFAULT_TARGET_SOURCES)
    timestamp = now_iso()
    conn.execute(
        """
        INSERT INTO collection_runs (
          request_id, cadence, run_date, status, source_scope, executor, started_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (int(request["id"]), cadence, run_date(), "running", source_scope, str(request["executor"] or "local"), timestamp, timestamp),
    )
    run_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
    conn.execute("UPDATE pipeline_run_requests SET collection_run_id = ?, status = 'running', started_at = ? WHERE id = ?", (run_id, timestamp, int(request["id"])))
    for index, stage in enumerate(PIPELINE_STAGES):
        conn.execute(
            """
            INSERT INTO pipeline_run_steps (
              run_id, stage_key, stage_label, stage_detail, stage_order, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                stage["stage_key"],
                stage["stage_label"],
                stage["stage_detail"],
                index,
                "queued",
                timestamp,
            ),
        )
    conn.commit()
    return run_id


def update_step(conn: sqlite3.Connection, run_id: int, stage_key: str, status: str) -> None:
    conn.execute(
        "UPDATE pipeline_run_steps SET status = ?, updated_at = ? WHERE run_id = ? AND stage_key = ?",
        (status, now_iso(), run_id, stage_key),
    )
    conn.commit()


def add_artifact(conn: sqlite3.Connection, run_id: int, artifact_type: str, content: str, file_path: str | None = None) -> None:
    conn.execute(
        "INSERT INTO artifacts (run_id, artifact_type, content, file_path, created_at) VALUES (?, ?, ?, ?, ?)",
        (run_id, artifact_type, content, file_path, now_iso()),
    )
    conn.commit()


def finish_request(conn: sqlite3.Connection, request_id: int, run_id: int, status: str, *, error_text: str | None = None) -> None:
    timestamp = now_iso()
    conn.execute(
        "UPDATE collection_runs SET status = ?, finished_at = ?, notes = COALESCE(?, notes) WHERE id = ?",
        (status, timestamp, error_text, run_id),
    )
    conn.execute(
        """
        UPDATE pipeline_run_requests
        SET status = ?,
            finished_at = ?,
            error_text = COALESCE(?, error_text)
        WHERE id = ?
        """,
        (status, timestamp, error_text, request_id),
    )
    conn.commit()
