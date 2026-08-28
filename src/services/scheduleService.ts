import { requireSupabase } from '@/lib/supabaseClient'
import type { DependencyType, NewProjectInput, Project, ScheduleDependency, ScheduleReport, ScheduleTask } from '@/types'

const REPORTS_BUCKET = 'gantt-reports'

// Postgres unique_violation — see gantt_tasks_activity_code_unique in
// supabase/05_v1_1_multiproject_and_controls.sql.
const UNIQUE_VIOLATION = '23505'

function rethrowFriendly(error: { code?: string; message: string }): never {
  if (error.code === UNIQUE_VIOLATION) {
    throw new Error('That Activity ID is already used in this project — pick a different one.')
  }
  throw error
}

// --- Projects -----------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await requireSupabase().from('gantt_projects').select('*').order('created_at', { ascending: true })
  if (error) throw error
  return data as Project[]
}

export async function createProject(input: NewProjectInput): Promise<Project> {
  const { data, error } = await requireSupabase().from('gantt_projects').insert(input).select('*').single()
  if (error) throw error
  return data as Project
}

export async function updateProject(id: string, patch: Partial<Omit<Project, 'id' | 'created_at' | 'updated_at'>>): Promise<Project> {
  const { data, error } = await requireSupabase().from('gantt_projects').update(patch).eq('id', id).select('*').single()
  if (error) throw error
  return data as Project
}

// --- Tasks / dependencies -------------------------------------------------------

export async function listTasks(projectId: string): Promise<ScheduleTask[]> {
  const { data, error } = await requireSupabase()
    .from('gantt_tasks')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('start_date', { ascending: true })
  if (error) throw error
  return data as ScheduleTask[]
}

export async function listDependencies(projectId: string): Promise<ScheduleDependency[]> {
  const { data, error } = await requireSupabase().from('gantt_dependencies').select('*').eq('project_id', projectId)
  if (error) throw error
  return data as ScheduleDependency[]
}

export interface NewTaskInput {
  project_id: string
  activity_code?: string | null
  name: string
  module?: string | null
  start_date: string
  end_date: string
  is_milestone?: boolean
  percent_complete?: number
  actual_start?: string | null
  actual_finish?: string | null
  assignee?: string | null
  color?: string | null
  notes?: string | null
  sort_order?: number
  created_by?: string | null
}

export async function createTask(payload: NewTaskInput): Promise<ScheduleTask> {
  const { data, error } = await requireSupabase()
    .from('gantt_tasks')
    .insert({
      project_id: payload.project_id,
      activity_code: payload.activity_code ?? null,
      name: payload.name,
      module: payload.module ?? null,
      start_date: payload.start_date,
      end_date: payload.end_date,
      is_milestone: payload.is_milestone ?? false,
      percent_complete: payload.percent_complete ?? 0,
      actual_start: payload.actual_start ?? null,
      actual_finish: payload.actual_finish ?? null,
      assignee: payload.assignee ?? null,
      color: payload.color ?? null,
      notes: payload.notes ?? null,
      sort_order: payload.sort_order ?? 0,
      created_by: payload.created_by ?? null,
    })
    .select('*')
    .single()
  if (error) rethrowFriendly(error)
  return data as ScheduleTask
}

export type TaskPatch = Partial<
  Pick<
    ScheduleTask,
    | 'activity_code'
    | 'name'
    | 'module'
    | 'sort_order'
    | 'start_date'
    | 'end_date'
    | 'is_milestone'
    | 'percent_complete'
    | 'actual_start'
    | 'actual_finish'
    | 'assignee'
    | 'color'
    | 'notes'
    | 'baseline_start'
    | 'baseline_end'
  >
>

export async function updateTask(id: string, patch: TaskPatch): Promise<ScheduleTask> {
  const { data, error } = await requireSupabase().from('gantt_tasks').update(patch).eq('id', id).select('*').single()
  if (error) rethrowFriendly(error)
  return data as ScheduleTask
}

