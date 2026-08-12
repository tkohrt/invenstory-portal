-- Answer Library (A1 + A2). Global question bank (For Granted IP) + per-tenant
-- answers with citations and events. Dedicated `answer` table (locked decision).

-- ---- Global question bank (readable by all authed users; admin writes) ----
create table if not exists public.grant_question (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  category    text not null,
  prompt_text text not null,
  guidance    text,
  audience    text not null default 'both' check (audience in ('nonprofit','startup','both')),
  sort_order  int  not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.grant_question enable row level security;
create policy grant_question_select on public.grant_question for select using (true);
create policy grant_question_write  on public.grant_question for all using (is_admin()) with check (is_admin());

-- ---- Per-tenant answers ----
create table if not exists public.answer (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  question_id      uuid not null references public.grant_question(id) on delete cascade,
  short_answer     text,
  long_answer      text,
  completeness     text not null default 'missing' check (completeness in ('strong','partial','missing')),
  robustness_score int  not null default 0,
  source           text not null default 'auto' check (source in ('auto','human')),
  status           text not null default 'draft' check (status in ('draft','in_review','published')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  stale            boolean not null default false,
  updated_at       timestamptz not null default now(),
  unique (tenant_id, question_id)
);
alter table public.answer enable row level security;
create policy answer_select on public.answer for select using (tenant_id = current_tenant_id() or is_admin());
create policy answer_write  on public.answer for all using (tenant_id = current_tenant_id() or is_admin()) with check (tenant_id = current_tenant_id() or is_admin());

-- ---- Answer citations ----
create table if not exists public.answer_citation (
  id          uuid primary key default gen_random_uuid(),
  answer_id   uuid not null references public.answer(id) on delete cascade,
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  document_id uuid not null references public.document(id) on delete cascade,
  snippet     text
);
alter table public.answer_citation enable row level security;
create policy answer_citation_select on public.answer_citation for select using (tenant_id = current_tenant_id() or is_admin());
create policy answer_citation_write  on public.answer_citation for all using (tenant_id = current_tenant_id() or is_admin()) with check (tenant_id = current_tenant_id() or is_admin());

-- ---- Answer events (audit + gamification source of truth) ----
create table if not exists public.answer_event (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  question_id uuid,
  kind        text not null,
  document_id uuid,
  created_at  timestamptz not null default now()
);
alter table public.answer_event enable row level security;
create policy answer_event_select on public.answer_event for select using (tenant_id = current_tenant_id() or is_admin());
create policy answer_event_write  on public.answer_event for all using (tenant_id = current_tenant_id() or is_admin()) with check (tenant_id = current_tenant_id() or is_admin());

create index if not exists answer_tenant_idx on public.answer(tenant_id);
create index if not exists answer_citation_answer_idx on public.answer_citation(answer_id);
