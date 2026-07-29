-- Semantic retrieval for RAG. HNSW index for cosine similarity, and an
-- RLS-respecting match function (SECURITY INVOKER): the tenant filter is
-- applied by RLS on the table scan BEFORE the similarity ordering/limit, so
-- a user can only ever match their own tenant's chunks.
create index chunk_embedding_hnsw_idx on chunk_embedding
  using hnsw (embedding vector_cosine_ops);

create function match_chunks(p_query_embedding vector(1024), p_match_count int default 6)
returns table (
  chunk_id uuid, document_id uuid, tenant_id uuid, title text,
  text text, page_number int, similarity real
)
language sql stable
set search_path = public
as $$
  select e.chunk_id, ch.document_id, ch.tenant_id, d.title,
    ch.text, ch.page_number,
    (1 - (e.embedding <=> p_query_embedding))::real as similarity
  from chunk_embedding e
  join document_chunk ch on ch.id = e.chunk_id
  join document d on d.id = ch.document_id
  order by e.embedding <=> p_query_embedding
  limit p_match_count;
$$;
