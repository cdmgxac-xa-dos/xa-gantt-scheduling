// ---------------------------------------------------------------------------
// Domain model — mirrors supabase/01_schema.sql exactly.
// ---------------------------------------------------------------------------

export type AppRole = 'editor' | 'viewer'

export interface AppUser {
  id: string
  full_name: string
  email: string
  role: AppRole
  created_at: string
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
  name: string
  module: string | null
  sort_order: number
  start_date: string
  end_date: string
  is_milestone: boolean
  percent_complete: number
  baseline_start: string | null
  baseline_end: string | null
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
