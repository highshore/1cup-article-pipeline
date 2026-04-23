import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  PipelineFlowStep,
  PipelineRunRecord,
  PipelineRunRequest,
  PipelineSchedule,
  PipelineScheduleKey,
  PriorityTarget,
  TargetSource,
} from "@/lib/article-dashboard";
import { createClient } from "@/lib/supabase/server";

type PipelineState = {
  activePipelineRequest: PipelineRunRequest | null;
  pipelineFlowSteps: PipelineFlowStep[];
  pipelineRuns: PipelineRunRecord[];
  priorityTargets: PriorityTarget[];
  targetSources: TargetSource[];
  pipelineSchedules: PipelineSchedule[];
};

type SupabaseError = {
  code?: string;
  message?: string;
};

type PipelineScheduleRow = {
  id: number;
  schedule_key: PipelineScheduleKey;
  report_type: string;
  cadence: "daily" | "weekly";
  weekdays_json: unknown;
  time_of_day: string;
  timezone_name: string;
  last_enqueued_slot: string | null;
  last_enqueued_at: string | null;
  updated_at: string;
};

type PipelineRequestRow = {
  id: number;
  pipeline_key: string;
  workflow_key: string;
  trigger_source: string;
  requested_by: string | null;
  executor: string;
  status: string;
  payload_json: unknown;
  requested_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested_at: string | null;
  cancel_requested_by: string | null;
  collection_run_id: number | null;
  backend_metadata_json: unknown;
  error_text: string | null;
};

const defaultPriorityTargets: PriorityTarget[] = [
  "C1 vocabulary density",
  "Discussion readiness",
  "Korean translation quality",
  "Business relevance",
  "Chart / media usefulness",
].map((label, index) => ({ id: -(index + 1), label }));

const defaultTargetSources: TargetSource[] = [
  { id: -1, domain: "wsj.com" },
  { id: -2, domain: "ft.com" },
];

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

export async function getPipelineState(limit = 12): Promise<PipelineState> {
  const supabase = await createClient();
  const [priorityTargets, targetSources, pipelineSchedules, pipelineRuns, activePipelineRequest] = await Promise.all([
    listPriorityTargets(supabase),
    listTargetSources(supabase),
    listPipelineSchedules(supabase),
    listPipelineRunRecords(supabase, limit),
    getActivePipelineRequest(supabase),
  ]);
  const latestPipelineRun = pipelineRuns[0] ?? null;
  const pipelineFlowSteps = await getPipelineFlowSteps(supabase, latestPipelineRun, activePipelineRequest);

  return {
    activePipelineRequest,
    pipelineFlowSteps,
    pipelineRuns,
    priorityTargets,
    targetSources,
    pipelineSchedules,
  };
}

export async function requestPipelineRunSupabase(): Promise<{ ok: boolean; requestId?: number; reason?: string }> {
  const supabase = await createClient();
  const [targetSources, priorityTargets] = await Promise.all([listTargetSources(supabase), listPriorityTargets(supabase)]);
  const payload = {
    cadence: "daily",
    workflowKey: "article-bot.daily-brief",
    requestedFrom: "dashboard",
    sources: targetSources.map((source) => source.domain),
    targetSourceDomains: targetSources.map((source) => source.domain),
    criteria: priorityTargets.map((target) => target.label),
    sections: ["frontpage", "business", "tech", "lifestyle"],
    limitPerSection: 5,
    notification: "kakao",
  };
  const { data, error } = await supabase.rpc("article_bot_enqueue_pipeline_request", {
    p_trigger_source: "dashboard",
    p_requested_by: "dashboard-ui",
    p_cadence: "daily",
    p_workflow_key: "article-bot.daily-brief",
    p_payload_json: payload,
    p_backend_metadata_json: { submissionMode: "dispatcher", notificationTarget: "kakao" },
  });
  throwUnlessMissing(error);
  const result = data as { ok?: boolean; requestId?: number; request_id?: number; reason?: string } | null;
  return {
    ok: Boolean(result?.ok),
    requestId: Number(result?.requestId ?? result?.request_id) || undefined,
    reason: result?.reason,
  };
}

export async function stopPipelineRunSupabase(): Promise<{ ok: boolean; requestId?: number; status?: string; reason?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("article_bot_cancel_active_pipeline_request", {
    p_requested_by: "dashboard-ui",
  });
  throwUnlessMissing(error);
  const result = data as { ok?: boolean; requestId?: number; request_id?: number; status?: string; reason?: string } | null;
  return {
    ok: Boolean(result?.ok),
    requestId: Number(result?.requestId ?? result?.request_id) || undefined,
    status: result?.status,
    reason: result?.reason,
  };
}

