-- Adds an "Approved by" counterpart to the existing "Prepared by" signature
-- block on the PDF report — a fixed name/title pair (e.g. a client-side
-- approver), not tied to any app account, so it's just two more fields on
-- the same project_info singleton.

alter table gantt_project_info add column if not exists approved_by_name text;
alter table gantt_project_info add column if not exists approved_by_title text;
