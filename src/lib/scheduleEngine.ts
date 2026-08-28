// ---------------------------------------------------------------------------
// Pure date-math + CPM (Critical Path Method) helpers for the Gantt module.
// No I/O here — scheduleService.ts calls into this to figure out what to
// write back to Supabase after a drag/resize/edit.
// ---------------------------------------------------------------------------

import type { ActivityStatus, DependencyType, ScheduleDependency, ScheduleHealth, ScheduleTask, WorkCalendarDays } from '@/types'

export interface DateWindow {
  start_date: string
  end_date: string
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Parses a 'YYYY-MM-DD' string as a UTC-noon instant, so day-math never trips over local DST. */
function parseIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 12)
}

function formatIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  return formatIso(parseIso(iso) + days * MS_PER_DAY)
}

/** Whole days between two ISO dates (b - a); can be negative. */
export function diffDays(aIso: string, bIso: string): number {
  return Math.round((parseIso(bIso) - parseIso(aIso)) / MS_PER_DAY)
}

/** Inclusive duration: a task starting and ending the same day is 1 day long. */
export function durationDays(window: DateWindow): number {
  return diffDays(window.start_date, window.end_date) + 1
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

// ---------------------------------------------------------------------------
// Work calendar — 5/6/7-day week. Only affects dependency-driven date math
// (cascade rescheduling below): a task's own start/end are still whatever
// the user picked, calendar or not. `days` in lag_days is "working days" per
// the project's calendar, not raw calendar days.
// ---------------------------------------------------------------------------

function weekdayOf(iso: string): number {
  return new Date(parseIso(iso)).getUTCDay() // 0 = Sunday .. 6 = Saturday
}

export function isWorkDay(iso: string, calendarDays: WorkCalendarDays): boolean {
  if (calendarDays === 7) return true
  const wd = weekdayOf(iso)
  if (calendarDays === 6) return wd !== 0 // Mon–Sat
  return wd >= 1 && wd <= 5 // Mon–Fri
}

/** Nearest date on/after `iso` that's a work day under the given calendar. */
export function rollForwardToWorkDay(iso: string, calendarDays: WorkCalendarDays): string {
  let result = iso
  while (!isWorkDay(result, calendarDays)) result = addDays(result, 1)
  return result
}

/** Shifts `iso` by `days` *working* days (can be negative), skipping non-work days under the calendar. */
export function addWorkDays(iso: string, days: number, calendarDays: WorkCalendarDays): string {
  if (calendarDays === 7 || days === 0) return addDays(iso, days)
  let result = iso
  const step = days > 0 ? 1 : -1
  let remaining = Math.abs(days)
  while (remaining > 0) {
    result = addDays(result, step)
    if (isWorkDay(result, calendarDays)) remaining--
  }
  return result
}

// ---------------------------------------------------------------------------
// Human-readable Activity ID (A100, A110, ... / M100, M110, ... for
// milestones) — next-in-sequence per project, numbered in tens the way MS
// Project / Primavera schedules conventionally are so there's room to insert
// activities later without renumbering everything.
// ---------------------------------------------------------------------------

export function nextActivityCode(tasks: ScheduleTask[], isMilestone: boolean): string {
  const prefix = isMilestone ? 'M' : 'A'
  let maxSeq = 90
  for (const t of tasks) {
    if (!t.activity_code) continue
    const m = /^([AM])(\d+)$/.exec(t.activity_code)
    if (m && m[1] === prefix) maxSeq = Math.max(maxSeq, Number(m[2]))
  }
  return `${prefix}${maxSeq + 10}`
}

// ---------------------------------------------------------------------------
// Status, variance, forecast, schedule health — all derived, nothing stored.
// ---------------------------------------------------------------------------

/** Per spec: Completed (actual finish or 100%) > In Progress/Delayed (actual start or >0%) > Not Started. */
export function deriveStatus(task: ScheduleTask, todayIso: string): ActivityStatus {
  if (task.actual_finish || task.percent_complete >= 100) return 'Completed'
  if (task.actual_start || task.percent_complete > 0) {
    return task.end_date < todayIso ? 'Delayed' : 'In Progress'
  }
  return task.start_date < todayIso ? 'Delayed' : 'Not Started'
}

/** Current finish vs. baseline finish, in days. Positive = delayed, negative = ahead, null = no baseline set. */
export function taskBaselineVarianceDays(task: ScheduleTask): number | null {
  if (!task.baseline_end) return null
  return diffDays(task.baseline_end, task.end_date)
}

/** The project's forecast finish — the latest current finish among its tasks. */
export function computeForecastFinish(tasks: ScheduleTask[]): string | null {
  if (tasks.length === 0) return null
  return tasks.reduce((max, t) => (t.end_date > max ? t.end_date : max), tasks[0].end_date)
}

/** Forecast finish vs. target completion, in days. Positive = late, negative = ahead of target. */
export function computeTargetVarianceDays(forecastFinish: string | null, targetCompletion: string | null): number | null {
  if (!forecastFinish || !targetCompletion) return null
  return diffDays(targetCompletion, forecastFinish)
}

/**
 * On Track: forecast is on/ahead of target and no delayed critical work.
 * Watch: something's delayed but forecast still meets target.
 * At Risk: forecast has slipped past target, or a critical-path task is delayed.
 */
export function computeScheduleHealth(
  tasks: ScheduleTask[],
  criticalIds: Set<string>,
  forecastFinish: string | null,
  targetCompletion: string | null,
  todayIso: string
): ScheduleHealth {
  const varianceDays = computeTargetVarianceDays(forecastFinish, targetCompletion)
  const delayed = tasks.filter((t) => deriveStatus(t, todayIso) === 'Delayed')
  const criticalDelayed = delayed.filter((t) => criticalIds.has(t.id))
  if ((varianceDays !== null && varianceDays > 0) || criticalDelayed.length > 0) return 'at_risk'
  if (delayed.length > 0) return 'watch'
  return 'on_track'
}

// ---------------------------------------------------------------------------
// Cycle detection — checked before a new dependency is written
// ---------------------------------------------------------------------------

/** True if adding predecessor->successor would create a cycle in the dependency graph. */
export function wouldCreateCycle(
  dependencies: ScheduleDependency[],
  predecessorId: string,
  successorId: string
): boolean {
  if (predecessorId === successorId) return true
  // A cycle exists iff `predecessorId` is already reachable *from* `successorId`.
  const bySuccessorOf = new Map<string, string[]>()
  for (const dep of dependencies) {
    const list = bySuccessorOf.get(dep.predecessor_id) ?? []
    list.push(dep.successor_id)
    bySuccessorOf.set(dep.predecessor_id, list)
  }
  const stack = [successorId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === predecessorId) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const next of bySuccessorOf.get(current) ?? []) stack.push(next)
  }
  return false
}

