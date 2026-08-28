// ---------------------------------------------------------------------------
// Excel export — a raw, editable companion to the PDF report. Two sheets:
// "Schedule" is a flat data table (one row per task, real dates/numbers, an
// autofilter) meant for a client's trades to import or reference directly;
// "Gantt Chart" rebuilds the bar-chart visual as colored spreadsheet cells
// (one column per day) since a PDF can't be "saved as Excel" and keep its
// bars — there's no such conversion, this is a second, independent render
// of the same schedule data.
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs'
import type { ScheduleDependency, ScheduleTask } from '@/types'
import { addDays, diffDays, durationDays } from './scheduleEngine'
import { moduleColor } from '@/components/gantt/ganttGeometry'

export interface ScheduleExcelInput {
  projectName: string
  projectLocation: string | null
  scopeOfWork: string | null
  generatedDate: string
  moduleGroups: { module: string; tasks: ScheduleTask[] }[]
  dependencies: ScheduleDependency[]
  criticalIds: Set<string>
  rangeStart: string
  totalDays: number
}

const BRAND_TEAL = 'FF0E7C86'
const CRITICAL_RED = 'FFDC2626'
const CRITICAL_TINT = 'FFFEE2E2'
const TEAL_TINT = 'FFECFEFF'
const HEADER_INK = 'FF0F172A'
const WEEKEND_TINT = 'FFF1F5F9'
const BORDER_LINE = 'FFE2E8F0'
const WHITE = 'FFFFFFFF'

const thinBorder = { style: 'thin' as const, color: { argb: BORDER_LINE } }

function toExcelDate(iso: string): Date {
  return new Date(iso + 'T00:00:00Z')
}

function argbFromHex(hex: string): string {
  return `FF${hex.replace('#', '').toUpperCase()}`
}

function formatPredecessors(taskId: string, dependencies: ScheduleDependency[], taskById: Map<string, ScheduleTask>): string {
  const preds = dependencies.filter((d) => d.successor_id === taskId)
  if (preds.length === 0) return ''
  return preds
    .map((d) => {
      const pred = taskById.get(d.predecessor_id)
      if (!pred) return null
      const lag = d.lag_days ? (d.lag_days > 0 ? `+${d.lag_days}d` : `${d.lag_days}d`) : ''
      return `${pred.name} (${d.dep_type}${lag})`
    })
    .filter((s): s is string => s !== null)
    .join('; ')
}

function addTitleBlock(sheet: ExcelJS.Worksheet, input: ScheduleExcelInput, lastCol: number) {
  const titleRow = sheet.addRow([input.projectName])
  sheet.mergeCells(titleRow.number, 1, titleRow.number, lastCol)
  titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: HEADER_INK } }
  titleRow.height = 22

  if (input.projectLocation) {
    const row = sheet.addRow([`Location: ${input.projectLocation}`])
    sheet.mergeCells(row.number, 1, row.number, lastCol)
    row.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF334155' } }
  }
  if (input.scopeOfWork) {
    const row = sheet.addRow([`Scope of Work: ${input.scopeOfWork}`])
    sheet.mergeCells(row.number, 1, row.number, lastCol)
    row.getCell(1).font = { size: 10, color: { argb: 'FF334155' } }
  }
  const dateRow = sheet.addRow([`As of ${input.generatedDate}`])
  sheet.mergeCells(dateRow.number, 1, dateRow.number, lastCol)
  dateRow.getCell(1).font = { italic: true, size: 8, color: { argb: 'FF64748B' } }
  sheet.addRow([])
}

// --- Sheet 1: flat, filterable data table -----------------------------------

function buildScheduleSheet(workbook: ExcelJS.Workbook, input: ScheduleExcelInput) {
  const sheet = workbook.addWorksheet('Schedule')
  const columns = [
    { header: 'Module', key: 'module', width: 20 },
    { header: 'Task', key: 'task', width: 42 },
    { header: 'Start Date', key: 'start', width: 13 },
    { header: 'Finish Date', key: 'finish', width: 13 },
    { header: 'Duration (d)', key: 'duration', width: 12 },
    { header: '% Complete', key: 'pct', width: 11 },
    { header: 'Milestone', key: 'milestone', width: 10 },
    { header: 'Critical Path', key: 'critical', width: 11 },
    { header: 'Predecessors', key: 'predecessors', width: 40 },
  ]

  addTitleBlock(sheet, input, columns.length)

  const taskById = new Map<string, ScheduleTask>()
  for (const group of input.moduleGroups) for (const t of group.tasks) taskById.set(t.id, t)

  const headerRowIndex = sheet.rowCount + 1
  const headerRow = sheet.addRow(columns.map((c) => c.header))
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: WHITE } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_INK } }
    cell.alignment = { vertical: 'middle' }
  })
  columns.forEach((c, i) => (sheet.getColumn(i + 1).width = c.width))

  for (const group of input.moduleGroups) {
    for (const task of group.tasks) {
      const row = sheet.addRow([
        group.module,
        task.name,
        toExcelDate(task.start_date),
        toExcelDate(task.end_date),
        task.is_milestone ? null : durationDays(task),
        task.percent_complete / 100,
        task.is_milestone ? 'Yes' : '',
        input.criticalIds.has(task.id) ? 'Yes' : '',
        formatPredecessors(task.id, input.dependencies, taskById),
      ])
      row.getCell(3).numFmt = 'yyyy-mm-dd'
      row.getCell(4).numFmt = 'yyyy-mm-dd'
      row.getCell(6).numFmt = '0%'
      if (input.criticalIds.has(task.id)) row.getCell(8).font = { bold: true, color: { argb: CRITICAL_RED } }
      row.eachCell((cell) => {
        cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
      })
    }
  }

  sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }]
  sheet.autoFilter = { from: { row: headerRowIndex, column: 1 }, to: { row: headerRowIndex, column: columns.length } }
}

