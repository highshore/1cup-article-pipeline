import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { listArticles, getSources, type ReviewStatus } from "@/lib/articles";

export type ArticleDashboardFilters = {
  source: string;
  phase: string;
  status: ReviewStatus | "all";
  collectedOn: string;
  search: string;
};

export type ArticleDashboardItem = {
  id: number;
  articleId: string;
  title: string;
  source: string;
  section: string;
  phase: string;
  status: ReviewStatus;
  summary: string;
  url: string;
  crawledAt: string;
  mediaCount: number;
  score: number;
  tags: string[];
  relevanceNotes: string;
};

export type DashboardMetric = {
  label: string;
  value: string;
  detail: string;
};

export type PriorityTarget = {
  id: number;
  label: string;
};

export type TargetSource = {
  id: number;
  domain: string;
};

export type PipelineScheduleKey = "daily_kakao_report" | "weekly_kakao_report";

export type PipelineSchedule = {
  id: number;
  scheduleKey: PipelineScheduleKey;
  reportType: string;
  cadence: "daily" | "weekly";
  weekdays: number[];
  timeOfDay: string;
  timezoneName: string;
  lastEnqueuedSlot: string | null;
  lastEnqueuedAt: string | null;
  updatedAt: string;
};

export type PipelineRunRequest = {
  id: number;
  pipelineKey: string;
  workflowKey: string;
  triggerSource: string;
  requestedBy: string | null;
  executor: string;
  status: string;
  payloadJson: string | null;
  requestedAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequestedAt: string | null;
  cancelRequestedBy: string | null;
  collectionRunId: number | null;
  backendMetadataJson: string | null;
  errorText: string | null;
};

export type PipelineRunRecord = {
  id: number;
  recordType: "run" | "request";
  requestId: number | null;
  collectionRunId: number | null;
  cadence: string;
  runDate: string;
  status: string;
  sourceScope: string;
  recordedAt: string;
};

export type PipelineFlowStep = {
  id: number;
  runId: number;
  stageKey: string;
  stageLabel: string;
  stageDetail: string;
  stageOrder: number;
  status: string;
  updatedAt: string;
};

export type ArticleDashboardData = {
  filters: ArticleDashboardFilters;
  metrics: DashboardMetric[];
  items: ArticleDashboardItem[];
  totalItems: number;
  pipelineRuns: PipelineRunRecord[];
  latestPipelineRun: PipelineRunRecord | null;
  activePipelineRequest: PipelineRunRequest | null;
  isPipelineRunning: boolean;
  pipelineFlowSteps: PipelineFlowStep[];
  priorityTargets: PriorityTarget[];
  targetSources: TargetSource[];
  pipelineSchedules: PipelineSchedule[];
  sourceOptions: string[];
  phaseOptions: string[];
  statusOptions: string[];
  latestCollectedAt: string;
};

type ScheduleRow = Omit<PipelineSchedule, "weekdays"> & {
  weekdaysJson: string;
};

type RequestRow = {
  id: number;
  pipeline_key: string;
  workflow_key: string;
  trigger_source: string;
  requested_by: string | null;
  executor: string;
  status: string;
  payload_json: string | null;
  requested_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested_at: string | null;
  cancel_requested_by: string | null;
  collection_run_id: number | null;
  backend_metadata_json: string | null;
  error_text: string | null;
};

const BOT_DB_PATH = process.env.ARTICLE_BOT_DB_PATH
  ? path.resolve(process.env.ARTICLE_BOT_DB_PATH)
  : path.resolve(process.cwd(), "..", "research-bot", "data", "article-dashboard.sqlite");

const PAGE_SIZE = 10;

