-- Efficient word count per tenant for the stats dashboard: full extracted
-- chunk text where available, plus snippets for docs not yet chunked.
-- SECURITY INVOKER so RLS scopes a client to their own tenant.
create function tenant_word_count(p_tenant uuid)
returns bigint language sql stable security invoker set search_path = public as $$
  select (
    coalesce((select sum(coalesce(array_length(regexp_split_to_array(trim(both from ch.text), '\s+'), 1), 0))
              from document_chunk ch where ch.tenant_id = p_tenant), 0)
    + coalesce((select sum(coalesce(array_length(regexp_split_to_array(trim(both from d.snippet), '\s+'), 1), 0))
               from document d where d.tenant_id = p_tenant
               and not exists (select 1 from document_chunk c where c.document_id = d.id)), 0)
  )::bigint;
$$;
