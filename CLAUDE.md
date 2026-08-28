# CLAUDE.md — working notes for this repo

Context for picking this project back up in a future session. See `README.md`
for setup/usage; this file is decisions, gotchas, and what's pending.

## What this is

Standalone Gantt/scheduling app (drag-and-drop chart, CPM critical path,
PDF export), sharing the **XA DOS (by module)** Supabase project
(`tdzkwclfthmvofegacji`) as its backend via `gantt_*`-prefixed tables only —
nothing of XA DOS's own tables is touched. Deployed on Netlify
(https://xa-gantt-scheduling.netlify.app, site id
`f1c94619-34e6-48f5-a87f-7e221bc5c08a`). Standalone for now — folding it into
XA DOS's own modules is a deliberately deferred future step; don't start it
without the user asking.

## v1.1 (2026-08-28) — multi-project + submission-grade controls

Built after comparing this app against the "XA DOS Gantt & Scheduling Build
Spec" doc: the spec's vision (full Projects + Field Operations integration,
weekly update workflow, constraint register, multi-role permissions) is
explicitly *not* being chased — the user is effectively the sole editor,
using this only to produce submission-ready schedules, not to run live
field-crew updates. Only the spec's data-model gaps that were real problems
for that use case got pulled in:

- **Multi-project.** `gantt_projects` table replaces the old
  `gantt_project_info` singleton, folding in its fields plus Revision, Data
  Date, Target Completion, Work Calendar. `project_id` FK added to
  `gantt_tasks`/`gantt_dependencies`/`gantt_reports`. Project switcher +
  "New project" live in `SchedulePage.tsx`'s header; last-selected project
  persisted to `localStorage` (`xa-gantt:last-project-id`). RLS is still
  flat editor/viewer, not scoped per-project — deliberate, there's no
  multi-team access-control need here.
- **Work calendar (5/6/7-day).** `gantt_projects.work_calendar_days`.
  `scheduleEngine.ts` gained `isWorkDay`/`addWorkDays`/
  `rollForwardToWorkDay`; `cascadeReschedule` now takes a `calendarDays`
  param and uses them for FS/SS/FF lag math. Manual drag/resize on the web
  chart is deliberately still literal calendar-day math (matches mouse
  movement 1:1) — the calendar only governs dependency-driven date
  calculation, not free-hand positioning.
- **Human-readable Activity ID.** `gantt_tasks.activity_code`
  (A100/A110.../M100...), unique per project
  (`gantt_tasks_activity_code_unique`), auto-suggested by
  `nextActivityCode()` and editable in the task modal. Duplicate-ID inserts
  surface as a friendly error (`rethrowFriendly` in `scheduleService.ts`
  catches Postgres `23505`).
- **Data Date + Revision + Target Completion** on `gantt_projects`, edited
  via the renamed "Project settings" modal. Data Date renders as a blue
  dashed vertical line on both the web Gantt and the PDF chart page (and a
  blue medium-border column marker on the Excel Gantt sheet).
- **Baseline variance / Forecast Finish / Schedule Health.** All derived,
  nothing stored: `taskBaselineVarianceDays`, `computeForecastFinish`,
  `computeTargetVarianceDays`, `computeScheduleHealth` in
  `scheduleEngine.ts`. Surfaced as a second KPI row on the schedule page, a
  Variance column + KPI row on PDF page 1, and Variance/Status columns in
  the Excel "Schedule" sheet.
- **Actual Start / Actual Finish + derived Status.** New columns on
  `gantt_tasks`; Status (Not Started/In Progress/Delayed/Completed) is
  computed by `deriveStatus()`, never stored — entering an Actual Finish in
  the task modal auto-sets % Complete to 100 per the spec's automation
  suggestion.
- **PDF legend** upgraded from a one-line caption to real swatches (Current/
  Baseline/Milestone/Critical/Progress/Data Date), and the chart page now
  draws a thin baseline bar under each current bar when a baseline is set
  (previously baseline was only visible on the web chart, not the PDF).

Explicitly **not** built — this is the line the spec crosses into "field
operations control tool," which doesn't match how this app is actually
used: Field Operations module, Weekly Update Mode, automatic slippage
detection, Constraint Register, manpower/material tracking, revision
history table, audit log, multi-role permissions, look-ahead views,
recovery schedules, AI schedule assistant. Revisit only if a second editor
or live field-crew updating actually shows up.

Migration: `supabase/05_v1_1_multiproject_and_controls.sql` — additive,
backfills the existing singleton project + all 6 tasks/2 dependencies/2
reports into one migrated `gantt_projects` row automatically.
`gantt_project_info` is left in place, unused, on purpose (nothing
destructive to roll back).