const stageDefinitions = [
  {
    stageKey: "load_settings",
    stageLabel: "Load criteria",
    stageDetail: "Read target sources, evaluation criteria, schedule metadata, and run options.",
  },
  {
    stageKey: "crawl_sources",
    stageLabel: "Crawl WSJ / FT",
    stageDetail: "Collect fresh stories from Wall Street Journal and Financial Times sections.",
  },
  {
    stageKey: "normalize_articles",
    stageLabel: "Normalize articles",
    stageDetail: "Canonicalize URLs, fold duplicates, and prepare crawler rows for evaluation.",
  },
  {
    stageKey: "evaluate_articles",
    stageLabel: "Evaluate fit",
    stageDetail: "Score articles against lesson value, C1 vocabulary, discussion potential, and business relevance.",
  },
  {
    stageKey: "process_articles",
    stageLabel: "Process outputs",
    stageDetail: "Run translation, summaries, discussion prompts, vocabulary extraction, and media sidecars.",
  },
  {
    stageKey: "deliver_kakao",
    stageLabel: "Notify Kakao",
    stageDetail: "Build a compact Kakao-ready brief with links back to the dashboard.",
  },
] as const;

const defaultPriorityTargets = [
  "C1 vocabulary density",
  "Discussion readiness",
  "Korean translation quality",
  "Business relevance",
  "Chart / media usefulness",
];

const defaultTargetSources = ["wsj.com", "ft.com"];

const defaultPipelineSchedules: PipelineSchedule[] = [
  {
    id: -1,
    scheduleKey: "daily_kakao_report",
    reportType: "daily-kakao-report",
    cadence: "daily",
    weekdays: [],
    timeOfDay: "09:00",
    timezoneName: "Asia/Seoul",
    lastEnqueuedSlot: null,
    lastEnqueuedAt: null,
    updatedAt: "",
  },
  {
    id: -2,
    scheduleKey: "weekly_kakao_report",
    reportType: "weekly-kakao-report",
    cadence: "weekly",
    weekdays: [],
    timeOfDay: "09:00",
    timezoneName: "Asia/Seoul",
    lastEnqueuedSlot: null,
    lastEnqueuedAt: null,
    updatedAt: "",
  },
];

export function getDefaultArticleDashboardFilters(
  values: {
    source?: string;
    phase?: string;
    status?: string;
    collectedOn?: string;
    search?: string;
  } = {},
): ArticleDashboardFilters {
  return {
    source: normalizeOption(values.source),
    phase: normalizeOption(values.phase),
    status: isReviewStatus(values.status) || values.status === "all" ? values.status : "all",
    collectedOn: values.collectedOn ?? "",
    search: values.search ?? "",
  };
}

export async function getArticleDashboardData(
  filters: ArticleDashboardFilters,
): Promise<ArticleDashboardData> {
  const [items, totalItems, allArticles, sources] = await Promise.all([
    getArticleDashboardItems(filters, { limit: PAGE_SIZE, offset: 0 }),
    getArticleDashboardItemCount(filters),
    listArticles({ source: "all", status: "all", query: "" }),
    getSources(),
  ]);
  const db = getBotDb();
  const priorityTargets = listPriorityTargets(db);
  const targetSources = listTargetSources(db);
  const pipelineSchedules = listPipelineSchedules(db);
  const pipelineRuns = listPipelineRunRecords(db, 12);
  const activePipelineRequest = getActivePipelineRequest(db);
  const latestPipelineRun = pipelineRuns[0] ?? null;
  const isPipelineRunning = Boolean(activePipelineRequest) || latestPipelineRun?.status === "queued" || latestPipelineRun?.status === "running";
  const flowSteps = getPipelineFlowSteps(db, latestPipelineRun, activePipelineRequest);
  const latestCollectedAt = allArticles[0]?.crawledAt ?? "";
  const sourceSet = Array.from(new Set([...sources, ...allArticles.map((article) => article.source)].filter(Boolean))).sort();
  const phaseSet = Array.from(new Set(allArticles.map((article) => article.phase).filter(Boolean))).sort();
  const sourceCount = sourceSet.length;
  const pendingCount = allArticles.filter((article) => article.status === "pending").length;
  const processedCount = allArticles.filter((article) => article.phase === "processed").length;

  return {
    filters,
    metrics: [
      {
        label: "Articles",
        value: String(allArticles.length),
        detail: `${totalItems} match the current dashboard filters.`,
      },
      {
        label: "Pending review",
        value: String(pendingCount),
        detail: "Rows waiting for an editorial decision before downstream use.",
      },
      {
        label: "Processed",
        value: String(processedCount),
        detail: "Articles with translation, summary, vocabulary, and discussion outputs.",
      },
      {
        label: "Sources",
        value: String(sourceCount),
        detail: "Configured crawl surface is focused on WSJ and FT.",
      },
    ],
    items,
    totalItems,
    pipelineRuns,
    latestPipelineRun,
    activePipelineRequest,
    isPipelineRunning,
    pipelineFlowSteps: flowSteps,
    priorityTargets,
    targetSources,
    pipelineSchedules,
    sourceOptions: ["all", ...sourceSet],
    phaseOptions: ["all", ...phaseSet],
    statusOptions: ["all", "pending", "approved", "deferred", "rejected"],
    latestCollectedAt,
  };
}

