import { NextResponse } from "next/server";

import { mutatePriorityTarget } from "@/lib/article-bot-control";

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
      await mutatePriorityTarget({ intent: "add", label: String(formData.get("label") ?? "") });
    }
    if (intent === "delete") {
      const targetId = Number(formData.get("targetId"));
      if (Number.isInteger(targetId)) {
        await mutatePriorityTarget({ intent: "delete", targetId });
      }
    }
  } catch (error) {
    console.error("priority-target mutation failed", error);
  }

  if (wantsAsyncResponse(request)) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.redirect(getRedirectUrl(request), { status: 303 });
}
