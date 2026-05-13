import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const round = req.nextUrl.searchParams.get('round')
  const tableName = round ? `daily_workforce_${round}` : 'daily_workforce'
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', tableName)
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const round = req.nextUrl.searchParams.get('round')
    const { rows, filename, workDate } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })
    if (!workDate) return NextResponse.json({ success: false, message: 'กรุณาระบุวันที่' }, { status: 400 })

    const records = rows.map((r: Record<string, unknown>) => ({
      work_date:      workDate,
      upload_round:   round ?? '0800',
      plan_id:        r['plan_id'] != null ? Number(r['plan_id']) : null,
      emp_id:         String(r['emp_id'] ?? '').trim(),
      name:           String(r['name'] ?? '').trim(),
      home_dept:      String(r['home_dept'] ?? '').trim() || null,
      target_dept:    String(r['target_dept'] ?? '').trim() || null,
      work_station:   String(r['work_station'] ?? '').trim() || null,
      shift:          String(r['shift'] ?? '').trim() || null,
      required_skill: String(r['required_skill'] ?? '').trim() || null,
      source_file:    filename ?? 'unknown',
    })).filter((r: { emp_id: string; name: string }) => r.emp_id && r.name)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ถูกต้อง (ต้องมี emp_id และ name)' }, { status: 400 })

    await supabase.from('daily_workforce')
      .delete()
      .eq('work_date', workDate)
      .eq('upload_round', round ?? '0800')

    const { error } = await supabase.from('daily_workforce').insert(records)
    if (error) throw error

    const tableName = round ? `daily_workforce_${round}` : 'daily_workforce'
    await supabase.from('upload_log').insert({
      table_name: tableName,
      source_file: filename ?? 'unknown',
      record_count: records.length,
    })

    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message
      : typeof e === 'object' && e !== null && 'message' in e ? String((e as {message:unknown}).message)
      : 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sourceFile = req.nextUrl.searchParams.get('file')
    const round      = req.nextUrl.searchParams.get('round')
    if (!sourceFile) return NextResponse.json({ success: false, message: 'missing file' }, { status: 400 })
    const tableName = round ? `daily_workforce_${round}` : 'daily_workforce'
    await supabase.from('daily_workforce').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', tableName).eq('source_file', sourceFile)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
