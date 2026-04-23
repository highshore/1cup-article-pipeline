#!/usr/bin/env python3
"""Poll due schedules and queued article-bot requests."""

from __future__ import annotations

import argparse
import subprocess
import sys
import time

from article_bot_store import claim_next_request, get_connection, process_due_pipeline_schedules


def dispatch_once() -> bool:
    conn = get_connection()
    try:
        process_due_pipeline_schedules(conn)
        request = claim_next_request(conn)
        if request is None:
            return False
        request_id = int(request["id"])
    finally:
        conn.close()

    command = [
        sys.executable,
        "apps/research-bot/scripts/execute_pipeline_request.py",
        "--request-id",
        str(request_id),
    ]
    print(f"[dispatcher] executing request {request_id}")
    subprocess.run(command, check=False)
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval-seconds", type=float, default=10.0)
    args = parser.parse_args()

    if args.once:
        dispatch_once()
        return 0

    print("[dispatcher] polling article-bot queue")
    while True:
      dispatched = dispatch_once()
      if not dispatched:
          time.sleep(max(1.0, args.interval_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
