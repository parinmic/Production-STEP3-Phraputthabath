import { NextRequest, NextResponse } from 'next/server'
import { supabase, externalSkillsSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const normalizeStation = (s: string) =>
  s.replace(/[()]/g, '').replace(/พิเศษ/g, '').replace(/\s+/g, ' ').trim()

function mapShift(raw: string): string {
  const s = raw.trim()
  if (s === 'กะ 14:00' || s === 'กะ 12:00') return 'กะ 2'
  if (s === '' || s === 'กะ 08:00') return 'กะ 1'
  console.warn(`sync-employee-skills: unrecognized shift value "${raw}", defaulting to กะ 1`)
  return 'กะ 1'
}

async function runSync() {
  try {
    const { data: rows, error: extErr } = await externalSkillsSupabase
      .from('employee_skills')
      .select('*')

    if (extErr) throw new Error(`External fetch: ${extErr.message}`)
    if (!rows?.length) return NextResponse.json({ success: true, inserted: 0, message: 'ไม่พบข้อมูลพนักงานจากต้นทาง' })

    const records = rows.map((row: Record<string, unknown>) => {
      const rawWorkStation = String(row['หน่วยงานย่อย'] ?? '').trim()
      const rawShift = String(row['กะ'] ?? '').trim()

      const skills: Record<string, number> = {}
      for (const [key, val] of Object.entries(row)) {
        if (!key.startsWith('กลุ่ม')) continue
        const level = Number(val ?? 0)
        if (level > 0) skills[key.replace(/_\d+$/, '').trim()] = level
      }

      return {
        emp_id:           String(row['Employee ID'] ?? '').trim(),
        name:             String(row['ชื่อ'] ?? '').trim(),
        department:       String(row['แผนก'] ?? '').trim() || null,
        work_station:     normalizeStation(rawWorkStation),
        shift:            mapShift(rawShift),
        day_off:          String(row['วันหยุด'] ?? '').trim() || null,
        is_weigher:       Number(row['ชั่งน้ำหนัก'] ?? 0) > 0,
        skills,
        raw_work_station: rawWorkStation || null,
        raw_shift:        rawShift || null,
      }
    }).filter(r => r.emp_id && r.name)

    // Full-replace: this table is always a same-day mirror of the external roster.
    const { error: delErr } = await supabase.from('employee_skills').delete().not('id', 'is', null)
    if (delErr) throw new Error(`Delete: ${delErr.message}`)

    if (records.length > 0) {
      const { error: insertErr } = await supabase.from('employee_skills').insert(records)
      if (insertErr) throw new Error(`Insert: ${insertErr.message}`)
    }

    return NextResponse.json({ success: true, inserted: records.length })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

// Called by Vercel cron (requires CRON_SECRET if set)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runSync()
}

// Called manually from UI (no auth required)
export async function POST() {
  return runSync()
}
