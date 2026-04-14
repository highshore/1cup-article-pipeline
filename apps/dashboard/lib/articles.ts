import fs from "node:fs";
import path from "node:path";

import { createClient } from "@/lib/supabase/server";

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
const ARTICLE_QUERY_LIMIT = 1200;
const ARTICLE_PAGE_LIMIT = 300;

export type ReviewStatus = "pending" | "approved" | "deferred" | "rejected";

export type ReviewFilter = {
  status: ReviewStatus | "all";
  source: string;
  query: string;
};

export type MediaEntry = {
  media_id: string;
  kind: string;
  order: number;
  title: string;
  asset_path: string | null;
  source_url: string | null;
  src: string;
  alt: string;
  caption: string;
  credit: string;
  preceding_text: string;
  following_text: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  screenshot_path: string | null;
};

export type ArticleContentBlock =
  | {
      type: "paragraph";
      order: number;
      paragraphId: string;
      text: string;
    }
  | {
      type: "media";
      order: number;
      mediaId: string;
      kind: string;
      title: string;
      assetPath: string | null;
      sourceUrl: string | null;
      alt: string;
      caption: string;
      credit: string;
      precedingText: string;
      followingText: string;
    };

export type ArticleRecord = {
  articleId: string;
  source: string;
  section: string;
  title: string;
  subtitle: string;
  phase: string;
  url: string;
  articleText: string;
  inputFilePath: string;
  crawledAt: string;
  status: ReviewStatus;
  note: string;
  updatedAt: string | null;
  media: MediaEntry[];
  content: ArticleContentBlock[];
  processed: {
    titleKo: string | null;
    subtitleKo: string | null;
    summaryEn: string[];
    summaryKo: string[];
    discussionTopics: string[];
    paragraphsKo: string[];
    c1Vocab: Array<{
      term: string;
      meaningEn: string;
      reason: string;
      exampleFromArticle: string;
    }>;
    atypicalTerms: Array<{
      term: string;
      category: string;
      explanationEn: string;
    }>;
    imagePath: string | null;
    imageUrl: string | null;
  };
  excerpt: string;
};

type ArticleRow = {
  article_id: string;
  source: string;
  section: string;
  title: string;
  subtitle: string;
  phase: string;
  url: string;
  article_text: string;
  input_file_path: string;
  crawled_at: string;
  document_json: string | Record<string, unknown> | null;
};

type ReviewRow = {
  article_id: string;
  status: ReviewStatus | null;
  note: string | null;
  updated_at: string | null;
};

export async function listArticles(filter: ReviewFilter): Promise<ArticleRecord[]> {
  const supabase = await createClient();
  let query = supabase
    .from("crawled_articles")
    .select("article_id, source, section, title, subtitle, phase, url, article_text, input_file_path, crawled_at, document_json")
    .order("crawled_at", { ascending: false })
    .order("url", { ascending: false })
    .limit(ARTICLE_QUERY_LIMIT);

  if (filter.source !== "all") {
    query = query.eq("source", filter.source);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error.message)) {
      return [];
    }
    throw new Error(`Failed to load articles from Supabase: ${error.message}`);
  }

  const rows = (data ?? []) as ArticleRow[];
  const reviews = await getReviewMap(rows.map((row) => row.article_id));

  return rows
    .map((row) => toArticleRecord(row, reviews.get(row.article_id)))
    .filter((record) => matchesStatusFilter(record, filter.status))
    .filter((record) => matchesQueryFilter(record, filter.query))
    .slice(0, ARTICLE_PAGE_LIMIT);
}

