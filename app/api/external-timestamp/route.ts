import { NextRequest, NextResponse } from 'next/server'
import { externalSupabase } from '@/lib/supabase'

function toThaiDate(iso: string): string {
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  return `${Number(parts[2])}/${Number(parts[1])}/${Number(parts[0]) + 543}`
}

export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get('date')
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const targetDate = toThaiDate(dateParam ?? today)

  const { data, error } = await externalSupabase
    .from('timestamp_with_dept')
    .select('emp_id, name, dept, shift, shift_start, scan_in, attendance_status, minutes_late')
    .eq('target_date', targetDate)
    .order('dept')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []
  const summary = {
    present: rows.filter(r => r.attendance_status === 'Present').length,
    late:    rows.filter(r => r.attendance_status === 'Late').length,
    absent:  rows.filter(r => r.attendance_status === 'Absent').length,
    total:   rows.length,
  }

  return NextResponse.json({ data: rows, summary })
}
