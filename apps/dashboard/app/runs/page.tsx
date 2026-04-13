import { launchPipelineRun } from "@/app/actions";
import { AppNav } from "@/components/app-nav";
import { ArrowPathIcon, BoltIcon, CommandLineIcon } from "@/components/icons";
import { PipelineRunsClient } from "@/components/pipeline-runs-client";
import {
  getDefaultRunOptions,
  getPipelineRun,
  getPipelineStageSummary,
  listPipelineRunArticles,
  listPipelineRunLogs,
  listPipelineRuns,
} from "@/lib/runs";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function RunsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedRunId = parsePositiveInteger(getFirst(resolvedSearchParams?.runId));
  const runs = listPipelineRuns(20);
  const selectedRun = (requestedRunId && getPipelineRun(requestedRunId)) || runs[0] || null;
  const defaultOptions = getDefaultRunOptions();

  const initialDetail = selectedRun
    ? {
        run: selectedRun,
        articles: listPipelineRunArticles(selectedRun.id),
        logs: listPipelineRunLogs(selectedRun.id),
        stageSummary: getPipelineStageSummary(selectedRun.id),
      }
    : {
        run: null,
        articles: [],
        logs: [],
        stageSummary: [],
      };

  return (
    <main className="mx-auto min-h-screen max-w-[1520px] px-4 py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="mb-5">
        <AppNav />
      </div>

      <div className="mb-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/78 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-dusk">
            <CommandLineIcon className="h-4 w-4" />
            Crawler Pipeline Desk
          </div>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-ink md:text-5xl">
            Trigger the article pipeline and watch it progress live.
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-ink/75 md:text-base">
            This route reads `pipeline_runs` state from SQLite and refreshes automatically while work is active, similar to a lightweight Airflow monitor.
          </p>
        </div>

        <form action={launchPipelineRun} className="grid gap-3 self-start rounded-[24px] border border-slate-200/75 bg-white/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur md:p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm text-ink/80">
              <span className="font-semibold">Backend</span>
              <select className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-0" defaultValue={defaultOptions.backend} name="backend">
                <option value="gemma4">GEMMA4</option>
                <option value="openai">OpenAI</option>
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-slate-200/65 bg-white/72 px-3 py-2.5 text-sm text-ink/80">
              <input className="h-4 w-4" defaultChecked={defaultOptions.skipImage} name="skipImage" type="checkbox" />
              <span className="font-semibold">Skip image generation</span>
            </label>
          </div>
          <label className="grid gap-1 text-sm text-ink/80">
            <span className="font-semibold">Input path</span>
            <input
              className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-0"
              defaultValue={defaultOptions.inputPath}
              name="inputPath"
              type="text"
            />
          </label>
          <label className="grid gap-1 text-sm text-ink/80">
            <span className="font-semibold">Output directory</span>
            <input
              className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-0"
              defaultValue={defaultOptions.outputDir}
              name="outputDir"
              type="text"
            />
          </label>
          <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/90" type="submit">
            <BoltIcon className="h-4 w-4" />
            Launch pipeline run
          </button>
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-ink/45">
            <ArrowPathIcon className="h-4 w-4" />
            Auto-refresh enabled for active runs
          </div>
        </form>
      </div>

      <PipelineRunsClient
        initialDetail={initialDetail}
        initialRuns={runs}
        initialSelectedRunId={selectedRun?.id ?? null}
      />
    </main>
  );
}

function getFirst(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
