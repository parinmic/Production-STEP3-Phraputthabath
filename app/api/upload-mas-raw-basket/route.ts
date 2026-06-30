import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'mas_raw_basket')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const records = rows
      .map((r: Record<string, unknown>) => {
        const unix    = r['UNIX'] != null ? String(r['UNIX']).trim() : null
        const sap     = String(r['SAP'] ?? '').trim()
        const name    = String(r['ชื่อ'] ?? '').trim()
        const kgPer   = Number(r['ปริมาณต่อตะกร้า'] ?? 0)
        if (!sap || !name || !kgPer) return null
        return { unix_code: unix || null, sap_code: sap, name, kg_per_basket: kgPer, source_file: filename ?? 'unknown' }
      })
      .filter(Boolean)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบข้อมูลที่ใช้งานได้' }, { status: 400 })

    await supabase.from('mas_raw_basket').delete().eq('source_file', filename ?? 'unknown')

    const { error } = await supabase.from('mas_raw_basket').insert(records)
    if (error) throw new Error(error.message)

    await supabase.from('upload_log').insert({
      table_name:   'mas_raw_basket',
      source_file:  filename ?? 'unknown',
      record_count: records.length,
    })

    await syncToDevAwaited(async (dev) => {
      await dev.from('mas_raw_basket').delete().eq('source_file', filename ?? 'unknown')
      await batchInsert(dev, 'mas_raw_basket', records)
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
    await supabase.from('mas_raw_basket').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', 'mas_raw_basket').eq('source_file', sourceFile)
    await syncToDevAwaited(async (dev) => {
      await dev.from('mas_raw_basket').delete().eq('source_file', sourceFile)
    })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
