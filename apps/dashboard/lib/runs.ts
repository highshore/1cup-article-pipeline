import fs from "node:fs";
import path from "node:path";

import { getDb } from "@/lib/db";

export const PIPELINE_STAGES = [
  "refine_article",
  "summarize_article",
  "extract_discussion_topics",
  "extract_c1_vocab",
  "extract_atypical_terms",
  "translate_to_korean",
  "polish_korean_translation",
  "build_image_prompt",
  "generate_image",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type PipelineRunStatus = "queued" | "running" | "succeeded" | "failed";

export type PipelineRunRecord = {
  id: number;
  status: PipelineRunStatus;
  command: string;
  inputPath: string;
  outputDir: string;
  backend: string;
  skipImage: boolean;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  pid: number | null;
  totalArticles: number;
  completedArticles: number;
  succeededArticles: number;
  failedArticles: number;
  summaryPath: string | null;
  logFile: string | null;
  errorMessage: string | null;
};

export type PipelineRunArticle = {
  runId: number;
  articleId: string;
  title: string | null;
  status: string;
  currentStage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  outputPath: string | null;
  errorMessage: string | null;
  stageStatuses: Record<string, string>;
};

export type PipelineRunLog = {
  id: number;
  runId: number;
  createdAt: string;
  stream: string;
  level: string | null;
  message: string;
  rawLine: string;
  articleId: string | null;
  stage: string | null;
};

export type PipelineStageSummary = {
  stage: string;
  queued: number;
  running: number;
  success: number;
  failed: number;
  skipped: number;
};

export type PipelineRunOptions = {
  backend: string;
  inputPath: string;
  outputDir: string;
  skipImage: boolean;
};

type RunRow = {
  id: number;
  status: PipelineRunStatus;
  command: string;
  input_path: string;
  output_dir: string;
  backend: string;
  skip_image: number;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  pid: number | null;
  total_articles: number;
  completed_articles: number;
  succeeded_articles: number;
  failed_articles: number;
  summary_path: string | null;
  log_file: string | null;
  error_message: string | null;
};

export function createPipelineRun(options: PipelineRunOptions): number {
  const db = getDb();
  const normalized = normalizeRunOptions(options);
  const command = buildPipelineCommand(normalized);
  const totalArticles = listInputFiles(normalized.inputPath).length;

  const result = db
    .prepare(
      `
      INSERT INTO pipeline_runs (
        status,
        command,
        input_path,
        output_dir,
        backend,
        skip_image,
        requested_at,
        total_articles
      )
      VALUES ('queued', ?, ?, ?, ?, ?, datetime('now'), ?)
      `,
    )
    .run(command, normalized.inputPath, normalized.outputDir, normalized.backend, normalized.skipImage ? 1 : 0, totalArticles);

  return Number(result.lastInsertRowid);
}

export function listPipelineRuns(limit = 20): PipelineRunRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT *
      FROM pipeline_runs
      ORDER BY id DESC
      LIMIT ?
      `,
    )
    .all(limit) as RunRow[];

  return rows.map(toRunRecord);
}

export function getPipelineRun(runId: number): PipelineRunRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM pipeline_runs WHERE id = ? LIMIT 1").get(runId) as RunRow | undefined;
  return row ? toRunRecord(row) : null;
}

export function listPipelineRunLogs(runId: number, limit = 250): PipelineRunLog[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT id, run_id, created_at, stream, level, message, raw_line, article_id, stage
      FROM pipeline_run_logs
      WHERE run_id = ?
      ORDER BY id DESC
      LIMIT ?
      `,
    )
    .all(runId, limit) as Array<{
      id: number;
      run_id: number;
      created_at: string;
      stream: string;
      level: string | null;
      message: string;
      raw_line: string;
      article_id: string | null;
      stage: string | null;
    }>;

  return rows
    .reverse()
    .map((row) => ({
      id: row.id,
      runId: row.run_id,
      createdAt: row.created_at,
      stream: row.stream,
      level: row.level,
      message: row.message,
      rawLine: row.raw_line,
      articleId: row.article_id,
      stage: row.stage,
    }));
}