// ---------------------------------------------------------------------------
// Cascade rescheduling — "push, don't pull": moving a predecessor later
// shoves violated successors forward; it never pulls a successor earlier on
// its own. That's the behavior people expect from drag-and-drop — an editor
// who drags a task later, and only that task, sees only the tasks it blocks
// move.
// ---------------------------------------------------------------------------

function minSuccessorStart(
  depType: DependencyType,
  lag: number,
  predWindow: DateWindow,
  calendarDays: WorkCalendarDays
): string | null {
  switch (depType) {
    case 'FS': {
      const base = rollForwardToWorkDay(addDays(predWindow.end_date, 1), calendarDays)
      return addWorkDays(base, lag, calendarDays)
    }
    case 'SS': {
      const base = rollForwardToWorkDay(predWindow.start_date, calendarDays)
      return addWorkDays(base, lag, calendarDays)
    }
    case 'FF':
      return null
  }
}

function minSuccessorEnd(
  depType: DependencyType,
  lag: number,
  predWindow: DateWindow,
  calendarDays: WorkCalendarDays
): string | null {
  if (depType !== 'FF') return null
  const base = rollForwardToWorkDay(predWindow.end_date, calendarDays)
  return addWorkDays(base, lag, calendarDays)
}

/**
 * Given the task list with `updatedTaskIds` already holding their new
 * start/end dates, walks the dependency graph forward and returns every
 * *other* task whose dates had to shift to keep dependencies satisfied.
 * `calendarDays` is the project's work calendar (5/6/7-day week) — lag is
 * interpreted in working days under it.
 */
export function cascadeReschedule(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependency[],
  updatedTaskIds: string[],
  calendarDays: WorkCalendarDays = 6
): Map<string, DateWindow> {
  const windows = new Map<string, DateWindow>()
  for (const t of tasks) windows.set(t.id, { start_date: t.start_date, end_date: t.end_date })

  const bySuccessor = new Map<string, ScheduleDependency[]>()
  for (const dep of dependencies) {
    const list = bySuccessor.get(dep.predecessor_id) ?? []
    list.push(dep)
    bySuccessor.set(dep.predecessor_id, list)
  }

  const changed = new Map<string, DateWindow>()
  const queue = [...updatedTaskIds]
  let guard = 0
  const maxIterations = tasks.length * Math.max(dependencies.length, 1) + tasks.length + 10

  while (queue.length > 0 && guard < maxIterations) {
    guard++
    const currentId = queue.shift()!
    const predWindow = windows.get(currentId)
    if (!predWindow) continue

    for (const dep of bySuccessor.get(currentId) ?? []) {
      const succWindow = windows.get(dep.successor_id)
      if (!succWindow) continue
      const duration = durationDays(succWindow)

      const minStart = minSuccessorStart(dep.dep_type, dep.lag_days, predWindow, calendarDays)
      const minEnd = minSuccessorEnd(dep.dep_type, dep.lag_days, predWindow, calendarDays)

      let nextWindow: DateWindow | null = null
      if (minStart && minStart > succWindow.start_date) {
        nextWindow = { start_date: minStart, end_date: addDays(minStart, duration - 1) }
      } else if (minEnd && minEnd > succWindow.end_date) {
        nextWindow = { start_date: addDays(minEnd, -(duration - 1)), end_date: minEnd }
      }

      if (nextWindow) {
        windows.set(dep.successor_id, nextWindow)
        changed.set(dep.successor_id, nextWindow)
        queue.push(dep.successor_id)
      }
    }
  }

  return changed
}

