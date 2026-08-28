-- =============================================================================
-- v1.1 upgrade — scoped from the XA DOS Gantt build spec down to what a
-- solo/PIC "plan it, control it, submit it" workflow actually needs (see
-- CLAUDE.md). Adds:
--
--  - gantt_projects — real multi-project support. Folds in every field that
--    used to live on the gantt_project_info singleton, plus Revision, Data
--    Date, Target Completion, and Work Calendar (5/6/7-day week).
--  - project_id on gantt_tasks / gantt_dependencies / gantt_reports, backfilled
--    from the one existing schedule so no data is lost.
--  - gantt_tasks.activity_code (human-readable A100/M100-style ID, unique per
--    project), .actual_start, .actual_finish.
--
-- gantt_project_info is intentionally left in place, unused — it's harmless,
-- and keeping it means this migration has nothing destructive to roll back.
--
-- Safe to re-run: guarded with IF NOT EXISTS / a "has this already migrated"
-- check before the one-time backfill.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- gantt_projects
-- ---------------------------------------------------------------------------

create table if not exists gantt_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled Project',
  location text,
  scope_of_work text,
  prepared_by_name text,
  prepared_by_title text,
  approved_by_name text,
  approved_by_title text,
  revision text not null default '00',
  data_date date,
  target_completion date,
  work_calendar_days smallint not null default 6,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gantt_projects_work_calendar_chk check (work_calendar_days in (5, 6, 7))
);

drop trigger if exists trg_gantt_projects_touch on gantt_projects;
create trigger trg_gantt_projects_touch
  before update on gantt_projects
  for each row execute function gantt_touch_updated_at();

alter table gantt_projects enable row level security;

drop policy if exists gantt_projects_select on gantt_projects;
create policy gantt_projects_select on gantt_projects
  for select to authenticated
  using (true);

drop policy if exists gantt_projects_insert_editor on gantt_projects;
create policy gantt_projects_insert_editor on gantt_projects
  for insert to authenticated
  with check (gantt_current_role() = 'editor');

drop policy if exists gantt_projects_update_editor on gantt_projects;
create policy gantt_projects_update_editor on gantt_projects
  for update to authenticated
  using (gantt_current_role() = 'editor')
  with check (gantt_current_role() = 'editor');

drop policy if exists gantt_projects_delete_editor on gantt_projects;
create policy gantt_projects_delete_editor on gantt_projects
  for delete to authenticated
  using (gantt_current_role() = 'editor');

-- ---------------------------------------------------------------------------
-- project_id columns — added first (nullable) so the backfill below has
-- somewhere to write; NOT NULL isn't enforced at the DB level since this
-- app queries everything already scoped by project_id at the service layer.
-- ---------------------------------------------------------------------------

alter table gantt_tasks add column if not exists project_id uuid references gantt_projects (id) on delete cascade;
alter table gantt_dependencies add column if not exists project_id uuid references gantt_projects (id) on delete cascade;
alter table gantt_reports add column if not exists project_id uuid references gantt_projects (id) on delete cascade;

create index if not exists idx_gantt_tasks_project on gantt_tasks (project_id);
create index if not exists idx_gantt_deps_project on gantt_dependencies (project_id);
create index if not exists idx_gantt_reports_project on gantt_reports (project_id);

-- ---------------------------------------------------------------------------
-- One-time backfill: migrate the old singleton project_info + every existing
-- task/dependency/report into a single gantt_projects row, so the app keeps
-- working unchanged for existing data the moment this ships.
-- ---------------------------------------------------------------------------

do $$
declare
  migrated_project_id uuid;
begin
  if not exists (select 1 from gantt_projects) then
    insert into gantt_projects (name, location, scope_of_work, prepared_by_name, prepared_by_title, approved_by_name, approved_by_title)
    select
      coalesce(nullif(project_name, ''), 'Untitled Project'),
      project_location,
      scope_of_work,
      prepared_by_name,
      prepared_by_title,
      approved_by_name,
      approved_by_title
    from gantt_project_info
    where id = true
    returning id into migrated_project_id;

    -- No project_info row existed (fresh install) — still need one project
    -- for the backfill below to attach existing rows to, if any exist.
    if migrated_project_id is null then
      insert into gantt_projects default values returning id into migrated_project_id;
    end if;

    update gantt_tasks set project_id = migrated_project_id where project_id is null;
    update gantt_dependencies set project_id = migrated_project_id where project_id is null;
    update gantt_reports set project_id = migrated_project_id where project_id is null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- gantt_tasks — activity_code, actual dates
-- ---------------------------------------------------------------------------

alter table gantt_tasks add column if not exists activity_code text;
alter table gantt_tasks add column if not exists actual_start date;
alter table gantt_tasks add column if not exists actual_finish date;

-- Backfill human-readable IDs for any task that doesn't have one yet (existing
-- rows from before this migration) — A100, A110, A120... for tasks, M100,
-- M110... for milestones, numbered per project in current display order.
with numbered as (
  select id, project_id, is_milestone,
    100 + 10 * (row_number() over (partition by project_id, is_milestone order by sort_order, start_date, id) - 1) as seq
  from gantt_tasks
  where activity_code is null and project_id is not null
)
update gantt_tasks t
set activity_code = (case when n.is_milestone then 'M' else 'A' end) || n.seq
from numbered n
where t.id = n.id;

alter table gantt_tasks drop constraint if exists gantt_tasks_activity_code_unique;
alter table gantt_tasks add constraint gantt_tasks_activity_code_unique unique (project_id, activity_code);
