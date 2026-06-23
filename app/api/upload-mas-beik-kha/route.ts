import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDev, batchInsert } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'mas_beik_kha')
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
        product_group: String(r['product_group'] ?? '').trim() || null,
        sap:           String(r['sap']           ?? '').trim(),
        sku_name:      String(r['sku_name']       ?? '').trim() || null,
      }))
      .filter((r: { sap: string }) => r.sap)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ถูกต้อง (ต้องมีรหัส SAP)' }, { status: 400 })

    await supabase.from('mas_beik_kha').delete().gte('id', 1)
    const { error } = await supabase.from('mas_beik_kha').insert(records)
    if (error) throw error

    await supabase.from('upload_log').delete().eq('table_name', 'mas_beik_kha')
    await supabase.from('upload_log').insert({ table_name: 'mas_beik_kha', source_file: filename ?? 'unknown', record_count: records.length })

    syncToDev(async (dev) => {
      await dev.from('mas_beik_kha').delete().gte('id', 1)
      await batchInsert(dev, 'mas_beik_kha', records)
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
    await supabase.from('mas_beik_kha').delete().gte('id', 1)
    await supabase.from('upload_log').delete().eq('table_name', 'mas_beik_kha').eq('source_file', sourceFile)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
