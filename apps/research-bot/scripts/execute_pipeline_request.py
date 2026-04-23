#!/usr/bin/env python3
"""Execute one claimed article-bot pipeline request."""

from __future__ import annotations

import argparse
import json
import traceback

from article_bot_store import create_collection_run, finish_request, get_connection, get_request_by_id
from run_article_research_graph import run_article_research_graph


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request-id", type=int, required=True)
    args = parser.parse_args()

    conn = get_connection()
    request = get_request_by_id(conn, args.request_id)
    if request is None:
        print(json.dumps({"ok": False, "error": "request-not-found", "requestId": args.request_id}))
        return 1

    run_id = create_collection_run(conn, request)
    try:
        result = run_article_research_graph(conn=conn, request=request, run_id=run_id)
        finish_request(conn, args.request_id, run_id, "success")
        print(json.dumps({"ok": True, "requestId": args.request_id, "runId": run_id, "result": result}, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001
        error_text = f"{exc}\n{traceback.format_exc(limit=8)}"
        finish_request(conn, args.request_id, run_id, "failed", error_text=error_text)
        print(json.dumps({"ok": False, "requestId": args.request_id, "runId": run_id, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
