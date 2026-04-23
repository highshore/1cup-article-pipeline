"use client";

import { useEffect, useState } from "react";

import { ClockIcon } from "@/components/icons";

function formatRelativeTime(isoTimestamp: string, nowMs: number) {
  const targetMs = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(targetMs)) {
    return "just now";
  }

  const diffMinutes = Math.max(0, Math.floor((nowMs - targetMs) / 60000));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ${diffHours % 24}h ago`;
  if (diffHours > 0) return `${diffHours}h ${diffMinutes % 60}m ago`;
  if (diffMinutes > 0) return `${diffMinutes}m ago`;
  return "just now";
}

export function LatestCollectionCard({
  latestCollectedAt,
  todayLabel,
}: {
  latestCollectedAt: string;
  todayLabel: string;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  const formattedTimestamp = latestCollectedAt ? latestCollectedAt.replace("T", " ").slice(0, 16) : "No records yet";

  return (
    <div className="min-w-0 rounded-[24px] border border-slate-200/75 bg-white/76 p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur xl:max-w-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-ink/45">Latest crawl</p>
          <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-ink">{formattedTimestamp}</p>
        </div>
        <div className="rounded-2xl bg-ember/10 p-2 text-ember">
          <ClockIcon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-ink/65">{todayLabel}</p>
      <p className="mt-2 inline-flex items-center rounded-full border border-slate-200/75 bg-white/80 px-3 py-1 text-sm font-medium text-ember">
        {latestCollectedAt ? formatRelativeTime(latestCollectedAt, nowMs) : "No crawl history"}
      </p>
    </div>
  );
}
