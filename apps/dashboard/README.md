# Dashboard

Next.js dashboard for browsing `data/crawler.sqlite3`, reviewing crawled articles, and triggering pipeline runs with DB-backed history and logs.

## Why it lives here

This repo is primarily a Python pipeline under `src/`, so the dashboard sits in `apps/dashboard` as a separate frontend workspace instead of mixing Node files into the root.

## Commands

```bash
cd apps/dashboard
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Environment

The source `.env.local` lives at the repository root. The dashboard npm scripts automatically create
`apps/dashboard/.env.local` as a symlink to `../../.env.local` when that link is missing, so the Next.js
sub-app reads the shared env file without duplicating secrets.

Optional auth controls:

Authorization is now designed to live in Supabase instead of env vars:

- `dashboard_user_access.role = 'supreme_leader'` can manage access records
- `dashboard_user_access.role = 'authorized'` can enter the dashboard after Kakao sign-in
- `dashboard_user_access.role = 'pending'` is created automatically when an unknown signed-in user first attempts access
- `dashboard_user_access.role = 'blocked'` is explicitly denied

The first signed-in user is bootstrapped as `supreme_leader` if no leader exists yet. After that, access is managed from the `/access` page.

## Database path

By default the app reads:

```text
../../data/crawler.sqlite3
```

Override with:

```bash
ARTICLE_DB_PATH=/absolute/path/to/crawler.sqlite3 npm run dev
```

## Review state

The dashboard creates a separate `article_reviews` table inside the same SQLite database on first load. It does not modify `crawled_articles`.
