import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncUploadToDev } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
    .eq('table_name', 'production_plan_100')
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
        plan_date:      String(r['plan_date'] ?? '').trim() || null,
        station:        String(r['station'] ?? '').trim(),
        seq:            Number(r['seq']) || null,
        step:           String(r['step'] ?? '').trim() || null,
        unix_code:      String(r['unix_code'] ?? '').trim() || null,
        sap:            String(r['sap'] ?? '').trim(),
        product_name:   String(r['product_name'] ?? '').trim() || null,
        weight_per_bag: Number(r['weight_per_bag']) || 0,
        qty_bags:       Number(r['qty_bags']) || 0,
        weight_total:   Number(r['weight_total']) || 0,
        lotus_bags:     Number(r['lotus_bags']) || 0,
        lotus_weight:   Number(r['lotus_weight']) || 0,
        cpft_bags:      Number(r['cpft_bags']) || 0,
        cpft_weight:    Number(r['cpft_weight']) || 0,
        makro_bags:     Number(r['makro_bags']) || 0,
        makro_weight:   Number(r['makro_weight']) || 0,
        source_file:    filename ?? 'unknown',
      }))
      .filter((r: { sap: string; station: string }) => r.sap && r.station)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ถูกต้อง' }, { status: 400 })

    const planDate = records[0].plan_date

    const uploadLogId = crypto.randomUUID()
    const { error: logErr } = await supabase
      .from('upload_log')
      .insert({ id: uploadLogId, table_name: 'production_plan_100', source_file: filename ?? 'unknown', record_count: records.length })
    if (logErr) throw logErr

    const recordsWithId = records.map((r: Record<string, unknown>) => ({ ...r, upload_log_id: uploadLogId }))
    const { error } = await supabase.from('production_plan_100').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', uploadLogId)
      throw error
    }

    await syncUploadToDev('production_plan_100', filename ?? 'unknown', records)

    // Fire-and-forget Phase 3 auto-gen (runs in its own serverless function to avoid timeout)
    if (planDate) {
      fetch(`${req.nextUrl.origin}/api/auto-generate-phase3`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: planDate }),
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ (วันที่ ${planDate ?? 'ไม่ระบุ'})` })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const uploadLogId = req.nextUrl.searchParams.get('id')
    if (!uploadLogId) return NextResponse.json({ success: false, message: 'missing id' }, { status: 400 })
    // ON DELETE CASCADE removes production_plan_100 rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
