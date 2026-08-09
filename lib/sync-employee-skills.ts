import { supabase, externalSkillsSupabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

// production_user (external) uses inconsistent job_site labels for the same
// physical station, plus two labels that mix in a second station/process
// entirely. Mapping decided with the plant team:
//   - "ไหล่ / บด (พิเศษ)" workers actually work the หมูบด line, not ไหล่.
//   - "เผาขา/ต้มเลือด" is kept under เผาขา even though these workers' skills
//     (ไส้/เลือด/กระเพาะ) don't match the เผาขา product groups.
const JOB_SITE_MAP: Record<string, string> = {
  'เผาขา/ต้มเลือด':      'เผาขา',
  'เลาะขา':              'เลาะขา',
  'สไลด์ (เบสิ/พิเศษ)':   'สไลด์',
  'สะโพก(พิเศษ)':        'สะโพก',
  'สามชั้น(พิเศษ)':       'สามชั้น',
  'ไหล่ / บด (พิเศษ)':    'หมูบด',
  'ไหล่(พิเศษ)':         'ไหล่',
}

function normalizeJobSite(raw: string): string {
  if (!raw) return ''
  if (JOB_SITE_MAP[raw]) return JOB_SITE_MAP[raw]
  const fallback = raw.replace(/[()]/g, '').replace(/พิเศษ/g, '').replace(/\/.*$/, '').replace(/\s+/g, ' ').trim()
  console.warn(`sync-employee-skills: unrecognized job_site "${raw}", falling back to "${fallback}"`)
  return fallback
}

// work_date/shift_start may come back as a Postgres date/time string or as a
// raw numeric day-fraction (as seen in the reference export) — handle both.
function parseWorkDate(val: unknown): string | null {
  if (val == null) return null
  if (typeof val === 'number') {
    const ms = Math.round((val - 25569) * 86400 * 1000)
    return new Date(ms).toISOString().slice(0, 10)
  }
  const s = String(val).trim()
  if (!s) return null
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s
}

function parseShiftStartHour(val: unknown): number | null {
  if (val == null || val === '') return null
  if (typeof val === 'number') return val <= 1 ? val * 24 : val
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (m) return Number(m[1]) + Number(m[2]) / 60
  const n = Number(s)
  return isNaN(n) ? null : (n <= 1 ? n * 24 : n)
}

// กะ 1 = กะเช้า, กะ 2 = กะบ่าย — derived from shift_start (authoritative),
// since the raw `shift` label alone is inconsistent (e.g. "กะ 1" appears for
// both 08:00 and 09:00 starts in the source data).
function deriveShift(shiftStartHour: number | null, rawShiftLabel: string): string {
  if (shiftStartHour != null) return shiftStartHour < 12 ? 'กะ 1' : 'กะ 2'
  return rawShiftLabel.includes('2') ? 'กะ 2' : 'กะ 1'
}

interface GroupAcc {
  work_date: string
  emp_id: string
  name: string
  dept: string | null
  raw_job_site: string
  shift_start_hour: number | null
  raw_shift: string
  is_weigher: boolean
  skills: Record<string, number>
}

export interface SyncResult {
  success: boolean
  inserted?: number
  workDates?: string[]
  message?: string
  error?: string
}

const FETCH_BATCH = 1000

// production_user has grown well past PostgREST's default 1000-row response
// cap, and with no explicit ORDER BY, which rows land in an unpaginated
// select('*') is unspecified — so a plain single-page fetch silently drops
// an arbitrary subset of dates/stations instead of erroring. Page through
// with .range() so every row is always retrieved.
//
// Pages are independent range reads, so once we know the total count we fetch
// them all in parallel instead of waiting on each round-trip serially — this
// was the main reason Phase 1 generation (which syncs the roster first) was
// slow on a table with many pages.
async function fetchAllProductionUserRows(): Promise<Record<string, unknown>[]> {
  const { count, error: countErr } = await externalSkillsSupabase
    .from('production_user')
    .select('*', { count: 'exact', head: true })
  if (countErr) throw new Error(`External count: ${countErr.message}`)
  if (!count) return []

  const pageStarts: number[] = []
  for (let from = 0; from < count; from += FETCH_BATCH) pageStarts.push(from)

  const pages = await Promise.all(pageStarts.map(async from => {
    const { data, error } = await externalSkillsSupabase
      .from('production_user')
      .select('*')
      .range(from, from + FETCH_BATCH - 1)
    if (error) throw new Error(`External fetch (${from}): ${error.message}`)
    return data ?? []
  }))
  return pages.flat()
}

export async function runSync(): Promise<SyncResult> {
  try {
    const rows = await fetchAllProductionUserRows()

    if (!rows?.length) return { success: true, inserted: 0, message: 'ไม่พบข้อมูลพนักงานจากต้นทาง' }

    // production_user is long-format: one row per (work_date, emp_id, skill).
    // Group into one record per (work_date, emp_id).
    const groups = new Map<string, GroupAcc>()
    for (const row of rows as Record<string, unknown>[]) {
      const workDate = parseWorkDate(row['work_date'])
      const empId = String(row['emp_id'] ?? '').trim()
      if (!workDate || !empId) continue

      const key = `${workDate}|${empId}`
      let g = groups.get(key)
      if (!g) {
        g = {
          work_date: workDate,
          emp_id: empId,
          name: String(row['employee_name'] ?? '').trim(),
          dept: String(row['dept'] ?? '').trim() || null,
          raw_job_site: String(row['job_site'] ?? '').trim(),
          shift_start_hour: parseShiftStartHour(row['shift_start']),
          raw_shift: String(row['shift'] ?? '').trim(),
          is_weigher: false,
          skills: {},
        }
        groups.set(key, g)
      }

      const canDo = row['can_do'] === true || row['can_do'] === 'true' || row['can_do'] === 1
      const skillName = String(row['skill'] ?? '').trim()
      if (!skillName || !canDo) continue
      if (skillName === 'ชั่งน้ำหนัก') { g.is_weigher = true; continue }
      g.skills[skillName] = Number(row['level'] ?? 1)
    }

    const records = [...groups.values()]
      .filter(g => g.emp_id && g.name)
      .map(g => ({
        work_date:        g.work_date,
        emp_id:           g.emp_id,
        name:             g.name,
        department:       g.dept,
        work_station:     normalizeJobSite(g.raw_job_site),
        shift:            deriveShift(g.shift_start_hour, g.raw_shift),
        is_weigher:       g.is_weigher,
        skills:           g.skills,
        raw_work_station: g.raw_job_site || null,
        raw_shift:        g.raw_shift || null,
      }))

    // Full-replace scoped to whichever work_date(s) this batch covers —
    // leaves any other already-synced dates untouched. Deletes are on
    // independent dates, so run them in parallel rather than one at a time.
    const workDates = [...new Set(records.map(r => r.work_date))]
    const delResults = await Promise.all(
      workDates.map(wd => supabase.from('employee_skills').delete().eq('work_date', wd)),
    )
    for (let i = 0; i < delResults.length; i++) {
      if (delResults[i].error) throw new Error(`Delete (${workDates[i]}): ${delResults[i].error!.message}`)
    }

    if (records.length > 0) {
      const { error: insertErr } = await supabase.from('employee_skills').insert(records)
      if (insertErr) throw new Error(`Insert: ${insertErr.message}`)
    }

    // Mirror the same batch into dev so it always reflects production's real roster —
    // best-effort only (syncToDevAwaited swallows errors), never blocks the real sync.
    // Kept awaited (rather than fire-and-forget) because on serverless the function
    // can be frozen right after the response is sent, which would silently drop an
    // in-flight background write — the deletes below are parallelized instead to
    // keep this step itself fast.
    await syncToDevAwaited(async (dev) => {
      await Promise.all(workDates.map(wd => dev.from('employee_skills').delete().eq('work_date', wd)))
      if (records.length > 0) await batchInsert(dev, 'employee_skills', records)
    })

    return { success: true, inserted: records.length, workDates }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: msg }
  }
}
