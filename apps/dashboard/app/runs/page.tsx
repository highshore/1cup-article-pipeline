import { ArticleOpsDashboard } from "@/components/article-ops-dashboard";
import { getArticleDashboardData, getDefaultArticleDashboardFilters } from "@/lib/article-dashboard";
import { requireUser } from "@/lib/auth";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined, fallback = ""): string {
  return Array.isArray(value) ? value[0] ?? fallback : value ?? fallback;
}

function formatTodayLabel() {
  return new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}

export default async function RunsPage({ searchParams }: PageProps) {
  await requireUser();
  const resolvedParams = (await searchParams) ?? {};
  const filters = getDefaultArticleDashboardFilters({
    source: getParam(resolvedParams.source, "all"),
    phase: getParam(resolvedParams.phase, "all"),
    status: getParam(resolvedParams.status, "all"),
    collectedOn: getParam(resolvedParams.collectedOn, ""),
    search: getParam(resolvedParams.search, ""),
  });
  const data = await getArticleDashboardData(filters);

  return <ArticleOpsDashboard data={data} todayLabel={formatTodayLabel()} />;
}
