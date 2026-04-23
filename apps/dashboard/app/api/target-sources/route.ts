import { NextResponse } from "next/server";

import { mutateTargetSource } from "@/lib/article-bot-control";

function getRedirectUrl(request: Request) {
  return request.headers.get("referer") ?? new URL("/runs", request.url).toString();
}

function wantsAsyncResponse(request: Request) {
  return request.headers.get("x-dashboard-async") === "1";
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "add") {
      await mutateTargetSource({ intent: "add", domain: String(formData.get("domain") ?? "") });
    }
    if (intent === "delete") {
      const targetSourceId = Number(formData.get("targetSourceId"));
      if (Number.isInteger(targetSourceId)) {
        await mutateTargetSource({ intent: "delete", targetSourceId });
      }
    }
  } catch (error) {
    console.error("target-source mutation failed", error);
  }

  if (wantsAsyncResponse(request)) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.redirect(getRedirectUrl(request), { status: 303 });
}
