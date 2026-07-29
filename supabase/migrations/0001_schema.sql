-- Inven(s)tory Portal schema. Mirrors lib/types.ts (the Phase 1 contract).
create extension if not exists vector;

create table tenant (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slack_channel_id text,
  slack_webhook_url text,
  created_at timestamptz not null default now()
);

create table app_user (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenant(id),          -- null = For Granted admin
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('client','admin')),
  auth_id uuid unique,                            -- links to auth.users (Phase 4)
  created_at timestamptz not null default now()
);

create table document (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  title text not null,
  layer text not null check (layer in ('I','II','III')),
  storage_key text not null,
  mime_type text not null default 'application/octet-stream',
  doc_kind text not null check (doc_kind in ('pdf','docx','web','note','xlsx','audio')),
  status text not null default 'pending' check (status in ('pending','processing','ready','failed')),
  error_detail text,
  ocr_applied boolean not null default false,
  current_version int not null default 1,
  uploaded_by uuid not null references app_user(id),
  source text not null default 'for_granted' check (source in ('client','for_granted')),
  snippet text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index document_tenant_idx on document(tenant_id);

create table document_version (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id) on delete cascade,
  tenant_id uuid not null references tenant(id),
  version int not null,
  storage_key text not null,
  uploaded_by uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  unique(document_id, version)
);
create index document_version_tenant_idx on document_version(tenant_id);

create table document_tag (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id) on delete cascade,
  tenant_id uuid not null references tenant(id),
  tag text not null,
  unique(document_id, tag)
);
create index document_tag_tenant_idx on document_tag(tenant_id);

create table document_chunk (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id) on delete cascade,
  tenant_id uuid not null references tenant(id),
  chunk_index int not null,
  text text not null,
  page_number int,
  char_start int not null default 0,
  char_end int not null default 0,
  embedding_model text,
  unique(document_id, chunk_index)
);
create index document_chunk_tenant_idx on document_chunk(tenant_id);

create table chunk_embedding (
  chunk_id uuid primary key references document_chunk(id) on delete cascade,
  tenant_id uuid not null references tenant(id),
  embedding vector(1024)                          -- Titan Text Embeddings V2
);
create index chunk_embedding_tenant_idx on chunk_embedding(tenant_id);

create table chat_session (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  user_id uuid not null references app_user(id),
  title text not null default 'New conversation',
  created_at timestamptz not null default now()
);
create index chat_session_tenant_idx on chat_session(tenant_id);

create table chat_message (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_session(id) on delete cascade,
  tenant_id uuid not null references tenant(id),
  role text not null check (role in ('user','assistant')),
  content text not null,
  citations uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index chat_message_tenant_idx on chat_message(tenant_id);

-- Artifact engine (client-facing name: Story Intelligence)
create table artifact_type (
  slug text primary key,
  name text not null,
  nav_label text not null,
  description text not null default '',
  prompt_ref text not null,
  card_schema jsonb not null default '{}',
  corpus_filter jsonb                              -- null = all three layers (default)
);

create table artifact_set (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  type_slug text not null references artifact_type(slug),
  status text not null default 'none' check (status in ('none','pending','approved','stale')),
  version int not null default 0,
  generated_at timestamptz,
  reviewed_by uuid references app_user(id),
  model_used text,
  token_cost numeric,
  gap_note text,
  unique(tenant_id, type_slug)
);
create index artifact_set_tenant_idx on artifact_set(tenant_id);

create table artifact_card (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references artifact_set(id) on delete cascade,
  tenant_id uuid not null references tenant(id),
  title text not null,
  payload jsonb not null default '{}',
  citations uuid[] not null default '{}',
  sort_order int not null default 0
);
create index artifact_card_tenant_idx on artifact_card(tenant_id);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references app_user(id),
  tenant_id uuid references tenant(id),
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index audit_log_tenant_idx on audit_log(tenant_id);

-- updated_at trigger (tested with a real INSERT/UPDATE in this phase — playbook error #2)
create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger document_updated_at before update on document
  for each row execute function set_updated_at();
