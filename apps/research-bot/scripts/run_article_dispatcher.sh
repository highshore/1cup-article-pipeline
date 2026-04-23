#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."
exec python3 apps/research-bot/scripts/article_dispatcher.py "$@"
