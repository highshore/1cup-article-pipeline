"use client";

import { useEffect, useState } from "react";

import { formatTimestamp } from "@/lib/format";
import type {
  PipelineRunArticle,
  PipelineRunLog,
  PipelineRunRecord,
  PipelineStageSummary,
} from "@/lib/runs";

type RunDetail = {
  run: PipelineRunRecord | null;
  articles: PipelineRunArticle[];
  logs: PipelineRunLog[];
  stageSummary: PipelineStageSummary[];
};

type PipelineRunsClientProps = {
  initialRuns: PipelineRunRecord[];
  initialSelectedRunId: number | null;
  initialDetail: RunDetail;
};

export function PipelineRunsClient({
  initialRuns,
  initialSelectedRunId,
  initialDetail,
}: PipelineRunsClientProps) {
  const [runs, setRuns] = useState(initialRuns);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(initialSelectedRunId);
  const [detail, setDetail] = useState<RunDetail>(initialDetail);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const hasActiveRun =
    detail.run?.status === "queued" ||
    detail.run?.status === "running" ||
    runs.some((run) => run.status === "queued" || run.status === "running");

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (cancelled) {
        return;
      }

      setIsRefreshing(true);
      try {
        const [runsResponse, detailResponse] = await Promise.all([
          fetch("/api/runs?limit=20", { cache: "no-store" }),
          selectedRunId ? fetch(`/api/runs/${selectedRunId}`, { cache: "no-store" }) : Promise.resolve(null),
        ]);

        if (!runsResponse.ok) {
          throw new Error(`Failed to load runs (${runsResponse.status})`);
        }

        const runsPayload = (await runsResponse.json()) as { runs: PipelineRunRecord[] };

        let nextDetail: RunDetail = { run: null, articles: [], logs: [], stageSummary: [] };
        if (detailResponse) {
          if (!detailResponse.ok) {
            throw new Error(`Failed to load run detail (${detailResponse.status})`);
          }
          nextDetail = (await detailResponse.json()) as RunDetail;
        }

        if (!cancelled) {
          setRuns(runsPayload.runs);
          setDetail(nextDetail);
          setRefreshError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setRefreshError(error instanceof Error ? error.message : "Refresh failed");
        }
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    };

    const intervalMs = hasActiveRun ? 2000 : 10000;
    void refresh();
    const timerId = window.setInterval(refresh, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [hasActiveRun, selectedRunId]);

  const effectiveSelectedRunId = detail.run?.id ?? selectedRunId ?? runs[0]?.id ?? null;
  const selectedRun = detail.run ?? runs.find((run) => run.id === effectiveSelectedRunId) ?? null;
  const totalArticles = selectedRun?.totalArticles ?? 0;
  const completedArticles = selectedRun?.completedArticles ?? 0;
  const progressPercent = totalArticles > 0 ? Math.round((completedArticles / totalArticles) * 100) : 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[344px_minmax(0,1fr)]">
      <section className="rounded-[24px] border border-slate-200/75 bg-white/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur md:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ink/45">Recent runs</p>
            <h2 className="mt-2 text-3xl font-semibold text-ink">Pipeline history</h2>
          </div>
          <div className="text-right text-xs uppercase tracking-[0.18em] text-ink/45">
            <div>{isRefreshing ? "Refreshing" : "Live"}</div>
            <div>{refreshError ? "degraded" : "ready"}</div>
          </div>
        </div>

        {refreshError ? <div className="mb-4 rounded-2xl border border-ember/15 bg-ember/10 px-3 py-2 text-sm text-ember">{refreshError}</div> : null}

        <div className="grid max-h-[75vh] gap-3 overflow-y-auto pr-1">
          {runs.length === 0 ? (
            <div className="rounded-3xl border border-slate-200/65 bg-white/60 px-4 py-12 text-center text-sm text-ink/60">
              No pipeline runs yet.
            </div>
          ) : (
            runs.map((run) => {
              const selected = run.id === effectiveSelectedRunId;
              return (
                <button
                  key={run.id}
                  className={[
                    "flex min-h-[188px] flex-col rounded-3xl border px-4 py-4 text-left transition",
                    selected
                      ? "border-ember/35 bg-ember/10 shadow-[0_10px_24px_rgba(37,99,235,0.08)] ring-1 ring-ember/15"
                      : "border-slate-200/70 bg-white/62 hover:border-slate-300/80 hover:bg-white/82",
                  ].join(" ")}
                  onClick={() => {
                    setSelectedRunId(run.id);
                    setDetail((current) => (current.run?.id === run.id ? current : { run, articles: [], logs: [], stageSummary: [] }));
                    window.history.replaceState(null, "", `/runs?runId=${run.id}`);
                  }}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">Run #{run.id}</p>
                      <h3 className="mt-2 text-base font-semibold text-ink">{run.backend.toUpperCase()}</h3>
                    </div>
                    <RunStatusBadge status={run.status} />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-sm text-ink/75">
                    <Metric label="Done" value={`${run.completedArticles}/${run.totalArticles}`} />
                    <Metric label="OK" value={String(run.succeededArticles)} />
                    <Metric label="Failed" value={String(run.failedArticles)} />
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/10">
                    <div
                      className="h-full rounded-full bg-moss transition-[width] duration-500"
                      style={{ width: `${run.totalArticles > 0 ? (run.completedArticles / run.totalArticles) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-xs uppercase tracking-[0.16em] text-ink/45">
                    <span>{formatTimestamp(run.requestedAt)}</span>
                    <span>{run.skipImage ? "No image" : "Full pipeline"}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="grid gap-4">
        {selectedRun ? (
          <>
            <div className="rounded-[28px] border border-slate-200/75 bg-white/84 p-5 shadow-panel backdrop-blur md:p-7">
              <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-6 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-dusk">Pipeline monitor</p>
                  <h1 className="mt-2 text-4xl font-semibold leading-tight text-ink md:text-5xl">
                    Run #{selectedRun.id}
                  </h1>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-ink/75">
                    Auto-refresh is enabled while runs are active. This view tails persisted DB state, not ephemeral console output.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <RunStatusBadge status={selectedRun.status} />
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">
                    {progressPercent}% complete
                  </span>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-4">
                <SummaryCard label="Articles" value={`${completedArticles}/${totalArticles}`} />
                <SummaryCard label="Succeeded" value={String(selectedRun.succeededArticles)} />
                <SummaryCard label="Failed" value={String(selectedRun.failedArticles)} />
                <SummaryCard label="Backend" value={selectedRun.backend.toUpperCase()} />
              </div>

              <div className="mt-6 h-3 overflow-hidden rounded-full bg-black/10">
                <div className="h-full rounded-full bg-moss transition-[width] duration-500" style={{ width: `${progressPercent}%` }} />
              </div>

              <dl className="mt-6 grid gap-3 text-sm text-ink/75 md:grid-cols-2">
                <MetaRow label="Requested" value={formatTimestamp(selectedRun.requestedAt)} />
                <MetaRow label="Started" value={formatTimestamp(selectedRun.startedAt)} />
                <MetaRow label="Finished" value={formatTimestamp(selectedRun.finishedAt)} />
                <MetaRow label="PID" value={selectedRun.pid ? String(selectedRun.pid) : "—"} />
                <MetaRow label="Input path" value={selectedRun.inputPath} />
                <MetaRow label="Output dir" value={selectedRun.outputDir} />
                <MetaRow label="Summary path" value={selectedRun.summaryPath ?? "—"} />
                <MetaRow label="Error" value={selectedRun.errorMessage ?? "—"} />
              </dl>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_392px]">
              <section className="rounded-[24px] border border-slate-200/70 bg-white/70 p-5 md:p-6">
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">Per stage</p>
                  <h2 className="mt-2 text-3xl font-semibold text-ink">Stage summary</h2>
                </div>
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                  {detail.stageSummary.map((stage) => (
                    <div key={stage.stage} className="h-full min-h-[152px] rounded-3xl border border-slate-200/65 bg-white/62 p-4">
                      <div className="text-sm font-semibold text-ink">{humanizeStage(stage.stage)}</div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs uppercase tracking-[0.14em] text-ink/55">
                        <TinyMetric label="Queued" value={stage.queued} />
                        <TinyMetric label="Running" value={stage.running} />
                        <TinyMetric label="Success" value={stage.success} />
                        <TinyMetric label="Failed" value={stage.failed} />
                        <TinyMetric label="Skipped" value={stage.skipped} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[24px] border border-slate-200/70 bg-white/70 p-5 md:p-6">
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">Latest logs</p>
                  <h2 className="mt-2 text-3xl font-semibold text-ink">Log tail</h2>
                </div>
                <div className="grid max-h-[480px] gap-2 overflow-y-auto rounded-3xl bg-ink px-4 py-4 text-sm text-white/85">
                  {detail.logs.length === 0 ? (
                    <p className="text-white/60">No logs captured yet.</p>
                  ) : (
                    detail.logs.map((log) => (
                      <div key={log.id} className="border-b border-white/10 pb-2 last:border-b-0">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-white/55">
                          <span>{formatTimestamp(log.createdAt)}</span>
                          <span>{log.stream}</span>
                          {log.level ? <span>{log.level}</span> : null}
                          {log.articleId ? <span>{log.articleId}</span> : null}
                          {log.stage ? <span>{humanizeStage(log.stage)}</span> : null}
                        </div>
                        <div className="mt-1 break-words leading-6">{log.message}</div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>

            <section className="rounded-[24px] border border-slate-200/70 bg-white/70 p-5 md:p-6">
              <div className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">Per article</p>
                  <h2 className="mt-2 text-3xl font-semibold text-ink">Article progress</h2>
              </div>
              <div className="overflow-x-auto rounded-3xl border border-slate-200/65 bg-white/56">
                <div className="grid min-w-[760px] grid-cols-[minmax(0,1.8fr)_120px_180px_140px] bg-shell/70 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink/55">
                  <div>Article</div>
                  <div>Status</div>
                  <div>Current stage</div>
                  <div>Completed</div>
                </div>
                <div className="max-h-[420px] overflow-y-auto bg-white/44">
                  {detail.articles.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-ink/60">No article-level records yet.</div>
                  ) : (
                    detail.articles.map((article) => (
                      <div
                        key={article.articleId}
                        className="grid min-w-[760px] grid-cols-[minmax(0,1.8fr)_120px_180px_140px] gap-3 border-t border-black/5 px-4 py-3 text-sm text-ink/80"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">{article.title || article.articleId}</div>
                          <div className="mt-1 truncate text-xs uppercase tracking-[0.14em] text-ink/45">{article.articleId}</div>
                        </div>
                        <div>
                          <ArticleStatusBadge status={article.status} />
                        </div>
                        <div className="truncate">{article.currentStage ? humanizeStage(article.currentStage) : "—"}</div>
                        <div>{formatTimestamp(article.completedAt)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          </>
        ) : (
              <div className="grid min-h-[60vh] place-items-center rounded-[24px] border border-slate-200/65 bg-white/60 p-8 text-center">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-ink/45">No runs yet</p>
                  <h2 className="mt-3 text-4xl font-semibold text-ink">Launch a pipeline run to monitor it here.</h2>
                </div>
              </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-ink/45">{label}</div>
      <div className="mt-1 text-base font-semibold text-ink">{value}</div>
    </div>
  );
}

function TinyMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div>{label}</div>
      <div className="mt-1 text-base font-semibold text-ink">{value}</div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-[112px] rounded-3xl border border-slate-200/65 bg-white/60 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">{label}</dt>
      <dd className="mt-1 break-all leading-6">{value}</dd>
    </div>
  );
}

function RunStatusBadge({ status }: { status: PipelineRunRecord["status"] }) {
  const styles = {
    queued: "border-dusk/20 bg-dusk/10 text-dusk",
    running: "border-moss/20 bg-moss/10 text-moss",
    succeeded: "border-slate-300 bg-slate-100 text-slate-700",
    failed: "border-red-200 bg-red-50 text-red-700",
  }[status];

  return <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${styles}`}>{status}</span>;
}

function ArticleStatusBadge({ status }: { status: string }) {
  const styles =
    {
      queued: "border-dusk/20 bg-dusk/10 text-dusk",
      running: "border-moss/20 bg-moss/10 text-moss",
      succeeded: "border-slate-300 bg-slate-100 text-slate-700",
      failed: "border-red-200 bg-red-50 text-red-700",
    }[status] ?? "border-slate-300 bg-slate-100 text-slate-700";

  return <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${styles}`}>{status}</span>;
}

function humanizeStage(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
