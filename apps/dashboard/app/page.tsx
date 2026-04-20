import { updateReviewStatus } from "@/app/actions";
import { AppNav } from "@/components/app-nav";
import { Panel } from "@/components/panel";
import { TranslatableText } from "@/components/translatable-text";
import { getArticle, getSources, listArticles, type ArticleContentBlock, type ReviewFilter, type ReviewStatus } from "@/lib/articles";
import { getDashboardSchemaStatus } from "@/lib/schema-status";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const statusOptions: Array<{ value: ReviewStatus | "all"; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "deferred", label: "Deferred" },
  { value: "rejected", label: "Rejected" },
];

function normalizeFilter(searchParams?: Record<string, string | string[] | undefined>): ReviewFilter {
  const rawStatus = getFirst(searchParams?.status);
  const rawSource = getFirst(searchParams?.source);
  const rawQuery = getFirst(searchParams?.q);

  return {
    status: isReviewStatus(rawStatus) || rawStatus === "all" ? (rawStatus as ReviewFilter["status"]) : "all",
    source: rawSource || "all",
    query: rawQuery || "",
  };
}

export default async function Page({ searchParams }: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const filter = normalizeFilter(resolvedSearchParams);
  const [schemaStatus, sources, articles] = await Promise.all([getDashboardSchemaStatus(), getSources(), listArticles(filter)]);
  const requestedArticleId = getFirst(resolvedSearchParams?.articleId);
  const selectedArticle = (requestedArticleId && (await getArticle(requestedArticleId))) || articles[0] || null;
  const returnTo = buildReturnTo({
    articleId: selectedArticle?.articleId,
    source: filter.source,
    status: filter.status,
    q: filter.query,
  });

  return (
    <main className="mx-auto min-h-screen max-w-[1520px] px-3 py-4 sm:px-4 sm:py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="mb-5">
        <AppNav />
      </div>

      <div className="mb-6 grid gap-4 sm:mb-8 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
        <div className="max-w-3xl">
          <h1 className="text-[2rem] font-semibold leading-tight text-ink sm:text-[2.4rem] md:text-5xl">
            Review crawled articles before they move downstream.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/75 md:text-base">
            This dashboard reads shared article rows from Supabase, shows the original article text and media
            sidecars, and writes review decisions back into the shared database.
          </p>
        </div>
        <div className="w-full rounded-[24px] border border-slate-200/75 bg-white/80 px-4 py-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur sm:px-5 lg:w-auto lg:justify-self-end">
          <div className="text-xs uppercase tracking-[0.22em] text-ink/55">Current dataset</div>
          <div className="mt-3 grid grid-cols-2 gap-4 text-sm text-ink/80 sm:gap-6">
            <div>
              <div className="text-2xl font-semibold text-ink">{articles.length}</div>
              <div>matching rows</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-ink">{sources.length}</div>
              <div>sources</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:gap-6 xl:grid-cols-[396px_minmax(0,1fr)]">
        <section className="rounded-[22px] border border-slate-200/75 bg-white/78 p-3 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur sm:p-4 md:rounded-[24px] md:p-5">
          <form className="grid gap-3 rounded-[20px] border border-slate-200/65 bg-white/60 p-4" method="get">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="grid gap-1 text-sm text-ink/80">
                <span className="font-semibold">Status</span>
                <select
                  className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-0"
                  defaultValue={filter.status}
                  name="status"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm text-ink/80">
                <span className="font-semibold">Source</span>
                <select
                  className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-0"
                  defaultValue={filter.source}
                  name="source"
                >
                  <option value="all">All sources</option>
                  {sources.map((source) => (
                    <option key={source} value={source}>
                      {source.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm text-ink/80">
                <span className="font-semibold">Search</span>
                <input
                  className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-0"
                  defaultValue={filter.query}
                  name="q"
                  placeholder="Title, URL, or article text"
                  type="search"
                />
              </label>
            </div>
            <button
              className="min-h-11 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/90"
              type="submit"
            >
              Apply filters
            </button>
          </form>

          <div className="mt-4 grid gap-3 overflow-y-auto pr-1 lg:max-h-[72vh]">
            {articles.length === 0 ? (
              <div className="rounded-3xl border border-slate-200/65 bg-white/60 px-4 py-12 text-center text-sm text-ink/60">
                No rows matched the current filters.
              </div>
            ) : (
              articles.map((article) => {
                const href = buildReturnTo({
                  articleId: article.articleId,
                  source: filter.source,
                  status: filter.status,
                  q: filter.query,
                });

                return (
                  <a
                    key={article.articleId}
                    className={[
                      "flex min-h-[164px] flex-col rounded-[24px] border px-4 py-4 transition sm:min-h-[208px] sm:rounded-3xl",
                      selectedArticle?.articleId === article.articleId
                        ? "border-ember/35 bg-ember/10 shadow-[0_10px_24px_rgba(37,99,235,0.08)] ring-1 ring-ember/15"
                        : "border-slate-200/70 bg-white/62 hover:border-slate-300/80 hover:bg-white/82",
                    ].join(" ")}
                    href={href}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ink/50">
                          {article.source.toUpperCase()} / {article.section}
                        </p>
                        <h2 className="mt-2 line-clamp-3 font-[family:var(--font-serif)] text-[1.22rem] leading-snug text-ink sm:text-[1.4rem] xl:text-[1.55rem]">
                          {article.title}
                        </h2>
                      </div>
                      <StatusBadge status={article.status} />
                    </div>
                    <p className="mt-3 line-clamp-4 flex-1 text-sm leading-6 text-ink/70">{article.articleText}</p>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.14em] text-ink/45 sm:text-xs sm:tracking-[0.16em]">
                      <span>{formatTimestamp(article.crawledAt)}</span>
                      <span>{article.media.length} media</span>
                    </div>
                  </a>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200/75 bg-white/84 p-4 shadow-panel backdrop-blur sm:p-5 md:rounded-[28px] md:p-7">
          {selectedArticle ? (
            <div className="grid gap-6">
              <div className="flex flex-col gap-4 border-b border-black/10 pb-6">
                <StatusBadge status={selectedArticle.status} />
                <div className="max-w-5xl">
                  <TranslatableText kind="title" original={selectedArticle.title} translated={selectedArticle.processed.titleKo} />
                  {selectedArticle.subtitle ? (
                    <div className="mt-4">
                      <TranslatableText kind="subtitle" original={selectedArticle.subtitle} translated={selectedArticle.processed.subtitleKo} />
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-ink/45">
                    <span className="rounded-full bg-white/62 px-3 py-1">
                      {selectedArticle.source.toUpperCase()} / {selectedArticle.section}
                    </span>
                    <span className="rounded-full bg-white/62 px-3 py-1">Phase: {selectedArticle.phase}</span>
                    <span className="rounded-full bg-white/62 px-3 py-1">{formatTimestamp(selectedArticle.crawledAt)}</span>
                    <span className="rounded-full bg-white/62 px-3 py-1">{selectedArticle.media.length} media</span>
                    <a
                      className="rounded-full bg-white/62 px-3 py-1 font-medium text-dusk underline-offset-4 hover:underline"
                      href={selectedArticle.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open original article
                    </a>
                  </div>
                </div>
              </div>

              <form action={updateReviewStatus} className="grid gap-4 rounded-[24px] border border-slate-200/65 bg-shell/58 p-4 md:rounded-[28px] md:p-5">
                <input name="articleId" type="hidden" value={selectedArticle.articleId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <label className="grid gap-2 text-sm text-ink/80">
                  <span className="font-semibold">Reviewer note</span>
                  <textarea
                    className="min-h-32 rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none"
                    defaultValue={selectedArticle.note}
                    name="note"
                    placeholder="Optional note for why this was approved, deferred, or rejected."
                  />
                </label>
                <div className="grid gap-3 sm:flex sm:flex-wrap">
                  <ActionButton label="Approve" status="approved" tone="approve" />
                  <ActionButton label="Defer" status="deferred" tone="defer" />
                  <ActionButton label="Reject" status="rejected" tone="reject" />
                  <ActionButton label="Reset to Pending" status="pending" tone="pending" />
                </div>
              </form>

              {selectedArticle.phase === "processed" ? (
                <Panel title="Summary" subtitle="Pipeline output">
                  <SummaryList
                    items={selectedArticle.processed.summaryEn}
                    translatedItems={selectedArticle.processed.summaryKo}
                    title="English summary"
                  />
                </Panel>
              ) : null}

              <article className="grid gap-4">
                <Panel title="Article text" subtitle={selectedArticle.inputFilePath}>
                  <ArticleBody article={selectedArticle} />
                </Panel>
              </article>

              <Panel title="Metadata" subtitle="Crawler row">
                <dl className="grid gap-3 text-sm text-ink/75 md:grid-cols-2">
                  <MetaRow label="Article ID" value={selectedArticle.articleId} />
                  <MetaRow label="Phase" value={selectedArticle.phase} />
                  <MetaRow label="Source" value={selectedArticle.source} />
                  <MetaRow label="Section" value={selectedArticle.section} />
                  <MetaRow label="Crawled at" value={selectedArticle.crawledAt} />
                  <MetaRow label="Reviewed at" value={selectedArticle.updatedAt ?? "Not reviewed"} />
                  <MetaRow label="Input path" value={selectedArticle.inputFilePath} />
                  <MetaRow label="Inline media" value={String(selectedArticle.media.length)} />
                </dl>
              </Panel>

              {selectedArticle.phase !== "processed" ? (
                <Panel title="Pipeline Status" subtitle="Current row">
                  <p className="text-sm leading-6 text-ink/65">
                    This row is still in `crawled` phase. Korean translations, summaries, discussion items, and generated images will appear here after the integrated pipeline writes a processed document back into SQLite.
                  </p>
                </Panel>
              ) : null}

              {selectedArticle.phase === "processed" ? (
                <>
                  <Panel
                    title="Discussion Topics"
                    subtitle={`${selectedArticle.processed.discussionTopics.length} prompts`}
                  >
                    <DiscussionTopicsList items={selectedArticle.processed.discussionTopics} />
                  </Panel>

                  <Panel
                    title="Language Notes"
                    subtitle={`${selectedArticle.processed.c1Vocab.length} C1 items, ${selectedArticle.processed.atypicalTerms.length} atypical terms`}
                  >
                    <div className="grid gap-6 lg:grid-cols-2">
                      <VocabList
                        emptyMessage="No C1 vocabulary items were stored for this processed row."
                        items={selectedArticle.processed.c1Vocab}
                        title="C1 vocabulary"
                      />
                      <AtypicalTermsList
                        emptyMessage="No atypical terms were stored for this processed row."
                        items={selectedArticle.processed.atypicalTerms}
                        title="Atypical terms"
                      />
                    </div>
                  </Panel>

                  {selectedArticle.processed.imagePath || selectedArticle.processed.imageUrl ? (
                    <Panel title="Generated Image" subtitle="Pipeline output">
                      <div className="mx-auto max-w-3xl">
                        <img
                          alt={selectedArticle.processed.titleKo || selectedArticle.title}
                          className="block h-auto w-full rounded-[24px] bg-shell object-contain"
                          src={
                            selectedArticle.processed.imageUrl ||
                            `/api/media?path=${encodeURIComponent(selectedArticle.processed.imagePath ?? "")}`
                          }
                        />
                      </div>
                    </Panel>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : (
            <div className="grid min-h-[50vh] place-items-center rounded-[24px] border border-slate-200/70 bg-white/60 p-6 text-center sm:min-h-[60vh] sm:p-8 md:rounded-[28px]">
              <div>
                {schemaStatus.hasCrawledArticles ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-ink/45">Nothing selected</p>
                    <h2 className="mt-3 font-[family:var(--font-serif)] text-3xl text-ink sm:text-4xl">Run the crawler, then review here.</h2>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-ink/65">
                      Once `crawled_articles` has rows, this page will show the latest articles and let you approve,
                      defer, or reject them.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-ink/45">Supabase setup needed</p>
                    <h2 className="mt-3 font-[family:var(--font-serif)] text-3xl text-ink sm:text-4xl">Your shared tables are not in Supabase yet.</h2>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-ink/65">
                      The app is live, but `public.crawled_articles` does not exist in this Supabase project yet. Run the schema in
                      `apps/dashboard/supabase/schema.sql`, then load your article rows into `crawled_articles`.
                    </p>
                    <p className="mt-3 text-xs uppercase tracking-[0.18em] text-ink/45">
                      {schemaStatus.hasArticleReviews ? "article_reviews exists" : "article_reviews missing too"}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">{label}</dt>
      <dd className="mt-1 break-all leading-6">{value}</dd>
    </div>
  );
}

function ArticleBody({
  article,
}: {
  article: Awaited<ReturnType<typeof getArticle>>;
}) {
  if (!article) {
    return null;
  }

  const paragraphBlocks = article.content.filter((block) => block.type === "paragraph");
  const paragraphTranslationsAligned =
    article.phase === "processed" &&
    article.processed.paragraphsKo.length > 0 &&
    article.processed.paragraphsKo.length === paragraphBlocks.length;

  let paragraphIndex = 0;

  return (
    <div className="w-full max-w-5xl space-y-5">
      {article.content.map((block) => {
        const translation =
          block.type === "paragraph" && paragraphTranslationsAligned ? article.processed.paragraphsKo[paragraphIndex] ?? null : null;
        const element = (
          <ArticleFlowBlock
            block={block}
            paragraphTranslation={translation}
          />
        );
        if (block.type === "paragraph") {
          paragraphIndex += 1;
        }
        return <div key={`${article.articleId}-${block.type}-${block.order}`}>{element}</div>;
      })}

      {article.phase === "processed" && !paragraphTranslationsAligned && article.processed.paragraphsKo.length > 0 ? (
        <div className="rounded-2xl border border-slate-200/70 bg-shell/60 px-4 py-3 text-sm leading-6 text-ink/65">
          Korean paragraph translations exist for this article, but they do not line up one-to-one with the current paragraph stream, so they are not attached inline.
        </div>
      ) : null}
    </div>
  );
}

function ArticleFlowBlock({
  block,
  paragraphTranslation,
}: {
  block: ArticleContentBlock;
  paragraphTranslation?: string | null;
}) {
  if (block.type === "paragraph") {
    return <TranslatableText kind="paragraph" original={block.text} translated={paragraphTranslation ?? null} />;
  }

  const previewSrc = block.assetPath
    ? `/api/media?path=${encodeURIComponent(block.assetPath)}`
    : block.sourceUrl && block.kind !== "interactive"
      ? block.sourceUrl
      : null;
  const iframeSrc = !previewSrc && block.sourceUrl && block.kind === "interactive" ? block.sourceUrl : null;
  const caption = block.caption || block.credit || block.alt || block.title;

  return (
    <figure className="overflow-hidden rounded-[24px] border border-slate-200/70 bg-white/60 p-3">
      {previewSrc ? (
        <img alt={block.alt || caption || ""} className="block h-auto w-full rounded-[18px] bg-shell object-contain" src={previewSrc} />
      ) : iframeSrc ? (
        <iframe className="block aspect-[16/10] w-full rounded-[18px] border-0 bg-shell" loading="lazy" src={iframeSrc} title={block.title || `media-${block.order}`} />
      ) : null}
      {caption ? <figcaption className="mt-3 text-sm leading-6 text-ink/65">{caption}</figcaption> : null}
    </figure>
  );
}

function SummaryList({
  title,
  items,
  translatedItems,
}: {
  title: string;
  items: string[];
  translatedItems: string[];
}) {
  const translationsAligned = translatedItems.length > 0 && translatedItems.length === items.length;

  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-ink/45">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-ink/60">No content available.</p>
      ) : (
        <ul className="mt-3 space-y-3 text-[15px] leading-7 text-ink/85">
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="rounded-2xl border border-slate-200/70 bg-white/58 px-4 py-3">
              <TranslatableText
                kind="summary"
                original={item}
                translated={translationsAligned ? translatedItems[index] ?? null : null}
              />
            </li>
          ))}
        </ul>
      )}
      {!translationsAligned && translatedItems.length > 0 ? (
        <p className="mt-3 text-sm leading-6 text-ink/60">
          Korean summary bullets exist for this row, but they do not line up one-to-one with the stored English summary.
        </p>
      ) : null}
    </div>
  );
}

function DiscussionTopicsList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm leading-6 text-ink/60">No discussion prompts were stored for this processed row.</p>;
  }

  return (
    <ol className="space-y-3 text-[15px] leading-7 text-ink/85">
      {items.map((item, index) => (
        <li key={`discussion-topic-${index}`} className="rounded-2xl border border-slate-200/70 bg-white/58 px-3 py-3 sm:px-4">
          <span className="mr-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">{String(index + 1).padStart(2, "0")}</span>
          {item}
        </li>
      ))}
    </ol>
  );
}

function VocabList({
  title,
  items,
  emptyMessage,
}: {
  title: string;
  items: Array<{ term: string; meaningEn: string; reason: string; exampleFromArticle: string }>;
  emptyMessage: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-ink/45">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-ink/60">{emptyMessage}</p>
      ) : (
        <div className="mt-3 grid gap-3">
          {items.map((item) => (
            <div key={item.term} className="rounded-2xl border border-slate-200/70 bg-white/58 px-4 py-3">
              <div className="text-sm font-semibold text-ink">{item.term}</div>
              <div className="mt-2 text-sm leading-6 text-ink/75">{item.meaningEn}</div>
              <div className="mt-2 text-xs uppercase tracking-[0.14em] text-ink/45">Why it matters</div>
              <div className="mt-1 text-sm leading-6 text-ink/75">{item.reason}</div>
              <div className="mt-2 text-xs uppercase tracking-[0.14em] text-ink/45">Example</div>
              <div className="mt-1 text-sm leading-6 text-ink/75">{item.exampleFromArticle}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AtypicalTermsList({
  title,
  items,
  emptyMessage,
}: {
  title: string;
  items: Array<{ term: string; category: string; explanationEn: string }>;
  emptyMessage: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-ink/45">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-ink/60">{emptyMessage}</p>
      ) : (
        <div className="mt-3 grid gap-3">
          {items.map((item) => (
            <div key={item.term} className="rounded-2xl border border-slate-200/70 bg-white/58 px-4 py-3">
              <div className="text-sm font-semibold text-ink">{item.term}</div>
              <div className="mt-2 text-xs uppercase tracking-[0.14em] text-ink/45">{item.category}</div>
              <div className="mt-1 text-sm leading-6 text-ink/75">{item.explanationEn}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label,
  status,
  tone,
}: {
  label: string;
  status: ReviewStatus;
  tone: "approve" | "defer" | "reject" | "pending";
}) {
  const styles = {
    approve: "bg-moss text-white hover:bg-moss/90",
    defer: "bg-dusk text-white hover:bg-dusk/90",
    reject: "bg-ember text-white hover:bg-ember/90",
    pending: "bg-ink text-white hover:bg-ink/90",
  }[tone];

  return (
    <button className={`min-h-11 w-full rounded-2xl px-4 py-2 text-sm font-semibold transition sm:w-auto ${styles}`} name="status" type="submit" value={status}>
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  const styles = {
    pending: "border-slate-300 bg-slate-100 text-slate-700",
    approved: "border-moss/20 bg-moss/10 text-moss",
    deferred: "border-dusk/20 bg-dusk/10 text-dusk",
    rejected: "border-red-200 bg-red-50 text-red-700",
  }[status];

  return (
    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${styles}`}>
      {status}
    </span>
  );
}

function buildReturnTo({
  articleId,
  source,
  status,
  q,
}: {
  articleId?: string;
  source: string;
  status: ReviewFilter["status"];
  q: string;
}) {
  const params = new URLSearchParams();
  if (articleId) {
    params.set("articleId", articleId);
  }
  if (source && source !== "all") {
    params.set("source", source);
  }
  if (status && status !== "all") {
    params.set("status", status);
  }
  if (q) {
    params.set("q", q);
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function getFirst(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isReviewStatus(value: string): value is ReviewStatus {
  return ["pending", "approved", "deferred", "rejected"].includes(value);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
