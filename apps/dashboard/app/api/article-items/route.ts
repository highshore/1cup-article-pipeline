import { NextResponse } from "next/server";

import {
  getArticleDashboardItemCount,
  getArticleDashboardItems,
  getDefaultArticleDashboardFilters,
} from "@/lib/article-dashboard";

export const dynamic = "force-dynamic";

function readNumber(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const offset = readNumber(searchParams.get("offset"), 0);
  const limit = Math.min(readNumber(searchParams.get("limit"), 10), 50);
  const filters = getDefaultArticleDashboardFilters({
    source: searchParams.get("source") ?? undefined,
    phase: searchParams.get("phase") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    collectedOn: searchParams.get("collectedOn") ?? undefined,
    search: searchParams.get("search") ?? undefined,
  });
  const [count, items] = await Promise.all([
    getArticleDashboardItemCount(filters),
    getArticleDashboardItems(filters, { limit, offset }),
  ]);

  return NextResponse.json({
    filters,
    count,
    offset,
    limit,
    hasMore: offset + items.length < count,
    items,
  });
}
