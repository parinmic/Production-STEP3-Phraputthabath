import { NextResponse } from 'next/server'
import { externalSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [yr, mo, dy] = today.split('-')
  const thaiDateNoPad  = `${Number(dy)}/${Number(mo)}/${Number(yr) + 543}`
  const thaiDatePadded = `${dy}/${mo}/${Number(yr) + 543}`

  // 1. ลอง query โดยไม่ filter date ก่อน — ดูว่า connect ได้ไหม
  const { data: sample, error: sampleErr } = await externalSupabase
    .from('timestamp_with_dept')
    .select('target_date, run_id, name, attendance_status')
    .order('created_at', { ascending: false })
    .limit(5)

  // 2. ลอง query ด้วย date format แบบไม่มี padding
  const { data: noPad, error: noPadErr } = await externalSupabase
    .from('timestamp_with_dept')
    .select('run_id, name')
    .eq('target_date', thaiDateNoPad)
    .limit(3)

  // 3. ลอง query ด้วย date format แบบมี padding
  const { data: padded, error: paddedErr } = await externalSupabase
    .from('timestamp_with_dept')
    .select('run_id, name')
    .eq('target_date', thaiDatePadded)
    .limit(3)

  return NextResponse.json({
    today_iso:          today,
    thaiDate_no_pad:    thaiDateNoPad,
    thaiDate_padded:    thaiDatePadded,
    sample_rows:        sample,
    sample_error:       sampleErr?.message ?? null,
    no_pad_rows:        noPad,
    no_pad_error:       noPadErr?.message ?? null,
    padded_rows:        padded,
    padded_error:       paddedErr?.message ?? null,
  })
}
