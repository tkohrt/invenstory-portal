-- Full-text search: tsvector generated columns + GIN indexes, and an
-- RLS-respecting search function. The function is SECURITY INVOKER (default),
-- so its internal reads run as the calling user and inherit tenant isolation.

-- Document-level search vector (title + snippet) — covers docs not yet chunked.
alter table document add column fts tsvector
  generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(snippet,''))) stored;
create index document_fts_idx on document using gin(fts);

-- Chunk-level search vector (the real passage-level search).
alter table document_chunk add column fts tsvector
  generated always as (to_tsvector('english', coalesce(text,''))) stored;
create index document_chunk_fts_idx on document_chunk using gin(fts);

-- Best-matching passage per document, across chunk text and doc title/snippet.
-- ts_headline uses NON-HTML sentinels; the app escapes the passage and only
-- then swaps sentinels for <mark>, so document content can never inject markup.
create function search_inventory(p_query text)
returns table (
  document_id uuid, tenant_id uuid, title text, layer text, doc_kind text,
  created_at timestamptz, passage text, page_number int, rank real
)
language sql stable
set search_path = public
as $$
  with q as (select websearch_to_tsquery('english', p_query) as tsq),
  hits as (
    select ch.document_id, ch.tenant_id, d.title, d.layer, d.doc_kind, d.created_at,
      ts_headline('english', ch.text, q.tsq,
        'StartSel=<<hl>>,StopSel=<</hl>>,MaxWords=42,MinWords=15,ShortWord=2') as passage,
      ch.page_number, ts_rank(ch.fts, q.tsq) as rank
    from document_chunk ch join document d on d.id = ch.document_id, q
    where ch.fts @@ q.tsq
    union all
    select d.id, d.tenant_id, d.title, d.layer, d.doc_kind, d.created_at,
      ts_headline('english', coalesce(d.snippet,''), q.tsq,
        'StartSel=<<hl>>,StopSel=<</hl>>,MaxWords=42,MinWords=15,ShortWord=2') as passage,
      null::int, ts_rank(d.fts, q.tsq) as rank
    from document d, q
    where d.fts @@ q.tsq
  )
  select distinct on (document_id)
    document_id, tenant_id, title, layer, doc_kind, created_at, passage, page_number, rank
  from hits
  order by document_id, rank desc;
$$;
