import "server-only";

import {
  getPipelineState,
  mutatePipelineScheduleSupabase,
  mutatePriorityTargetSupabase,
  mutateTargetSourceSupabase,
  requestPipelineRunSupabase,
  stopPipelineRunSupabase,
} from "@/lib/article-pipeline-store";
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

const PAGE_SIZE = 10;

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
  const pipelineState = await getPipelineState(12);
  const { priorityTargets, targetSources, pipelineSchedules, pipelineRuns, activePipelineRequest, pipelineFlowSteps } = pipelineState;
  const latestPipelineRun = pipelineRuns[0] ?? null;
  const isPipelineRunning = Boolean(activePipelineRequest) || latestPipelineRun?.status === "queued" || latestPipelineRun?.status === "running";
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
    pipelineFlowSteps,
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

export const requestPipelineRunLocal = requestPipelineRunSupabase;
export const stopPipelineRunLocal = stopPipelineRunSupabase;

export async function mutatePriorityTargetLocal(
  mutation: { intent: "add"; label: string } | { intent: "delete"; targetId: number },
): Promise<{ ok: boolean; reason?: string }> {
  return mutatePriorityTargetSupabase(mutation);
}

export async function mutateTargetSourceLocal(
  mutation: { intent: "add"; domain: string } | { intent: "delete"; targetSourceId: number },
): Promise<{ ok: boolean; reason?: string }> {
  return mutateTargetSourceSupabase(mutation);
}

export async function mutatePipelineScheduleLocal(
  mutation: { scheduleKey: PipelineScheduleKey; weekdays: number[]; timeOfDay: string },
): Promise<{ ok: boolean; reason?: string }> {
  return mutatePipelineScheduleSupabase(mutation);
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

function normalizeOption(value: string | undefined): string {
  return value && value.trim() ? value.trim() : "all";
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === "pending" || value === "approved" || value === "deferred" || value === "rejected";
}