export async function mutatePriorityTargetSupabase(
  mutation: { intent: "add"; label: string } | { intent: "delete"; targetId: number },
): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  if (mutation.intent === "delete") {
    const { error } = await supabase.from("priority_targets").delete().eq("id", mutation.targetId);
    throwUnlessMissing(error);
    return { ok: true };
  }

  const label = mutation.label.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!label) return { ok: false, reason: "empty-label" };
  const { error } = await supabase.from("priority_targets").insert({ label, sort_order: 999 });
  if (isUniqueViolation(error)) return { ok: false, reason: "duplicate-label" };
  throwUnlessMissing(error);
  return { ok: true };
}

export async function mutateTargetSourceSupabase(
  mutation: { intent: "add"; domain: string } | { intent: "delete"; targetSourceId: number },
): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  if (mutation.intent === "delete") {
    const { error } = await supabase.from("target_sources").delete().eq("id", mutation.targetSourceId);
    throwUnlessMissing(error);
    return { ok: true };
  }

  const domain = normalizeDomain(mutation.domain);
  if (!domain) return { ok: false, reason: "empty-domain" };
  const { error } = await supabase.from("target_sources").insert({ domain, sort_order: 999 });
  if (isUniqueViolation(error)) return { ok: false, reason: "duplicate-domain" };
  throwUnlessMissing(error);
  return { ok: true };
}

export async function mutatePipelineScheduleSupabase(
  mutation: { scheduleKey: PipelineScheduleKey; weekdays: number[]; timeOfDay: string },
): Promise<{ ok: boolean; reason?: string }> {
  const schedule = defaultPipelineSchedules.find((entry) => entry.scheduleKey === mutation.scheduleKey);
  if (!schedule) return { ok: false, reason: "invalid-schedule-key" };
  if (!/^\d{2}:\d{2}$/.test(mutation.timeOfDay)) return { ok: false, reason: "invalid-time" };

  const supabase = await createClient();
  const weekdays = normalizeWeekdays(mutation.weekdays, schedule.cadence === "daily");
  const { error } = await supabase
    .from("pipeline_schedules")
    .update({
      weekdays_json: weekdays,
      time_of_day: mutation.timeOfDay,
      updated_at: new Date().toISOString(),
    })
    .eq("schedule_key", mutation.scheduleKey);
  throwUnlessMissing(error);
  return { ok: true };
}

async function listPriorityTargets(supabase: SupabaseClient): Promise<PriorityTarget[]> {
  const { data, error } = await supabase.from("priority_targets").select("id,label").order("sort_order").order("id");
  if (isMissingRelation(error)) return defaultPriorityTargets;
  throwIfError(error);
  return (data ?? []).map((row) => ({ id: Number(row.id), label: String(row.label) }));
}

async function listTargetSources(supabase: SupabaseClient): Promise<TargetSource[]> {
  const { data, error } = await supabase.from("target_sources").select("id,domain").order("sort_order").order("id");
  if (isMissingRelation(error)) return defaultTargetSources;
  throwIfError(error);
  return (data ?? []).map((row) => ({ id: Number(row.id), domain: String(row.domain) }));
}

async function listPipelineSchedules(supabase: SupabaseClient): Promise<PipelineSchedule[]> {
  const { data, error } = await supabase
    .from("pipeline_schedules")
    .select("id,schedule_key,report_type,cadence,weekdays_json,time_of_day,timezone_name,last_enqueued_slot,last_enqueued_at,updated_at")
    .order("id");
  if (isMissingRelation(error)) return defaultPipelineSchedules;
  throwIfError(error);
  return ((data ?? []) as PipelineScheduleRow[]).map((row) => ({
    id: Number(row.id),
    scheduleKey: row.schedule_key,
    reportType: row.report_type,
    cadence: row.cadence === "weekly" ? "weekly" : "daily",
    weekdays: safeJsonArray(row.weekdays_json).map(Number).filter((value) => Number.isInteger(value)),
    timeOfDay: row.time_of_day,
    timezoneName: row.timezone_name,
    lastEnqueuedSlot: row.last_enqueued_slot,
    lastEnqueuedAt: row.last_enqueued_at,
    updatedAt: row.updated_at,
  }));
}

async function listPipelineRunRecords(supabase: SupabaseClient, limit: number): Promise<PipelineRunRecord[]> {
  const { data: runs, error: runsError } = await supabase
    .from("collection_runs")
    .select("id,request_id,cadence,run_date,status,source_scope,started_at,created_at")
    .order("id", { ascending: false })
    .limit(limit);
  if (isMissingRelation(runsError)) return [];
  throwIfError(runsError);

  const { data: requests, error: requestsError } = await supabase
    .from("pipeline_run_requests")
    .select("id,collection_run_id,payload_json,status,trigger_source,requested_at")
    .is("collection_run_id", null)
    .order("id", { ascending: false })
    .limit(limit);
  throwIfError(requestsError);

  return [
    ...(runs ?? []).map((row) => ({
      id: Number(row.id),
      recordType: "run" as const,
      requestId: row.request_id ? Number(row.request_id) : null,
      collectionRunId: Number(row.id),
      cadence: String(row.cadence ?? "daily"),
      runDate: String(row.run_date ?? "").slice(0, 10),
      status: String(row.status ?? "queued"),
      sourceScope: String(row.source_scope ?? ""),
      recordedAt: String(row.started_at ?? row.created_at ?? ""),
    })),
    ...(requests ?? []).map((row) => {
      const payload = safeJsonObject(row.payload_json);
      return {
        id: Number(row.id),
        recordType: "request" as const,
        requestId: Number(row.id),
        collectionRunId: row.collection_run_id ? Number(row.collection_run_id) : null,
        cadence: String(payload.cadence ?? "daily"),
        runDate: String(row.requested_at ?? "").slice(0, 10),
        status: String(row.status ?? "requested"),
        sourceScope: String(row.trigger_source ?? "dashboard"),
        recordedAt: String(row.requested_at ?? ""),
      };
    }),
  ]
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    .slice(0, limit);
}

