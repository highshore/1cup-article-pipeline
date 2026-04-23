#!/usr/bin/env python3
"""Supabase/Postgres queue/control helpers owned by apps/research-bot."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

from article_bot_env import load_root_env

load_root_env()

KST = timezone(timedelta(hours=9))
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


class SupabaseStore:
    """Small PostgREST/RPC client so the worker can run without extra Python deps."""

    def __init__(self) -> None:
        url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
        if not (url and key):
            raise RuntimeError("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for article-bot queue access.")
        self.base_url = url.rstrip("/")
        self.key = key

    def close(self) -> None:
        return

    def table(self, table: str, *, query: dict[str, str] | None = None) -> Any:
        return self._request("GET", f"/rest/v1/{table}", query=query)

    def insert(self, table: str, payload: dict[str, Any] | list[dict[str, Any]], *, returning: bool = False) -> Any:
        return self._request("POST", f"/rest/v1/{table}", payload, prefer="return=representation" if returning else "return=minimal")

    def update(self, table: str, payload: dict[str, Any], *, query: dict[str, str]) -> Any:
        return self._request("PATCH", f"/rest/v1/{table}", payload, query=query, prefer="return=minimal")

    def delete(self, table: str, *, query: dict[str, str]) -> Any:
        return self._request("DELETE", f"/rest/v1/{table}", query=query, prefer="return=minimal")

    def rpc(self, name: str, payload: dict[str, Any] | None = None) -> Any:
        return self._request("POST", f"/rest/v1/rpc/{name}", payload or {})

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | list[dict[str, Any]] | None = None,
        *,
        query: dict[str, str] | None = None,
        prefer: str | None = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        if query:
            url = f"{url}?{urllib.parse.urlencode(query)}"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Accept": "application/json",
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase {method} {path} failed ({exc.code}): {error_body}") from exc
        if not response_body:
            return None
        return json.loads(response_body)


def now_iso() -> str:
    return datetime.now(KST).replace(microsecond=0).isoformat()


def run_date() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


def get_connection() -> SupabaseStore:
    return SupabaseStore()


def normalize_target_source_domain(value: str) -> str:
    collapsed = " ".join(str(value).strip().split()).lower()
    if not collapsed:
        return ""
    parsed = urllib.parse.urlparse(collapsed if "://" in collapsed else f"https://{collapsed}")
    host = (parsed.netloc or parsed.path or "").split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    return host.replace("www.", "", 1).strip(".")


def load_target_sources(store: SupabaseStore) -> list[str]:
    rows = store.table("target_sources", query={"select": "domain", "order": "sort_order.asc,id.asc"})
    values = [str(row.get("domain", "")).strip().lower() for row in rows if str(row.get("domain", "")).strip()]
    return values or DEFAULT_TARGET_SOURCES


def load_priority_targets(store: SupabaseStore) -> list[str]:
    rows = store.table("priority_targets", query={"select": "label", "order": "sort_order.asc,id.asc"})
    values = [str(row.get("label", "")).strip() for row in rows if str(row.get("label", "")).strip()]
    return values or DEFAULT_PRIORITY_TARGETS


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


def enqueue_pipeline_run_request(
    *,
    trigger_source: str,
    requested_by: str,
    cadence: str = "daily",
    workflow_key: str | None = None,
    payload_updates: dict[str, object] | None = None,
    metadata_updates: dict[str, object] | None = None,
) -> dict[str, object]:
    store = get_connection()
    try:
        target_sources = load_target_sources(store)
        priority_targets = load_priority_targets(store)
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
        result = store.rpc(
            "article_bot_enqueue_pipeline_request",
            {
                "p_trigger_source": trigger_source,
                "p_requested_by": requested_by,
                "p_cadence": cadence,
                "p_workflow_key": resolved_workflow_key,
                "p_payload_json": payload,
                "p_backend_metadata_json": metadata,
            },
        )
        return result if isinstance(result, dict) else {"ok": False, "reason": "invalid-rpc-result"}
    finally:
        store.close()


def cancel_active_pipeline_request(*, requested_by: str) -> dict[str, object]:
    store = get_connection()
    try:
        result = store.rpc("article_bot_cancel_active_pipeline_request", {"p_requested_by": requested_by})
        return result if isinstance(result, dict) else {"ok": False, "reason": "invalid-rpc-result"}
    finally:
        store.close()


def add_priority_target(label: str) -> dict[str, object]:
    normalized = " ".join(str(label).strip().split())[:60]
    if not normalized:
        return {"ok": False, "reason": "empty-label"}
    store = get_connection()
    try:
        rows = store.table("priority_targets", query={"select": "sort_order", "order": "sort_order.desc", "limit": "1"})
        next_order = int(rows[0]["sort_order"]) + 1 if rows else 0
        store.insert("priority_targets", {"label": normalized, "sort_order": next_order})
        return {"ok": True}
    finally:
        store.close()


def delete_priority_target(target_id: int) -> dict[str, object]:
    store = get_connection()
    try:
        store.delete("priority_targets", query={"id": f"eq.{target_id}"})
        return {"ok": True}
    finally:
        store.close()


def add_target_source(domain: str) -> dict[str, object]:
    normalized = normalize_target_source_domain(domain)
    if not normalized:
        return {"ok": False, "reason": "empty-domain"}
    store = get_connection()
    try:
        rows = store.table("target_sources", query={"select": "sort_order", "order": "sort_order.desc", "limit": "1"})
        next_order = int(rows[0]["sort_order"]) + 1 if rows else 0
        store.insert("target_sources", {"domain": normalized, "sort_order": next_order})
        return {"ok": True}
    finally:
        store.close()


def delete_target_source(target_source_id: int) -> dict[str, object]:
    store = get_connection()
    try:
        store.delete("target_sources", query={"id": f"eq.{target_source_id}"})
        return {"ok": True}
    finally:
        store.close()


def upsert_pipeline_schedule(*, schedule_key: str, weekdays: list[object], time_of_day: str) -> dict[str, object]:
    cadence = "weekly" if schedule_key == "weekly_kakao_report" else "daily"
    if schedule_key not in {"daily_kakao_report", "weekly_kakao_report"}:
        return {"ok": False, "reason": "invalid-schedule-key"}
    normalized_time = normalize_time_of_day(time_of_day)
    if not normalized_time:
        return {"ok": False, "reason": "invalid-time"}
    normalized_weekdays = normalize_schedule_weekdays(weekdays, allow_multiple=cadence == "daily")
    baseline_slot = most_recent_due_slot(normalized_weekdays, normalized_time)
    store = get_connection()
    try:
        store.update(
            "pipeline_schedules",
            {
                "weekdays_json": normalized_weekdays,
                "time_of_day": normalized_time,
                "last_enqueued_slot": baseline_slot,
                "updated_at": now_iso(),
            },
            query={"schedule_key": f"eq.{schedule_key}"},
        )
        return {"ok": True}
    finally:
        store.close()


def process_due_pipeline_schedules(store: SupabaseStore) -> list[dict[str, object]]:
    enqueued: list[dict[str, object]] = []
    rows = store.table(
        "pipeline_schedules",
        query={"select": "*", "order": "id.asc"},
    )
    for row in rows:
        cadence = str(row.get("cadence") or "daily")
        parsed_weekdays = row.get("weekdays_json") if isinstance(row.get("weekdays_json"), list) else []
        weekdays = normalize_schedule_weekdays(parsed_weekdays, allow_multiple=cadence == "daily")
        due_slot = most_recent_due_slot(weekdays, str(row.get("time_of_day") or ""))
        if due_slot is None or str(row.get("last_enqueued_slot") or "") == due_slot:
            continue
        result = enqueue_pipeline_run_request(
            trigger_source="scheduler",
            requested_by=f"schedule:{row.get('schedule_key')}",
            cadence=cadence,
            workflow_key=workflow_key_for_cadence(cadence),
            payload_updates={
                "scheduleKey": str(row.get("schedule_key")),
                "reportType": str(row.get("report_type")),
                "scheduledFor": due_slot,
            },
        )
        if result.get("ok"):
            store.update(
                "pipeline_schedules",
                {
                    "last_enqueued_slot": due_slot,
                    "last_enqueued_at": now_iso(),
                    "updated_at": now_iso(),
                },
                query={"schedule_key": f"eq.{row.get('schedule_key')}"},
            )
            enqueued.append({"scheduleKey": str(row.get("schedule_key")), "requestId": result.get("requestId"), "dueSlot": due_slot})
    return enqueued


def claim_next_request(store: SupabaseStore) -> dict[str, Any] | None:
    result = store.rpc("article_bot_claim_next_request")
    return result if isinstance(result, dict) and result.get("id") is not None else None


def get_request_by_id(store: SupabaseStore, request_id: int) -> dict[str, Any] | None:
    rows = store.table("pipeline_run_requests", query={"select": "*", "id": f"eq.{request_id}", "limit": "1"})
    return rows[0] if rows else None


def create_collection_run(store: SupabaseStore, request: dict[str, Any]) -> int:
    result = store.rpc("article_bot_create_collection_run", {"p_request_id": int(request["id"])})
    return int(result)


def update_step(store: SupabaseStore, run_id: int, stage_key: str, status: str) -> None:
    store.update(
        "pipeline_run_steps",
        {"status": status, "updated_at": now_iso()},
        query={"run_id": f"eq.{run_id}", "stage_key": f"eq.{stage_key}"},
    )


def add_artifact(store: SupabaseStore, run_id: int, artifact_type: str, content: str, file_path: str | None = None) -> None:
    store.insert(
        "artifacts",
        {
            "run_id": run_id,
            "artifact_type": artifact_type,
            "content": content,
            "file_path": file_path,
            "created_at": now_iso(),
        },
    )


def add_article_evaluation(
    store: SupabaseStore,
    *,
    run_id: int,
    article_id: str,
    url: str,
    title: str,
    source: str,
    score: float,
    criteria: dict[str, float],
    notes: str,
) -> None:
    store.insert(
        "article_evaluations",
        {
            "run_id": run_id,
            "article_id": article_id,
            "url": url,
            "title": title,
            "source": source,
            "score": score,
            "criteria_json": criteria,
            "notes": notes,
            "created_at": now_iso(),
        },
    )


def finish_request(store: SupabaseStore, request_id: int, run_id: int, status: str, *, error_text: str | None = None) -> None:
    timestamp = now_iso()
    run_payload: dict[str, Any] = {"status": status, "finished_at": timestamp}
    if error_text:
        run_payload["notes"] = error_text
    store.update("collection_runs", run_payload, query={"id": f"eq.{run_id}"})
    payload: dict[str, Any] = {"status": status, "finished_at": timestamp}
    if error_text:
        payload["error_text"] = error_text
    store.update("pipeline_run_requests", payload, query={"id": f"eq.{request_id}"})
