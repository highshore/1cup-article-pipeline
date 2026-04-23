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
npx vercel deploy --prod
