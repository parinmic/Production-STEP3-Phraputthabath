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

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization')
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    const bangkokHour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false }))
    const uploadRound = bangkokHour < 12 ? '0930' : '1530'

    const [yr, mo, dy] = today.split('-')
    const thaiDate = `${Number(dy)}/${Number(mo)}/${Number(yr) + 543}`

    // 1. Fetch Present + Late from external Supabase
    const { data: attendance, error: extErr } = await externalSupabase
      .from('timestamp_with_dept')
      .select('emp_id, name, shift, attendance_status')
      .eq('target_date', thaiDate)
      .in('attendance_status', ['Present', 'Late'])

    if (extErr) throw new Error(`External fetch: ${extErr.message}`)
    if (!attendance?.length) {
      return NextResponse.json({ success: true, round: uploadRound, inserted: 0, message: 'ไม่มีข้อมูล Attendance วันนี้' })
    }

    // 2. Build present-worker map
    const presentMap = new Map<string, { empId: string; shift: string }>()
    for (const a of attendance) {
      const key = normName(String(a.name ?? ''))
      if (key) presentMap.set(key, { empId: String(a.emp_id ?? a.name), shift: String(a.shift ?? '') })
    }

    // 3. Match with workforce_weekly to resolve stations
    const types = ['sa-phok-special', 'lai-special', 'sam-chan-special']
    const stationMap: Record<string, string> = {
      'sa-phok-special': 'สะโพกพิเศษ',
      'sam-chan-special': 'สามชั้นพิเศษ',
      'lai-special':     'ไหล่พิเศษ',
    }

    const records: {
      work_date: string; emp_id: string; name: string
      work_station: string; shift: string; upload_round: string
    }[] = []
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
        const info = presentMap.get(key)
        if (!info) continue
        seen.add(key)
        records.push({
          work_date:    today,
          emp_id:       info.empId,
          name,
          work_station: stationMap[type] ?? type,
          shift:        info.shift === 'กะ 2' ? 'กะ 2' : 'กะ 1',
          upload_round: uploadRound,
        })
      }
    }

    // 4. Fallback: match unmatched attendance workers against Mas Job Assign
    const unmatched = [...presentMap.keys()].filter(k => !seen.has(k))
    if (unmatched.length > 0) {
      const { data: manpowerRows } = await supabase
        .from('master_logic_manpower')
        .select('product_type, row_data')

      for (const row of manpowerRows ?? []) {
        const rd = (row.row_data ?? {}) as Record<string, any>
        const name = String(rd['รายชื่อพนักงาน'] ?? '').trim()
        if (!name) continue
        const key = normName(name)
        if (seen.has(key) || !unmatched.includes(key)) continue
        const info = presentMap.get(key)
        if (!info) continue
        seen.add(key)
        records.push({
          work_date:    today,
          emp_id:       info.empId,
          name,
          work_station: String(row.product_type ?? ''),
          shift:        info.shift === 'กะ 2' ? 'กะ 2' : 'กะ 1',
          upload_round: uploadRound,
        })
      }
    }

    // 5. Replace old records for this round, insert new ones
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
