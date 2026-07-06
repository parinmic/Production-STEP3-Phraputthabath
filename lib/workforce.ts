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

// ========== Day-off matching ==========
// employee_skills.day_off stores a bare Thai weekday abbreviation (จ/อ/พ/พฤ/ศ/ส/อา).
// Exact-match only — do not use .includes(), since 'พ' is a prefix of 'พฤ'.

export const THAI_DAY_CODE: Record<string, string> = {
  'อาทิตย์':  'อา',
  'จันทร์':   'จ',
  'อังคาร':   'อ',
  'พุธ':      'พ',
  'พฤหัสบดี': 'พฤ',
  'ศุกร์':    'ศ',
  'เสาร์':    'ส',
}

const THAI_WEEKDAY_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']

export function isDayOff(dayOffRaw: string | null | undefined, productionDate: string): boolean {
  if (!dayOffRaw) return false
  const parts = productionDate.split('-')
  if (parts.length !== 3) return false
  const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  const weekdayName = THAI_WEEKDAY_NAMES[dateObj.getDay()]
  return dayOffRaw.trim() === THAI_DAY_CODE[weekdayName]
}

// ========== Fetch ==========

interface EmployeeSkillRow {
  emp_id: string
  name: string
  work_station: string | null
  shift: string | null
  day_off: string | null
  is_weigher: boolean
  skills: Record<string, number> | null
}

export async function fetchWorkforceAndSkills(productionDate: string): Promise<{
  workforce: WorkforceRow[]
  jobAssignMap: JobAssignMap
}> {
  const { data } = await supabase
    .from('employee_skills')
    .select('emp_id, name, work_station, shift, day_off, is_weigher, skills')

  const workforce: WorkforceRow[] = []
  const jobAssignMap: JobAssignMap = new Map()

  for (const row of (data ?? []) as EmployeeSkillRow[]) {
    if (!row.name || isDayOff(row.day_off, productionDate)) continue

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

  return { workforce, jobAssignMap }
}
