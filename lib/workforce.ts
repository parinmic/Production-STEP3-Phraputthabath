import { supabase } from '@/lib/supabase'

// ========== Types ==========
// Shared by lib/generate-plan.ts and app/api/production/generate-supplementary/route.ts
// so both plan generators read workforce/skill data the same way.

export interface WorkforceRow {
  emp_id: string
  name: string
  work_station: string
  shift: string
}

export interface JobAssignEntry {
  isWeigher: boolean
  groups: Map<string, number>
}

export type JobAssignMap = Map<string, JobAssignEntry>

// ========== Name normalizer ==========

export const normName = (s: string) => {
  if (!s) return ''
  return s.replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}

// ========== Fetch ==========
// employee_skills is a per-date mirror of the external production_user roster
// (see app/api/cron/sync-employee-skills) — a person simply has no row for a
// given work_date if they're not scheduled that day, so no separate day-off
// check is needed here.

interface EmployeeSkillRow {
  emp_id: string
  name: string
  work_station: string | null
  shift: string | null
  is_weigher: boolean
  skills: Record<string, number> | null
}

// The 7 production stations plan generation assigns workers to (see supabase.ts TableName).
const ALL_STATIONS = ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์', 'เผาขา', 'เลาะขา']

export async function fetchWorkforceAndSkills(productionDate: string, options?: {
  // Emergency fallback: a partial roster sync can leave individual stations with zero
  // workers today even though other stations are fine (e.g. source hasn't entered today's
  // shift for that job_site yet). Rather than an all-or-nothing swap to one prior day, back
  // each empty station independently from the most recent prior work_date that has workers
  // for it — may be 1, 2, 3+ days back per station, whatever is most recent.
  fallbackToPreviousDay?: boolean
}): Promise<{
  workforce: WorkforceRow[]
  jobAssignMap: JobAssignMap
  workDateUsed: string
  stationFallbackDates: Record<string, string>
}> {
  const workforce: WorkforceRow[] = []
  const jobAssignMap: JobAssignMap = new Map()
  const stationFallbackDates: Record<string, string> = {}

  const pushRow = (row: EmployeeSkillRow) => {
    if (!row.name) return
    workforce.push({
      emp_id: row.emp_id || row.name,
      name: row.name,
      work_station: row.work_station ?? '',
      shift: row.shift ?? '',
    })
    const groups = new Map<string, number>()
    for (const [key, val] of Object.entries(row.skills ?? {})) {
      const level = Number(val)
      if (level > 0) groups.set(key, level)
    }
    jobAssignMap.set(normName(row.name), { isWeigher: row.is_weigher, groups })
  }

  const { data: todayRows } = await supabase
    .from('employee_skills')
    .select('emp_id, name, work_station, shift, is_weigher, skills')
    .eq('work_date', productionDate)

  const stationsPresent = new Set<string>()
  for (const row of (todayRows ?? []) as EmployeeSkillRow[]) {
    pushRow(row)
    if (row.work_station) stationsPresent.add(row.work_station)
  }

  if (options?.fallbackToPreviousDay) {
    const missingStations = ALL_STATIONS.filter(s => !stationsPresent.has(s))
    if (missingStations.length > 0) {
      const { data: priorRows } = await supabase
        .from('employee_skills')
        .select('work_date, emp_id, name, work_station, shift, is_weigher, skills')
        .lt('work_date', productionDate)
        .in('work_station', missingStations)
        .order('work_date', { ascending: false })
        .limit(3000)

      // Rows come back newest-first, so the first row seen per station is its most recent
      // available date — take every row from exactly that date for that station.
      const latestDateByStation = new Map<string, string>()
      for (const row of (priorRows ?? []) as (EmployeeSkillRow & { work_date: string })[]) {
        const station = row.work_station ?? ''
        if (!latestDateByStation.has(station)) latestDateByStation.set(station, row.work_date)
      }
      for (const row of (priorRows ?? []) as (EmployeeSkillRow & { work_date: string })[]) {
        const station = row.work_station ?? ''
        if (latestDateByStation.get(station) === row.work_date) {
          pushRow(row)
          stationFallbackDates[station] = row.work_date
        }
      }
    }
  }

  return { workforce, jobAssignMap, workDateUsed: productionDate, stationFallbackDates }
}
