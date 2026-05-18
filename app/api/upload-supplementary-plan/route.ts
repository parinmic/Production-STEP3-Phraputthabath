import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data: logs } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'production_plan_supplementary')
    .order('uploaded_at', { ascending: false })
    .limit(20)

  // Fetch loading_time/deadline_time from the first record of each batch
  const uploads = await Promise.all((logs ?? []).map(async r => {
    const { data: rec } = await supabase
      .from('production_plan_supplementary')
      .select('loading_time, deadline_time')
      .eq('source_file', r.source_file)
      .limit(1)
      .maybeSingle()
    return {
      source_file:   r.source_file,
      record_count:  r.record_count,
      uploaded_at:   r.uploaded_at,
      loading_time:  rec?.loading_time ?? null,
      deadline_time: rec?.deadline_time ?? null,
    }
  }))

  return NextResponse.json({ uploads })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename, loading_time, deadline_time } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })
    if (!loading_time) return NextResponse.json({ success: false, message: 'กรุณาระบุเวลาโหลดจ่าย' }, { status: 400 })

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
        loading_time:   loading_time,
        deadline_time:  deadline_time,
        source_file:    filename ?? 'unknown',
      }))
      .filter((r: { sap: string; station: string }) => r.sap && r.station)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ถูกต้อง' }, { status: 400 })

    const planDate = records[0].plan_date
    if (planDate) {
      await supabase
        .from('production_plan_supplementary')
        .delete()
        .eq('plan_date', planDate)
        .eq('loading_time', loading_time)
    }

    const { error } = await supabase.from('production_plan_supplementary').insert(records)
    if (error) throw error

    await supabase.from('upload_log').insert({
      table_name:   'production_plan_supplementary',
      source_file:  filename ?? 'unknown',
      record_count: records.length,
    })

    return NextResponse.json({
      success: true,
      message: `บันทึกสำเร็จ ${records.length} รายการ — โหลดจ่าย ${loading_time} น. (deadline ${deadline_time} น.)`,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sourceFile = req.nextUrl.searchParams.get('file')
    if (!sourceFile) return NextResponse.json({ success: false, message: 'missing file' }, { status: 400 })
    await supabase.from('production_plan_supplementary').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', 'production_plan_supplementary').eq('source_file', sourceFile)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
