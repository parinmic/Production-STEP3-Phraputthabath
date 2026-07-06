import { NextRequest, NextResponse } from 'next/server'
import { supabase, externalSkillsSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

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

interface SyncResult {
  success: boolean
  inserted?: number
  workDates?: string[]
  message?: string
  error?: string
}

async function runSync(): Promise<SyncResult> {
  try {
    const { data: rows, error: extErr } = await externalSkillsSupabase
      .from('production_user')
      .select('*')

    if (extErr) throw new Error(`External fetch: ${extErr.message}`)
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
    // leaves any other already-synced dates untouched.
    const workDates = [...new Set(records.map(r => r.work_date))]
    for (const wd of workDates) {
      const { error: delErr } = await supabase.from('employee_skills').delete().eq('work_date', wd)
      if (delErr) throw new Error(`Delete (${wd}): ${delErr.message}`)
    }

    if (records.length > 0) {
      const { error: insertErr } = await supabase.from('employee_skills').insert(records)
      if (insertErr) throw new Error(`Insert: ${insertErr.message}`)
    }

    return { success: true, inserted: records.length, workDates }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: msg }
  }
}

// Fires right after a successful sync so Phase 1 always reflects the
// freshest roster for today — this is the only automatic Phase 1 trigger
// in the system, and it always fully overwrites any existing Phase 1 plan
// for today (disableMidRecal: true skips generatePlan's mid-day "keep
// already-started work" merge, which is only meant for manual re-runs
// during the day, not this from-scratch daily trigger).
async function triggerPhase1Generation(origin: string, authHeader: string | null) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  try {
    const res = await fetch(`${origin}/api/production/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify({ date: todayStr, phase: 1, deductMode: 'plan', disableMidRecal: true }),
    })
    const result = await res.json().catch(() => null)
    return { date: todayStr, ok: res.ok, result }
  } catch (e: unknown) {
    return { date: todayStr, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function runSyncAndGenerate(origin: string, authHeader: string | null) {
  const syncResult = await runSync()
  if (!syncResult.success) return { ...syncResult, phase1Generation: null }
  const phase1Generation = await triggerPhase1Generation(origin, authHeader)
  return { ...syncResult, phase1Generation }
}

// Called by Vercel cron (requires CRON_SECRET if set)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runSyncAndGenerate(req.nextUrl.origin, authHeader)
  return NextResponse.json(result, { status: result.success ? 200 : 500 })
}

// Called manually from UI (no auth required)
export async function POST(req: NextRequest) {
  const result = await runSyncAndGenerate(req.nextUrl.origin, req.headers.get('Authorization'))
  return NextResponse.json(result, { status: result.success ? 200 : 500 })
}
