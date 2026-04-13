import fs from "node:fs";
import path from "node:path";

import { getDb } from "@/lib/db";

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

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
  status: ReviewStatus | null;
  note: string | null;
  updated_at: string | null;
  document_json: string;
};

export function listArticles(filter: ReviewFilter): ArticleRecord[] {
  const db = getDb();
  const clauses = ["1 = 1"];
  const params: Array<string> = [];

  if (filter.status !== "all") {
    clauses.push("COALESCE(ar.status, 'pending') = ?");
    params.push(filter.status);
  }

  if (filter.source !== "all") {
    clauses.push("ca.source = ?");
    params.push(filter.source);
  }

  if (filter.query) {
    clauses.push("(ca.title LIKE ? OR ca.url LIKE ? OR ca.article_text LIKE ?)");
    const q = `%${filter.query}%`;
    params.push(q, q, q);
  }

  const rows = db
    .prepare(
      `
      SELECT
        ca.article_id,
        ca.source,
        ca.section,
        ca.title,
        ca.subtitle,
        ca.phase,
        ca.url,
        ca.article_text,
        ca.input_file_path,
        ca.crawled_at,
        ar.status,
        ar.note,
        ar.updated_at,
        ca.document_json
      FROM crawled_articles AS ca
      LEFT JOIN article_reviews AS ar
        ON ar.article_id = ca.article_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY ca.crawled_at DESC, ca.url DESC
      LIMIT 300
      `,
    )
    .all(...params) as ArticleRow[];

  return rows.map(toArticleRecord);
}

export function getArticle(articleId: string): ArticleRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT
        ca.article_id,
        ca.source,
        ca.section,
        ca.title,
        ca.subtitle,
        ca.phase,
        ca.url,
        ca.article_text,
        ca.input_file_path,
        ca.crawled_at,
        ar.status,
        ar.note,
        ar.updated_at,
        ca.document_json
      FROM crawled_articles AS ca
      LEFT JOIN article_reviews AS ar
        ON ar.article_id = ca.article_id
      WHERE ca.article_id = ?
      LIMIT 1
      `,
    )
    .get(articleId) as ArticleRow | undefined;

  return row ? toArticleRecord(row) : null;
}

export function getSources(): string[] {
  const db = getDb();
  const rows = db.prepare("SELECT DISTINCT source FROM crawled_articles ORDER BY source").all() as Array<{ source: string }>;
  return rows.map((row) => row.source);
}

export function upsertReview(articleId: string, status: ReviewStatus, note: string): void {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO article_reviews (article_id, status, note, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(article_id) DO UPDATE SET
      status = excluded.status,
      note = excluded.note,
      updated_at = excluded.updated_at
    `,
  ).run(articleId, status, note.trim());
}

function toArticleRecord(row: ArticleRow): ArticleRecord {
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
    status: row.status ?? "pending",
    note: row.note ?? "",
    updatedAt: row.updated_at ?? null,
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

function parseDocumentJson(documentJson: string): Record<string, unknown> | null {
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