// --- Sheet 2: the bar chart, redrawn as colored cells ------------------------

const LEAD_COLS = 3 // Task, Start, Finish
const DAY_COL_WIDTH = 2.6

function buildGanttSheet(workbook: ExcelJS.Workbook, input: ScheduleExcelInput) {
  const sheet = workbook.addWorksheet('Gantt Chart')
  const { rangeStart, totalDays } = input
  const lastCol = LEAD_COLS + totalDays

  addTitleBlock(sheet, input, lastCol)

  sheet.getColumn(1).width = 32
  sheet.getColumn(2).width = 11
  sheet.getColumn(3).width = 11
  for (let i = 0; i < totalDays; i++) sheet.getColumn(LEAD_COLS + 1 + i).width = DAY_COL_WIDTH

  const monthHeaderRowIndex = sheet.rowCount + 1
  const monthRow = sheet.getRow(monthHeaderRowIndex)
  const dayRow = sheet.getRow(monthHeaderRowIndex + 1)
  ;['Activity', 'Start', 'Finish'].forEach((label, i) => {
    sheet.mergeCells(monthHeaderRowIndex, i + 1, monthHeaderRowIndex + 1, i + 1)
    const cell = monthRow.getCell(i + 1)
    cell.value = label
    cell.font = { bold: true, color: { argb: WHITE } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_INK } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
  })

  const todayOffset = diffDays(rangeStart, new Date().toISOString().slice(0, 10))
  let monthStartCol = LEAD_COLS + 1
  let monthLabel = ''
  for (let i = 0; i <= totalDays; i++) {
    const iso = i < totalDays ? addDays(rangeStart, i) : null
    const label = iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }) : null
    if (label !== monthLabel) {
      const col = LEAD_COLS + 1 + i
      if (monthLabel && col > monthStartCol) {
        sheet.mergeCells(monthHeaderRowIndex, monthStartCol, monthHeaderRowIndex, col - 1)
        const cell = monthRow.getCell(monthStartCol)
        cell.value = monthLabel
        cell.font = { bold: true, size: 8, color: { argb: HEADER_INK } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
        cell.alignment = { horizontal: 'left' }
      }
      monthStartCol = col
      monthLabel = label ?? ''
    }
    if (iso) {
      const d = new Date(iso + 'T12:00:00Z')
      const weekday = d.getUTCDay()
      const cell = dayRow.getCell(LEAD_COLS + 1 + i)
      cell.value = d.getUTCDate()
      cell.font = { size: 6.5, color: { argb: 'FF64748B' } }
      cell.alignment = { horizontal: 'center' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: weekday === 0 || weekday === 6 ? WEEKEND_TINT : WHITE } }
    }
  }
  monthRow.height = 14
  dayRow.height = 12

  for (const group of input.moduleGroups) {
    const groupRow = sheet.addRow([`${group.module} (${group.tasks.length})`])
    sheet.mergeCells(groupRow.number, 1, groupRow.number, lastCol)
    groupRow.getCell(1).font = { bold: true, color: { argb: argbFromHex(moduleColor(group.module)) } }
    groupRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }

    for (const task of group.tasks) {
      const row = sheet.addRow([task.name, toExcelDate(task.start_date), toExcelDate(task.end_date)])
      row.getCell(2).numFmt = 'yyyy-mm-dd'
      row.getCell(3).numFmt = 'yyyy-mm-dd'
      row.getCell(1).font = { size: 8 }
      row.getCell(2).font = { size: 8 }
      row.getCell(3).font = { size: 8 }

      const isCritical = input.criticalIds.has(task.id)
      const barColor = isCritical ? CRITICAL_RED : BRAND_TEAL
      const barTint = isCritical ? CRITICAL_TINT : TEAL_TINT
      const startOffset = diffDays(rangeStart, task.start_date)
      const duration = durationDays(task)

      for (let i = 0; i < totalDays; i++) {
        const col = LEAD_COLS + 1 + i
        const cell = row.getCell(col)
        const iso = addDays(rangeStart, i)
        const weekday = new Date(iso + 'T12:00:00Z').getUTCDay()
        const isWeekend = weekday === 0 || weekday === 6
        const inBar = i >= startOffset && i < startOffset + duration

        if (task.is_milestone && i === startOffset) {
          cell.value = '◆'
          cell.font = { size: 8, bold: true, color: { argb: barColor } }
          cell.alignment = { horizontal: 'center' }
        } else if (inBar && !task.is_milestone) {
          const isFilled = i < startOffset + Math.round((duration * Math.min(100, Math.max(0, task.percent_complete))) / 100)
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isFilled ? barColor : barTint } }
        } else if (isWeekend) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WEEKEND_TINT } }
        }

        if (i === todayOffset) {
          cell.border = { ...cell.border, left: { style: 'medium', color: { argb: CRITICAL_RED } } }
        }
      }
    }
  }

  sheet.views = [{ state: 'frozen', xSplit: LEAD_COLS, ySplit: monthHeaderRowIndex + 1 }]
}

export async function buildScheduleWorkbookBlob(input: ScheduleExcelInput): Promise<Blob> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'XA Gantt & Scheduling'
  workbook.created = new Date()

  buildScheduleSheet(workbook, input)
  buildGanttSheet(workbook, input)

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