export function listPipelineRunArticles(runId: number): PipelineRunArticle[] {
  const db = getDb();
  const articleRows = db
    .prepare(
      `
      SELECT run_id, article_id, title, status, current_stage, started_at, completed_at, output_path, error_message
      FROM pipeline_run_articles
      WHERE run_id = ?
      ORDER BY article_id
      `,
    )
    .all(runId) as Array<{
      run_id: number;
      article_id: string;
      title: string | null;
      status: string;
      current_stage: string | null;
      started_at: string | null;
      completed_at: string | null;
      output_path: string | null;
      error_message: string | null;
    }>;

  const stageRows = db
    .prepare(
      `
      SELECT article_id, stage, status
      FROM pipeline_run_article_stages
      WHERE run_id = ?
      `,
    )
    .all(runId) as Array<{ article_id: string; stage: string; status: string }>;

  const stageMap = new Map<string, Record<string, string>>();
  for (const row of stageRows) {
    const stages = stageMap.get(row.article_id) ?? {};
    stages[row.stage] = row.status;
    stageMap.set(row.article_id, stages);
  }

  return articleRows.map((row) => ({
    runId: row.run_id,
    articleId: row.article_id,
    title: row.title,
    status: row.status,
    currentStage: row.current_stage,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    outputPath: row.output_path,
    errorMessage: row.error_message,
    stageStatuses: stageMap.get(row.article_id) ?? {},
  }));
}

export function getPipelineStageSummary(runId: number): PipelineStageSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT stage, status, COUNT(*) AS count
      FROM pipeline_run_article_stages
      WHERE run_id = ?
      GROUP BY stage, status
      `,
    )
    .all(runId) as Array<{ stage: string; status: string; count: number }>;

  const summaryMap = new Map<string, PipelineStageSummary>();
  for (const stage of PIPELINE_STAGES) {
    summaryMap.set(stage, {
      stage,
      queued: 0,
      running: 0,
      success: 0,
      failed: 0,
      skipped: 0,
    });
  }

  for (const row of rows) {
    const entry = summaryMap.get(row.stage);
    if (!entry) {
      continue;
    }
    if (row.status === "success") {
      entry.success = row.count;
    } else if (row.status === "failed") {
      entry.failed = row.count;
    } else if (row.status === "running") {
      entry.running = row.count;
    } else if (row.status === "skipped") {
      entry.skipped = row.count;
    } else {
      entry.queued = row.count;
    }
  }

  return PIPELINE_STAGES.map((stage) => summaryMap.get(stage) as PipelineStageSummary);
}

export function getDefaultRunOptions(): PipelineRunOptions {
  const root = path.resolve(process.cwd(), "..", "..");
  return {
    backend: "gemma4",
    inputPath: path.join(root, "input"),
    outputDir: path.join(root, "output"),
    skipImage: false,
  };
}

function buildPipelineCommand(options: PipelineRunOptions): string {
  const command = [
    "uv run article-pipeline",
    `--input-path ${shellEscape(options.inputPath)}`,
    `--output-dir ${shellEscape(options.outputDir)}`,
    `--backend ${shellEscape(options.backend)}`,
    "--disable-progress",
    "--log-level INFO",
  ];

  if (options.skipImage) {
    command.push("--skip-image");
  }

  return command.join(" ");
}

function listInputFiles(inputPath: string): string[] {
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

function normalizeRunOptions(options: PipelineRunOptions): PipelineRunOptions {
  return {
    backend: options.backend === "openai" ? "openai" : "gemma4",
    inputPath: path.resolve(options.inputPath),
    outputDir: path.resolve(options.outputDir),
    skipImage: Boolean(options.skipImage),
  };
}

function toRunRecord(row: RunRow): PipelineRunRecord {
  return {
    id: row.id,
    status: row.status,
    command: row.command,
    inputPath: row.input_path,
    outputDir: row.output_dir,
    backend: row.backend,
    skipImage: Boolean(row.skip_image),
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    exitCode: row.exit_code,
    pid: row.pid,
    totalArticles: row.total_articles,
    completedArticles: row.completed_articles,
    succeededArticles: row.succeeded_articles,
    failedArticles: row.failed_articles,
    summaryPath: row.summary_path,
    logFile: row.log_file,
    errorMessage: row.error_message,
  };
}

function shellEscape(value: string): string {
  return JSON.stringify(value);
}
