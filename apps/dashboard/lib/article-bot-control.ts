import "server-only";

import {
  mutatePipelineScheduleLocal,
  mutatePriorityTargetLocal,
  mutateTargetSourceLocal,
  requestPipelineRunLocal,
  stopPipelineRunLocal,
  type PipelineScheduleKey,
} from "@/lib/article-dashboard";

type ControlResponse = {
  ok?: boolean;
  reason?: string;
  error?: string;
};

type PriorityTargetMutation =
  | {
      intent: "add";
      label: string;
    }
  | {
      intent: "delete";
      targetId: number;
    };

type TargetSourceMutation =
  | {
      intent: "add";
      domain: string;
    }
  | {
      intent: "delete";
      targetSourceId: number;
    };

type PipelineScheduleMutation = {
  scheduleKey: PipelineScheduleKey;
  weekdays: number[];
  timeOfDay: string;
};

const CONTROL_BASE_URL = process.env.ARTICLE_BOT_CONTROL_BASE_URL ?? "";

async function postControl<T extends ControlResponse>(
  path: string,
  payload: Record<string, unknown>,
): Promise<T> {
  if (!CONTROL_BASE_URL) {
    throw new Error("ARTICLE_BOT_CONTROL_BASE_URL is not configured");
  }

  const response = await fetch(`${CONTROL_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const result = (await response.json()) as T;

  if (!response.ok) {
    throw new Error(result.error ?? `Article-bot control request failed: ${response.status}`);
  }

  return result;
}

async function withLocalFallback<T extends ControlResponse>(
  path: string,
  payload: Record<string, unknown>,
  fallback: () => T,
): Promise<T> {
  if (!CONTROL_BASE_URL) {
    return fallback();
  }

  try {
    return await postControl<T>(path, payload);
  } catch (error) {
    console.error("article-bot control request failed; using local fallback", error);
    return fallback();
  }
}

export async function requestPipelineRun() {
  return withLocalFallback(
    "/pipeline-runs/request",
    {
      triggerSource: "dashboard",
      requestedBy: "dashboard-ui",
    },
    requestPipelineRunLocal,
  );
}

export async function stopPipelineRun() {
  return withLocalFallback(
    "/pipeline-runs/stop",
    {
      requestedBy: "dashboard-ui",
    },
    stopPipelineRunLocal,
  );
}

export async function mutatePriorityTarget(mutation: PriorityTargetMutation) {
  return withLocalFallback("/priority-targets", mutation, () => mutatePriorityTargetLocal(mutation));
}

export async function mutateTargetSource(mutation: TargetSourceMutation) {
  return withLocalFallback("/target-sources", mutation, () => mutateTargetSourceLocal(mutation));
}

export async function mutatePipelineSchedule(mutation: PipelineScheduleMutation) {
  return withLocalFallback("/pipeline-schedules", mutation, () => mutatePipelineScheduleLocal(mutation));
}
