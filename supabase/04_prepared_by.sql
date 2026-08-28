-- "Prepared by" moves from the logged-in user's own account (full_name +
-- designation) to a fixed Project Info field, same as "Approved by" —
-- whoever happens to be signed in when a PDF is generated shouldn't
-- determine who the report says prepared it, and this sidesteps needing
-- every account's designation to be kept up to date.

alter table gantt_project_info add column if not exists prepared_by_name text;
alter table gantt_project_info add column if not exists prepared_by_title text;
