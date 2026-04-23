import path from "node:path";

import Database from "better-sqlite3";

declare global {
  var __dashboardDb: Database.Database | undefined;
}

export function resolveDbPath(): string {
  if (process.env.ARTICLE_DB_PATH) {
    return process.env.ARTICLE_DB_PATH;
  }

  return path.resolve(process.cwd(), "..", "..", "data", "crawler.sqlite3");
}

export function getDb(): Database.Database {
  if (!global.__dashboardDb) {
    global.__dashboardDb = new Database(resolveDbPath());
    global.__dashboardDb.pragma("journal_mode = WAL");
    global.__dashboardDb.pragma("foreign_keys = ON");
    ensureDashboardSchema(global.__dashboardDb);
  }

  return global.__dashboardDb;
}

function ensureDashboardSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS article_reviews (
      article_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'deferred', 'rejected')),
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_article_reviews_status
      ON article_reviews (status, updated_at);

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
      command TEXT NOT NULL,
      input_path TEXT NOT NULL,
      output_dir TEXT NOT NULL,
      backend TEXT NOT NULL,
      skip_image INTEGER NOT NULL DEFAULT 0,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      exit_code INTEGER,
      pid INTEGER,
      total_articles INTEGER NOT NULL DEFAULT 0,
      completed_articles INTEGER NOT NULL DEFAULT 0,
      succeeded_articles INTEGER NOT NULL DEFAULT 0,
      failed_articles INTEGER NOT NULL DEFAULT 0,
      summary_path TEXT,
      log_file TEXT,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status
      ON pipeline_runs (status, requested_at DESC);

    CREATE TABLE IF NOT EXISTS pipeline_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      stream TEXT NOT NULL,
      level TEXT,
      message TEXT NOT NULL,
      raw_line TEXT NOT NULL,
      article_id TEXT,
      stage TEXT,
      FOREIGN KEY(run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_run_logs_run_id
      ON pipeline_run_logs (run_id, id DESC);

    CREATE TABLE IF NOT EXISTS pipeline_run_articles (
      run_id INTEGER NOT NULL,
      article_id TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      current_stage TEXT,
      started_at TEXT,
      completed_at TEXT,
      output_path TEXT,
      error_message TEXT,
      PRIMARY KEY (run_id, article_id),
      FOREIGN KEY(run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pipeline_run_article_stages (
      run_id INTEGER NOT NULL,
      article_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, article_id, stage),
      FOREIGN KEY(run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
    );
  `);
}
