// ---------------------------------------------------------------------------
// Domain model — mirrors supabase/01_schema.sql exactly.
// ---------------------------------------------------------------------------

export type AppRole = 'editor' | 'viewer'

export interface AppUser {
  id: string
  full_name: string
  email: string
  role: AppRole
  designation: string | null
  created_at: string
}

// v1.1: a project is a real row (gantt_projects), not the old
// gantt_project_info singleton — see supabase/05_v1_1_multiproject_and_controls.sql.
export type WorkCalendarDays = 5 | 6 | 7

export interface Project {
  id: string
  name: string
  location: string | null
  scope_of_work: string | null
  prepared_by_name: string | null
  prepared_by_title: string | null
  approved_by_name: string | null
  approved_by_title: string | null
  revision: string
  data_date: string | null
  target_completion: string | null
  work_calendar_days: WorkCalendarDays
  created_at: string
  updated_at: string
}

export type NewProjectInput = Pick<Project, 'name'> & Partial<Omit<Project, 'id' | 'name' | 'created_at' | 'updated_at'>>

export type ActivityStatus = 'Not Started' | 'In Progress' | 'Delayed' | 'Completed'

export type ScheduleHealth = 'on_track' | 'watch' | 'at_risk'

export const SCHEDULE_HEALTH_LABELS: Record<ScheduleHealth, string> = {
  on_track: 'On Track',
  watch: 'Watch',
  at_risk: 'At Risk',
}

// Start-to-Finish is intentionally not modeled — it's the one dependency
// type real construction schedules almost never use.
export type DependencyType = 'FS' | 'SS' | 'FF'

export const DEPENDENCY_TYPES: DependencyType[] = ['FS', 'SS', 'FF']

export const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = {
  FS: 'Finish-to-Start',
  SS: 'Start-to-Start',
  FF: 'Finish-to-Finish',
}

export interface ScheduleTask {
  id: string
  project_id: string
  activity_code: string | null
  name: string
  module: string | null
  sort_order: number
  start_date: string
  end_date: string
  is_milestone: boolean
  percent_complete: number
  baseline_start: string | null
  baseline_end: string | null
  actual_start: string | null
  actual_finish: string | null
  assignee: string | null
  color: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ScheduleDependency {
  id: string
  predecessor_id: string
  successor_id: string
  dep_type: DependencyType
  lag_days: number
}

export interface ScheduleReport {
  id: string
  storage_path: string
  file_name: string
  note: string | null
  generated_by: string | null
  generated_by_name?: string | null
  generated_at: string
}
