import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'bkp_orders')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const records = rows.map((r: Record<string, unknown>) => ({
      production_date: r.production_date ?? null,
      delivery_date:   r.delivery_date   ?? null,
      sku:             String(r.sku ?? '').trim(),
      sku_name:        r.sku_name         ?? null,
      quantity:        Number(r.quantity) || 0,
      source_file:     filename ?? 'unknown',
    })).filter((r: { sku: string; quantity: number }) => r.sku && r.quantity > 0)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบข้อมูลที่ถูกต้อง' }, { status: 400 })

    const { error } = await supabase.from('bkp_orders').insert(records)
    if (error) throw error

    await supabase.from('upload_log').insert({
      table_name:   'bkp_orders',
      source_file:  filename ?? 'unknown',
      record_count: records.length,
    })

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
    const sourceFile = req.nextUrl.searchParams.get('file')
    if (!sourceFile) return NextResponse.json({ success: false, message: 'missing file' }, { status: 400 })
    await supabase.from('bkp_orders').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', 'bkp_orders').eq('source_file', sourceFile)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
