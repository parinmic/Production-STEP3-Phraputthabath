import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get('file')
  if (file) {
    const { data } = await supabase
      .from('mas_sayapan')
      .select('product_group, station, slot_order, source_file')
      .eq('source_file', file)
      .order('station',    { ascending: true })
      .order('slot_order', { ascending: true })
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

    const records: { station: string; product_group: string; slot_order: number; source_file: string }[] = []

    for (const row of rows as Record<string, unknown>[]) {
      const keys = Object.keys(row)

      // New wide format: "สายพาน" column + "กลุ่มสินค้าที่ N" columns
      const stationKey = keys.find(k => /^สายพาน$|^station$/i.test(k.trim()))
      const groupKeys  = keys
        .filter(k => /กลุ่มสินค้าที่\s*\d+/i.test(k))
        .sort((a, b) => {
          const na = parseInt(a.match(/\d+/)?.[0] ?? '0')
          const nb = parseInt(b.match(/\d+/)?.[0] ?? '0')
          return na - nb
        })

      if (stationKey && groupKeys.length > 0) {
        // Wide format row
        const station = String(row[stationKey] ?? '').trim()
        if (!station) continue
        for (const gk of groupKeys) {
          const group = String(row[gk] ?? '').trim()
          if (!group) continue
          const slotNum = parseInt(gk.match(/\d+/)?.[0] ?? '0')
          records.push({ station, product_group: group, slot_order: slotNum, source_file: filename ?? 'unknown' })
        }
      } else {
        // Fallback: old long format (product_group, station)
        const groupKey   = keys.find(k => /กลุ่ม|product_group/i.test(k)) ?? keys[0]
        const sKey       = keys.find(k => /สายพาน|station/i.test(k))      ?? keys[1]
        const station    = String(row[sKey]     ?? '').trim()
        const group      = String(row[groupKey] ?? '').trim()
        if (station && group) {
          records.push({ station, product_group: group, slot_order: 0, source_file: filename ?? 'unknown' })
        }
      }
    }

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบข้อมูลที่ใช้งานได้' }, { status: 400 })

    const { error: delErr } = await supabase.from('mas_sayapan').delete().gte('id', 1)
    if (delErr) throw delErr

    const { error } = await supabase.rpc('insert_mas_sayapan_rows', { records: JSON.stringify(records) })
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
