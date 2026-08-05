-- Switch embeddings from Bedrock Titan (1024-dim) to Supabase's built-in
-- gte-small model (384-dim), run in an Edge Function. Clears prior vectors
-- (few/none, since Bedrock was blocked) and re-dimensions the column + index.
drop index if exists chunk_embedding_hnsw_idx;
delete from chunk_embedding;
alter table chunk_embedding alter column embedding type vector(384);
create index chunk_embedding_hnsw_idx on chunk_embedding using hnsw (embedding vector_cosine_ops);

drop function if exists match_chunks(vector, integer);
create function match_chunks(p_query_embedding vector(384), p_match_count int default 6)
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
