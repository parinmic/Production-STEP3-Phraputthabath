import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDev, batchInsert } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'mas_yield')
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
        const weight = Number(r['น้ำหนักซาก RM'] ?? r['carcass_weight'] ?? 0)
        const group  = String(r['กลุ่มสินค้า'] ?? r['product_group'] ?? '').trim()
        const yld    = Number(r['Yield'] ?? r['yield_pct'] ?? 0)
        if (!weight || !group || !yld) return null
        return { carcass_weight: weight, product_group: group, yield_pct: yld, source_file: filename ?? 'unknown' }
      })
      .filter(Boolean)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบข้อมูลที่ใช้งานได้' }, { status: 400 })

    await supabase.from('mas_yield').delete().eq('source_file', filename ?? 'unknown')

    const BATCH = 500
    for (let i = 0; i < records.length; i += BATCH) {
      const { error } = await supabase.from('mas_yield').insert(records.slice(i, i + BATCH))
      if (error) throw error
    }

    await supabase.from('upload_log').insert({
      table_name:   'mas_yield',
      source_file:  filename ?? 'unknown',
      record_count: records.length,
    })

    syncToDev(async (dev) => {
      await dev.from('mas_yield').delete().eq('source_file', filename ?? 'unknown')
      await batchInsert(dev, 'mas_yield', records)
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
    await supabase.from('mas_yield').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', 'mas_yield').eq('source_file', sourceFile)
    syncToDev(async (dev) => {
      await dev.from('mas_yield').delete().eq('source_file', sourceFile)
    })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
