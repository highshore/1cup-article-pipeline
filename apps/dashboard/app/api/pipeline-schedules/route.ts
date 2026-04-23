import { NextResponse } from "next/server";

import { mutatePipelineSchedule } from "@/lib/article-bot-control";

function getRedirectUrl(request: Request) {
  return request.headers.get("referer") ?? new URL("/runs", request.url).toString();
}

function wantsAsyncResponse(request: Request) {
  return request.headers.get("x-dashboard-async") === "1";
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const scheduleKey = String(formData.get("scheduleKey") ?? "");
  const timeOfDay = String(formData.get("timeOfDay") ?? "");
  const weekdays = formData
    .getAll("weekdays")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));

  try {
    if (scheduleKey === "daily_kakao_report" || scheduleKey === "weekly_kakao_report") {
      await mutatePipelineSchedule({ scheduleKey, weekdays, timeOfDay });
    }
  } catch (error) {
    console.error("pipeline schedule mutation failed", error);
  }

  if (wantsAsyncResponse(request)) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.redirect(getRedirectUrl(request), { status: 303 });
}
