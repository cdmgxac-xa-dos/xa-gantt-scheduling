import { useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import type { ScheduleDependency, ScheduleTask } from '@/types'
import { addDays } from '@/lib/scheduleEngine'
import {
  buildDayCells,
  buildMonthGroups,
  buildWeekGroups,
  computeTimelineRange,
  moduleColor,
  xForIso,
  DAY_WIDTH,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  type GanttZoom,
} from './ganttGeometry'
import { GanttBar } from './GanttBar'

type VisibleRow =
  | { type: 'module'; key: string; label: string; count: number; collapsed: boolean }
  | { type: 'task'; key: string; task: ScheduleTask }

type DragMode = 'move' | 'resize-left' | 'resize-right'

export function GanttChart({
  tasks,
  dependencies,
  zoom,
  editable,
  criticalIds,
  showBaseline,
  collapsedModules,
  onToggleModule,
  onTaskDatesChange,
  onLinkTasks,
  onSelectTask,
  onReorderTask,
  onReorderModule,
  todayIso,
}: {
  tasks: ScheduleTask[]
  dependencies: ScheduleDependency[]
  zoom: GanttZoom
  editable: boolean
  criticalIds: Set<string>
  showBaseline: boolean
  collapsedModules: Set<string>
  onToggleModule: (moduleKey: string) => void
  onTaskDatesChange: (taskId: string, window: { start_date: string; end_date: string }) => void
  onLinkTasks: (predecessorId: string, successorId: string) => void
  onSelectTask: (taskId: string) => void
  onReorderTask: (taskId: string, direction: 'up' | 'down') => void
  onReorderModule: (moduleKey: string, direction: 'up' | 'down') => void
  todayIso: string
}) {
  const dayWidth = DAY_WIDTH[zoom]
  const containerRef = useRef<HTMLDivElement>(null)

  const range = useMemo(() => computeTimelineRange(tasks, todayIso), [tasks, todayIso])
  const dayCells = useMemo(() => buildDayCells(range), [range])
  const monthGroups = useMemo(() => buildMonthGroups(dayCells), [dayCells])
  const weekGroups = useMemo(() => buildWeekGroups(dayCells), [dayCells])
  const contentWidth = range.totalDays * dayWidth

  const grouped = useMemo(() => {
    const map = new Map<string, ScheduleTask[]>()
    for (const t of tasks) {
      const key = t.module || 'Ungrouped'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    return Array.from(map.entries())
  }, [tasks])

  const visibleRows = useMemo<VisibleRow[]>(() => {
    const rows: VisibleRow[] = []
    for (const [moduleKey, moduleTasks] of grouped) {
      const collapsed = collapsedModules.has(moduleKey)
      rows.push({ type: 'module', key: moduleKey, label: moduleKey, count: moduleTasks.length, collapsed })
      if (!collapsed) for (const t of moduleTasks) rows.push({ type: 'task', key: t.id, task: t })
    }
    return rows
  }, [grouped, collapsedModules])

  const rowIndexByTaskId = useMemo(() => {
    const map = new Map<string, number>()
    visibleRows.forEach((row, i) => {
      if (row.type === 'task') map.set(row.task.id, i)
    })
    return map
  }, [visibleRows])

  // Position within its own module group — determines whether the "move
  // up"/"move down" reorder buttons are usable for that task.
  const taskOrderInfo = useMemo(() => {
    const map = new Map<string, { isFirst: boolean; isLast: boolean }>()
    for (const [, moduleTasks] of grouped) {
      moduleTasks.forEach((t, i) => {
        map.set(t.id, { isFirst: i === 0, isLast: i === moduleTasks.length - 1 })
      })
    }
    return map
  }, [grouped])

  // Position of each module among all modules — same idea, for the module
  // reorder buttons.
  const moduleOrderInfo = useMemo(() => {
    const map = new Map<string, { isFirst: boolean; isLast: boolean }>()
    grouped.forEach(([key], i) => {
      map.set(key, { isFirst: i === 0, isLast: i === grouped.length - 1 })
    })
    return map
  }, [grouped])

  // --- drag-to-move / drag-to-resize -----------------------------------------

  const [drag, setDrag] = useState<{ taskId: string; mode: DragMode; deltaDays: number } | null>(null)

  function beginDrag(e: React.MouseEvent, task: ScheduleTask, mode: DragMode) {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    const start = { taskId: task.id, mode, startX: e.clientX, origStart: task.start_date, origEnd: task.end_date }
    setDrag({ taskId: task.id, mode, deltaDays: 0 })

    function onMove(ev: MouseEvent) {
      const deltaPx = ev.clientX - start.startX
      const deltaDays = Math.round(deltaPx / dayWidth)
      setDrag({ taskId: start.taskId, mode: start.mode, deltaDays })
    }

    function onUp(ev: MouseEvent) {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDrag(null)

      const deltaPx = ev.clientX - start.startX
      const deltaDays = Math.round(deltaPx / dayWidth)
      if (deltaDays === 0) return

      if (start.mode === 'move') {
        onTaskDatesChange(task.id, {
          start_date: addDays(start.origStart, deltaDays),
          end_date: addDays(start.origEnd, deltaDays),
        })
      } else if (start.mode === 'resize-left') {
        const newStart = addDays(start.origStart, deltaDays)
        if (newStart <= start.origEnd) onTaskDatesChange(task.id, { start_date: newStart, end_date: start.origEnd })
      } else if (start.mode === 'resize-right') {
        const newEnd = addDays(start.origEnd, deltaDays)
        if (newEnd >= start.origStart) onTaskDatesChange(task.id, { start_date: start.origStart, end_date: newEnd })
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // --- drag-to-link (dependency creation) -------------------------------------

  const [linking, setLinking] = useState<{ fromTaskId: string; x: number; y: number } | null>(null)

  function beginLink(e: React.MouseEvent, task: ScheduleTask) {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    const container = containerRef.current
    if (!container) return

    function pointFromEvent(ev: MouseEvent) {
      const rect = container!.getBoundingClientRect()
      return { x: ev.clientX - rect.left + container!.scrollLeft, y: ev.clientY - rect.top }
    }

    setLinking({ fromTaskId: task.id, ...pointFromEvent(e.nativeEvent) })

    function onMove(ev: MouseEvent) {
      setLinking({ fromTaskId: task.id, ...pointFromEvent(ev) })
    }

    function onUp(ev: MouseEvent) {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setLinking(null)

      const rect = container!.getBoundingClientRect()
      const y = ev.clientY - rect.top - HEADER_HEIGHT
      if (y < 0) return
      const rowIndex = Math.floor(y / ROW_HEIGHT)
      const targetRow = visibleRows[rowIndex]
      if (targetRow && targetRow.type === 'task' && targetRow.task.id !== task.id) {
        onLinkTasks(task.id, targetRow.task.id)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // --- rendering ---------------------------------------------------------------

  function windowFor(task: ScheduleTask): { start_date: string; end_date: string } {
    if (drag && drag.taskId === task.id) {
      if (drag.mode === 'move') {
        return { start_date: addDays(task.start_date, drag.deltaDays), end_date: addDays(task.end_date, drag.deltaDays) }
      }
      if (drag.mode === 'resize-left') {
        return { start_date: addDays(task.start_date, drag.deltaDays), end_date: task.end_date }
      }
      return { start_date: task.start_date, end_date: addDays(task.end_date, drag.deltaDays) }
    }
    return { start_date: task.start_date, end_date: task.end_date }
  }

  const bodyHeight = visibleRows.length * ROW_HEIGHT
  const todayX = xForIso(range, todayIso, dayWidth)

  return (
    <div className="flex overflow-hidden rounded-2xl border border-brand-line bg-white shadow-card">
      {/* Activity list — fixed-width column that scrolls vertically with the
          page but stays put horizontally, so it stays aligned row-for-row
          with the timeline next to it regardless of horizontal scroll/zoom. */}
      <div className="w-56 shrink-0 border-r border-brand-line">
        <div
          className="sticky top-0 z-10 flex items-end border-b border-brand-line bg-white px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-slate"
          style={{ height: HEADER_HEIGHT }}
        >
          Activities
        </div>
        <div className="relative" style={{ height: bodyHeight }}>
          {visibleRows.map((row, i) =>
            row.type === 'module' ? (
              <div
                key={row.key}
                className="group absolute left-0 flex w-full items-center gap-1 border-b border-brand-line bg-slate-50 px-2 text-xs font-bold"
                style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT, color: moduleColor(row.label) }}
              >
                <button
                  onClick={() => onToggleModule(row.key)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  {row.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span className="truncate">
                    {row.label} ({row.count})
                  </span>
                </button>
                {editable && (
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => onReorderModule(row.key, 'up')}
                      disabled={moduleOrderInfo.get(row.key)?.isFirst}
                      title="Move module up (its activities move with it)"
                      className="rounded p-0.5 hover:bg-slate-200 disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      onClick={() => onReorderModule(row.key, 'down')}
                      disabled={moduleOrderInfo.get(row.key)?.isLast}
                      title="Move module down (its activities move with it)"
                      className="rounded p-0.5 hover:bg-slate-200 disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ChevronDown size={13} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div
                key={row.key}
                className="group absolute left-0 flex w-full items-center gap-1 border-b border-brand-line/60 px-2"
                style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
              >
                <span className="min-w-0 flex-1 truncate text-xs text-brand-ink" title={row.task.name}>
                  {row.task.name}
                </span>
                {editable && (
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => onReorderTask(row.task.id, 'up')}
                      disabled={taskOrderInfo.get(row.task.id)?.isFirst}
                      title="Move up"
                      className="rounded p-0.5 text-brand-slate hover:bg-slate-100 hover:text-brand-ink disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      onClick={() => onReorderTask(row.task.id, 'down')}
                      disabled={taskOrderInfo.get(row.task.id)?.isLast}
                      title="Move down"
                      className="rounded p-0.5 text-brand-slate hover:bg-slate-100 hover:text-brand-ink disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ChevronDown size={13} />
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>

      <div ref={containerRef} className="relative flex-1 overflow-x-auto">
        <div style={{ width: contentWidth, minWidth: '100%' }}>
          {/* Header */}
          <div className="sticky top-0 z-10 bg-white" style={{ height: HEADER_HEIGHT }}>
            <div className="flex border-b border-brand-line" style={{ height: HEADER_HEIGHT / 2 }}>
              {(zoom === 'month' ? monthGroups : weekGroups).map((g) => (
                <div
                  key={`${g.label}-${g.startIndex}`}
                  className="shrink-0 truncate border-r border-brand-line px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-ink"
                  style={{ width: g.span * dayWidth }}
                >
                  {g.label}
                </div>
              ))}
            </div>
            {zoom !== 'month' && (
              <div className="flex" style={{ height: HEADER_HEIGHT / 2 }}>
                {dayCells.map((c) => (
                  <div
                    key={c.iso}
                    className={`shrink-0 border-r border-brand-line/60 text-center text-[10px] leading-[1.6rem] ${
                      c.isWeekend ? 'bg-slate-50 text-brand-slate' : 'text-brand-ink'
                    }`}
                    style={{ width: dayWidth }}
                  >
                    {zoom === 'day' ? c.dayOfMonth : c.weekday === 1 ? c.dayOfMonth : ''}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Body */}
          <div className="relative" style={{ height: bodyHeight }}>
            {/* weekend shading */}
            {zoom === 'day' &&
              dayCells
                .filter((c) => c.isWeekend)
                .map((c) => (
                  <div
                    key={c.iso}
                    className="absolute top-0 bg-slate-50"
                    style={{ left: c.index * dayWidth, width: dayWidth, height: bodyHeight }}
                  />
                ))}

            {/* today line */}
            <div className="absolute top-0 z-10 w-px bg-red-500" style={{ left: todayX, height: bodyHeight }} />

            {/* row backgrounds + module bands (labels live in the activity list on the left) */}
            {visibleRows.map((row, i) =>
              row.type === 'module' ? (
                <div
                  key={row.key}
                  className="absolute left-0 w-full border-b border-brand-line bg-slate-50"
                  style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                />
              ) : (
                <div
                  key={row.key}
                  className="absolute left-0 w-full border-b border-brand-line/60"
                  style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                />
              )
            )}

            {/* dependency lines */}
            <svg className="pointer-events-none absolute inset-0" width={contentWidth} height={bodyHeight}>
              <defs>
                <marker id="gantt-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#94A3B8" />
                </marker>
              </defs>
              {dependencies.map((dep) => {
                const predRow = rowIndexByTaskId.get(dep.predecessor_id)
                const succRow = rowIndexByTaskId.get(dep.successor_id)
                if (predRow === undefined || succRow === undefined) return null
                const predTask = tasks.find((t) => t.id === dep.predecessor_id)
                const succTask = tasks.find((t) => t.id === dep.successor_id)
                if (!predTask || !succTask) return null
                const predWindow = windowFor(predTask)
                const succWindow = windowFor(succTask)
                const x1 = xForIso(range, predWindow.end_date, dayWidth) + dayWidth
                const y1 = predRow * ROW_HEIGHT + ROW_HEIGHT / 2
                const x2 = xForIso(range, succWindow.start_date, dayWidth)
                const y2 = succRow * ROW_HEIGHT + ROW_HEIGHT / 2
                const midX = x1 + 10
                return (
                  <path
                    key={dep.id}
                    d={`M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2},${y2}`}
                    fill="none"
                    stroke="#94A3B8"
                    strokeWidth={1.5}
                    markerEnd="url(#gantt-arrow)"
                  />
                )
              })}
              {linking && (() => {
                const fromRow = rowIndexByTaskId.get(linking.fromTaskId)
                const fromTask = tasks.find((t) => t.id === linking.fromTaskId)
                if (fromRow === undefined || !fromTask) return null
                const w = windowFor(fromTask)
                const x1 = xForIso(range, w.end_date, dayWidth) + dayWidth
                const y1 = fromRow * ROW_HEIGHT + ROW_HEIGHT / 2
                return (
                  <line x1={x1} y1={y1} x2={linking.x} y2={linking.y} stroke="#0E7C86" strokeWidth={2} strokeDasharray="4 3" />
                )
              })()}
            </svg>

            {/* baseline ghost bars */}
            {showBaseline &&
              visibleRows.map((row, i) => {
                if (row.type !== 'task' || !row.task.baseline_start || !row.task.baseline_end) return null
                const x = xForIso(range, row.task.baseline_start, dayWidth)
                const w = xForIso(range, row.task.baseline_end, dayWidth) + dayWidth - x
                return (
                  <div
                    key={`baseline-${row.key}`}
                    className="absolute rounded-sm bg-slate-300"
                    style={{ left: x, top: i * ROW_HEIGHT + ROW_HEIGHT - 9, width: Math.max(w, 4), height: 4 }}
                    title={`Baseline: ${row.task.baseline_start} → ${row.task.baseline_end}`}
                  />
                )
              })}

            {/* bars */}
            {visibleRows.map((row, i) => {
              if (row.type !== 'task') return null
              const w = windowFor(row.task)
              const x = xForIso(range, w.start_date, dayWidth)
              const width = xForIso(range, w.end_date, dayWidth) + dayWidth - x - 2
              return (
                <div key={row.key} className="absolute left-0 w-full" style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}>
                  <GanttBar
                    task={row.task}
                    x={x}
                    width={width}
                    isCritical={criticalIds.has(row.task.id)}
                    editable={editable}
                    onMoveStart={(e) => beginDrag(e, row.task, 'move')}
                    onResizeStart={(e, edge) => beginDrag(e, row.task, edge === 'left' ? 'resize-left' : 'resize-right')}
                    onLinkStart={(e) => beginLink(e, row.task)}
                    onClick={() => onSelectTask(row.task.id)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
