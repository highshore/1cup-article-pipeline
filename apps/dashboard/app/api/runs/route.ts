import { listPipelineRuns } from "@/lib/runs";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.floor(rawLimit))) : 20;

  return Response.json(
    { runs: listPipelineRuns(limit) },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
