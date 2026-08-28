-- =============================================================================
-- XA Gantt & Scheduling — schema
--
-- Standalone app, shared Postgres instance: this runs inside the existing
-- "XA DOS (by module)" Supabase project, purely additive. Every object here
-- is prefixed `gantt_` so it can never collide with XA DOS's own tables,
-- functions, or types — this app owns nothing else in that database.
--
-- Not wired to XA DOS's own auth/projects tables (app_users, roles,
-- role_module_permissions, projects) on purpose — this app has its own tiny
-- 2-role user table for now. When this gets folded into XA DOS's Projects /
-- Field Operations modules later, the integration point is additive: add a
-- project_id column to gantt_tasks referencing public.projects, and switch
-- the role checks over to role_module_permissions. Not built now since it's
-- speculative — safe to add later without a rewrite.
--
-- Safe to re-run: everything is guarded with IF NOT EXISTS / CREATE OR REPLACE.
-- =============================================================================

create extension if not exists pgcrypto;

do $$ begin
  create type gantt_app_role as enum ('editor', 'viewer');
exception when duplicate_object then null; end $$;

-- Start-to-Finish is deliberately not modeled — it's the one dependency type
-- real construction schedules almost never use.
do $$ begin
  create type gantt_dep_type as enum ('FS', 'SS', 'FF');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- gantt_app_users — this app's own tiny user directory, 1:1 with auth.users.
-- Not the same table as XA DOS's app_users; a person with an XA DOS account
-- needs a separate gantt_app_users row to use this app, until integration.
-- ---------------------------------------------------------------------------

create table if not exists gantt_app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  role gantt_app_role not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- gantt_tasks / gantt_dependencies / gantt_reports
-- ---------------------------------------------------------------------------

create table if not exists gantt_tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  module text,
  sort_order integer not null default 0,
  start_date date not null,
  end_date date not null,
  is_milestone boolean not null default false,
  percent_complete integer not null default 0,
  baseline_start date,
  baseline_end date,
  assignee text,
  color text,
  notes text,
  created_by uuid references gantt_app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gantt_tasks_dates_chk check (end_date >= start_date),
  constraint gantt_tasks_pct_chk check (percent_complete between 0 and 100)
);

create index if not exists idx_gantt_tasks_module on gantt_tasks (module);
create index if not exists idx_gantt_tasks_dates on gantt_tasks (start_date, end_date);

create or replace function gantt_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_gantt_tasks_touch on gantt_tasks;
create trigger trg_gantt_tasks_touch
  before update on gantt_tasks
  for each row execute function gantt_touch_updated_at();

create table if not exists gantt_dependencies (
  id uuid primary key default gen_random_uuid(),
  predecessor_id uuid not null references gantt_tasks (id) on delete cascade,
  successor_id uuid not null references gantt_tasks (id) on delete cascade,
  dep_type gantt_dep_type not null default 'FS',
  lag_days integer not null default 0,
  created_at timestamptz not null default now(),
  constraint gantt_dependencies_no_self_link check (predecessor_id <> successor_id),
  constraint gantt_dependencies_unique unique (predecessor_id, successor_id)
);

create index if not exists idx_gantt_deps_predecessor on gantt_dependencies (predecessor_id);
create index if not exists idx_gantt_deps_successor on gantt_dependencies (successor_id);

create table if not exists gantt_reports (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  file_name text not null,
  note text,
  generated_by uuid references gantt_app_users (id) on delete set null,
  generated_at timestamptz not null default now()
);

create index if not exists idx_gantt_reports_generated_at on gantt_reports (generated_at desc);

-- ---------------------------------------------------------------------------
-- Helpers — SECURITY DEFINER so RLS policies can check role/existence
-- without re-triggering RLS on gantt_app_users (avoids recursion), same
-- pattern as XA DOS's own app_current_role()/admin_exists() helpers.
-- ---------------------------------------------------------------------------

create or replace function gantt_current_role() returns gantt_app_role
language sql stable security definer set search_path = public as $$
  select role from gantt_app_users where id = auth.uid();
$$;

-- Lets the pre-login screen offer first-run Editor setup exactly once.
-- Callable by anon (there's no session yet at login time).
create or replace function gantt_editor_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from gantt_app_users where role = 'editor');
$$;

grant execute on function gantt_editor_exists() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security — no workflow states here (unlike a review pipeline),
-- so plain RLS is enough; no RPC layer needed. Everyone signed in can view,
-- only 'editor' can create/edit/drag/delete.
-- ---------------------------------------------------------------------------

