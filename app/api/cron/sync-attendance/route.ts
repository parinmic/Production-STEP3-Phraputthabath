import { NextRequest, NextResponse } from 'next/server'
import { supabase, externalSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const normName = (s: string) =>
  s ? s.replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase() : ''

const getFieldVal = (rowData: Record<string, any>, prefixes: string[]): string => {
  for (const p of prefixes) {
    if (rowData[p] != null) return String(rowData[p]).trim()
  }
  const keys = Object.keys(rowData)
  for (const p of prefixes) {
    const k = keys.find(k => k.toLowerCase().includes(p.toLowerCase()))
    if (k && rowData[k] != null) return String(rowData[k]).trim()
  }
  return ''
}

async function runSync() {
  try {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    const bangkokHour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false }))
    const uploadRound = bangkokHour < 12 ? '0930' : '1530'

    const [yr, mo, dy] = today.split('-')
    const thaiDate = `${Number(mo)}/${Number(dy)}/${Number(yr) + 543}`

    // 1. Find latest run_id for this date
    const { data: latestRun, error: runErr } = await externalSupabase
      .from('timestamp_with_dept')
      .select('run_id')
      .eq('target_date', thaiDate)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (runErr) throw new Error(`External fetch run_id: ${runErr.message}`)
    if (!latestRun?.run_id) {
      return NextResponse.json({ success: true, round: uploadRound, inserted: 0, message: 'ไม่มีข้อมูล Attendance วันนี้' })
    }

    // 2. Fetch ALL attendance records from latest run only
    const { data: allAttendance, error: extErr } = await externalSupabase
      .from('timestamp_with_dept')
      .select('emp_id, name, dept, shift, shift_start, scan_in, attendance_status, minutes_late')
      .eq('target_date', thaiDate)
      .eq('run_id', latestRun.run_id)

    if (extErr) throw new Error(`External fetch: ${extErr.message}`)
    if (!allAttendance?.length) {
      return NextResponse.json({ success: true, round: uploadRound, inserted: 0, message: 'ไม่มีข้อมูล Attendance วันนี้' })
    }

    // 2. Build map of Present+Late workers for station resolution
    const presentMap = new Map<string, { empId: string; shift: string; dept: string; scanIn: string; status: string; minsLate: number }>()
    for (const a of allAttendance) {
      if (a.attendance_status !== 'Present' && a.attendance_status !== 'Late') continue
      const key = normName(String(a.name ?? ''))
      if (key) presentMap.set(key, {
        empId:    String(a.emp_id ?? a.name),
        shift:    String(a.shift ?? ''),
        dept:     String(a.dept ?? ''),
        scanIn:   String(a.scan_in ?? ''),
        status:   String(a.attendance_status ?? ''),
        minsLate: Number(a.minutes_late ?? 0),
      })
    }

    // 3. Resolve station for Present+Late via workforce_weekly
    const types = ['sa-phok-special', 'lai-special', 'sam-chan-special']
    const stationMap: Record<string, string> = {
      'sa-phok-special': 'สะโพกพิเศษ',
      'sam-chan-special': 'สามชั้นพิเศษ',
      'lai-special':     'ไหล่พิเศษ',
    }

    // stationResolved: normName → work_station
    const stationResolved = new Map<string, string>()
    const seen = new Set<string>()

    for (const type of types) {
      const logTable = `workforce_weekly_${type.replace(/-/g, '_')}`
      const { data: latestLog } = await supabase
        .from('upload_log').select('source_file')
        .eq('table_name', logTable)
        .order('uploaded_at', { ascending: false }).limit(1).maybeSingle()
      if (!latestLog) continue

      const { data: weeklyData } = await supabase
        .from('workforce_weekly').select('row_data')
        .eq('weekly_type', type).eq('source_file', latestLog.source_file)
      if (!weeklyData) continue

      for (const row of weeklyData) {
        const rd = (row.row_data ?? {}) as Record<string, any>
        const name = getFieldVal(rd, ['รายชื่อพนักงาน', 'ชื่อจริง', 'ชื่อพนักงาน', 'ชื่อ', 'name', 'full_name'])
        if (!name) continue
        const key = normName(name)
        if (seen.has(key)) continue
        if (!presentMap.has(key)) continue
        seen.add(key)
        stationResolved.set(key, stationMap[type] ?? type)
      }
    }

    // 4. Fallback: Mas Job Assign for unmatched Present+Late
    const unmatched = [...presentMap.keys()].filter(k => !seen.has(k))
    if (unmatched.length > 0) {
      const { data: manpowerRows } = await supabase
        .from('master_logic_manpower').select('product_type, row_data')
      for (const row of manpowerRows ?? []) {
        const rd = (row.row_data ?? {}) as Record<string, any>
        const name = String(rd['รายชื่อพนักงาน'] ?? '').trim()
        if (!name) continue
        const key = normName(name)
        if (seen.has(key) || !unmatched.includes(key)) continue
        const info = presentMap.get(key)
        if (!info) continue
        seen.add(key)
        stationResolved.set(key, String(row.product_type ?? ''))
      }
    }

    // 5. Build records for ALL attendance rows
    const records = allAttendance.map(a => {
      const key     = normName(String(a.name ?? ''))
      const station = stationResolved.get(key) ?? null
      return {
        work_date:      today,
        emp_id:         String(a.emp_id ?? a.name),
        name:           String(a.name ?? ''),
        home_dept:      String(a.dept ?? ''),
        work_station:   station ?? '',
        shift:          String(a.shift ?? ''),
        required_skill: `${a.scan_in ?? ''}|${a.attendance_status ?? ''}|${a.minutes_late ?? 0}|${a.shift_start ?? ''}`,
        upload_round:   uploadRound,
      }
    }).filter(r => r.name)

    // 6. Replace old records for this round, insert new ones
    await supabase.from('daily_workforce')
      .delete().eq('work_date', today).eq('upload_round', uploadRound)

    if (records.length > 0) {
      const { error: insertErr } = await supabase.from('daily_workforce').insert(records)
      if (insertErr) throw new Error(`Insert: ${insertErr.message}`)
    }

    return NextResponse.json({ success: true, round: uploadRound, date: today, inserted: records.length })
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
