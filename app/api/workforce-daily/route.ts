import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET  ?date=YYYY-MM-DD  → rows for that date (all rounds)
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? ''
  if (!date) return NextResponse.json({ data: [] })
  const { data } = await supabase
    .from('daily_workforce')
    .select('emp_id, name, work_station, shift, upload_round')
    .eq('work_date', date)
  return NextResponse.json({ data: data ?? [] })
}

// PUT  body: { date, emp_id, name, work_station, shift, dept, scan_in, attendance_status, minutes_late }
export async function PUT(req: NextRequest) {
  try {
    const { date, emp_id, name, work_station, shift, dept, scan_in, attendance_status, minutes_late } = await req.json()
    if (!date || !emp_id || !name)
      return NextResponse.json({ error: 'missing fields' }, { status: 400 })

    await supabase.from('daily_workforce').delete()
      .eq('work_date', date).eq('emp_id', emp_id)

    const { error } = await supabase.from('daily_workforce').insert({
      work_date:      date,
      emp_id,
      name,
      work_station:   work_station || null,
      shift:          shift ?? 'กะ 1',
      home_dept:      dept || null,
      required_skill: `${scan_in ?? ''}|${attendance_status ?? ''}|${minutes_late ?? 0}|`,
      upload_round:   'manual',
    })
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// DELETE  ?date=YYYY-MM-DD&emp_id=XXX
export async function DELETE(req: NextRequest) {
  try {
    const date   = req.nextUrl.searchParams.get('date') ?? ''
    const emp_id = req.nextUrl.searchParams.get('emp_id') ?? ''
    if (!date || !emp_id)
      return NextResponse.json({ error: 'missing params' }, { status: 400 })
    await supabase.from('daily_workforce').delete()
      .eq('work_date', date).eq('emp_id', emp_id)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
