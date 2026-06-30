-- Track where a match_reviews row came from so ESPN recaps (authoritative for
-- finished matches) are never clobbered by the LLM fallback, and so jobs can
-- stop re-crawling once a recap is stored.
alter table match_reviews
  add column if not exists source text not null default 'generated';