export async function getArticleDashboardItems(
  filters: ArticleDashboardFilters,
  options: { limit: number; offset: number },
): Promise<ArticleDashboardItem[]> {
  const articles = await getFilteredArticles(filters);
  return articles.slice(options.offset, options.offset + options.limit).map((article, index) => ({
    id: options.offset + index + 1,
    articleId: article.articleId,
    title: article.title,
    source: article.source,
    section: article.section,
    phase: article.phase,
    status: article.status,
    summary: article.processed.summaryEn[0] || article.excerpt || article.articleText.slice(0, 280),
    url: article.url,
    crawledAt: article.crawledAt,
    mediaCount: article.media.length,
    score: scoreArticle(article),
    tags: buildArticleTags(article),
    relevanceNotes: buildRelevanceNotes(article),
  }));
}

export async function getArticleDashboardItemCount(filters: ArticleDashboardFilters): Promise<number> {
  const articles = await getFilteredArticles(filters);
  return articles.length;
}

export function requestPipelineRunLocal(): { ok: boolean; requestId?: number; reason?: string } {
  const db = getBotDb();
  if (hasActivePipelineWork(db)) {
    return { ok: false, reason: "active-run-exists" };
  }

  const now = isoNow();
  const payload = {
    cadence: "daily",
    sources: listTargetSources(db).map((source) => source.domain),
    criteria: listPriorityTargets(db).map((target) => target.label),
    sections: ["frontpage", "business", "tech", "lifestyle"],
    limitPerSection: 5,
    notification: "kakao",
  };
  const result = db.prepare(`
    INSERT INTO pipeline_run_requests (
      pipeline_key, workflow_key, trigger_source, requested_by, executor, status,
      payload_json, requested_at, backend_metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "article-bot",
    "article-bot.daily-brief",
    "dashboard",
    "dashboard-ui",
    "local",
    "requested",
    JSON.stringify(payload),
    now,
    JSON.stringify({ submissionMode: "dispatcher", notificationTarget: "kakao" }),
  );

  return { ok: true, requestId: Number(result.lastInsertRowid) };
}

export function stopPipelineRunLocal(): { ok: boolean; requestId?: number; status?: string; reason?: string } {
  const db = getBotDb();
  const row = db.prepare(`
    SELECT id, status, collection_run_id
    FROM pipeline_run_requests
    WHERE status IN ('requested', 'claimed', 'submitted', 'running', 'cancelling')
    ORDER BY requested_at DESC, id DESC
    LIMIT 1
  `).get() as { id: number; status: string; collection_run_id: number | null } | undefined;

  if (!row) {
    return { ok: false, reason: "no-active-request" };
  }

  const now = isoNow();
  if (row.status === "requested" || row.status === "claimed") {
    db.prepare(`
      UPDATE pipeline_run_requests
      SET status = 'cancelled',
          finished_at = COALESCE(finished_at, ?),
          cancel_requested_at = COALESCE(cancel_requested_at, ?),
          cancel_requested_by = COALESCE(cancel_requested_by, ?),
          error_text = COALESCE(error_text, ?)
      WHERE id = ?
    `).run(now, now, "dashboard-ui", "Cancelled from dashboard-ui", row.id);
    cancelCollectionRun(db, row.collection_run_id, now);
    return { ok: true, requestId: row.id, status: "cancelled" };
  }

  db.prepare(`
    UPDATE pipeline_run_requests
    SET status = 'cancelling',
        cancel_requested_at = COALESCE(cancel_requested_at, ?),
        cancel_requested_by = COALESCE(cancel_requested_by, ?)
    WHERE id = ?
  `).run(now, "dashboard-ui", row.id);
  return { ok: true, requestId: row.id, status: "cancelling" };
}

export function mutatePriorityTargetLocal(
  mutation: { intent: "add"; label: string } | { intent: "delete"; targetId: number },
): { ok: boolean; reason?: string } {
  const db = getBotDb();
  if (mutation.intent === "delete") {
    const result = db.prepare("DELETE FROM priority_targets WHERE id = ?").run(mutation.targetId);
    return { ok: result.changes > 0 };
  }

  const label = mutation.label.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!label) {
    return { ok: false, reason: "empty-label" };
  }

  const result = db.prepare(`
    INSERT OR IGNORE INTO priority_targets (label, sort_order)
    VALUES (?, COALESCE((SELECT MAX(sort_order) + 1 FROM priority_targets), 0))
  `).run(label);
  return { ok: result.changes > 0 };
}

export function mutateTargetSourceLocal(
  mutation: { intent: "add"; domain: string } | { intent: "delete"; targetSourceId: number },
): { ok: boolean; reason?: string } {
  const db = getBotDb();
  if (mutation.intent === "delete") {
    const result = db.prepare("DELETE FROM target_sources WHERE id = ?").run(mutation.targetSourceId);
    return { ok: result.changes > 0 };
  }

  const domain = normalizeDomain(mutation.domain);
  if (!domain) {
    return { ok: false, reason: "empty-domain" };
  }

  const result = db.prepare(`
    INSERT OR IGNORE INTO target_sources (domain, sort_order)
    VALUES (?, COALESCE((SELECT MAX(sort_order) + 1 FROM target_sources), 0))
  `).run(domain);
  return { ok: result.changes > 0 };
}

export function mutatePipelineScheduleLocal(
  mutation: { scheduleKey: PipelineScheduleKey; weekdays: number[]; timeOfDay: string },
): { ok: boolean; reason?: string } {
  const schedule = defaultPipelineSchedules.find((entry) => entry.scheduleKey === mutation.scheduleKey);
  if (!schedule) {
    return { ok: false, reason: "invalid-schedule-key" };
  }
  if (!/^\d{2}:\d{2}$/.test(mutation.timeOfDay)) {
    return { ok: false, reason: "invalid-time" };
  }

  const weekdays = normalizeWeekdays(mutation.weekdays, schedule.cadence === "daily");
  const db = getBotDb();
  db.prepare(`
    UPDATE pipeline_schedules
    SET weekdays_json = ?,
        time_of_day = ?,
        updated_at = ?
    WHERE schedule_key = ?
  `).run(JSON.stringify(weekdays), mutation.timeOfDay, isoNow(), mutation.scheduleKey);
  return { ok: true };
}

function getBotDb(): Database.Database {
  fs.mkdirSync(path.dirname(BOT_DB_PATH), { recursive: true });
  const db = new Database(BOT_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureBotSchema(db);
  return db;
}

function ensureBotSchema(db: Database.Database): void {
  const targetSourcesExisted = hasTable(db, "target_sources");
  db.exec(`
    CREATE TABLE IF NOT EXISTS priority_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL COLLATE NOCASE UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS target_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL COLLATE NOCASE UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pipeline_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_key TEXT NOT NULL COLLATE NOCASE UNIQUE,
      report_type TEXT NOT NULL,
      cadence TEXT NOT NULL,
      weekdays_json TEXT NOT NULL DEFAULT '[]',
      time_of_day TEXT NOT NULL DEFAULT '09:00',
      timezone_name TEXT NOT NULL DEFAULT 'Asia/Seoul',
      last_enqueued_slot TEXT,
      last_enqueued_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pipeline_run_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pipeline_key TEXT NOT NULL,
      workflow_key TEXT NOT NULL,
      trigger_source TEXT NOT NULL,
      requested_by TEXT,
      executor TEXT NOT NULL DEFAULT 'local',
      status TEXT NOT NULL,
      payload_json TEXT,
      requested_at TEXT NOT NULL,
      claimed_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      cancel_requested_at TEXT,
      cancel_requested_by TEXT,
      collection_run_id INTEGER,
      backend_metadata_json TEXT,
      error_text TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS collection_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER,
      cadence TEXT NOT NULL,
      run_date TEXT NOT NULL,
      status TEXT NOT NULL,
      source_scope TEXT NOT NULL,
      executor TEXT,
      started_at TEXT,
      finished_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pipeline_run_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      stage_key TEXT NOT NULL,
      stage_label TEXT NOT NULL,
      stage_detail TEXT NOT NULL,
      stage_order INTEGER NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      artifact_type TEXT NOT NULL,
      content TEXT,
      file_path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_priority_targets_sort_order ON priority_targets(sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_target_sources_sort_order ON target_sources(sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_schedules_cadence ON pipeline_schedules(cadence, schedule_key);
    CREATE INDEX IF NOT EXISTS idx_pipeline_run_requests_status ON pipeline_run_requests(status, requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_collection_runs_status ON collection_runs(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pipeline_run_steps_run_order ON pipeline_run_steps(run_id, stage_order);
  `);

  const priorityCount = db.prepare("SELECT COUNT(*) AS count FROM priority_targets").get() as { count: number };
  if (priorityCount.count === 0) {
    const insert = db.prepare("INSERT OR IGNORE INTO priority_targets (label, sort_order) VALUES (?, ?)");
    defaultPriorityTargets.forEach((target, index) => insert.run(target, index));
  }

  if (!targetSourcesExisted) {
    const insert = db.prepare("INSERT OR IGNORE INTO target_sources (domain, sort_order) VALUES (?, ?)");
    defaultTargetSources.forEach((source, index) => insert.run(source, index));
  }

  const insertSchedule = db.prepare(`
    INSERT OR IGNORE INTO pipeline_schedules (
      schedule_key, report_type, cadence, weekdays_json, time_of_day, timezone_name, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  defaultPipelineSchedules.forEach((schedule) => {
    insertSchedule.run(
      schedule.scheduleKey,
      schedule.reportType,
      schedule.cadence,
      JSON.stringify(schedule.weekdays),
      schedule.timeOfDay,
      schedule.timezoneName,
      isoNow(),
    );
  });
}

async function getFilteredArticles(filters: ArticleDashboardFilters) {
  const articles = await listArticles({
    source: filters.source,
    status: filters.status,
    query: filters.search,
  });

  return articles.filter((article) => {
    if (filters.phase !== "all" && article.phase !== filters.phase) {
      return false;
    }
    if (filters.collectedOn && !article.crawledAt.startsWith(filters.collectedOn)) {
      return false;
    }
    return true;
  });
}

function listPriorityTargets(db: Database.Database): PriorityTarget[] {
  return db.prepare("SELECT id, label FROM priority_targets ORDER BY sort_order, id").all() as PriorityTarget[];
}

function listTargetSources(db: Database.Database): TargetSource[] {
  return db.prepare("SELECT id, domain FROM target_sources ORDER BY sort_order, id").all() as TargetSource[];
}

function listPipelineSchedules(db: Database.Database): PipelineSchedule[] {
  const rows = db.prepare(`
    SELECT
      id,
      schedule_key AS scheduleKey,
      report_type AS reportType,
      cadence,
      weekdays_json AS weekdaysJson,
      time_of_day AS timeOfDay,
      timezone_name AS timezoneName,
      last_enqueued_slot AS lastEnqueuedSlot,
      last_enqueued_at AS lastEnqueuedAt,
      updated_at AS updatedAt
    FROM pipeline_schedules
    ORDER BY id
  `).all() as ScheduleRow[];

  return rows.map((row) => ({
    ...row,
    scheduleKey: row.scheduleKey as PipelineScheduleKey,
    cadence: row.cadence === "weekly" ? "weekly" : "daily",
    weekdays: safeJsonArray(row.weekdaysJson).map(Number).filter((value) => Number.isInteger(value)),
  }));
}

function listPipelineRunRecords(db: Database.Database, limit: number): PipelineRunRecord[] {
  const rows = db.prepare(`
    SELECT
      id,
      request_id AS requestId,
      id AS collectionRunId,
      cadence,
      run_date AS runDate,
      status,
      source_scope AS sourceScope,
      COALESCE(started_at, created_at) AS recordedAt
    FROM collection_runs
    ORDER BY id DESC
    LIMIT ?
  `).all(limit) as Array<Omit<PipelineRunRecord, "recordType">>;

  const requests = db.prepare(`
    SELECT
      id,
      id AS requestId,
      collection_run_id AS collectionRunId,
      COALESCE(json_extract(payload_json, '$.cadence'), 'daily') AS cadence,
      substr(requested_at, 1, 10) AS runDate,
      status,
      trigger_source AS sourceScope,
      requested_at AS recordedAt
    FROM pipeline_run_requests
    WHERE collection_run_id IS NULL
    ORDER BY id DESC
    LIMIT ?
  `).all(limit) as Array<Omit<PipelineRunRecord, "recordType">>;

  return [
    ...rows.map((row) => ({ ...row, recordType: "run" as const })),
    ...requests.map((row) => ({ ...row, recordType: "request" as const })),
  ]
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    .slice(0, limit);
}

function getActivePipelineRequest(db: Database.Database): PipelineRunRequest | null {
  const row = db.prepare(`
    SELECT
      id,
      pipeline_key,
      workflow_key,
      trigger_source,
      requested_by,
      executor,
      status,
      payload_json,
      requested_at,
      claimed_at,
      started_at,
      finished_at,
      cancel_requested_at,
      cancel_requested_by,
      collection_run_id,
      backend_metadata_json,
      error_text
    FROM pipeline_run_requests
    WHERE status IN ('requested', 'claimed', 'submitted', 'running', 'cancelling')
    ORDER BY requested_at DESC, id DESC
    LIMIT 1
  `).get() as RequestRow | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    pipelineKey: row.pipeline_key,
    workflowKey: row.workflow_key,
    triggerSource: row.trigger_source,
    requestedBy: row.requested_by,
    executor: row.executor,
    status: row.status,
    payloadJson: row.payload_json,
    requestedAt: row.requested_at,
    claimedAt: row.claimed_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    cancelRequestedAt: row.cancel_requested_at,
    cancelRequestedBy: row.cancel_requested_by,
    collectionRunId: row.collection_run_id,
    backendMetadataJson: row.backend_metadata_json,
    errorText: row.error_text,
  };
}

function getPipelineFlowSteps(
  db: Database.Database,
  latestRun: PipelineRunRecord | null,
  activeRequest: PipelineRunRequest | null,
): PipelineFlowStep[] {
  if (latestRun?.recordType === "run" && latestRun.collectionRunId) {
    const rows = db.prepare(`
      SELECT
        id,
        run_id AS runId,
        stage_key AS stageKey,
        stage_label AS stageLabel,
        stage_detail AS stageDetail,
        stage_order AS stageOrder,
        status,
        updated_at AS updatedAt
      FROM pipeline_run_steps
      WHERE run_id = ?
      ORDER BY stage_order ASC
    `).all(latestRun.collectionRunId) as PipelineFlowStep[];
    if (rows.length > 0) {
      return rows;
    }
  }

  const status = activeRequest?.status ?? latestRun?.status ?? null;
  const recordedAt = activeRequest?.requestedAt ?? latestRun?.recordedAt ?? "";
  const statuses = syntheticStageStatuses(status);
  return stageDefinitions.map((stage, index) => ({
    id: -(index + 1),
    runId: latestRun?.collectionRunId ?? activeRequest?.id ?? -1,
    stageKey: stage.stageKey,
    stageLabel: stage.stageLabel,
    stageDetail: stage.stageDetail,
    stageOrder: index,
    status: statuses[index] ?? "queued",
    updatedAt: statuses[index] === "queued" ? "" : recordedAt,
  }));
}

function syntheticStageStatuses(status: string | null): string[] {
  if (status === "success" || status === "succeeded") {
    return stageDefinitions.map(() => "success");
  }
  if (status === "failed") {
    return stageDefinitions.map((_, index) => (index < 2 ? "success" : index === 2 ? "failed" : "queued"));
  }
  if (status === "cancelled") {
    return stageDefinitions.map(() => "cancelled");
  }
  if (status === "running" || status === "submitted") {
    return stageDefinitions.map((_, index) => (index === 0 ? "success" : index === 1 ? "running" : "queued"));
  }
  if (status === "claimed") {
    return stageDefinitions.map((_, index) => (index === 0 ? "running" : "queued"));
  }
  if (status === "cancelling") {
    return stageDefinitions.map((_, index) => (index === 0 ? "running" : "cancelled"));
  }
  return stageDefinitions.map(() => "queued");
}

function scoreArticle(article: Awaited<ReturnType<typeof listArticles>>[number]): number {
  let score = 50;
  if (article.phase === "processed") score += 18;
  if (article.processed.summaryEn.length > 0) score += 10;
  if (article.processed.discussionTopics.length > 0) score += 10;
  if (article.processed.c1Vocab.length > 0) score += 8;
  if (article.media.length > 0) score += 4;
  if (article.status === "approved") score += 8;
  if (article.status === "rejected") score -= 20;
  return Math.max(0, Math.min(100, score));
}

function buildArticleTags(article: Awaited<ReturnType<typeof listArticles>>[number]): string[] {
  return [
    article.source.toUpperCase(),
    article.section,
    article.phase,
    `${article.media.length} media`,
  ].filter(Boolean).slice(0, 5);
}

function buildRelevanceNotes(article: Awaited<ReturnType<typeof listArticles>>[number]): string {
  const signals = [];
  if (article.processed.c1Vocab.length > 0) signals.push(`${article.processed.c1Vocab.length} C1 vocabulary items`);
  if (article.processed.discussionTopics.length > 0) signals.push(`${article.processed.discussionTopics.length} discussion prompts`);
  if (article.processed.summaryEn.length > 0) signals.push("pipeline summary ready");
  if (article.media.length > 0) signals.push(`${article.media.length} media sidecars`);
  return signals.length > 0
    ? `Useful for 1Cup review because it has ${signals.join(", ")}.`
    : "Awaiting processing signals; review title, source, and article body before downstream use.";
}

function hasActivePipelineWork(db: Database.Database): boolean {
  const request = db.prepare(`
    SELECT 1 FROM pipeline_run_requests
    WHERE status IN ('requested', 'claimed', 'submitted', 'running', 'cancelling')
    LIMIT 1
  `).get();
  if (request) {
    return true;
  }
  return Boolean(db.prepare("SELECT 1 FROM collection_runs WHERE status IN ('queued', 'running') LIMIT 1").get());
}

function cancelCollectionRun(db: Database.Database, runId: number | null, timestamp: string): void {
  if (!runId) {
    return;
  }
  db.prepare(`
    UPDATE collection_runs
    SET status = 'cancelled',
        finished_at = COALESCE(finished_at, ?),
        notes = COALESCE(notes, ?)
    WHERE id = ?
  `).run(timestamp, "Cancelled from dashboard-ui", runId);
  db.prepare(`
    UPDATE pipeline_run_steps
    SET status = 'cancelled',
        updated_at = ?
    WHERE run_id = ?
      AND status IN ('queued', 'running')
  `).run(timestamp, runId);
}

function safeJsonArray(value: string | null): unknown[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeOption(value: string | undefined): string {
  return value && value.trim() ? value.trim() : "all";
}

function normalizeWeekdays(values: number[], allowMultiple: boolean): number[] {
  const normalized = Array.from(new Set(values.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))).sort();
  return allowMultiple ? normalized : normalized.slice(0, 1);
}

function normalizeDomain(value: string): string {
  const cleaned = value.trim().toLowerCase();
  if (!cleaned) {
    return "";
  }
  try {
    const url = new URL(cleaned.includes("://") ? cleaned : `https://${cleaned}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return cleaned.replace(/^www\./, "").split("/")[0] ?? "";
  }
}

function hasTable(db: Database.Database, tableName: string): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(tableName));
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === "pending" || value === "approved" || value === "deferred" || value === "rejected";
}

function isoNow(): string {
  return new Date().toISOString();
}
