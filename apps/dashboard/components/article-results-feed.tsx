"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import { ArrowPathIcon, ClockIcon, NewspaperIcon, TrendingIcon } from "@/components/icons";
import type { ArticleDashboardFilters, ArticleDashboardItem } from "@/lib/article-dashboard";

const PAGE_SIZE = 10;

const FeedStack = styled.div`
  display: grid;
  gap: 16px;
`;

const ArticleLink = styled.a`
  display: block;
  border: 1px solid rgba(226, 232, 240, 0.75);
  border-radius: 26px;
  background: rgba(255, 255, 255, 0.8);
  padding: 20px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.05);
  backdrop-filter: blur(14px);
  transition:
    transform 140ms ease,
    border-color 140ms ease,
    background-color 140ms ease;

  &:hover {
    transform: translateY(-2px);
    border-color: rgba(217, 119, 6, 0.35);
    background: rgba(255, 255, 255, 0.9);
  }
`;

const ArticleBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const ArticleHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;

  @media (min-width: 1024px) {
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
  }
`;

const ArticleCopy = styled.div`
  display: grid;
  gap: 12px;
`;

const PillRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
`;

const SourcePill = styled.span`
  border-radius: 999px;
  background: rgba(217, 119, 6, 0.1);
  padding: 4px 12px;
  color: #d97706;
`;

const PhasePill = styled.span`
  border-radius: 999px;
  background: rgba(22, 101, 52, 0.1);
  padding: 4px 12px;
  color: #166534;
`;

const statusTone = {
  approved: {
    border: "#a7f3d0",
    background: "#ecfdf5",
    color: "#065f46",
  },
  deferred: {
    border: "#e2e8f0",
    background: "#f1f5f9",
    color: "#334155",
  },
  pending: {
    border: "#fde68a",
    background: "#fffbeb",
    color: "#92400e",
  },
  rejected: {
    border: "#fecaca",
    background: "#fef2f2",
    color: "#b91c1c",
  },
} as const;

const StatusPill = styled.span<{ $status: string }>`
  border: 1px solid ${({ $status }) => statusTone[$status as keyof typeof statusTone]?.border ?? "#e2e8f0"};
  border-radius: 999px;
  background: ${({ $status }) => statusTone[$status as keyof typeof statusTone]?.background ?? "#f1f5f9"};
  padding: 4px 12px;
  color: ${({ $status }) => statusTone[$status as keyof typeof statusTone]?.color ?? "#334155"};
`;

const ArticleTitle = styled.h3`
  color: #0f172a;
  font-family: var(--font-serif);
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.15;
`;

const ArticleSummary = styled.p`
  display: -webkit-box;
  margin-top: 8px;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  color: rgba(15, 23, 42, 0.7);
  font-size: 0.875rem;
  line-height: 1.75;
`;

const ArticleMeta = styled.div`
  display: grid;
  gap: 8px;
  border: 1px solid rgba(226, 232, 240, 0.75);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.7);
  padding: 12px 16px;
  color: rgba(15, 23, 42, 0.65);
  font-size: 0.875rem;

  @media (min-width: 1024px) {
    min-width: 224px;
  }
`;

const MetaLine = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;

  svg {
    width: 16px;
    height: 16px;
    color: #d97706;
  }
`;

const TagRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const TagPill = styled.span`
  border-radius: 999px;
  background: #f5f7fb;
  padding: 4px 12px;
  color: rgba(15, 23, 42, 0.7);
  font-size: 0.875rem;
  font-weight: 500;
`;

const EvaluationBox = styled.div`
  border: 1px solid rgba(226, 232, 240, 0.7);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  padding: 16px;
`;

const EvaluationLabel = styled.p`
  color: rgba(15, 23, 42, 0.45);
  font-size: 0.75rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
`;

const EvaluationText = styled.p`
  margin-top: 8px;
  color: rgba(15, 23, 42, 0.75);
  font-size: 0.875rem;
  line-height: 1.75;
`;

const EmptyState = styled.div`
  border: 1px solid rgba(226, 232, 240, 0.75);
  border-radius: 26px;
  background: rgba(255, 255, 255, 0.8);
  padding: 32px;
  text-align: center;
  color: rgba(15, 23, 42, 0.6);
  font-size: 0.875rem;
  line-height: 1.75;
`;

const LoadError = styled.div`
  border: 1px solid #fecaca;
  border-radius: 16px;
  background: #fef2f2;
  padding: 12px 16px;
  color: #b91c1c;
  font-size: 0.875rem;
`;

const FeedStatusWrap = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
`;

const LoadingPill = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(226, 232, 240, 0.75);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  padding: 8px 16px;
  color: rgba(15, 23, 42, 0.6);
  font-size: 0.875rem;
`;

const EndMessage = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
  color: rgba(15, 23, 42, 0.55);
  font-size: 0.875rem;
`;

const SpinIcon = styled(ArrowPathIcon)`
  width: 16px;
  height: 16px;
  animation: spin 1s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

function formatCrawledAt(value: string) {
  return value.replace("T", " ").slice(0, 16);
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
    <ArticleLink href={item.url} rel="noreferrer" target="_blank">
      <ArticleBody>
        <ArticleHeader>
          <ArticleCopy>
            <PillRow>
              <SourcePill>{item.source.toUpperCase()}</SourcePill>
              <PhasePill>{item.phase}</PhasePill>
              <StatusPill $status={item.status}>{item.status}</StatusPill>
            </PillRow>
            <div>
              <ArticleTitle>{item.title}</ArticleTitle>
              <ArticleSummary>{item.summary}</ArticleSummary>
            </div>
          </ArticleCopy>

          <ArticleMeta>
            <MetaLine>
              <ClockIcon />
              <span>{formatCrawledAt(item.crawledAt)}</span>
            </MetaLine>
            <MetaLine>
              <TrendingIcon />
              <span>Fit score {item.score}</span>
            </MetaLine>
            <MetaLine>
              <NewspaperIcon />
              <span>{item.section || "frontpage"} / {item.mediaCount} media</span>
            </MetaLine>
          </ArticleMeta>
        </ArticleHeader>

        <TagRow>
          {item.tags.map((tag) => (
            <TagPill key={tag}>
              #{tag}
            </TagPill>
          ))}
        </TagRow>

        <EvaluationBox>
          <EvaluationLabel>Evaluation signals</EvaluationLabel>
          <EvaluationText>{item.relevanceNotes}</EvaluationText>
        </EvaluationBox>
      </ArticleBody>
    </ArticleLink>
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
      <EmptyState>
        No article results match the current filters yet.
      </EmptyState>
    );
  }

  return (
    <FeedStack>
      {items.map((item) => (
        <ArticleCard key={item.articleId} item={item} />
      ))}

      {loadError ? <LoadError>{loadError}</LoadError> : null}

      {hasMore ? (
        <FeedStatusWrap ref={sentinelRef}>
          <LoadingPill>
            {isLoading ? (
              <>
                <SpinIcon />
                Loading more
              </>
            ) : (
              `Loading 10 at a time (${items.length} / ${totalCount})`
            )}
          </LoadingPill>
        </FeedStatusWrap>
      ) : (
        <EndMessage>
          {`All article results loaded (${items.length} / ${totalCount})`}
        </EndMessage>
      )}
    </FeedStack>
  );
}