**Rollback path**: this was built entirely on branch
`claude/gantt-md-comparison-9me7vm`, not merged to `main`, and deployed
only to a Netlify branch/preview URL — production
(https://xa-gantt-scheduling.netlify.app) keeps serving the pre-v1.1 build
from `main` until the user says to merge. The Supabase migration is live
either way (additive, and `gantt_project_info`/old columns are untouched),
so `main`'s old code keeps working unchanged against the upgraded schema.

## Hard-learned rules for this codebase

- **Never touch anything outside `gantt_*` in the shared Supabase project.**
  Early in this project's life a migration was mistakenly applied against
  the *drawing-tracker* app's own tables in the same shared project and had
  to be rolled back. Before any `apply_migration`/`execute_sql` DDL against
  `tdzkwclfthmvofegacji`, run a read-only collision check (`pg_type`,
  `pg_tables`, `pg_proc`, `storage.buckets`) for the exact object names
  about to be created.
- **No passwords anywhere.** Every account signs in via magic link
  (`signInWithOtp`). Account creation uses `signUp()` with a random
  throwaway password purely to synchronously get the new user's id (needed
  to provision their `gantt_app_users` row) — never shown, never used to
  sign in. See `src/services/authService.ts`.
- **react-pdf (`@react-pdf/renderer` v4.6) gotchas**, all in
  `src/components/SchedulePdfDocument.tsx`:
  - Base Helvetica is WinAnsi-encoded — no `◆` (U+25C6) or other non-ASCII
    symbol glyphs. Using one silently substitutes garbage characters instead
    of erroring. Milestones are a rotated square `View`, not a Unicode glyph.
  - No `numberOfLines`/line-clamp support in this version's `Text`. Where a
    fixed row height matters (the chart page, for the dependency-line y-math
    below), long names are truncated to a char count with `…` instead
    (`truncateForChartRow`) — real line-clamping isn't available.
  - `position: 'absolute'` elements need `wrap={false}` or their content can
    split across a page boundary instead of moving as a unit.
  - `fixed` elements repeat identically on every physical page a `<Page>`
    auto-splits onto; a normal-flow element does not. The chart page's title
    + date-axis header (`ChartPageHeader`) and the dependency-line `Svg`
    overlay (`DependencyLines`) both assume single-page content — a report
    long enough to spill onto a second physical page will have correct bars
    on that page but dates/connector-lines computed for the full range will
    be wrong there. No real fix without predicting react-pdf's own layout
    pass; flagged rather than solved.
  - No visual renderer available in this environment. The established
    verification loop: write a throwaway `pdf-test.tsx` at the repo root
    importing `SchedulePdfDocument` with synthetic data, render via
    `TSX_TSCONFIG_PATH=./tsconfig.app.json npx -y tsx pdf-test.tsx` to a
    `/tmp/*.pdf`, then rasterize with PyMuPDF (`pip install pymupdf`,
    `page.get_pixmap(dpi=150).save(...)`) and actually look at the PNG
    before shipping. Delete `pdf-test.tsx` afterward — never commit it.
- **Excel export** (`src/lib/scheduleExcelExport.ts`, exceljs, lazy-loaded
  from `SchedulePage.tsx` the same way as the PDF renderer): headless
  LibreOffice in this environment cannot load *any* xlsx — confirmed with a
  trivial two-cell file, not specific to this export — so there's no visual
  render available for it here. Verification instead means writing a sample
  workbook and reading it back with exceljs itself (cell values, fills,
  merges, borders) and checking the numbers against hand-computed expected
  column ranges. If a real xlsx-to-image path is ever needed, try installing
  a fresh LibreOffice rather than trusting the one in this sandbox.
- **Netlify deploys**: `netlify-deploy-services-updater` (`deploy-site`)
  returns a shell command with a signed, short-lived `--proxy-path` token —
  run it via Bash from the repo root. A Cloudflare 502
  (`origin_bad_gateway`) on this call has been consistently transient in
  this session; wait ~15-20s and retry (a fresh call, since the token in a
  failed response is unusable/expired by the time you'd reuse it).

## Where things are

- `supabase/01-05_*.sql` — schema, in apply order (all additive/idempotent,
  safe to re-run)
- `src/lib/scheduleEngine.ts` — CPM forward/backward pass, cascade
  rescheduling (push-only, now calendar-aware), work calendar helpers,
  Activity ID generation, status/variance/forecast/health derivation
- `src/components/gantt/` — the drag/drop chart (`GanttChart.tsx`,
  `GanttBar.tsx`, `ganttGeometry.ts` for pixel/date math)
- `src/components/SchedulePdfDocument.tsx` — the 2-page PDF (page 1: text
  schedule table + KPI rows; page 2: date-axis header + legend + bar chart +
  baseline bars + dependency lines + Data Date line + signature blocks)
- `src/lib/scheduleExcelExport.ts` — Excel export (Schedule + Gantt Chart
  sheets)
- `src/pages/SchedulePage.tsx` — the whole app screen: project switcher,
  toolbar, task/module reorder handlers, Project settings modal, task modal
  with predecessor editor + Activity ID/Actual dates/Status/Variance
- `src/services/scheduleService.ts` — all Supabase queries, project-scoped
  since v1.1; `rethrowFriendly()` turns Postgres unique-violation on
  Activity ID into a readable error