async function getActivePipelineRequest(supabase: SupabaseClient): Promise<PipelineRunRequest | null> {
  const { data, error } = await supabase
    .from("pipeline_run_requests")
    .select("*")
    .in("status", ["requested", "claimed", "submitted", "running", "cancelling"])
    .order("requested_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (isMissingRelation(error)) return null;
  throwIfError(error);
  return data ? mapPipelineRequest(data as PipelineRequestRow) : null;
}

async function getPipelineFlowSteps(
  supabase: SupabaseClient,
  latestRun: PipelineRunRecord | null,
  activeRequest: PipelineRunRequest | null,
): Promise<PipelineFlowStep[]> {
  if (latestRun?.recordType === "run" && latestRun.collectionRunId) {
    const { data, error } = await supabase
      .from("pipeline_run_steps")
      .select("id,run_id,stage_key,stage_label,stage_detail,stage_order,status,updated_at")
      .eq("run_id", latestRun.collectionRunId)
      .order("stage_order");
    throwIfError(error);
    if ((data ?? []).length > 0) {
      return (data ?? []).map((row) => ({
        id: Number(row.id),
        runId: Number(row.run_id),
        stageKey: String(row.stage_key),
        stageLabel: String(row.stage_label),
        stageDetail: String(row.stage_detail),
        stageOrder: Number(row.stage_order),
        status: String(row.status),
        updatedAt: String(row.updated_at),
      }));
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

function mapPipelineRequest(row: PipelineRequestRow): PipelineRunRequest {
  return {
    id: Number(row.id),
    pipelineKey: row.pipeline_key,
    workflowKey: row.workflow_key,
    triggerSource: row.trigger_source,
    requestedBy: row.requested_by,
    executor: row.executor,
    status: row.status,
    payloadJson: row.payload_json ? JSON.stringify(row.payload_json) : null,
    requestedAt: row.requested_at,
    claimedAt: row.claimed_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    cancelRequestedAt: row.cancel_requested_at,
    cancelRequestedBy: row.cancel_requested_by,
    collectionRunId: row.collection_run_id,
    backendMetadataJson: row.backend_metadata_json ? JSON.stringify(row.backend_metadata_json) : null,
    errorText: row.error_text,
  };
}

function syntheticStageStatuses(status: string | null): string[] {
  if (status === "success" || status === "succeeded") return stageDefinitions.map(() => "success");
  if (status === "failed") return stageDefinitions.map((_, index) => (index < 2 ? "success" : index === 2 ? "failed" : "queued"));
  if (status === "cancelled") return stageDefinitions.map(() => "cancelled");
  if (status === "running" || status === "submitted") return stageDefinitions.map((_, index) => (index === 0 ? "success" : index === 1 ? "running" : "queued"));
  if (status === "claimed") return stageDefinitions.map((_, index) => (index === 0 ? "running" : "queued"));
  if (status === "cancelling") return stageDefinitions.map((_, index) => (index === 0 ? "running" : "cancelled"));
  return stageDefinitions.map(() => "queued");
}

function normalizeWeekdays(values: number[], allowMultiple: boolean): number[] {
  const normalized = Array.from(new Set(values.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))).sort();
  return allowMultiple ? normalized : normalized.slice(0, 1);
}

function normalizeDomain(value: string): string {
  const cleaned = value.trim().toLowerCase();
  if (!cleaned) return "";
  try {
    const url = new URL(cleaned.includes("://") ? cleaned : `https://${cleaned}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return cleaned.replace(/^www\./, "").split("/")[0] ?? "";
  }
}

function safeJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isMissingRelation(error: SupabaseError | null): boolean {
  return Boolean(error && (error.code === "42P01" || error.message?.includes("does not exist")));
}

function isUniqueViolation(error: SupabaseError | null): boolean {
  return error?.code === "23505";
}

function throwUnlessMissing(error: SupabaseError | null): void {
  if (isMissingRelation(error)) {
    throw new Error("Pipeline Supabase tables are missing. Run apps/dashboard/supabase/schema.sql in Supabase.");
  }
  throwIfError(error);
}

function throwIfError(error: SupabaseError | null): void {
  if (error) {
    throw new Error(error.message ?? "Supabase pipeline query failed.");
  }
}
