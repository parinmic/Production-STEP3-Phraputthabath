import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const date  = req.nextUrl.searchParams.get('date')
  const phase = req.nextUrl.searchParams.get('phase')

  if (!date || !phase) {
    return NextResponse.json({ items: [] })
  }

  const { data, error } = await supabase
    .from('withdrawal_requests')
    .select('*')
    .eq('request_date', date)
    .eq('phase', Number(phase))
    .order('work_station')
    .order('sku')

  if (error) return NextResponse.json({ items: [], error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { items, requestDate, phase } = await req.json()
    if (!items?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    // ลบข้อมูลเดิมของวันนั้น phase นั้นก่อน แล้วแทนที่ใหม่
    await supabase
      .from('withdrawal_requests')
      .delete()
      .eq('request_date', requestDate)
      .eq('phase', phase)

    const records = items.map((r: Record<string, unknown>) => ({
      request_date: requestDate,
      phase:        Number(phase),
      sku:          String(r['sku'] ?? '').trim(),
      sku_name:     String(r['sku_name'] ?? '').trim() || null,
      quantity:     Number(r['quantity'] ?? 0),
      unit:         String(r['unit'] ?? 'ชิ้น').trim(),
      work_station: String(r['work_station'] ?? '').trim() || null,
      note:         String(r['note'] ?? '').trim() || null,
    })).filter((r: { sku: string }) => r.sku)

    const { error } = await supabase.from('withdrawal_requests').insert(records)
    if (error) throw error

    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
