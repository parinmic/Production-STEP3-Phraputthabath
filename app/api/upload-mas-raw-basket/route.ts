import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
    .eq('table_name', 'mas_raw_basket')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    type BasketRecord = { unix_code: string | null; sap_code: string; name: string; kg_per_basket: number; source_file: string }

    const records: BasketRecord[] = rows
      .map((r: Record<string, unknown>) => {
        const unix    = r['UNIX'] != null ? String(r['UNIX']).trim() : null
        const sap     = String(r['SAP'] ?? '').trim()
        const name    = String(r['ชื่อ'] ?? '').trim()
        const kgPer   = Number(r['ปริมาณต่อตะกร้า'] ?? 0)
        if (!sap || !name || !kgPer) return null
        return { unix_code: unix || null, sap_code: sap, name, kg_per_basket: kgPer, source_file: filename ?? 'unknown' }
      })
      .filter(Boolean) as BasketRecord[]

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบข้อมูลที่ใช้งานได้' }, { status: 400 })

    const { data: logEntry, error: logErr } = await supabase
      .from('upload_log')
      .insert({ table_name: 'mas_raw_basket', source_file: filename ?? 'unknown', record_count: records.length })
      .select('id')
      .single()
    if (logErr) throw logErr

    const recordsWithId = records.map((r: BasketRecord) => ({ ...r, upload_log_id: logEntry.id }))
    const { error } = await supabase.from('mas_raw_basket').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', logEntry.id)
      throw new Error(error.message)
    }

    await syncToDevAwaited(async (dev) => {
      const { data: devLog, error: devLogErr } = await dev
        .from('upload_log')
        .insert({ table_name: 'mas_raw_basket', source_file: filename ?? 'unknown', record_count: records.length })
        .select('id')
        .single()
      if (devLogErr) throw devLogErr
      await batchInsert(dev, 'mas_raw_basket', records.map((r: BasketRecord) => ({ ...r, upload_log_id: devLog.id })))
    })

    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const uploadLogId = req.nextUrl.searchParams.get('id')
    if (!uploadLogId) return NextResponse.json({ success: false, message: 'missing id' }, { status: 400 })
    // ON DELETE CASCADE removes mas_raw_basket rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
