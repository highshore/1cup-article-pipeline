import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { ArticleResultsFeed } from "@/components/article-results-feed";
import { AsyncForm } from "@/components/async-form";
import { DashboardAutoRefresh } from "@/components/dashboard-auto-refresh";
import {
  ArrowPathIcon,
  BoltIcon,
  ClockIcon,
  GlobeIcon,
  PlusIcon,
  PlayIcon,
  QueueIcon,
  StopIcon,
  TrendingIcon,
  XMarkIcon,
} from "@/components/icons";
import { LatestCollectionCard } from "@/components/latest-collection-card";
import { PipelineScheduleForm } from "@/components/pipeline-schedule-form";
import type { ArticleDashboardData, ArticleDashboardFilters } from "@/lib/article-dashboard";

const panelClass = "rounded-[26px] border border-slate-200/75 bg-white/80 p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur";
const sectionHeadingClass = "text-lg font-semibold tracking-[-0.02em]";

function statusClasses(status: string) {
  if (status === "requested" || status === "queued" || status === "cancelling") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "claimed" || status === "submitted" || status === "running") return "border-sky-200 bg-sky-50 text-sky-800";
  if (status === "success" || status === "succeeded") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "failed" || status === "cancelled") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function prettyLabel(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  return value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function FilterSelect({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: keyof ArticleDashboardFilters;
  value: string;
  options: string[];
}) {
  return (
    <label className="grid gap-2 text-sm text-ink/70">
      <span className="font-semibold text-ink">{label}</span>
      <select
        className="min-h-11 rounded-2xl border border-slate-200 bg-white/86 px-3 py-2.5 outline-none ring-0"
        defaultValue={value}
        name={name}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {prettyLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function normalizeSourceDomainLabel(domain: string) {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

function faviconUrlForDomain(domain: string) {
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
}

export function ArticleOpsDashboard({
  data,
  todayLabel,
}: {
  data: ArticleDashboardData;
  todayLabel: string;
}) {
  const visiblePipelineRuns = data.pipelineRuns.slice(0, 3);
  const remainingPipelineRuns = data.pipelineRuns.slice(3);
  const completedFlowSteps = data.pipelineFlowSteps.filter((step) => step.status === "success").length;
  const activeFlowStep =
    data.pipelineFlowSteps.find((step) => step.status === "running") ??
    data.pipelineFlowSteps.find((step) => step.status === "failed") ??
    data.pipelineFlowSteps.at(-1) ??
    null;
  const nextFlowStep = data.pipelineFlowSteps.find((step) => step.status === "queued") ?? null;
  const flowProgress = data.pipelineFlowSteps.length > 0 ? Math.round((completedFlowSteps / data.pipelineFlowSteps.length) * 100) : 0;
  const flowStatus = data.activePipelineRequest?.status ?? data.latestPipelineRun?.status ?? null;
  const primaryActionLabel = data.isPipelineRunning
    ? data.activePipelineRequest?.status === "requested"
      ? "Pipeline requested"
      : data.activePipelineRequest?.status === "cancelling"
        ? "Stop requested"
        : "Pipeline running"
    : "Run pipeline";
  const dailySchedule = data.pipelineSchedules.find((schedule) => schedule.scheduleKey === "daily_kakao_report") ?? null;

  return (
    <main className="mx-auto min-h-screen max-w-[1520px] px-4 py-5 text-ink sm:px-5 sm:py-6 md:px-6 lg:px-8 lg:py-8">
      <DashboardAutoRefresh enabled={data.isPipelineRunning} />
      <div className="mb-6">
        <AppNav />
      </div>

      <section className="rounded-[28px] border border-slate-200/75 bg-white/80 p-7 shadow-panel backdrop-blur sm:p-8">
        <div className="flex flex-col gap-8 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-3xl space-y-4">
            <h1 className="text-[2.5rem] font-semibold leading-tight tracking-[-0.05em] text-ink sm:text-[3.2rem]">
              Article Pipeline
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-ink/70 sm:text-[15px]">
              Pipeline steps: crawl WSJ and FT, evaluate relevance and translation quality, process approved articles
              and media, save the stack to the database, and deliver scheduled Kakao updates.
            </p>
          </div>
          <LatestCollectionCard latestCollectedAt={data.latestCollectedAt} todayLabel={todayLabel} />
        </div>
      </section>

      <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <div key={metric.label} className="relative min-h-[152px] overflow-hidden rounded-[24px] border border-slate-200/75 bg-white/80 p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur">
            <div className="relative z-10 flex h-full flex-col justify-between gap-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink/62">{metric.label}</span>
                <div className="rounded-2xl bg-ember/10 p-2 text-ember">
                  <TrendingIcon className="h-5 w-5" />
                </div>
              </div>
              <div>
                <p className="text-4xl font-semibold tracking-[-0.05em]">{metric.value}</p>
                <p className="mt-2 max-w-56 text-sm leading-6 text-ink/62">{metric.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.65fr_0.95fr]">
        <aside className="order-1 space-y-5 xl:order-none xl:col-start-2 xl:row-start-2">
          <h2 className="text-xl font-semibold tracking-[-0.04em]">Settings</h2>
          <section className={panelClass}>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-moss/10 p-2 text-moss">
                <GlobeIcon className="h-5 w-5" />
              </div>
              <h2 className={sectionHeadingClass}>Target sources</h2>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {data.targetSources.map((source) => (
                <AsyncForm key={source.id} action="/api/target-sources" className="inline-flex">
                  <input name="intent" type="hidden" value="delete" />
                  <input name="targetSourceId" type="hidden" value={String(source.id)} />
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/75 bg-white/72 px-3 py-2 text-sm font-medium">
                    <img alt="" className="h-4 w-4 rounded-full" src={faviconUrlForDomain(source.domain)} />
                    <span>{normalizeSourceDomainLabel(source.domain)}</span>
                    <button aria-label={`${source.domain} delete`} className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/5 text-ink/55 hover:bg-black/10 hover:text-ink" type="submit">
                      <XMarkIcon className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </AsyncForm>
              ))}
            </div>

            <AsyncForm action="/api/target-sources" className="mt-5 flex flex-col gap-2 sm:flex-row">
              <input name="intent" type="hidden" value="add" />
              <input className="min-h-11 flex-1 rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none" maxLength={120} name="domain" placeholder="https://www.wsj.com" />
              <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 text-sm font-semibold text-white hover:bg-ink/90" type="submit">
                <PlusIcon className="h-4 w-4" />
                Add
              </button>
            </AsyncForm>
          </section>

          <section className={panelClass}>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-dusk/10 p-2 text-dusk">
                <ClockIcon className="h-5 w-5" />
              </div>
              <h2 className={sectionHeadingClass}>Schedules</h2>
            </div>

            <div className="mt-5 space-y-5">
              <PipelineScheduleForm schedule={dailySchedule} />
            </div>
          </section>

          <section className={panelClass}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-ember/10 p-2 text-ember">
                  <BoltIcon className="h-5 w-5" />
                </div>
                <h2 className={sectionHeadingClass}>Pipeline flow</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-self-end">
                {data.isPipelineRunning ? (
                  <AsyncForm action="/api/pipeline-runs/stop">
                    <button className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-400" disabled={data.activePipelineRequest?.status === "cancelling"} type="submit">
                      {data.activePipelineRequest?.status === "cancelling" ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <StopIcon className="h-4 w-4" />}
                    </button>
                  </AsyncForm>
                ) : null}

                <AsyncForm action="/api/pipeline-runs/test">
                  <button className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-ink px-3 text-sm font-semibold text-white hover:bg-ink/90 disabled:cursor-not-allowed disabled:bg-ink/50" disabled={data.isPipelineRunning} type="submit">
                    {data.isPipelineRunning ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <PlayIcon className="h-4 w-4" />}
                    {primaryActionLabel}
                  </button>
                </AsyncForm>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200/75 bg-white/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{data.activePipelineRequest ? "Dispatcher queue" : (data.latestPipelineRun?.sourceScope ?? "Waiting")}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-ink/45">
                    {data.activePipelineRequest?.requestedAt.replace("T", " ").slice(0, 16) ?? data.latestPipelineRun?.recordedAt.replace("T", " ").slice(0, 16) ?? "No run history"}
                  </p>
                </div>
                {flowStatus ? <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses(flowStatus)}`}>{prettyLabel(flowStatus)}</span> : null}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <FlowMiniMetric label="Current" value={activeFlowStep?.stageLabel ?? "Idle"} />
                <FlowMiniMetric label="Done" value={`${completedFlowSteps} / ${data.pipelineFlowSteps.length}`} />
                <FlowMiniMetric label="Next" value={nextFlowStep?.stageLabel ?? "Complete"} />
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-ember/10">
                <div className="h-full rounded-full bg-ember transition-[width]" style={{ width: `${flowProgress}%` }} />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {data.pipelineFlowSteps.map((step) => (
                <div key={`${step.runId}-${step.stageKey}`} className="rounded-2xl border border-slate-200/75 bg-white/72 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold">{step.stageOrder + 1}. {step.stageLabel}</p>
                      <p className="mt-2 text-sm leading-6 text-ink/62">{step.stageDetail}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses(step.status)}`}>{prettyLabel(step.status)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={panelClass}>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-ember/10 p-2 text-ember">
                <ClockIcon className="h-5 w-5" />
              </div>
              <h2 className={sectionHeadingClass}>Run history</h2>
            </div>

            <div className="mt-5 space-y-3">
              {visiblePipelineRuns.map((run) => (
                <RunHistoryCard key={`${run.recordType}-${run.id}`} run={run} />
              ))}
              {visiblePipelineRuns.length === 0 ? <p className="rounded-2xl border border-slate-200/75 bg-white/70 px-4 py-8 text-center text-sm text-ink/55">No research-bot runs yet.</p> : null}
            </div>

            {remainingPipelineRuns.length > 0 ? (
              <details className="mt-4">
                <summary className="cursor-pointer rounded-2xl px-3 py-2 text-center text-sm font-semibold text-ink/55 hover:bg-white/60">More history</summary>
                <div className="mt-3 space-y-3">
                  {remainingPipelineRuns.map((run) => (
                    <RunHistoryCard key={`${run.recordType}-${run.id}`} run={run} />
                  ))}
                </div>
              </details>
            ) : null}
          </section>
        </aside>

        <section className={`order-2 xl:order-none xl:col-span-2 xl:row-start-1 ${panelClass}`}>
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-ember/10 p-2 text-ember">
                <QueueIcon className="h-5 w-5" />
              </div>
              <h2 className={sectionHeadingClass}>Filters</h2>
            </div>

            <AsyncForm autoSubmit className="grid gap-4 lg:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))_auto]" method="get">
              <label className="grid gap-2 text-sm text-ink/70">
                <span className="font-semibold text-ink">Search</span>
                <input className="min-h-11 rounded-2xl border border-slate-200 bg-white/86 px-4 outline-none" defaultValue={data.filters.search} name="search" placeholder="markets, climate, AI..." />
              </label>
              <FilterSelect label="Source" name="source" value={data.filters.source} options={data.sourceOptions} />
              <FilterSelect label="Phase" name="phase" value={data.filters.phase} options={data.phaseOptions} />
              <FilterSelect label="Review" name="status" value={data.filters.status} options={data.statusOptions} />
              <label className="grid gap-2 text-sm text-ink/70">
                <span className="font-semibold text-ink">Crawl date</span>
                <input className="min-h-11 rounded-2xl border border-slate-200 bg-white/86 px-4 text-sm outline-none" defaultValue={data.filters.collectedOn} name="collectedOn" type="date" />
              </label>
              <div className="flex items-end">
                <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-ink/60 hover:bg-white/70" href="/runs">Reset</Link>
              </div>
            </AsyncForm>
          </div>
        </section>

        <section className="order-3 space-y-5 xl:order-none xl:col-start-1 xl:row-start-2">
          <h2 className="text-xl font-semibold tracking-[-0.04em]">Article Candidates</h2>
          <ArticleResultsFeed filters={data.filters} initialItems={data.items} totalCount={data.totalItems} />
        </section>
      </div>
    </main>
  );
}

function FlowMiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/75 bg-white/80 p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-ink/45">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
    </div>
  );
}

function RunHistoryCard({ run }: { run: ArticleDashboardData["pipelineRuns"][number] }) {
  return (
    <div className="block rounded-2xl border border-slate-200/75 bg-white/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{run.recordedAt.replace("T", " ").slice(0, 16)}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-ink/45">{prettyLabel(run.sourceScope)}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses(run.status)}`}>{prettyLabel(run.status)}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm text-ink/60">
        <span className="rounded-full border border-slate-200/75 bg-white/80 px-3 py-1">{prettyLabel(run.cadence)}</span>
        <span className="rounded-full border border-slate-200/75 bg-white/80 px-3 py-1">{run.runDate}</span>
      </div>
    </div>
  );
}
