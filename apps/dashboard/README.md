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
