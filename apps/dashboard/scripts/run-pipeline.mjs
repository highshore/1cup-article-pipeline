import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

import Database from "better-sqlite3";

const PIPELINE_STAGES = [
  "refine_article",
  "summarize_article",
  "extract_discussion_topics",
  "extract_c1_vocab",
  "extract_atypical_terms",
  "translate_to_korean",
  "polish_korean_translation",
  "build_image_prompt",
  "generate_image",
];

const runId = Number(process.argv[2] ?? "0");
if (!runId) {
  throw new Error("Usage: node scripts/run-pipeline.mjs <runId>");
}

const dbPath = process.env.ARTICLE_DB_PATH;
if (!dbPath) {
  throw new Error("Missing ARTICLE_DB_PATH");
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const run = db.prepare("SELECT * FROM pipeline_runs WHERE id = ? LIMIT 1").get(runId);
if (!run) {
  throw new Error(`Run ${runId} not found`);
}

const requestedAt = isoNow();
db.prepare(
  `
  UPDATE pipeline_runs
  SET status = 'running', started_at = ?, pid = ?, error_message = NULL
  WHERE id = ?
  `,
).run(requestedAt, process.pid, runId);

primeRunArticles(runId, run.input_path);

const commandArgs = [
  "run",
  "article-pipeline",
  "--input-path",
  run.input_path,
  "--output-dir",
  run.output_dir,
  "--backend",
  run.backend,
  "--disable-progress",
  "--log-level",
  "INFO",
];

if (run.skip_image) {
  commandArgs.push("--skip-image");
}

const child = spawn("uv", commandArgs, {
  cwd: path.resolve(process.cwd(), "..", ".."),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

db.prepare("UPDATE pipeline_runs SET pid = ? WHERE id = ?").run(child.pid ?? null, runId);

consumeStream("stdout", child.stdout);
consumeStream("stderr", child.stderr);

child.on("close", (code) => {
  finalizeRun(code ?? 1);
  db.close();
});

function consumeStream(streamName, stream) {
  const reader = readline.createInterface({ input: stream });
  reader.on("line", (line) => {
    handleLogLine(streamName, line);
  });
}

function handleLogLine(stream, line) {
  const parsed = parseStructuredLine(line);
  const message = parsed.message;
  const timestamp = isoNow();
  const details = extractMessageDetails(message);

  db.prepare(
    `
    INSERT INTO pipeline_run_logs (run_id, created_at, stream, level, message, raw_line, article_id, stage)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(runId, timestamp, stream, parsed.level, message, line, details.articleId, details.stage);

  applyMessageEffects(timestamp, details);
}

function applyMessageEffects(timestamp, details) {
  if (details.kind === "article_start") {
    db.prepare(
      `
      UPDATE pipeline_run_articles
      SET status = 'running', started_at = COALESCE(started_at, ?)
      WHERE run_id = ? AND article_id = ?
      `,
    ).run(timestamp, runId, details.articleId);
    return;
  }

  if (details.kind === "stage_attempt") {
    db.prepare(
      `
      INSERT INTO pipeline_run_article_stages (run_id, article_id, stage, status, attempts, updated_at)
      VALUES (?, ?, ?, 'running', ?, ?)
      ON CONFLICT(run_id, article_id, stage) DO UPDATE SET
        status = 'running',
        attempts = excluded.attempts,
        updated_at = excluded.updated_at
      `,
    ).run(runId, details.articleId, details.stage, details.attempts, timestamp);

    db.prepare(
      `
      UPDATE pipeline_run_articles
      SET current_stage = ?, status = CASE WHEN status = 'queued' THEN 'running' ELSE status END
      WHERE run_id = ? AND article_id = ?
      `,
    ).run(details.stage, runId, details.articleId);
    return;
  }

  if (details.kind === "stage_complete" || details.kind === "stage_failed" || details.kind === "stage_skipped") {
    const status =
      details.kind === "stage_complete" ? "success" : details.kind === "stage_failed" ? "failed" : "skipped";
    db.prepare(
      `
      INSERT INTO pipeline_run_article_stages (run_id, article_id, stage, status, attempts, updated_at)
      VALUES (?, ?, ?, ?, COALESCE((SELECT attempts FROM pipeline_run_article_stages WHERE run_id = ? AND article_id = ? AND stage = ?), 0), ?)
      ON CONFLICT(run_id, article_id, stage) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at
      `,
    ).run(runId, details.articleId, details.stage, status, runId, details.articleId, details.stage, timestamp);

    if (details.kind === "stage_failed") {
      db.prepare(
        `
        UPDATE pipeline_run_articles
        SET status = 'running', current_stage = ?, error_message = ?
        WHERE run_id = ? AND article_id = ?
        `,
      ).run(details.stage, details.errorMessage ?? null, runId, details.articleId);
    }
    return;
  }

  if (details.kind === "article_output") {
    const articleStatus = inspectArticleOutput(details.outputPath);
    db.prepare(
      `
      UPDATE pipeline_run_articles
      SET status = ?, completed_at = ?, output_path = ?, current_stage = NULL, error_message = ?
      WHERE run_id = ? AND article_id = ?
      `,
    ).run(articleStatus.status, timestamp, details.outputPath, articleStatus.errorMessage, runId, details.articleId);
    refreshRunCounts();
    return;
  }

  if (details.kind === "run_summary") {
    db.prepare("UPDATE pipeline_runs SET summary_path = ? WHERE id = ?").run(details.summaryPath, runId);
  }
}

function finalizeRun(exitCode) {
  const summaryPath = path.join(run.output_dir, "run_summary.json");
  let summary = null;
  if (fs.existsSync(summaryPath)) {
    try {
      summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    } catch {
      summary = null;
    }
  }

  refreshRunCounts();

  db.prepare(
    `
    UPDATE pipeline_runs
    SET status = ?, finished_at = ?, exit_code = ?, summary_path = ?, log_file = ?, error_message = COALESCE(error_message, ?)
    WHERE id = ?
    `,
  ).run(
    exitCode === 0 ? "succeeded" : "failed",
    isoNow(),
    exitCode,
    summaryPath,
    summary?.log_file ?? null,
    exitCode === 0 ? null : "Pipeline exited with a non-zero status",
    runId,
  );
}

function refreshRunCounts() {
  const stats = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('succeeded', 'failed') THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM pipeline_run_articles
      WHERE run_id = ?
      `,
    )
    .get(runId);

  db.prepare(
    `
    UPDATE pipeline_runs
    SET total_articles = COALESCE(?, total_articles),
        completed_articles = COALESCE(?, 0),
        succeeded_articles = COALESCE(?, 0),
        failed_articles = COALESCE(?, 0)
    WHERE id = ?
    `,
  ).run(stats.total ?? 0, stats.completed ?? 0, stats.succeeded ?? 0, stats.failed ?? 0, runId);
}

function primeRunArticles(currentRunId, inputPath) {
  const files = listInputFiles(inputPath);
  for (const filePath of files) {
    const articleId = path.basename(filePath, ".txt");
    const title = readArticleTitle(filePath);
    db.prepare(
      `
      INSERT INTO pipeline_run_articles (run_id, article_id, title, status)
      VALUES (?, ?, ?, 'queued')
      ON CONFLICT(run_id, article_id) DO NOTHING
      `,
    ).run(currentRunId, articleId, title);

    for (const stage of PIPELINE_STAGES) {
      db.prepare(
        `
        INSERT INTO pipeline_run_article_stages (run_id, article_id, stage, status, attempts, updated_at)
        VALUES (?, ?, ?, 'queued', 0, ?)
        ON CONFLICT(run_id, article_id, stage) DO NOTHING
        `,
      ).run(currentRunId, articleId, stage, isoNow());
    }
  }

  db.prepare("UPDATE pipeline_runs SET total_articles = ? WHERE id = ?").run(files.length, currentRunId);
}

function listInputFiles(inputPath) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    return [];
  }

  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return resolved.endsWith(".txt") ? [resolved] : [];
  }

  return fs
    .readdirSync(resolved)
    .filter((entry) => entry.endsWith(".txt"))
    .map((entry) => path.join(resolved, entry))
    .sort();
}

