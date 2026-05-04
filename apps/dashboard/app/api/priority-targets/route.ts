import { NextResponse } from "next/server";

import { mutatePriorityTarget } from "@/lib/article-bot-control";

function getRedirectUrl(request: Request) {
  return request.headers.get("referer") ?? new URL("/runs", request.url).toString();
}

function wantsAsyncResponse(request: Request) {
  return request.headers.get("x-dashboard-async") === "1";
}

function parseCommaSeparatedList(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  let mutationError: unknown = null;

  try {
    if (intent === "add") {
      for (const label of parseCommaSeparatedList(formData.get("label"))) {
        await mutatePriorityTarget({ intent: "add", label });
      }
    }
    if (intent === "delete") {
      const targetId = Number(formData.get("targetId"));
      if (Number.isInteger(targetId)) {
        await mutatePriorityTarget({ intent: "delete", targetId });
      }
    }
    if (intent === "reset") {
      await mutatePriorityTarget({ intent: "reset" });
    }
  } catch (error) {
    mutationError = error;
    console.error("priority-target mutation failed", error);
  }

  if (wantsAsyncResponse(request)) {
    if (mutationError) {
      return NextResponse.json({ ok: false, error: "priority-target-mutation-failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.redirect(getRedirectUrl(request), { status: 303 });
}
