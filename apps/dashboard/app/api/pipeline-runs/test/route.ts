import { NextResponse } from "next/server";

import { requestPipelineRun } from "@/lib/article-bot-control";

function getRedirectUrl(request: Request) {
  return request.headers.get("referer") ?? new URL("/runs", request.url).toString();
}

function wantsAsyncResponse(request: Request) {
  return request.headers.get("x-dashboard-async") === "1";
}

export async function POST(request: Request) {
  try {
    await requestPipelineRun();
  } catch (error) {
    console.error("pipeline run request failed", error);
  }

  if (wantsAsyncResponse(request)) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.redirect(getRedirectUrl(request), { status: 303 });
}
