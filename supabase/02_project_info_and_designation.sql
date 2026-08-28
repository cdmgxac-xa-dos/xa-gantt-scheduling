-- =============================================================================
-- Adds:
--  - gantt_app_users.designation — a free-text job title (e.g. "Project
--    Manager"), separate from the editor/viewer permission role, shown on
--    the "Prepared by" block of exported PDFs.
--  - gantt_project_info — a singleton row (project name / location / scope
--    of work) shown in the PDF report header. Singleton via a boolean PK
--    pinned to `true`, so there is exactly one row, ever.
-- =============================================================================

alter table gantt_app_users add column if not exists designation text;

create table if not exists gantt_project_info (
  id boolean primary key default true,
  project_name text,
  project_location text,
  scope_of_work text,
  updated_at timestamptz not null default now(),
  constraint gantt_project_info_singleton check (id)
);

drop trigger if exists trg_gantt_project_info_touch on gantt_project_info;
create trigger trg_gantt_project_info_touch
  before update on gantt_project_info
  for each row execute function gantt_touch_updated_at();

insert into gantt_project_info (id) values (true) on conflict (id) do nothing;

alter table gantt_project_info enable row level security;

drop policy if exists gantt_project_info_select on gantt_project_info;
create policy gantt_project_info_select on gantt_project_info
  for select to authenticated
  using (true);

drop policy if exists gantt_project_info_update_editor on gantt_project_info;
create policy gantt_project_info_update_editor on gantt_project_info
  for update to authenticated
  using (gantt_current_role() = 'editor')
  with check (gantt_current_role() = 'editor');
