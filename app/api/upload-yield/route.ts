import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDev, batchInsert } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'yield_bags')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { sapResults, workDate, filename } = await req.json() as {
      sapResults: { sapCode: string; bags: number }[]
      workDate: string
      filename: string
    }
    if (!sapResults?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })
    if (!workDate) return NextResponse.json({ success: false, message: 'กรุณาระบุวันที่' }, { status: 400 })

    await supabase.from('yield_bags').delete().eq('work_date', workDate)

    const records = sapResults.map(({ sapCode, bags }) => ({
      work_date:   workDate,
      sap_code:    sapCode,
      bags,
      source_file: filename ?? 'unknown',
    }))

    const { error } = await supabase.from('yield_bags').insert(records)
    if (error) throw error

    await supabase.from('upload_log').delete().eq('table_name', 'yield_bags').eq('source_file', filename ?? 'unknown')
    await supabase.from('upload_log').insert({
      table_name:   'yield_bags',
      source_file:  filename ?? 'unknown',
      record_count: records.length,
    })

    syncToDev(async (dev) => {
      await dev.from('yield_bags').delete().eq('work_date', workDate)
      await batchInsert(dev, 'yield_bags', records)
    })
    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รหัส SAP` })
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
    await supabase.from('yield_bags').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', 'yield_bags').eq('source_file', sourceFile)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
