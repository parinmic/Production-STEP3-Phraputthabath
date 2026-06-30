import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncUploadToDev } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
    .eq('table_name', 'picking_unit_master_basic')
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
        step:            String(r['step']      ?? '').trim() || null,
        unix_code:       String(r['unix_code'] ?? '').trim() || null,
        sap:             String(r['sap'] ?? '').trim(),
        product_name:    String(r['product_name'] ?? '').trim() || null,
        weight_per_bag:  Number(r['weight_per_bag']) || 0,
        unit:            String(r['unit'] ?? '').trim() || 'ถุง',
        mins_per_basket: r['mins_per_basket'] != null && r['mins_per_basket'] !== '' ? Number(r['mins_per_basket']) || null : null,
        source_file:     filename ?? 'unknown',
      }))
      .filter((r: { sap: string }) => r.sap)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ถูกต้อง' }, { status: 400 })

    const uploadLogId = crypto.randomUUID()
    const { error: logErr } = await supabase
      .from('upload_log')
      .insert({ id: uploadLogId, table_name: 'picking_unit_master_basic', source_file: filename ?? 'unknown', record_count: records.length })
    if (logErr) throw logErr

    const recordsWithId = records.map((r: Record<string, unknown>) => ({ ...r, upload_log_id: uploadLogId }))
    const { error } = await supabase.from('picking_unit_master_basic').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', uploadLogId)
      throw error
    }

    await syncUploadToDev('picking_unit_master_basic', filename ?? 'unknown', records)
    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message
      : typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message)
      : 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const uploadLogId = req.nextUrl.searchParams.get('id')
    if (!uploadLogId) return NextResponse.json({ success: false, message: 'missing id' }, { status: 400 })
    // ON DELETE CASCADE removes picking_unit_master_basic rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
