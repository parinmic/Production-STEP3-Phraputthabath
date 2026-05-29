import { NextRequest, NextResponse } from 'next/server'
import { supabase, externalSupabase } from '@/lib/supabase'

function toThaiDate(iso: string): string {
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  return `${Number(parts[2])}/${Number(parts[1])}/${Number(parts[0]) + 543}`
}

const normName = (s: string) =>
  s ? s.replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase() : ''

const STATION_MAP: Record<string, string> = {
  'sa-phok-special': 'สะโพก',
  'sam-chan-special': 'สามชั้น',
  'lai-special':     'ไหล่',
}

async function buildStationLookup(): Promise<Map<string, string>> {
  const types = ['sa-phok-special', 'lai-special', 'sam-chan-special']
  const lookup = new Map<string, string>()

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

    const station = STATION_MAP[type] ?? type
    for (const row of weeklyData) {
      const rd = (row.row_data ?? {}) as Record<string, any>
      for (const key of ['รายชื่อพนักงาน', 'ชื่อจริง', 'ชื่อพนักงาน', 'ชื่อ', 'name', 'full_name']) {
        const val = rd[key]
        if (val) { lookup.set(normName(String(val)), station); break }
      }
    }
  }

  return lookup
}

export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get('date')
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const targetDate = toThaiDate(dateParam ?? today)

  const [attendanceResult, stationLookup] = await Promise.all([
    externalSupabase
      .from('timestamp_with_dept')
      .select('emp_id, name, dept, shift, shift_start, scan_in, attendance_status, minutes_late')
      .eq('target_date', targetDate)
      .order('dept')
      .order('name'),
    buildStationLookup(),
  ])

  if (attendanceResult.error)
    return NextResponse.json({ error: attendanceResult.error.message }, { status: 500 })

  const rows = (attendanceResult.data ?? []).map(r => ({
    ...r,
    station: stationLookup.get(normName(String(r.name ?? ''))) ?? null,
  }))

  const summary = {
    present: rows.filter(r => r.attendance_status === 'Present').length,
    late:    rows.filter(r => r.attendance_status === 'Late').length,
    absent:  rows.filter(r => r.attendance_status === 'Absent').length,
    total:   rows.length,
  }

  return NextResponse.json({ data: rows, summary })
}
