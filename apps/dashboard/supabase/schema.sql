create table if not exists public.crawled_articles (
  article_id text primary key,
  source text not null,
  section text not null default '',
  title text not null,
  subtitle text not null default '',
  phase text not null default 'crawled',
  url text not null,
  article_text text not null,
  input_file_path text not null default '',
  crawled_at timestamptz not null default now(),
  document_json jsonb
);

create index if not exists idx_crawled_articles_source on public.crawled_articles (source);
create index if not exists idx_crawled_articles_crawled_at on public.crawled_articles (crawled_at desc);

create table if not exists public.article_reviews (
  article_id text primary key references public.crawled_articles(article_id) on delete cascade,
  status text not null check (status in ('pending', 'approved', 'deferred', 'rejected')),
  note text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists idx_article_reviews_status on public.article_reviews (status, updated_at desc);
