import { NextResponse } from "next/server";

import { requestPipelineRun } from "@/lib/article-bot-control";
import type { PipelineRunCadence } from "@/lib/article-dashboard";

function getRedirectUrl(request: Request) {
  return request.headers.get("referer") ?? new URL("/runs", request.url).toString();
}

function wantsAsyncResponse(request: Request) {
  return request.headers.get("x-dashboard-async") === "1";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const cadence: PipelineRunCadence = formData.get("cadence") === "weekly" ? "weekly" : "daily";
    await requestPipelineRun(cadence);
  } catch (error) {
    console.error("pipeline run request failed", error);
  }

  if (wantsAsyncResponse(request)) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.redirect(getRedirectUrl(request), { status: 303 });
}