/** Fire-and-collect updates for a set of tasks whose dates changed together (a drag that cascaded). */
export async function bulkUpdateTaskDates(
  updates: { id: string; start_date: string; end_date: string }[]
): Promise<void> {
  const client = requireSupabase()
  const results = await Promise.all(
    updates.map((u) => client.from('gantt_tasks').update({ start_date: u.start_date, end_date: u.end_date }).eq('id', u.id))
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await requireSupabase().from('gantt_tasks').delete().eq('id', id)
  if (error) throw error
}

export async function createDependency(payload: {
  project_id: string
  predecessor_id: string
  successor_id: string
  dep_type: DependencyType
  lag_days?: number
}): Promise<ScheduleDependency> {
  const { data, error } = await requireSupabase()
    .from('gantt_dependencies')
    .insert({
      project_id: payload.project_id,
      predecessor_id: payload.predecessor_id,
      successor_id: payload.successor_id,
      dep_type: payload.dep_type,
      lag_days: payload.lag_days ?? 0,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as ScheduleDependency
}

export async function updateDependency(
  id: string,
  patch: Partial<Pick<ScheduleDependency, 'dep_type' | 'lag_days'>>
): Promise<ScheduleDependency> {
  const { data, error } = await requireSupabase()
    .from('gantt_dependencies')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as ScheduleDependency
}

export async function deleteDependency(id: string): Promise<void> {
  const { error } = await requireSupabase().from('gantt_dependencies').delete().eq('id', id)
  if (error) throw error
}

/** Snapshots every task's current dates into its baseline (planned-vs-actual reporting). */
export async function setBaselineForAll(tasks: ScheduleTask[]): Promise<void> {
  const client = requireSupabase()
  const results = await Promise.all(
    tasks.map((t) =>
      client.from('gantt_tasks').update({ baseline_start: t.start_date, baseline_end: t.end_date }).eq('id', t.id)
    )
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error
}

export async function clearBaselineForAll(tasks: ScheduleTask[]): Promise<void> {
  const client = requireSupabase()
  const results = await Promise.all(
    tasks.map((t) => client.from('gantt_tasks').update({ baseline_start: null, baseline_end: null }).eq('id', t.id))
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error
}

// --- Saved PDF reports -------------------------------------------------------

export async function listReports(projectId: string): Promise<ScheduleReport[]> {
  const { data, error } = await requireSupabase()
    .from('gantt_reports')
    .select('*, gantt_app_users(full_name)')
    .eq('project_id', projectId)
    .order('generated_at', { ascending: false })
  if (error) throw error
  return (data as any[]).map((row) => {
    const { gantt_app_users, ...rest } = row
    return { ...rest, generated_by_name: gantt_app_users?.full_name ?? null }
  })
}

function reportStoragePath(fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${Date.now()}-${safeName}`
}

export async function saveReport(blob: Blob, fileName: string, projectId: string, note?: string): Promise<ScheduleReport> {
  const path = reportStoragePath(fileName)
  const client = requireSupabase()

  const { error: uploadError } = await client.storage.from(REPORTS_BUCKET).upload(path, blob, {
    contentType: 'application/pdf',
    upsert: false,
  })
  if (uploadError) throw uploadError

  const {
    data: { user },
  } = await client.auth.getUser()

  const { data, error } = await client
    .from('gantt_reports')
    .insert({ project_id: projectId, storage_path: path, file_name: fileName, note: note ?? null, generated_by: user?.id ?? null })
    .select('*')
    .single()
  if (error) throw error
  return data as ScheduleReport
}

export async function getReportSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await requireSupabase().storage.from(REPORTS_BUCKET).createSignedUrl(storagePath, 60 * 10)
  if (error) throw error
  return data.signedUrl
}

export async function deleteReport(id: string, storagePath: string): Promise<void> {
  const client = requireSupabase()
  const { error: storageError } = await client.storage.from(REPORTS_BUCKET).remove([storagePath])
  if (storageError) throw storageError
  const { error } = await client.from('gantt_reports').delete().eq('id', id)
  if (error) throw error
}