// ---------------------------------------------------------------------------
// Critical path — standard CPM forward/backward pass in duration-day units
// (not calendar dates, so it stays correct regardless of where the project
// actually sits on the calendar).
// ---------------------------------------------------------------------------

export function computeCriticalPath(tasks: ScheduleTask[], dependencies: ScheduleDependency[]): Set<string> {
  if (tasks.length === 0) return new Set()

  const duration = new Map<string, number>()
  for (const t of tasks) duration.set(t.id, durationDays(t))

  const outgoing = new Map<string, ScheduleDependency[]>()
  const incoming = new Map<string, ScheduleDependency[]>()
  const indegree = new Map<string, number>()
  for (const t of tasks) indegree.set(t.id, 0)

  for (const dep of dependencies) {
    if (!duration.has(dep.predecessor_id) || !duration.has(dep.successor_id)) continue
    if (!outgoing.has(dep.predecessor_id)) outgoing.set(dep.predecessor_id, [])
    outgoing.get(dep.predecessor_id)!.push(dep)
    if (!incoming.has(dep.successor_id)) incoming.set(dep.successor_id, [])
    incoming.get(dep.successor_id)!.push(dep)
    indegree.set(dep.successor_id, (indegree.get(dep.successor_id) ?? 0) + 1)
  }

  // Kahn's algorithm for a topological order; any node left over (a cycle,
  // which the UI prevents on creation) is simply excluded from CPM.
  const order: string[] = []
  const queue = tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0).map((t) => t.id)
  const indegreeWorking = new Map(indegree)
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const dep of outgoing.get(id) ?? []) {
      const remaining = (indegreeWorking.get(dep.successor_id) ?? 0) - 1
      indegreeWorking.set(dep.successor_id, remaining)
      if (remaining === 0) queue.push(dep.successor_id)
    }
  }

  const es = new Map<string, number>()
  const ef = new Map<string, number>()
  for (const id of order) {
    const dur = duration.get(id) ?? 0
    let start = 0
    for (const dep of incoming.get(id) ?? []) {
      const predEf = ef.get(dep.predecessor_id) ?? 0
      const predEs = es.get(dep.predecessor_id) ?? 0
      if (dep.dep_type === 'FS') start = Math.max(start, predEf + dep.lag_days)
      else if (dep.dep_type === 'SS') start = Math.max(start, predEs + dep.lag_days)
      else if (dep.dep_type === 'FF') start = Math.max(start, predEf + dep.lag_days - dur)
    }
    es.set(id, start)
    ef.set(id, start + dur)
  }

  const projectFinish = Math.max(0, ...Array.from(ef.values()))

  const lf = new Map<string, number>()
  const ls = new Map<string, number>()
  for (const id of [...order].reverse()) {
    const dur = duration.get(id) ?? 0
    const outs = outgoing.get(id) ?? []
    let finish = projectFinish
    if (outs.length > 0) {
      finish = Infinity
      for (const dep of outs) {
        const succLf = lf.get(dep.successor_id) ?? projectFinish
        const succLs = ls.get(dep.successor_id) ?? projectFinish - (duration.get(dep.successor_id) ?? 0)
        if (dep.dep_type === 'FS') finish = Math.min(finish, succLs - dep.lag_days)
        else if (dep.dep_type === 'SS') finish = Math.min(finish, succLs - dep.lag_days + dur)
        else if (dep.dep_type === 'FF') finish = Math.min(finish, succLf - dep.lag_days)
      }
      if (!Number.isFinite(finish)) finish = projectFinish
    }
    lf.set(id, finish)
    ls.set(id, finish - dur)
  }

  const critical = new Set<string>()
  for (const id of order) {
    const slack = (ls.get(id) ?? 0) - (es.get(id) ?? 0)
    if (slack <= 0) critical.add(id)
  }
  return critical
}
