-- Recall-oriented lexical retrieval for RAG (distinct from the precise,
-- AND-based search_inventory used by the Search page). Builds an OR query
-- from the question's lexemes so a natural question matches documents
-- containing ANY salient term, ranked. SECURITY INVOKER -> RLS scoped.
create function match_lexical(p_query text, p_count int default 6)
returns table (
  document_id uuid, tenant_id uuid, title text, text text, page_number int, rank real
)
language plpgsql stable
set search_path = public
as $$
declare
  or_query tsquery;
begin
  -- OR together the query's lexemes; empty query -> no rows
  select to_tsquery('english', string_agg(lexeme, ' | '))
    into or_query
  from unnest(to_tsvector('english', coalesce(p_query,''))) as t(lexeme, positions, weights);
  if or_query is null then return; end if;

  return query
  with hits as (
    select ch.document_id, ch.tenant_id, d.title, ch.text, ch.page_number,
           ts_rank(ch.fts, or_query) as rank
    from document_chunk ch join document d on d.id = ch.document_id
    where ch.fts @@ or_query
    union all
    select d.id, d.tenant_id, d.title, d.snippet, null::int,
           ts_rank(d.fts, or_query) as rank
    from document d
    where d.fts @@ or_query
  )
  select distinct on (h.document_id) h.document_id, h.tenant_id, h.title, h.text, h.page_number, h.rank
  from hits h
  order by h.document_id, h.rank desc;
end $$;
