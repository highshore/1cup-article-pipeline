"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ArrowPathIcon, ClockIcon, NewspaperIcon, TrendingIcon } from "@/components/icons";
import type { ArticleDashboardFilters, ArticleDashboardItem } from "@/lib/article-dashboard";

const PAGE_SIZE = 10;

function statusClasses(status: string) {
  if (status === "pending") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "deferred") return "border-slate-200 bg-slate-100 text-slate-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function buildApiUrl(filters: ArticleDashboardFilters, offset: number, limit: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (!value || value === "all") {
      continue;
    }
    params.set(key, value);
  }
  params.set("offset", String(offset));
  params.set("limit", String(limit));
  return `/api/article-items?${params.toString()}`;
}

function ArticleCard({ item }: { item: ArticleDashboardItem }) {
  return (
    <a
      className="block rounded-[26px] border border-slate-200/75 bg-white/80 p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur transition hover:-translate-y-0.5 hover:border-ember/35 hover:bg-white/90"
      href={item.url}
      rel="noreferrer"
      target="_blank"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]">
              <span className="rounded-full bg-ember/10 px-3 py-1 text-ember">{item.source.toUpperCase()}</span>
              <span className="rounded-full bg-moss/10 px-3 py-1 text-moss">{item.phase}</span>
              <span className={`rounded-full border px-3 py-1 ${statusClasses(item.status)}`}>{item.status}</span>
            </div>
            <div>
              <h3 className="font-[family:var(--font-serif)] text-2xl font-semibold leading-tight text-ink">{item.title}</h3>
              <p className="mt-2 line-clamp-3 text-sm leading-7 text-ink/70">{item.summary}</p>
            </div>
          </div>

          <div className="grid gap-2 rounded-2xl border border-slate-200/75 bg-white/70 px-4 py-3 text-sm text-ink/65 lg:min-w-56">
            <div className="flex items-center gap-2">
              <ClockIcon className="h-4 w-4 text-ember" />
              <span>{item.crawledAt.replace("T", " ").slice(0, 16)}</span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingIcon className="h-4 w-4 text-ember" />
              <span>Fit score {item.score}</span>
            </div>
            <div className="flex items-center gap-2">
              <NewspaperIcon className="h-4 w-4 text-ember" />
              <span>{item.section || "frontpage"} / {item.mediaCount} media</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {item.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-shell px-3 py-1 text-sm font-medium text-ink/70">
              #{tag}
            </span>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200/70 bg-white/72 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-ink/45">Evaluation signals</p>
          <p className="mt-2 text-sm leading-7 text-ink/75">{item.relevanceNotes}</p>
        </div>
      </div>
    </a>
  );
}

export function ArticleResultsFeed({
  initialItems,
  totalCount,
  filters,
}: {
  initialItems: ArticleDashboardItem[];
  totalCount: number;
  filters: ArticleDashboardFilters;
}) {
  const [items, setItems] = useState(initialItems);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialItems.length < totalCount);
  const [loadError, setLoadError] = useState("");
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const apiUrl = useMemo(() => buildApiUrl(filters, items.length, PAGE_SIZE), [filters, items.length]);

  useEffect(() => {
    setItems(initialItems);
    setHasMore(initialItems.length < totalCount);
    setLoadError("");
    setIsLoading(false);
  }, [initialItems, totalCount]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || isLoading) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || isLoading) {
          return;
        }

        setIsLoading(true);
        fetch(apiUrl, { cache: "no-store" })
          .then(async (response) => {
            if (!response.ok) {
              throw new Error("Unable to load more article results.");
            }
            const payload = (await response.json()) as {
              items?: ArticleDashboardItem[];
              hasMore?: boolean;
            };
            const nextItems = Array.isArray(payload.items) ? payload.items : [];
            setItems((current) => {
              const existingIds = new Set(current.map((item) => item.articleId));
              return [...current, ...nextItems.filter((item) => !existingIds.has(item.articleId))];
            });
            setHasMore(Boolean(payload.hasMore) && nextItems.length > 0);
            setLoadError("");
          })
          .catch((error) => setLoadError(error instanceof Error ? error.message : "Unable to load more article results."))
          .finally(() => setIsLoading(false));
      },
      { rootMargin: "320px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [apiUrl, hasMore, isLoading]);

  if (items.length === 0) {
    return (
      <div className="rounded-[26px] border border-slate-200/75 bg-white/80 p-8 text-center text-sm leading-7 text-ink/60">
        No article results match the current filters yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <ArticleCard key={item.articleId} item={item} />
      ))}

      {loadError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div> : null}

      {hasMore ? (
        <div ref={sentinelRef} className="flex items-center justify-center py-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/75 bg-white/80 px-4 py-2 text-sm text-ink/60">
            {isLoading ? (
              <>
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                Loading more
              </>
            ) : (
              `Loading 10 at a time (${items.length} / ${totalCount})`
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center py-2 text-sm text-ink/55">
          {`All article results loaded (${items.length} / ${totalCount})`}
        </div>
      )}
    </div>
  );
}