function readArticleTitle(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf-8");
    const match = text.match(/^\s*Title:\s*(.+)\s*$/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function inspectArticleOutput(outputPath) {
  try {
    const payload = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    if (errors.length > 0) {
      return {
        status: "failed",
        errorMessage: errors
          .map((error) => `${error.stage ?? "unknown"}: ${error.message ?? "error"}`)
          .join(" | "),
      };
    }
  } catch {
    return {
      status: "failed",
      errorMessage: "Could not read article output JSON",
    };
  }

  return {
    status: "succeeded",
    errorMessage: null,
  };
}

function parseStructuredLine(line) {
  const match = line.match(/^\d{4}-\d{2}-\d{2} .*?\|\s*([A-Z]+)\s*\|\s*(.*)$/);
  if (!match) {
    return {
      level: null,
      message: line.trim(),
    };
  }

  return {
    level: match[1],
    message: match[2],
  };
}

function extractMessageDetails(message) {
  let match = message.match(/^Starting article pipeline for '([^']+)'$/);
  if (match) {
    return { kind: "article_start", articleId: match[1], stage: null };
  }

  match = message.match(/^Stage '([^:]+):([^']+)' attempt (\d+)\/(\d+)$/);
  if (match) {
    return {
      kind: "stage_attempt",
      articleId: match[1],
      stage: match[2],
      attempts: Number(match[3]),
    };
  }

  match = message.match(/^Stage '([^:]+):([^']+)' completed in ([\d.]+)s$/);
  if (match) {
    return { kind: "stage_complete", articleId: match[1], stage: match[2] };
  }

  match = message.match(/^Stage '([^:]+):([^']+)' failed after \d+ attempt\(s\): \[[^\]]+\] (.+)$/);
  if (match) {
    return {
      kind: "stage_failed",
      articleId: match[1],
      stage: match[2],
      errorMessage: match[3],
    };
  }

  match = message.match(/^Stage '([^:]+):([^']+)' skipped: (.+)$/);
  if (match) {
    return {
      kind: "stage_skipped",
      articleId: match[1],
      stage: match[2],
      errorMessage: match[3],
    };
  }

  match = message.match(/^Wrote article output for '([^']+)' to '([^']+)'$/);
  if (match) {
    return {
      kind: "article_output",
      articleId: match[1],
      stage: null,
      outputPath: match[2],
    };
  }

  match = message.match(/^Wrote run summary to '([^']+)'$/);
  if (match) {
    return {
      kind: "run_summary",
      articleId: null,
      stage: null,
      summaryPath: match[1],
    };
  }

  return { kind: "other", articleId: null, stage: null };
}

function isoNow() {
  return new Date().toISOString();
}
