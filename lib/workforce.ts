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

export async function fetchWorkforceAndSkills(productionDate: string, options?: {
  // Emergency fallback: if today's roster hasn't been synced yet, fall back to
  // the most recent prior work_date that does have data instead of failing.
  fallbackToPreviousDay?: boolean
}): Promise<{
  workforce: WorkforceRow[]
  jobAssignMap: JobAssignMap
  workDateUsed: string
}> {
  let workDateUsed = productionDate
  let data = (await supabase
    .from('employee_skills')
    .select('emp_id, name, work_station, shift, is_weigher, skills')
    .eq('work_date', productionDate)).data

  if (!data?.length && options?.fallbackToPreviousDay) {
    const { data: prevDateRow } = await supabase
      .from('employee_skills')
      .select('work_date')
      .lt('work_date', productionDate)
      .order('work_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (prevDateRow?.work_date) {
      workDateUsed = prevDateRow.work_date
      data = (await supabase
        .from('employee_skills')
        .select('emp_id, name, work_station, shift, is_weigher, skills')
        .eq('work_date', workDateUsed)).data
    }
  }

  const workforce: WorkforceRow[] = []
  const jobAssignMap: JobAssignMap = new Map()

  for (const row of (data ?? []) as EmployeeSkillRow[]) {
    if (!row.name) continue

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

  return { workforce, jobAssignMap, workDateUsed }
}
