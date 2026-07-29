-- Grant Drafts workspace ("In the Works"). Drafts are For-Granted-authored work
-- in progress for a tenant; [BRACKET] placeholders become question cards the
-- client answers in the portal, and each answer files back into the Inven(s)tory.

create table grant_draft (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  title text not null,
  funder text,
  amount_cents bigint,              -- integer cents (playbook: money as ints)
  deadline date,
  status text not null default 'drafting'
    check (status in ('drafting','client_review','submitted','won','lost')),
  body text not null default '',    -- draft narrative with [BRACKET] placeholders
  outcome_note text,                -- award/decline detail once resolved
  created_by uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index grant_draft_tenant_idx on grant_draft(tenant_id);

create table draft_bracket (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references grant_draft(id) on delete cascade,
  tenant_id uuid not null references tenant(id),
  label text not null,              -- the text inside [BRACKET]
  answer text,                      -- client's answer (null = open)
  answered_by uuid references app_user(id),
  answered_at timestamptz,
  filed_document_id uuid references document(id), -- the Inven(s)tory doc created from the answer
  sort_order int not null default 0,
  unique(draft_id, label)
);
create index draft_bracket_tenant_idx on draft_bracket(tenant_id);

create trigger grant_draft_updated_at before update on grant_draft
  for each row execute function set_updated_at();

-- RLS: same tenancy model as everything else. Drafts are visible to the tenant
-- and to admins; clients answer brackets, admins manage drafts.
alter table grant_draft enable row level security;
alter table draft_bracket enable row level security;

create policy grant_draft_select on grant_draft for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy grant_draft_admin_write on grant_draft for all
  using (is_admin()) with check (is_admin());

create policy draft_bracket_select on draft_bracket for select
  using (tenant_id = current_tenant_id() or is_admin());
-- clients may answer brackets within their own tenant (update only)
create policy draft_bracket_client_answer on draft_bracket for update
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());
create policy draft_bracket_admin_write on draft_bracket for insert
  with check (is_admin());