export async function getArticle(articleId: string): Promise<ArticleRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crawled_articles")
    .select("article_id, source, section, title, subtitle, phase, url, article_text, input_file_path, crawled_at, document_json")
    .eq("article_id", articleId)
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error.message)) {
      return null;
    }
    throw new Error(`Failed to load article ${articleId} from Supabase: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const reviews = await getReviewMap([articleId]);
  return toArticleRecord(data as ArticleRow, reviews.get(articleId));
}

export async function getSources(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("crawled_articles").select("source").order("source", { ascending: true }).limit(ARTICLE_QUERY_LIMIT);

  if (error) {
    if (isMissingRelationError(error.message)) {
      return [];
    }
    throw new Error(`Failed to load sources from Supabase: ${error.message}`);
  }

  return Array.from(new Set((data ?? []).map((row) => String(row.source ?? "").trim()).filter(Boolean)));
}

export async function upsertReview(articleId: string, status: ReviewStatus, note: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("article_reviews").upsert(
    {
      article_id: articleId,
      status,
      note: note.trim(),
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "article_id",
    },
  );

  if (error) {
    throw new Error(`Failed to save review for ${articleId}: ${error.message}`);
  }
}

async function getReviewMap(articleIds: string[]): Promise<Map<string, ReviewRow>> {
  const uniqueIds = Array.from(new Set(articleIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("article_reviews")
    .select("article_id, status, note, updated_at")
    .in("article_id", uniqueIds);

  if (error) {
    if (isMissingRelationError(error.message)) {
      return new Map();
    }
    throw new Error(`Failed to load article reviews from Supabase: ${error.message}`);
  }

  return new Map((data ?? []).map((row) => [row.article_id, row as ReviewRow]));
}

function toArticleRecord(row: ArticleRow, review?: ReviewRow | null): ArticleRecord {
  const payload = parseDocumentJson(row.document_json);
  const content = buildArticleContent(row, payload);
  const media = content.filter(isMediaBlock).map(toMediaEntry);

  return {
    articleId: row.article_id,
    source: row.source,
    section: row.section,
    title: row.title,
    subtitle: row.subtitle,
    phase: row.phase,
    url: row.url,
    articleText: row.article_text,
    inputFilePath: row.input_file_path,
    crawledAt: row.crawled_at,
    status: review?.status ?? "pending",
    note: review?.note ?? "",
    updatedAt: review?.updated_at ?? null,
    media,
    content,
    processed: {
      titleKo: normalizeOptionalString(payload?.title_ko),
      subtitleKo: normalizeOptionalString(payload?.subtitle_ko),
      summaryEn: normalizeStringArray(payload?.summary_en),
      summaryKo: normalizeStringArray(payload?.summary_ko),
      discussionTopics: normalizeStringArray(payload?.discussion_topics),
      paragraphsKo: normalizeStringArray(payload?.paragraphs_ko),
      c1Vocab: normalizeC1Vocab(payload?.c1_vocab),
      atypicalTerms: normalizeAtypicalTerms(payload?.atypical_terms),
      imagePath: normalizeAssetPath(payload?.image_path),
      imageUrl: normalizeOptionalString(payload?.image_url),
    },
    excerpt: row.article_text.split(/\n\s*\n/).filter(Boolean).slice(0, 2).join("\n\n"),
  };
}

function matchesStatusFilter(record: ArticleRecord, status: ReviewStatus | "all"): boolean {
  return status === "all" ? true : record.status === status;
}

function matchesQueryFilter(record: ArticleRecord, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [record.title, record.url, record.articleText].some((value) => value.toLowerCase().includes(normalizedQuery));
}

function isMissingRelationError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not find the table") ||
    normalized.includes("relation") && normalized.includes("does not exist")
  );
}

function buildArticleContent(row: ArticleRow, payload: Record<string, unknown> | null): ArticleContentBlock[] {
  const article = payload?.article;

  if (Array.isArray(article)) {
    const blocks = article
      .map((item) => toContentBlock(item, row.input_file_path, row.article_id))
      .filter((block): block is ArticleContentBlock => block !== null)
      .sort((left, right) => left.order - right.order);

    if (blocks.length > 0) {
      return blocks;
    }
  }

  return row.article_text
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((text, index) => ({
      type: "paragraph" as const,
      order: index + 1,
      paragraphId: `fallback-paragraph-${index + 1}`,
      text,
    }));
}

function parseDocumentJson(documentJson: string | Record<string, unknown> | null): Record<string, unknown> | null {
  if (!documentJson) {
    return null;
  }

  if (typeof documentJson === "object") {
    return documentJson;
  }

  try {
    return JSON.parse(documentJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toContentBlock(raw: unknown, inputFilePath: string, articleId: string): ArticleContentBlock | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const item = raw as Record<string, unknown>;
  const type = String(item.type ?? "");
  const order = Number(item.order ?? 0);

  if (type === "paragraph") {
    const text = String(item.text ?? "").trim();
    if (!text) {
      return null;
    }
    return {
      type: "paragraph",
      order,
      paragraphId: String(item.paragraph_id ?? `paragraph-${order}`),
      text,
    };
  }

  if (type === "media") {
    const kind = String(item.kind ?? "media");
    return {
      type: "media",
      order,
      mediaId: String(item.media_id ?? `media-${order}`),
      kind,
      title: String(item.title ?? ""),
      assetPath: resolveMediaAssetPath(item.asset_path, inputFilePath, articleId, order),
      sourceUrl: normalizeOptionalString(item.source_url),
      alt: String(item.alt ?? ""),
      caption: String(item.caption ?? ""),
      credit: String(item.credit ?? ""),
      precedingText: String(item.preceding_text ?? ""),
      followingText: String(item.following_text ?? ""),
    };
  }

  return null;
}

function resolveMediaAssetPath(
  rawAssetPath: unknown,
  inputFilePath: string,
  articleId: string,
  order: number,
): string | null {
  const explicit = normalizeOptionalString(rawAssetPath);
  if (explicit) {
    return toRepoRelativePath(explicit);
  }

  const articleDir = path.dirname(inputFilePath);
  const mediaDir = path.join(articleDir, "_media", articleId);
  if (!fs.existsSync(mediaDir)) {
    return null;
  }

  const prefix = `${String(order).padStart(2, "0")}-`;
  const candidate = fs.readdirSync(mediaDir).find((entry) => entry.startsWith(prefix));
  if (!candidate) {
    return null;
  }

  return toRepoRelativePath(path.join(mediaDir, candidate));
}

function toRepoRelativePath(filePath: string): string | null {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(REPO_ROOT, filePath);
  const relativePath = path.relative(REPO_ROOT, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  return relativePath;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeAssetPath(value: unknown): string | null {
  const rawPath = normalizeOptionalString(value);
  return rawPath ? toRepoRelativePath(rawPath) : null;
}

function normalizeC1Vocab(
  value: unknown,
): Array<{ term: string; meaningEn: string; reason: string; exampleFromArticle: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const term = String(record.term ?? "").trim();
      const meaningEn = String(record.meaning_en ?? "").trim();
      const reason = String(record.reason ?? "").trim();
      const exampleFromArticle = String(record.example_from_article ?? "").trim();

      if (!(term && meaningEn && reason && exampleFromArticle)) {
        return null;
      }

      return {
        term,
        meaningEn,
        reason,
        exampleFromArticle,
      };
    })
    .filter((item): item is { term: string; meaningEn: string; reason: string; exampleFromArticle: string } => item !== null);
}

function normalizeAtypicalTerms(
  value: unknown,
): Array<{ term: string; category: string; explanationEn: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const term = String(record.term ?? "").trim();
      const category = String(record.category ?? "").trim();
      const explanationEn = String(record.explanation_en ?? "").trim();

      if (!(term && category && explanationEn)) {
        return null;
      }

      return {
        term,
        category,
        explanationEn,
      };
    })
    .filter((item): item is { term: string; category: string; explanationEn: string } => item !== null);
}

function isMediaBlock(block: ArticleContentBlock): block is Extract<ArticleContentBlock, { type: "media" }> {
  return block.type === "media";
}

function toMediaEntry(block: Extract<ArticleContentBlock, { type: "media" }>): MediaEntry {
  return {
    media_id: block.mediaId,
    kind: block.kind,
    order: block.order,
    title: block.title,
    asset_path: block.assetPath,
    source_url: block.sourceUrl,
    src: block.sourceUrl ?? "",
    alt: block.alt,
    caption: block.caption,
    credit: block.credit,
    preceding_text: block.precedingText,
    following_text: block.followingText,
    bbox: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    },
    screenshot_path: block.assetPath,
  };
}
