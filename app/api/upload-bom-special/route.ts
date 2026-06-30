import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'bom_special')
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
        product_code:     String(r['product_code']     ?? '').trim() || null,
        product_sap:      String(r['product_sap']      ?? '').trim(),
        product_name:     String(r['product_name']     ?? '').trim() || null,
        raw_code:         String(r['raw_code']         ?? '').trim() || null,
        raw_sap:          String(r['raw_sap']          ?? '').trim(),
        raw_name:         String(r['raw_name']         ?? '').trim() || null,
        weight_condition: String(r['weight_condition'] ?? '').trim(),
        yield_pct:        Number(r['yield_pct']) || 0,
      }))
      .filter((r: { product_sap: string; raw_sap: string; weight_condition: string }) => r.product_sap && r.raw_sap && r.weight_condition)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ถูกต้อง' }, { status: 400 })

    await supabase.from('bom_special').delete().gte('id', 1)
    const { error } = await supabase.from('bom_special').insert(records)
    if (error) throw new Error(error.message ?? JSON.stringify(error))

    await supabase.from('upload_log').delete().eq('table_name', 'bom_special')
    await supabase.from('upload_log').insert({
      table_name: 'bom_special',
      source_file: filename ?? 'unknown',
      record_count: records.length,
    })

    await syncToDevAwaited(async (dev) => {
      await dev.from('bom_special').delete().gte('id', 1)
      await batchInsert(dev, 'bom_special', records)
    })
    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sourceFile = req.nextUrl.searchParams.get('file')
    if (!sourceFile) return NextResponse.json({ success: false, message: 'missing file' }, { status: 400 })
    await supabase.from('bom_special').delete().gte('id', 1)
    await supabase.from('upload_log').delete().eq('table_name', 'bom_special').eq('source_file', sourceFile)
    await syncToDevAwaited(async (dev) => {
      await dev.from('bom_special').delete().gte('id', 1)
    })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
