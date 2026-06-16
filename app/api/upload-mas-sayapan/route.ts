import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get('file')
  if (file) {
    const { data } = await supabase
      .from('mas_sayapan')
      .select('product_group, station, source_file')
      .eq('source_file', file)
    return NextResponse.json({ data: data ?? [] })
  }
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'mas_sayapan')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const records = (rows as Record<string, unknown>[]).map(r => {
      const keys = Object.keys(r)
      const groupKey   = keys.find(k => /กลุ่ม|product_group/i.test(k)) ?? keys[0]
      const stationKey = keys.find(k => /สายพาน|station/i.test(k))      ?? keys[1]
      return {
        product_group: String(r[groupKey]   ?? ''),
        station:       String(r[stationKey] ?? ''),
        source_file:   filename ?? 'unknown',
      }
    })

    const { error: delErr } = await supabase.from('mas_sayapan').delete().gte('id', 1)
    if (delErr) throw delErr

    const { error } = await supabase.from('mas_sayapan').insert(records)
    if (error) throw error

    await supabase.from('upload_log').delete().eq('table_name', 'mas_sayapan')
    await supabase.from('upload_log').insert({
      table_name:   'mas_sayapan',
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
    await supabase.from('mas_sayapan').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', 'mas_sayapan').eq('source_file', sourceFile)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
