import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

export async function GET(req: NextRequest) {
  const round = req.nextUrl.searchParams.get('round')
  const tableName = round ? `daily_workforce_${round}` : 'daily_workforce'
  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
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

    const tableName = round ? `daily_workforce_${round}` : 'daily_workforce'
    const { data: logEntry, error: logErr } = await supabase
      .from('upload_log')
      .insert({ table_name: tableName, source_file: filename ?? 'unknown', record_count: records.length })
      .select('id')
      .single()
    if (logErr) throw logErr

    const recordsWithId = records.map((r: Record<string, unknown>) => ({ ...r, upload_log_id: logEntry.id }))
    const { error } = await supabase.from('daily_workforce').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', logEntry.id)
      throw error
    }

    await syncToDevAwaited(async (dev) => {
      const { data: devLog, error: devLogErr } = await dev
        .from('upload_log')
        .insert({ table_name: tableName, source_file: filename ?? 'unknown', record_count: records.length })
        .select('id')
        .single()
      if (devLogErr) throw devLogErr
      await batchInsert(dev, 'daily_workforce', records.map((r: Record<string, unknown>) => ({ ...r, upload_log_id: devLog.id })))
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
    const uploadLogId = req.nextUrl.searchParams.get('id')
    if (!uploadLogId) return NextResponse.json({ success: false, message: 'missing id' }, { status: 400 })
    // ON DELETE CASCADE removes daily_workforce rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
