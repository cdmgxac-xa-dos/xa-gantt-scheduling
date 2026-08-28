import { useEffect, useMemo, useState } from 'react'
import {
  Loader2,
  Plus,
  Download,
  Save,
  CalendarClock,
  Eraser,
  Trash2,
  X,
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { GanttChart } from '@/components/gantt/GanttChart'
import { computeTimelineRange, type GanttZoom } from '@/components/gantt/ganttGeometry'
import { cascadeReschedule, computeCriticalPath, durationDays, todayIso, wouldCreateCycle } from '@/lib/scheduleEngine'
import {
  bulkUpdateTaskDates,
  clearBaselineForAll,
  createDependency,
  createTask,
  deleteDependency,
  deleteReport,
  deleteTask,
  getReportSignedUrl,
  listDependencies,
  listReports,
  listTasks,
  saveReport,
  setBaselineForAll,
  updateDependency,
  updateTask,
} from '@/services/scheduleService'
import { DEPENDENCY_TYPES, DEPENDENCY_TYPE_LABELS } from '@/types'
import type { DependencyType, ScheduleDependency, ScheduleReport, ScheduleTask } from '@/types'

const APP_TITLE = 'XA Gantt & Scheduling'
const ZOOM_OPTIONS: { value: GanttZoom; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

export function SchedulePage() {
  const { user } = useAuth()
  const editable = user?.role === 'editor'

  const [tasks, setTasks] = useState<ScheduleTask[]>([])
  const [dependencies, setDependencies] = useState<ScheduleDependency[]>([])
  const [reports, setReports] = useState<ScheduleReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState<GanttZoom>('week')
  const [showBaseline, setShowBaseline] = useState(false)
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; task?: ScheduleTask } | null>(null)
  const [exporting, setExporting] = useState<'download' | 'save' | null>(null)
  const [showReports, setShowReports] = useState(false)
  const [busyAction, setBusyAction] = useState(false)

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const [t, d, r] = await Promise.all([listTasks(), listDependencies(), listReports()])
      setTasks(t)
      setDependencies(d)
      setReports(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedule')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const displayTasks = useMemo(() => {
    const byModule = new Map<string, ScheduleTask[]>()
    for (const t of tasks) {
      const key = t.module || 'Ungrouped'
      if (!byModule.has(key)) byModule.set(key, [])
      byModule.get(key)!.push(t)
    }
    const moduleNames = Array.from(byModule.keys()).sort((a, b) => a.localeCompare(b))
    const result: ScheduleTask[] = []
    for (const name of moduleNames) {
      const group = byModule
        .get(name)!
        .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.sort_order - b.sort_order)
      result.push(...group)
    }
    return result
  }, [tasks])

  const moduleNames = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.module).filter((m): m is string => !!m))).sort(),
    [tasks]
  )

  const criticalIds = useMemo(() => computeCriticalPath(tasks, dependencies), [tasks, dependencies])

  const stats = useMemo(() => {
    const total = tasks.length
    const milestones = tasks.filter((t) => t.is_milestone).length
    const completed = tasks.filter((t) => t.percent_complete >= 100).length
    const overallPercent = total > 0 ? tasks.reduce((sum, t) => sum + t.percent_complete, 0) / total : 0
    const overdue = tasks.filter((t) => t.end_date < todayIso() && t.percent_complete < 100).length
    return { total, milestones, completed, overallPercent, overdue, criticalCount: criticalIds.size }
  }, [tasks, criticalIds])

  function toggleModule(name: string) {
    setCollapsedModules((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // --- persistence for drag/resize/link ---------------------------------------

  async function handleTaskDatesChange(taskId: string, window: { start_date: string; end_date: string }) {
    const withUpdate = tasks.map((t) => (t.id === taskId ? { ...t, ...window } : t))
    const cascaded = cascadeReschedule(withUpdate, dependencies, [taskId])
    const finalTasks = withUpdate.map((t) => (cascaded.has(t.id) ? { ...t, ...cascaded.get(t.id)! } : t))
    setTasks(finalTasks)
    try {
      await bulkUpdateTaskDates([
        { id: taskId, ...window },
        ...Array.from(cascaded.entries()).map(([id, w]) => ({ id, ...w })),
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the new dates')
      await refresh()
    }
  }

  async function handleLinkTasks(predecessorId: string, successorId: string) {
    if (dependencies.some((d) => d.predecessor_id === predecessorId && d.successor_id === successorId)) return
    if (wouldCreateCycle(dependencies, predecessorId, successorId)) {
      setError('That link would create a circular dependency — not created.')
      return
    }
    try {
      const dep = await createDependency({ predecessor_id: predecessorId, successor_id: successorId, dep_type: 'FS' })
      const nextDeps = [...dependencies, dep]
      setDependencies(nextDeps)
      const cascaded = cascadeReschedule(tasks, nextDeps, [predecessorId])
      if (cascaded.size > 0) {
        setTasks((prev) => prev.map((t) => (cascaded.has(t.id) ? { ...t, ...cascaded.get(t.id)! } : t)))
        await bulkUpdateTaskDates(Array.from(cascaded.entries()).map(([id, w]) => ({ id, ...w })))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create dependency')
    }
  }

  async function handleSetBaseline() {
    if (!window.confirm('Snapshot every task’s current start/finish as the baseline for planned-vs-actual reporting?')) return
    setBusyAction(true)
    try {
      await setBaselineForAll(tasks)
      setShowBaseline(true)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set baseline')
    } finally {
      setBusyAction(false)
    }
  }

  async function handleClearBaseline() {
    setBusyAction(true)
    try {
      await clearBaselineForAll(tasks)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear baseline')
    } finally {
      setBusyAction(false)
    }
  }

  async function handleDeleteTask(taskId: string) {
    if (!window.confirm('Delete this task? Any dependency links to/from it are removed too.')) return
    setBusyAction(true)
    try {
      await deleteTask(taskId)
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
      setDependencies((prev) => prev.filter((d) => d.predecessor_id !== taskId && d.successor_id !== taskId))
      setModal(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete task')
    } finally {
      setBusyAction(false)
    }
  }

  // --- PDF export ---------------------------------------------------------------

  async function buildPdfBlob() {
    const [{ pdf }, { SchedulePdfDocument }] = await Promise.all([
      import('@react-pdf/renderer'),
      import('@/components/SchedulePdfDocument'),
    ])
    const byModule = new Map<string, ScheduleTask[]>()
    for (const t of displayTasks) {
      const key = t.module || 'Ungrouped'
      if (!byModule.has(key)) byModule.set(key, [])
      byModule.get(key)!.push(t)
    }
    const moduleGroups = Array.from(byModule.entries()).map(([module, groupTasks]) => ({ module, tasks: groupTasks }))
    const range = computeTimelineRange(tasks, todayIso())
    const generatedDate = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

    return pdf(
      <SchedulePdfDocument
        generatedDate={generatedDate}
        projectName={APP_TITLE}
        preparedBy={user?.full_name ?? null}
        moduleGroups={moduleGroups}
        rangeStart={range.startIso}
        totalDays={range.totalDays}
        criticalIds={criticalIds}
        totalTasks={stats.total}
        milestoneCount={stats.milestones}
        overallPercent={stats.overallPercent}
      />
    ).toBlob()
  }

  async function handleDownloadPdf() {
    setExporting('download')
    try {
      const blob = await buildPdfBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Project-Schedule-${todayIso()}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate PDF')
    } finally {
      setExporting(null)
    }
  }

  async function handleSaveReport() {
    setExporting('save')
    try {
      const blob = await buildPdfBlob()
      const report = await saveReport(blob, `Project-Schedule-${todayIso()}.pdf`)
      setReports((prev) => [report, ...prev])
      setShowReports(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save PDF to the project')
    } finally {
      setExporting(null)
    }
  }

  async function handleOpenReport(report: ScheduleReport) {
    try {
      const url = await getReportSignedUrl(report.storage_path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open report')
    }
  }

  async function handleDeleteReport(report: ScheduleReport) {
    if (!window.confirm(`Delete "${report.file_name}"? This cannot be undone.`)) return
    try {
      await deleteReport(report.id, report.storage_path)
      setReports((prev) => prev.filter((r) => r.id !== report.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete report')
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin text-brand-slate" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-ink">Project Schedule</h1>
          <p className="text-sm text-brand-slate">Gantt &amp; critical-path view</p>
        </div>
        {editable && (
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="flex items-center gap-1.5 rounded-lg bg-brand-ink px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <Plus size={14} /> Add task
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError('')}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Total tasks" value={stats.total} />
        <StatCard label="Milestones" value={stats.milestones} />
        <StatCard label="Completed" value={stats.completed} />
        <StatCard label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? 'danger' : undefined} />
        <StatCard label="On critical path" value={stats.criticalCount} tone="critical" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-line bg-white p-3 shadow-card">
        <div className="flex items-center gap-1 rounded-lg border border-brand-line p-0.5">
          {ZOOM_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setZoom(opt.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                zoom === opt.value ? 'bg-brand-ink text-white' : 'text-brand-slate hover:bg-slate-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-brand-slate">
            <input type="checkbox" checked={showBaseline} onChange={(e) => setShowBaseline(e.target.checked)} />
            Show baseline
          </label>
          {editable && (
            <>
              <ToolbarButton icon={CalendarClock} label="Set baseline" onClick={handleSetBaseline} disabled={busyAction} />
              <ToolbarButton icon={Eraser} label="Clear baseline" onClick={handleClearBaseline} disabled={busyAction} />
            </>
          )}
          <ToolbarButton
            icon={Download}
            label="Download PDF"
            onClick={handleDownloadPdf}
            disabled={exporting !== null}
            loading={exporting === 'download'}
          />
          {editable && (
            <ToolbarButton
              icon={Save}
              label="Save to project"
              onClick={handleSaveReport}
              disabled={exporting !== null}
              loading={exporting === 'save'}
            />
          )}
          <ToolbarButton icon={FileText} label={`Reports (${reports.length})`} onClick={() => setShowReports((v) => !v)} />
        </div>
      </div>

      {showReports && (
        <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-card">
          <h2 className="mb-3 text-sm font-bold text-brand-ink">Saved schedule reports</h2>
          {reports.length === 0 ? (
            <p className="text-sm text-brand-slate">No PDFs saved yet — use "Save to project" above.</p>
          ) : (
            <ul className="divide-y divide-brand-line">
              {reports.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-semibold text-brand-ink">{r.file_name}</p>
                    <p className="text-xs text-brand-slate">
                      {new Date(r.generated_at).toLocaleString()} {r.generated_by_name ? `· ${r.generated_by_name}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleOpenReport(r)} className="text-xs font-semibold text-brand-teal hover:underline">
                      Open
                    </button>
                    {editable && (
                      <button onClick={() => handleDeleteReport(r)} className="text-brand-slate hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-brand-line bg-white p-10 text-center text-sm text-brand-slate">
          No schedule tasks yet.{editable ? ' Click "Add task" to build the schedule.' : ''}
        </div>
      ) : (
        <GanttChart
          tasks={displayTasks}
          dependencies={dependencies}
          zoom={zoom}
          editable={editable}
          criticalIds={criticalIds}
          showBaseline={showBaseline}
          collapsedModules={collapsedModules}
          onToggleModule={toggleModule}
          onTaskDatesChange={handleTaskDatesChange}
          onLinkTasks={handleLinkTasks}
          onSelectTask={(taskId) => {
            if (!editable) return
            const task = tasks.find((t) => t.id === taskId)
            if (task) setModal({ mode: 'edit', task })
          }}
          todayIso={todayIso()}
        />
      )}

      {editable && (
        <p className="text-xs text-brand-slate">
          Drag a bar to reschedule it, drag its edges to change duration, or drag from the small dot on its right edge onto
          another task to link them — dependent tasks push forward automatically. Click a bar to edit its details.
        </p>
      )}

      {modal && (
        <TaskModal
          mode={modal.mode}
          task={modal.task}
          moduleNames={moduleNames}
          allTasks={tasks}
          dependencies={dependencies}
          busy={busyAction}
          onClose={() => setModal(null)}
          onCreate={async (input) => {
            setBusyAction(true)
            try {
              const created = await createTask({ ...input, created_by: user?.id ?? null })
              setTasks((prev) => [...prev, created])
              setModal(null)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Failed to create task')
            } finally {
              setBusyAction(false)
            }
          }}
          onSave={async (taskId, patch) => {
            setBusyAction(true)
            try {
              const updated = await updateTask(taskId, patch)
              const withUpdate = tasks.map((t) => (t.id === taskId ? updated : t))
              const cascaded = cascadeReschedule(withUpdate, dependencies, [taskId])
              const finalTasks = withUpdate.map((t) => (cascaded.has(t.id) ? { ...t, ...cascaded.get(t.id)! } : t))
              setTasks(finalTasks)
              if (cascaded.size > 0) {
                await bulkUpdateTaskDates(Array.from(cascaded.entries()).map(([id, w]) => ({ id, ...w })))
              }
              setModal(null)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Failed to save task')
            } finally {
              setBusyAction(false)
            }
          }}
          onDelete={handleDeleteTask}
          onDependencyAdded={(dep) => setDependencies((prev) => [...prev, dep])}
          onDependencyUpdated={(dep) => setDependencies((prev) => prev.map((d) => (d.id === dep.id ? dep : d)))}
          onDependencyRemoved={(depId) => setDependencies((prev) => prev.filter((d) => d.id !== depId))}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'critical' }) {
  const valueClass = tone === 'danger' ? 'text-red-600' : tone === 'critical' ? 'text-red-600' : 'text-brand-ink'
  return (
    <div className="rounded-xl border border-brand-line bg-white p-3 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-slate">{label}</p>
      <p className={`mt-1 text-xl font-bold ${valueClass}`}>{value}</p>
    </div>
  )
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  loading,
}: {
  icon: typeof Download
  label: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-lg border border-brand-line px-2.5 py-1.5 text-xs font-semibold text-brand-ink hover:bg-slate-50 disabled:opacity-50"
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Add / edit task modal, with a predecessor editor mirroring the "Predecessors"
// column standard in MS Project / Primavera — the discoverable, precise way to
// wire dependencies, alongside dragging links directly on the chart.
// ---------------------------------------------------------------------------

interface TaskFormInput {
  name: string
  module?: string | null
  start_date: string
  end_date: string
  is_milestone?: boolean
  percent_complete?: number
  assignee?: string | null
  notes?: string | null
}

function TaskModal({
  mode,
  task,
  moduleNames,
  allTasks,
  dependencies,
  busy,
  onClose,
  onCreate,
  onSave,
  onDelete,
  onDependencyAdded,
  onDependencyUpdated,
  onDependencyRemoved,
}: {
  mode: 'create' | 'edit'
  task?: ScheduleTask
  moduleNames: string[]
  allTasks: ScheduleTask[]
  dependencies: ScheduleDependency[]
  busy: boolean
  onClose: () => void
  onCreate: (input: TaskFormInput) => Promise<void>
  onSave: (taskId: string, patch: Partial<TaskFormInput>) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
  onDependencyAdded: (dep: ScheduleDependency) => void
  onDependencyUpdated: (dep: ScheduleDependency) => void
  onDependencyRemoved: (depId: string) => void
}) {
  const [name, setName] = useState(task?.name ?? '')
  const [moduleName, setModuleName] = useState(task?.module ?? '')
  const [startDate, setStartDate] = useState(task?.start_date ?? todayIso())
  const [endDate, setEndDate] = useState(task?.end_date ?? todayIso())
  const [isMilestone, setIsMilestone] = useState(task?.is_milestone ?? false)
  const [percentComplete, setPercentComplete] = useState(String(task?.percent_complete ?? 0))
  const [assignee, setAssignee] = useState(task?.assignee ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [saveError, setSaveError] = useState('')
  const [depError, setDepError] = useState('')
  const [showNotes, setShowNotes] = useState(!!task?.notes)

  const duration = useMemo(() => {
    if (!startDate || !endDate || endDate < startDate) return null
    return durationDays({ start_date: startDate, end_date: endDate })
  }, [startDate, endDate])

  function handleMilestoneToggle(checked: boolean) {
    setIsMilestone(checked)
    if (checked) setEndDate(startDate)
  }

  function handleStartChange(value: string) {
    setStartDate(value)
    if (isMilestone) setEndDate(value)
    else if (endDate < value) setEndDate(value)
  }

  async function handleSubmit() {
    setSaveError('')
    if (!name.trim()) {
      setSaveError('Task name is required.')
      return
    }
    if (endDate < startDate) {
      setSaveError('Finish date cannot be before the start date.')
      return
    }
    const input: TaskFormInput = {
      name: name.trim(),
      module: moduleName.trim() || null,
      start_date: startDate,
      end_date: isMilestone ? startDate : endDate,
      is_milestone: isMilestone,
      percent_complete: Math.max(0, Math.min(100, Number(percentComplete) || 0)),
      assignee: assignee.trim() || null,
      notes: notes.trim() || null,
    }
    if (mode === 'create') await onCreate(input)
    else if (task) await onSave(task.id, input)
  }

  const predecessorDeps = task ? dependencies.filter((d) => d.successor_id === task.id) : []
  const candidatePredecessors = task ? allTasks.filter((t) => t.id !== task.id) : []

  const [newPredId, setNewPredId] = useState('')
  const [newDepType, setNewDepType] = useState<DependencyType>('FS')
  const [newLag, setNewLag] = useState('0')

  async function addPredecessor() {
    setDepError('')
    if (!task || !newPredId) return
    if (wouldCreateCycle(dependencies, newPredId, task.id)) {
      setDepError('That link would create a circular dependency.')
      return
    }
    try {
      const dep = await createDependency({
        predecessor_id: newPredId,
        successor_id: task.id,
        dep_type: newDepType,
        lag_days: Number(newLag) || 0,
      })
      onDependencyAdded(dep)
      setNewPredId('')
      setNewLag('0')
    } catch (e) {
      setDepError(e instanceof Error ? e.message : 'Failed to add predecessor')
    }
  }

  async function changeLag(dep: ScheduleDependency, lag: number) {
    try {
      const updated = await updateDependency(dep.id, { lag_days: lag })
      onDependencyUpdated(updated)
    } catch (e) {
      setDepError(e instanceof Error ? e.message : 'Failed to update dependency')
    }
  }

  async function changeType(dep: ScheduleDependency, depType: DependencyType) {
    try {
      const updated = await updateDependency(dep.id, { dep_type: depType })
      onDependencyUpdated(updated)
    } catch (e) {
      setDepError(e instanceof Error ? e.message : 'Failed to update dependency')
    }
  }

  async function removePredecessor(depId: string) {
    try {
      await deleteDependency(depId)
      onDependencyRemoved(depId)
    } catch (e) {
      setDepError(e instanceof Error ? e.message : 'Failed to remove dependency')
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-pop">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-brand-ink">{mode === 'create' ? 'Add task' : 'Edit task'}</h2>
          <button onClick={onClose} className="text-brand-slate hover:text-brand-ink">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Task name" value={name} onChange={setName} />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-brand-slate">Module</span>
            <input
              list="schedule-modules"
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              placeholder="e.g. Panel Boards"
              className="w-full rounded-lg border border-brand-line px-3 py-2 text-sm"
            />
            <datalist id="schedule-modules">
              {moduleNames.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>

          <label className="flex items-center gap-2 text-sm font-semibold text-brand-ink">
            <input type="checkbox" checked={isMilestone} onChange={(e) => handleMilestoneToggle(e.target.checked)} />
            Milestone (single date, no duration)
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-brand-slate">Start</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleStartChange(e.target.value)}
                className="w-full rounded-lg border border-brand-line px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-brand-slate">Finish</span>
              <input
                type="date"
                value={endDate}
                disabled={isMilestone}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-brand-line px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </label>
          </div>
          {duration !== null && !isMilestone && <p className="text-xs text-brand-slate">Duration: {duration} day(s)</p>}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-brand-slate">% Complete</span>
              <input
                type="number"
                min={0}
                max={100}
                value={percentComplete}
                onChange={(e) => setPercentComplete(e.target.value)}
                className="w-full rounded-lg border border-brand-line px-3 py-2 text-sm"
              />
            </label>
            <Field label="Assignee" value={assignee} onChange={setAssignee} placeholder="Optional" />
          </div>

          <button
            type="button"
            onClick={() => setShowNotes((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-brand-slate hover:text-brand-teal"
          >
            {showNotes ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Notes
          </button>
          {showNotes && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-brand-line px-3 py-2 text-sm"
              placeholder="Optional notes"
            />
          )}

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
        </div>

        {mode === 'edit' && task && (
          <div className="mt-5 border-t border-brand-line pt-4">
            <h3 className="mb-2 text-sm font-bold text-brand-ink">Predecessors</h3>
            {predecessorDeps.length === 0 ? (
              <p className="mb-2 text-xs text-brand-slate">No predecessors — this task isn't blocked by anything.</p>
            ) : (
              <ul className="mb-2 space-y-2">
                {predecessorDeps.map((dep) => {
                  const pred = allTasks.find((t) => t.id === dep.predecessor_id)
                  return (
                    <li key={dep.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs">
                      <span className="font-semibold text-brand-ink">{pred?.name ?? 'Unknown task'}</span>
                      <select
                        value={dep.dep_type}
                        onChange={(e) => changeType(dep, e.target.value as DependencyType)}
                        className="rounded border border-brand-line px-1.5 py-1"
                      >
                        {DEPENDENCY_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t} — {DEPENDENCY_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                      <span>lag</span>
                      <input
                        type="number"
                        value={dep.lag_days}
                        onChange={(e) => changeLag(dep, Number(e.target.value) || 0)}
                        className="w-14 rounded border border-brand-line px-1.5 py-1"
                      />
                      <span>days</span>
                      <button onClick={() => removePredecessor(dep.id)} className="ml-auto text-brand-slate hover:text-red-600">
                        <Trash2 size={13} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={newPredId}
                onChange={(e) => setNewPredId(e.target.value)}
                className="min-w-[160px] flex-1 rounded-lg border border-brand-line px-2 py-1.5 text-xs"
              >
                <option value="">Add predecessor…</option>
                {candidatePredecessors.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select
                value={newDepType}
                onChange={(e) => setNewDepType(e.target.value as DependencyType)}
                className="rounded-lg border border-brand-line px-2 py-1.5 text-xs"
              >
                {DEPENDENCY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={newLag}
                onChange={(e) => setNewLag(e.target.value)}
                title="Lag (days)"
                className="w-16 rounded-lg border border-brand-line px-2 py-1.5 text-xs"
              />
              <button
                onClick={addPredecessor}
                disabled={!newPredId}
                className="rounded-lg bg-brand-ink px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {depError && <p className="mt-1 text-xs text-red-600">{depError}</p>}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          {mode === 'edit' && task ? (
            <button
              onClick={() => onDelete(task.id)}
              className="flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              <Trash2 size={14} /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-brand-line px-4 py-2 text-sm font-semibold">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-brand-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-brand-slate">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-brand-line px-3 py-2 text-sm"
      />
    </label>
  )
}
