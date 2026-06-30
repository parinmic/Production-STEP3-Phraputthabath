import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
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

    // Delete existing data for the same plan_date before inserting
    const planDate = records[0].plan_date
    if (planDate) {
      const { error: delErr } = await supabase
        .from('production_plan_100')
        .delete()
        .eq('plan_date', planDate)
      if (delErr) throw delErr
    }

    const { error } = await supabase.from('production_plan_100').insert(records)
    if (error) throw error

    await supabase.from('upload_log').insert({
      table_name:   'production_plan_100',
      source_file:  filename ?? 'unknown',
      record_count: records.length,
    })

    await syncToDevAwaited(async (dev) => {
      if (planDate) await dev.from('production_plan_100').delete().eq('plan_date', planDate)
      await batchInsert(dev, 'production_plan_100', records)
    })

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
    const sourceFile = req.nextUrl.searchParams.get('file')
    if (!sourceFile) return NextResponse.json({ success: false, message: 'missing file' }, { status: 400 })
    await supabase.from('production_plan_100').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', 'production_plan_100').eq('source_file', sourceFile)
    await syncToDevAwaited(async (dev) => {
      await dev.from('production_plan_100').delete().eq('source_file', sourceFile)
    })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
