import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
    .eq('table_name', 'mas_yield')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    type YieldRecord = { carcass_weight: number; product_group: string; yield_pct: number; source_file: string }

    const records: YieldRecord[] = rows
      .map((r: Record<string, unknown>) => {
        const weight = Number(r['น้ำหนักซาก RM'] ?? r['carcass_weight'] ?? 0)
        const group  = String(r['กลุ่มสินค้า'] ?? r['product_group'] ?? '').trim()
        const yld    = Number(r['Yield'] ?? r['yield_pct'] ?? 0)
        if (!weight || !group || !yld) return null
        return { carcass_weight: weight, product_group: group, yield_pct: yld, source_file: filename ?? 'unknown' }
      })
      .filter(Boolean) as YieldRecord[]

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบข้อมูลที่ใช้งานได้' }, { status: 400 })

    const { data: logEntry, error: logErr } = await supabase
      .from('upload_log')
      .insert({ table_name: 'mas_yield', source_file: filename ?? 'unknown', record_count: records.length })
      .select('id')
      .single()
    if (logErr) throw logErr

    const recordsWithId = records.map((r: YieldRecord) => ({ ...r, upload_log_id: logEntry.id }))
    const BATCH = 500
    for (let i = 0; i < recordsWithId.length; i += BATCH) {
      const { error } = await supabase.from('mas_yield').insert(recordsWithId.slice(i, i + BATCH))
      if (error) {
        await supabase.from('upload_log').delete().eq('id', logEntry.id)
        throw error
      }
    }

    await syncToDevAwaited(async (dev) => {
      const { data: devLog, error: devLogErr } = await dev
        .from('upload_log')
        .insert({ table_name: 'mas_yield', source_file: filename ?? 'unknown', record_count: records.length })
        .select('id')
        .single()
      if (devLogErr) throw devLogErr
      await batchInsert(dev, 'mas_yield', records.map((r: YieldRecord) => ({ ...r, upload_log_id: devLog.id })))
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
    // ON DELETE CASCADE removes mas_yield rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
