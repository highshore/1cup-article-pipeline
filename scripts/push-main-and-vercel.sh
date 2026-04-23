#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root"

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "main" ]]; then
  echo "Refusing to deploy from '$current_branch'. Switch to main first." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to deploy with uncommitted changes. Commit or stash first." >&2
  exit 1
fi

git push origin main

cd "$repo_root/apps/dashboard"
deploy_output="$(mktemp)"
trap 'rm -f "$deploy_output"' EXIT

npx vercel deploy --prod 2>&1 | tee "$deploy_output"

deployment_url="$(
  { grep -Eo 'https://[^[:space:]]+\.vercel\.app' "$deploy_output" || true; } \
    | grep -v '^https://1cupboard\.vercel\.app$' \
    | head -n 1 \
    || true
)"

if [[ -z "$deployment_url" ]]; then
  echo "Vercel deploy succeeded, but no deployment URL was detected for aliasing." >&2
  exit 1
fi

npx vercel alias set "${deployment_url#https://}" "${VERCEL_DEPLOY_ALIAS:-1cupboard.vercel.app}"
