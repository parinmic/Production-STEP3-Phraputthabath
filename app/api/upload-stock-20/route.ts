import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
    .eq('table_name', 'stock_20')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const records = rows
      .map((r: Record<string, unknown>) => ({
        material_code: String(r['รหัสสินค้า'] ?? '').trim(),
        material_name: String(r['ชื่อสินค้า'] ?? '').trim(),
        spec_code:     String(r['รหัส Spec']  ?? '').trim(),
        qty_1:         Number(r['ปริมาณ_1']   ?? 0),
        weight_1:      Number(r['น้าหนัก_1']  ?? 0),
        qty_2:         Number(r['ปริมาณ_2']   ?? 0),
        weight_2:      Number(r['น้าหนัก_2']  ?? 0),
        qty_3:         Number(r['ปริมาณ_3']   ?? 0),
        weight_3:      Number(r['น้าหนัก_3']  ?? 0),
        qty_total:     Number(r['ปริมาณรวม']  ?? 0),
        weight_total:  Number(r['น้าหนักรวม'] ?? 0),
        unit:          String(r['หน่วย']       ?? '').trim(),
        source_file:   filename ?? 'unknown',
      }))
      .filter((r: { spec_code: string }) => r.spec_code)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ถูกต้อง' }, { status: 400 })

    // Insert upload_log first to get the batch id
    const { data: logEntry, error: logErr } = await supabase
      .from('upload_log')
      .insert({ table_name: 'stock_20', source_file: filename ?? 'unknown', record_count: records.length })
      .select('id')
      .single()
    if (logErr) throw logErr

    // Insert records tagged with upload_log_id — no delete before insert
    const recordsWithId = records.map(r => ({ ...r, upload_log_id: logEntry.id }))
    const { error } = await supabase.from('stock_20').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', logEntry.id)
      throw error
    }

    // Sync to dev: create its own upload_log entry (separate id) then insert
    await syncToDevAwaited(async (dev) => {
      const { data: devLog, error: devLogErr } = await dev
        .from('upload_log')
        .insert({ table_name: 'stock_20', source_file: filename ?? 'unknown', record_count: records.length })
        .select('id')
        .single()
      if (devLogErr) throw devLogErr
      await batchInsert(dev, 'stock_20', records.map(r => ({ ...r, upload_log_id: devLog.id })))
    })

    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const uploadLogId = req.nextUrl.searchParams.get('id')
    if (!uploadLogId) return NextResponse.json({ success: false, message: 'missing id' }, { status: 400 })
    // ON DELETE CASCADE removes stock_20 rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
