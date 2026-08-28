// ---------------------------------------------------------------------------
// Pure layout math for the Gantt timeline — kept separate from GanttChart.tsx
// so the pixel/date conversions can be reasoned about (and unit-tested) on
// their own.
// ---------------------------------------------------------------------------

import type { ScheduleTask } from '@/types'
import { addDays, diffDays } from '@/lib/scheduleEngine'

export type GanttZoom = 'day' | 'week' | 'month'

export const DAY_WIDTH: Record<GanttZoom, number> = { day: 34, week: 14, month: 6 }
export const ROW_HEIGHT = 40
export const HEADER_HEIGHT = 48
export const BAR_VPAD = 8

export interface TimelineRange {
  startIso: string
  totalDays: number
}

export function computeTimelineRange(tasks: ScheduleTask[], todayIso: string): TimelineRange {
  let minIso = addDays(todayIso, -7)
  let maxIso = addDays(todayIso, 60)
  for (const t of tasks) {
    if (t.start_date < minIso) minIso = t.start_date
    if (t.end_date > maxIso) maxIso = t.end_date
    if (t.baseline_start && t.baseline_start < minIso) minIso = t.baseline_start
    if (t.baseline_end && t.baseline_end > maxIso) maxIso = t.baseline_end
  }
  minIso = addDays(minIso, -3)
  maxIso = addDays(maxIso, 10)
  return { startIso: minIso, totalDays: diffDays(minIso, maxIso) + 1 }
}

export function xForIso(range: TimelineRange, iso: string, dayWidth: number): number {
  return diffDays(range.startIso, iso) * dayWidth
}

export interface DayCell {
  iso: string
  index: number
  dayOfMonth: number
  weekday: number // 0 = Sunday
  isWeekend: boolean
  isMonthStart: boolean
}

export function buildDayCells(range: TimelineRange): DayCell[] {
  const cells: DayCell[] = []
  for (let i = 0; i < range.totalDays; i++) {
    const iso = addDays(range.startIso, i)
    const d = new Date(iso + 'T12:00:00Z')
    const weekday = d.getUTCDay()
    cells.push({
      iso,
      index: i,
      dayOfMonth: d.getUTCDate(),
      weekday,
      isWeekend: weekday === 0 || weekday === 6,
      isMonthStart: d.getUTCDate() === 1,
    })
  }
  return cells
}

export interface HeaderGroup {
  label: string
  startIndex: number
  span: number
}

/** Groups day cells into month bands (top header row). */
export function buildMonthGroups(cells: DayCell[]): HeaderGroup[] {
  const groups: HeaderGroup[] = []
  for (const cell of cells) {
    const d = new Date(cell.iso + 'T12:00:00Z')
    const label = d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.span++
    else groups.push({ label, startIndex: cell.index, span: 1 })
  }
  return groups
}

/** Groups day cells into week bands, labeled by the week's Monday date. */
export function buildWeekGroups(cells: DayCell[]): HeaderGroup[] {
  const groups: HeaderGroup[] = []
  for (const cell of cells) {
    const isWeekStart = cell.weekday === 1 || cell.index === 0
    if (isWeekStart || groups.length === 0) {
      const d = new Date(cell.iso + 'T12:00:00Z')
      const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
      groups.push({ label, startIndex: cell.index, span: 1 })
    } else {
      groups[groups.length - 1].span++
    }
  }
  return groups
}

export function moduleColor(module: string | null): string {
  const palette = ['#0E7C86', '#6366F1', '#D97706', '#DB2777', '#7C3AED', '#0EA5E9', '#16A34A', '#B45309']
  if (!module) return '#475569'
  let hash = 0
  for (let i = 0; i < module.length; i++) hash = (hash * 31 + module.charCodeAt(i)) >>> 0
  return palette[hash % palette.length]
}