alter table gantt_app_users enable row level security;
alter table gantt_tasks enable row level security;
alter table gantt_dependencies enable row level security;
alter table gantt_reports enable row level security;

-- gantt_app_users ------------------------------------------------------------

drop policy if exists gantt_app_users_select on gantt_app_users;
create policy gantt_app_users_select on gantt_app_users
  for select to authenticated
  using (true);

-- First-ever row: whoever signs up bootstraps themselves as editor, once.
drop policy if exists gantt_app_users_insert_bootstrap on gantt_app_users;
create policy gantt_app_users_insert_bootstrap on gantt_app_users
  for insert to authenticated
  with check (auth.uid() = id and role = 'editor' and not gantt_editor_exists());

-- After that, only an existing editor can add more accounts.
drop policy if exists gantt_app_users_insert_editor on gantt_app_users;
create policy gantt_app_users_insert_editor on gantt_app_users
  for insert to authenticated
  with check (gantt_current_role() = 'editor');

drop policy if exists gantt_app_users_update_self on gantt_app_users;
create policy gantt_app_users_update_self on gantt_app_users
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists gantt_app_users_update_editor on gantt_app_users;
create policy gantt_app_users_update_editor on gantt_app_users
  for update to authenticated
  using (gantt_current_role() = 'editor')
  with check (gantt_current_role() = 'editor');

drop policy if exists gantt_app_users_delete_editor on gantt_app_users;
create policy gantt_app_users_delete_editor on gantt_app_users
  for delete to authenticated
  using (gantt_current_role() = 'editor');

-- gantt_tasks ------------------------------------------------------------

drop policy if exists gantt_tasks_select on gantt_tasks;
create policy gantt_tasks_select on gantt_tasks
  for select to authenticated
  using (true);

drop policy if exists gantt_tasks_insert_editor on gantt_tasks;
create policy gantt_tasks_insert_editor on gantt_tasks
  for insert to authenticated
  with check (gantt_current_role() = 'editor');

drop policy if exists gantt_tasks_update_editor on gantt_tasks;
create policy gantt_tasks_update_editor on gantt_tasks
  for update to authenticated
  using (gantt_current_role() = 'editor')
  with check (gantt_current_role() = 'editor');

drop policy if exists gantt_tasks_delete_editor on gantt_tasks;
create policy gantt_tasks_delete_editor on gantt_tasks
  for delete to authenticated
  using (gantt_current_role() = 'editor');

-- gantt_dependencies ------------------------------------------------------------

drop policy if exists gantt_deps_select on gantt_dependencies;
create policy gantt_deps_select on gantt_dependencies
  for select to authenticated
  using (true);

drop policy if exists gantt_deps_insert_editor on gantt_dependencies;
create policy gantt_deps_insert_editor on gantt_dependencies
  for insert to authenticated
  with check (gantt_current_role() = 'editor');

drop policy if exists gantt_deps_update_editor on gantt_dependencies;
create policy gantt_deps_update_editor on gantt_dependencies
  for update to authenticated
  using (gantt_current_role() = 'editor')
  with check (gantt_current_role() = 'editor');

drop policy if exists gantt_deps_delete_editor on gantt_dependencies;
create policy gantt_deps_delete_editor on gantt_dependencies
  for delete to authenticated
  using (gantt_current_role() = 'editor');

-- gantt_reports ------------------------------------------------------------

drop policy if exists gantt_reports_select on gantt_reports;
create policy gantt_reports_select on gantt_reports
  for select to authenticated
  using (true);

drop policy if exists gantt_reports_insert_editor on gantt_reports;
create policy gantt_reports_insert_editor on gantt_reports
  for insert to authenticated
  with check (gantt_current_role() = 'editor');

drop policy if exists gantt_reports_delete_editor on gantt_reports;
create policy gantt_reports_delete_editor on gantt_reports
  for delete to authenticated
  using (gantt_current_role() = 'editor');

-- ---------------------------------------------------------------------------
-- Storage bucket for saved schedule PDF reports (private; signed URLs only)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('gantt-reports', 'gantt-reports', false)
on conflict (id) do nothing;

drop policy if exists gantt_reports_storage_select on storage.objects;
create policy gantt_reports_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'gantt-reports');

drop policy if exists gantt_reports_storage_insert on storage.objects;
create policy gantt_reports_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gantt-reports' and gantt_current_role() = 'editor');

drop policy if exists gantt_reports_storage_delete on storage.objects;
create policy gantt_reports_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'gantt-reports' and gantt_current_role() = 'editor');
