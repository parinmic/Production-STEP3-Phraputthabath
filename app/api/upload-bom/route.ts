import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'bom_items')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const records = rows.map((r: Record<string, unknown>) => ({
      pg:           Number(r['pg']) || 0,
      pg_name:      String(r['pg_name'] ?? '').trim(),
      product_code: String(r['product_code'] ?? '').trim() || null,
      product_sap:  String(r['product_sap'] ?? '').trim(),
      product_name: String(r['product_name'] ?? '').trim() || null,
      raw_code:     String(r['raw_code'] ?? '').trim() || null,
      raw_sap:      String(r['raw_sap'] ?? '').trim() || null,
      raw_name:     String(r['raw_name'] ?? '').trim() || null,
      yield_pct:    Number(r['yield_pct']) || 0,
      loss_pct:     Number(r['loss_pct']) || 0,
      by_products:  (() => { try { return JSON.parse(String(r['by_products_json'] ?? '[]')) } catch { return [] } })(),
    })).filter((r: { product_sap: string }) => r.product_sap)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ถูกต้อง' }, { status: 400 })

    await supabase.from('bom_items').delete().gte('id', 1)

    const { error } = await supabase.from('bom_items').insert(records)
    if (error) throw error

    await supabase.from('upload_log').insert({
      table_name: 'bom_items',
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
