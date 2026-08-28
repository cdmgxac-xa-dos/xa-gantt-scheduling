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

## Current limitation: single schedule only

There is no "project" entity. `gantt_tasks`/`gantt_dependencies`/
`gantt_reports` are one flat pool each, and `gantt_project_info` is a
schema-enforced singleton (`id boolean primary key default true`) — there
can only ever be one project's title/location/scope/signatures. The user
asked about running a second schedule with a different title (2026-08-28)
and was told this needs real multi-project support before it's possible:

- `gantt_projects` table (id, name, created_at)
- `project_id` FK added to `gantt_tasks`, `gantt_dependencies`,
  `gantt_reports`; fold `gantt_project_info`'s fields into `gantt_projects`
  itself so they're per-project
- a project switcher + "Add project" in the UI, RLS scoped by project

Not started — the user said to leave it until after they've tested the
current single-project version. Pick this up when asked.

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

- `supabase/01-04_*.sql` — schema, in apply order (all additive/idempotent,
  safe to re-run)
- `src/lib/scheduleEngine.ts` — CPM forward/backward pass, cascade
  rescheduling (push-only)
- `src/components/gantt/` — the drag/drop chart (`GanttChart.tsx`,
  `GanttBar.tsx`, `ganttGeometry.ts` for pixel/date math)
- `src/components/SchedulePdfDocument.tsx` — the 2-page PDF (page 1: text
  schedule table; page 2: date-axis header + bar chart + dependency lines +
  signature blocks)
- `src/pages/SchedulePage.tsx` — the whole app screen: toolbar, task/module
  reorder handlers, Project Info modal, task modal with predecessor editor
