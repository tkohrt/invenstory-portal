-- Row Level Security: the single most important control in this build.
-- Every table gets RLS. Tables with no policy = locked by default.
-- Helper functions are SECURITY DEFINER so policies stay readable.

create function public.current_tenant_id() returns uuid
language sql security definer stable set search_path = public as $$
  select tenant_id from app_user where auth_id = (select auth.uid())
$$;

create function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select role = 'admin' from app_user where auth_id = (select auth.uid())), false)
$$;

alter table tenant           enable row level security;
alter table app_user         enable row level security;
alter table document         enable row level security;
alter table document_version enable row level security;
alter table document_tag     enable row level security;
alter table document_chunk   enable row level security;
alter table chunk_embedding  enable row level security;
alter table chat_session     enable row level security;
alter table chat_message     enable row level security;
alter table artifact_type    enable row level security;
alter table artifact_set     enable row level security;
alter table artifact_card    enable row level security;
alter table audit_log        enable row level security;

-- tenant: members see their own org; admins see all
create policy tenant_select on tenant for select
  using (id = current_tenant_id() or is_admin());

-- app_user: see users of your own tenant (and yourself); admins all
create policy app_user_select on app_user for select
  using (tenant_id = current_tenant_id() or auth_id = (select auth.uid()) or is_admin());

-- document: full CRUD within your tenant; admins across tenants
create policy document_select on document for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy document_insert on document for insert
  with check (tenant_id = current_tenant_id() or is_admin());
create policy document_update on document for update
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());
create policy document_delete on document for delete
  using (tenant_id = current_tenant_id() or is_admin());

-- document_version / document_tag: same shape
create policy document_version_select on document_version for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy document_version_insert on document_version for insert
  with check (tenant_id = current_tenant_id() or is_admin());
create policy document_tag_select on document_tag for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy document_tag_insert on document_tag for insert
  with check (tenant_id = current_tenant_id() or is_admin());
create policy document_tag_delete on document_tag for delete
  using (tenant_id = current_tenant_id() or is_admin());

-- chunks + embeddings: read within tenant; WRITTEN ONLY by the ingestion
-- worker via service role (no insert/update policies on purpose)
create policy document_chunk_select on document_chunk for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy chunk_embedding_select on chunk_embedding for select
  using (tenant_id = current_tenant_id() or is_admin());

-- chat: your tenant's sessions; messages via your sessions
create policy chat_session_select on chat_session for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy chat_session_insert on chat_session for insert
  with check (tenant_id = current_tenant_id() or is_admin());
create policy chat_message_select on chat_message for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy chat_message_insert on chat_message for insert
  with check (tenant_id = current_tenant_id() or is_admin());

-- artifact_type: global registry, readable by any signed-in user
create policy artifact_type_select on artifact_type for select
  using ((select auth.uid()) is not null);

-- artifact sets/cards: read within tenant; generation + review write via
-- service role and admin UI (no client writes)
create policy artifact_set_select on artifact_set for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy artifact_set_admin_write on artifact_set for update
  using (is_admin()) with check (is_admin());
create policy artifact_card_select on artifact_card for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy artifact_card_admin_write on artifact_card for update
  using (is_admin()) with check (is_admin());
create policy artifact_card_admin_delete on artifact_card for delete
  using (is_admin());

-- audit_log: admins read; rows written only by service role
create policy audit_log_select on audit_log for select using (is_admin());

-- Storage: private bucket; path {tenant_id}/{document_id}/{version} makes
-- object storage inherit tenant isolation via the first path segment.
insert into storage.buckets (id, name, public) values ('documents','documents', false);
create policy storage_docs_select on storage.objects for select
  using (bucket_id = 'documents'
         and ((storage.foldername(name))[1] = current_tenant_id()::text or is_admin()));
create policy storage_docs_insert on storage.objects for insert
  with check (bucket_id = 'documents'
         and ((storage.foldername(name))[1] = current_tenant_id()::text or is_admin()));
create policy storage_docs_delete on storage.objects for delete
  using (bucket_id = 'documents'
         and ((storage.foldername(name))[1] = current_tenant_id()::text or is_admin()));
