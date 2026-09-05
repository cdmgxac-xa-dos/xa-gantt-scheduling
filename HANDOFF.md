# HANDOFF.md

Snapshot for picking up this project cold. `README.md` has setup/usage;
`CLAUDE.md` has the full narrative history and gotchas. This file is the
short version: what it is, where it stands right now, and what to check
first.

## What this is

A standalone drag-and-drop Gantt/scheduling app — CPM critical path,
predecessor-driven cascade rescheduling, baseline snapshots, PDF and Excel
export. It shares the **XA DOS (by module)** Supabase project
(`tdzkwclfthmvofegacji`) as its backend, touching only its own
`gantt_*`-prefixed tables; nothing of XA DOS's own tables is read or
written. Folding this into XA DOS proper is a deliberately deferred future
step — don't start it without the user asking.

## Current status

**v1.1, live in production.** `main` and
https://xa-gantt-scheduling.netlify.app (site id
`f1c94619-34e6-48f5-a87f-7e221bc5c08a`) both serve v1.1 — multi-project
support, work calendars, human-readable Activity IDs, Data Date/Revision/
Target Completion, derived baseline variance/forecast/health, Actual Start/
Finish with derived Status, and an upgraded PDF legend. See CLAUDE.md's
"v1.1" section for the full feature list and what was deliberately left out
(Field Operations module, weekly update workflow, constraint register,
multi-role permissions, audit log — none of it matches how this app is
actually used, which is single-editor, submission-grade schedule
production, not live field-crew updates).

Rollback path if v1.1 ever needs reverting: `git revert` (or reset to
`2b625c7`, the last pre-v1.1 commit) on `main`, then redeploy. The Supabase
migration (`supabase/05_v1_1_multiproject_and_controls.sql`) is additive
and doesn't need reverting — old code keeps working against the upgraded
schema either way.

## Tech stack

React 18 + TypeScript + Vite, Tailwind CSS, React Router, Supabase JS
client, `@react-pdf/renderer` for PDF export, `exceljs` for Excel export.
No test suite; `npm run lint` (ESLint) and `tsc -b` (via `npm run build`)
are the only automated checks.

## Setup (see README.md for full detail)

```bash
cp .env.example .env.local   # XA DOS Supabase project URL + anon key
npm install
npm run dev
```

SQL migrations live in `supabase/01-05_*.sql`, applied in order — all
additive/idempotent. Auth is magic-link only (no passwords); see README.md
for the required Supabase Auth settings (email confirmation off, redirect
URL registered).

## Where things are

- `src/lib/scheduleEngine.ts` — CPM forward/backward pass, cascade
  rescheduling (push-only, calendar-aware), work calendar helpers, Activity
  ID generation, status/variance/forecast/health derivation
- `src/components/gantt/` — the drag/drop chart (`GanttChart.tsx`,
  `GanttBar.tsx`, `ganttGeometry.ts` for pixel/date math)
- `src/components/SchedulePdfDocument.tsx` — the 2-page PDF export
- `src/lib/scheduleExcelExport.ts` — the Excel export
- `src/pages/SchedulePage.tsx` — the whole app screen: project switcher,
  toolbar, task/module reorder, Project settings modal, task modal
- `src/services/scheduleService.ts` — all Supabase queries
  (project-scoped), `rethrowFriendly()` for readable Activity ID collisions
- `src/services/authService.ts` — magic-link auth, throwaway-password
  account provisioning
- `supabase/01-05_*.sql` — schema, in apply order

## Things to know before touching this codebase

- **Never run DDL against anything outside `gantt_*`** in the shared
  Supabase project — it's shared with the *drawing-tracker* app, and a
  migration once hit that app's own tables by mistake. Always do a
  read-only collision check first (see CLAUDE.md for the exact query
  shape).
- **No passwords anywhere** — every sign-in is a magic link.
- **react-pdf v4.6 has several sharp edges** (WinAnsi-only glyphs, no
  line-clamping, `fixed` elements repeating per physical page, multi-page
  chart math not being predicted correctly). No visual PDF renderer is
  available in a sandboxed session — verify via the `pdf-test.tsx` +
  PyMuPDF rasterize loop described in CLAUDE.md, and delete the throwaway
  file afterward.
- **No visual xlsx renderer either** — verify Excel export by reading the
  workbook back with `exceljs` and checking values/fills/merges against
  hand-computed expectations.
- **Netlify deploys go straight to production** — there's no draft/preview
  mode for this site, regardless of which branch is checked out locally.
  Confirm changes are actually wanted live before running the deploy
  command.

## Open items / natural next steps

Nothing is currently in flight. Revisit the deliberately-deferred
Field Operations / weekly-update / multi-role feature set only if a second
editor or live field-crew updating actually becomes a real need — see
CLAUDE.md's v1.1 section for the full list of what was scoped out and why.
