import { createClient } from "@/lib/supabase/server";

export type DashboardSchemaStatus = {
  hasCrawledArticles: boolean;
  hasArticleReviews: boolean;
};

export async function getDashboardSchemaStatus(): Promise<DashboardSchemaStatus> {
  const supabase = await createClient();

  const [articlesResult, reviewsResult] = await Promise.all([
    supabase.from("crawled_articles").select("article_id", { head: true, count: "exact" }).limit(1),
    supabase.from("article_reviews").select("article_id", { head: true, count: "exact" }).limit(1),
  ]);

  return {
    hasCrawledArticles: !isMissingRelationError(articlesResult.error?.message),
    hasArticleReviews: !isMissingRelationError(reviewsResult.error?.message),
  };
}

function isMissingRelationError(message: string | undefined): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not find the table") ||
    normalized.includes("relation") && normalized.includes("does not exist")
  );
}
