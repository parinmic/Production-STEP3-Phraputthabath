import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
    .eq('table_name', 'bkp_orders')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    type BkpRecord = { production_date: unknown; delivery_date: unknown; sku: string; sku_name: unknown; quantity: number; source_file: string }

    const records: BkpRecord[] = rows.map((r: Record<string, unknown>) => ({
      production_date: r.production_date ?? null,
      delivery_date:   r.delivery_date   ?? null,
      sku:             String(r.sku ?? '').trim(),
      sku_name:        r.sku_name         ?? null,
      quantity:        Number(r.quantity) || 0,
      source_file:     filename ?? 'unknown',
    })).filter((r: BkpRecord) => r.sku && r.quantity > 0)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบข้อมูลที่ถูกต้อง' }, { status: 400 })

    const { data: logEntry, error: logErr } = await supabase
      .from('upload_log')
      .insert({ table_name: 'bkp_orders', source_file: filename ?? 'unknown', record_count: records.length })
      .select('id')
      .single()
    if (logErr) throw logErr

    const recordsWithId = records.map((r: BkpRecord) => ({ ...r, upload_log_id: logEntry.id }))
    const { error } = await supabase.from('bkp_orders').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', logEntry.id)
      throw error
    }

    await syncToDevAwaited(async (dev) => {
      const { data: devLog, error: devLogErr } = await dev
        .from('upload_log')
        .insert({ table_name: 'bkp_orders', source_file: filename ?? 'unknown', record_count: records.length })
        .select('id')
        .single()
      if (devLogErr) throw devLogErr
      await batchInsert(dev, 'bkp_orders', records.map((r: BkpRecord) => ({ ...r, upload_log_id: devLog.id })))
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
    const uploadLogId = req.nextUrl.searchParams.get('id')
    if (!uploadLogId) return NextResponse.json({ success: false, message: 'missing id' }, { status: 400 })
    // ON DELETE CASCADE removes bkp_orders rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
