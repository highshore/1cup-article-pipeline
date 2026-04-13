import {
  getPipelineRun,
  getPipelineStageSummary,
  listPipelineRunArticles,
  listPipelineRunLogs,
} from "@/lib/runs";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext): Promise<Response> {
  const { runId: rawRunId } = await context.params;
  const runId = Number(rawRunId);

  if (!Number.isInteger(runId) || runId <= 0) {
    return Response.json({ error: "Invalid run ID" }, { status: 400 });
  }

  const run = getPipelineRun(runId);
  if (!run) {
    return Response.json({ error: "Run not found" }, { status: 404 });
  }

  return Response.json(
    {
      run,
      articles: listPipelineRunArticles(runId),
      logs: listPipelineRunLogs(runId),
      stageSummary: getPipelineStageSummary(runId),
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
