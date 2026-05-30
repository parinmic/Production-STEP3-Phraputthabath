import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

function activeRound(dateStr: string): string {
  // Determine which cron round is active for a given date (Bangkok time)
  const now = new Date()
  const bangkokNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  const today = bangkokNow.toLocaleDateString('sv-SE')

  // For past dates always return 1530 (latest)
  if (dateStr < today) return '1530'

  const h = bangkokNow.getHours()
  const m = bangkokNow.getMinutes()
  const totalMins = h * 60 + m

  if (totalMins >= 15 * 60 + 30) return '1530'
  if (totalMins >= 9 * 60 + 30)  return '0930'
  return '' // before first sync
}

export async function GET(req: NextRequest) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const dateParam = req.nextUrl.searchParams.get('date') ?? today
  const round = activeRound(dateParam)

  if (!round) {
    return NextResponse.json({ data: [], summary: { present: 0, late: 0, absent: 0, total: 0 }, message: 'ยังไม่ถึงเวลา Sync (9:30)' })
  }

  // Read cron snapshot + manual overrides in parallel
  const [{ data: wfRows, error }, { data: manualRows }] = await Promise.all([
    supabase.from('daily_workforce')
      .select('emp_id, name, home_dept, work_station, shift, required_skill')
      .eq('work_date', dateParam).eq('upload_round', round)
      .order('home_dept').order('name'),
    supabase.from('daily_workforce')
      .select('emp_id, name, home_dept, work_station, shift, required_skill')
      .eq('work_date', dateParam).eq('upload_round', 'manual'),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Build manual override map (emp_id → row)
  const manualMap = new Map<string, typeof manualRows extends (infer T)[] | null ? T : never>()
  for (const r of manualRows ?? []) manualMap.set(r.emp_id, r)

  const parseRow = (r: { emp_id: string; name: string; home_dept: string | null; work_station: string | null; shift: string | null; required_skill: string | null }) => {
    const parts = String(r.required_skill ?? '').split('|')
    return {
      emp_id:            r.emp_id,
      name:              r.name,
      dept:              r.home_dept ?? '',
      shift:             r.shift ?? '',
      shift_start:       parts[3] ?? '',
      scan_in:           parts[0] ?? '',
      attendance_status: parts[1] ?? '',
      minutes_late:      Number(parts[2] ?? 0),
      station:           r.work_station || null,
    }
  }

  const rows = (wfRows ?? []).map(r => {
    const override = manualMap.get(r.emp_id)
    return parseRow(override ?? r)
  })

  const summary = {
    present: rows.filter(r => r.attendance_status === 'Present').length,
    late:    rows.filter(r => r.attendance_status === 'Late').length,
    absent:  rows.filter(r => r.attendance_status === 'Absent').length,
    total:   rows.length,
  }

  return NextResponse.json({ data: rows, summary, round })
}
