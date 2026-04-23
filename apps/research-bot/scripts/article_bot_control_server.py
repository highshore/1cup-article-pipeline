#!/usr/bin/env python3
"""Host-side control server for article-bot dashboard write actions."""

from __future__ import annotations

import argparse
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from article_bot_store import (
    add_priority_target,
    add_target_source,
    cancel_active_pipeline_request,
    delete_priority_target,
    delete_target_source,
    enqueue_pipeline_run_request,
    upsert_pipeline_schedule,
)


def parse_request_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    content_length = handler.headers.get("Content-Length")
    if not content_length:
        return {}
    raw_body = handler.rfile.read(int(content_length))
    if not raw_body:
        return {}
    parsed = json.loads(raw_body.decode("utf-8"))
    return parsed if isinstance(parsed, dict) else {}


class ControlRequestHandler(BaseHTTPRequestHandler):
    server_version = "ArticleBotControl/1.0"

    def _write_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._write_json(HTTPStatus.OK, {"ok": True})
            return
        self._write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not-found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            payload = parse_request_json(self)
        except json.JSONDecodeError:
            self._write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid-json"})
            return

        try:
            if self.path == "/pipeline-runs/request":
                result = enqueue_pipeline_run_request(
                    trigger_source=str(payload.get("triggerSource") or "dashboard"),
                    requested_by=str(payload.get("requestedBy") or "dashboard-ui"),
                )
                self._write_json(HTTPStatus.OK, result)
                return

            if self.path == "/pipeline-runs/stop":
                result = cancel_active_pipeline_request(
                    requested_by=str(payload.get("requestedBy") or "dashboard-ui"),
                )
                self._write_json(HTTPStatus.OK, result)
                return

            if self.path == "/priority-targets":
                intent = str(payload.get("intent") or "")
                if intent == "add":
                    self._write_json(HTTPStatus.OK, add_priority_target(str(payload.get("label") or "")))
                    return
                if intent == "delete" and isinstance(payload.get("targetId"), int):
                    self._write_json(HTTPStatus.OK, delete_priority_target(int(payload["targetId"])))
                    return
                self._write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid-intent"})
                return

            if self.path == "/target-sources":
                intent = str(payload.get("intent") or "")
                if intent == "add":
                    self._write_json(HTTPStatus.OK, add_target_source(str(payload.get("domain") or "")))
                    return
                if intent == "delete" and isinstance(payload.get("targetSourceId"), int):
                    self._write_json(HTTPStatus.OK, delete_target_source(int(payload["targetSourceId"])))
                    return
                self._write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid-intent"})
                return

            if self.path == "/pipeline-schedules":
                weekdays = payload.get("weekdays")
                result = upsert_pipeline_schedule(
                    schedule_key=str(payload.get("scheduleKey") or ""),
                    weekdays=weekdays if isinstance(weekdays, list) else [],
                    time_of_day=str(payload.get("timeOfDay") or ""),
                )
                self._write_json(HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_REQUEST, result)
                return

            self._write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not-found"})
        except Exception as exc:  # noqa: BLE001
            self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("ARTICLE_BOT_CONTROL_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("ARTICLE_BOT_CONTROL_PORT", "7721")))
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), ControlRequestHandler)
    print(f"[control] listening on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
