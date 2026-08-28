# XA Gantt & Scheduling

A standalone drag-and-drop Gantt / scheduling app: CPM (Critical Path Method)
dependency tracking, a critical path computed automatically, and report-ready
PDF export — built and deployed on its own, with its own frontend, while
sharing the **XA DOS (by module)** Supabase project as its backend.

**Standalone for now.** This app's tables (`gantt_*`) are purely additive in
that shared database — nothing of XA DOS's own tables, functions, or types is
touched. The plan is to fold this into XA DOS's Projects / Field Operations
modules later; see the note at the top of `supabase/01_schema.sql` for the
integration seam that was deliberately left in place for that.

## What this is modeled on

The small set of features that actually get used day-to-day in construction
scheduling (MS Project / Primavera P6 style tools), and nothing more:

- a flat task list grouped by **module**, each with start/finish dates, %
  complete, and an optional milestone flag
- predecessor links — Finish-to-Start, Start-to-Start, Finish-to-Finish, each
  with lag/lead days — wired either by dragging a link on the chart or via
  the "Predecessors" list in the task editor
- automatic forward rescheduling: dragging a task later pushes every task it
  blocks forward by exactly enough to keep every dependency satisfied,
  cascading transitively (push-only — it never pulls a successor earlier on
  its own)
- a critical path, computed with a standard CPM forward/backward pass
  (`src/lib/scheduleEngine.ts`) and highlighted in red on the chart and in
  the PDF export
- a baseline snapshot for planned-vs-actual reporting
- day/week/month zoom, weekend shading, a "today" marker, collapsible module
  groups

**Deliberately left out**: Start-to-Finish links (the one dependency type
real schedules almost never use), resource/cost loading and leveling,
multiple baselines, working-time calendars, a WBS outline hierarchy, and
recurring tasks.

## Roles

Two roles, kept intentionally minimal:

- **Editor** — creates/edits/drags tasks and dependencies, manages other
  accounts, saves PDF reports to the project.
- **Viewer** — sees the same chart read-only, can download a PDF.

No passwords anywhere — every account (Editor or Viewer) signs in with an
emailed magic link. An Editor creates a new account with just a name, email,
and role; that person's first sign-in is the same "enter your email, click
the link" flow as everyone else's.

## Setup

1. **Run the SQL**, in order, in the XA DOS (by module) Supabase project's
   SQL Editor: `supabase/01_schema.sql`, `02_project_info_and_designation.sql`,
   `03_approved_by.sql`. All additive and safe to re-run.
2. **Auth settings**:
   - Authentication → Providers → Email → turn off "Confirm email" (account
     creation signs a user up and writes their `gantt_app_users` row in the
     same request; if email confirmation is required, that insert fails RLS
     since there's no session yet).
   - Authentication → URL Configuration → Redirect URLs → add this app's
     deployed origin (e.g. `https://xa-gantt-scheduling.netlify.app/**`).
     This project's Auth "Site URL" belongs to a different app sharing the
     same Supabase project — without this entry, every magic link falls
     back to that other app's URL instead of coming back here.
3. **Configure the app**:
   ```bash
   cp .env.example .env.local   # fill in the XA DOS project's URL + anon key
   npm install
   npm run dev
   ```
4. Open the app — since no Editor account exists yet, it shows "Set up the
   first Editor account." Fill in name, email, and designation (your job
   title — shown on the "Prepared by" line of exported PDFs), then check
   that inbox for the sign-in link. Once in, use **Users** to add more
   Editor or Viewer accounts, and "Add project info" on the Schedule page
   to set the project name/location/scope of work (PDF header) and the
   "Approved by" name/title (PDF bottom-right signature block — a fixed
   name, not tied to any account, e.g. a client-side approver).

## Project structure

```
src/
  components/gantt/   ganttGeometry, GanttChart, GanttBar — the chart itself
  components/         SchedulePdfDocument (PDF report)
  context/            AuthContext
  layouts/            AppLayout (top nav)
  pages/              Login, Schedule (the whole app + Project Info modal), Users, NotFound
  routes/             ProtectedRoute
  services/           authService, scheduleService (incl. project info)
  lib/                supabaseClient, scheduleEngine (CPM date math)
  types/               Domain model — mirrors the supabase/*.sql files
supabase/
  01_schema.sql        gantt_app_users, gantt_tasks, gantt_dependencies, gantt_reports
  02_project_info_and_designation.sql   gantt_app_users.designation, gantt_project_info
  03_approved_by.sql   gantt_project_info.approved_by_name / approved_by_title
```
