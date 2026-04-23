#!/usr/bin/env python3
"""Cron/manual helper for adding an article-bot pipeline request."""

from __future__ import annotations

import argparse
import json

from article_bot_store import enqueue_pipeline_run_request


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trigger-source", default="manual")
    parser.add_argument("--requested-by", default="cli")
    parser.add_argument("--cadence", choices=["daily", "weekly"], default="daily")
    args = parser.parse_args()

    result = enqueue_pipeline_run_request(
        trigger_source=args.trigger_source,
        requested_by=args.requested_by,
        cadence=args.cadence,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
