import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncUploadToDev } from '@/lib/sync-to-dev'

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get('file')
  if (file) {
    const { data } = await supabase
      .from('mas_sayapan')
      .select('product_group, station, source_file')
      .eq('source_file', file)
      .order('id', { ascending: true })
    return NextResponse.json({ data: data ?? [] })
  }
  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
    .eq('table_name', 'mas_sayapan')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    // Build records sorted by station then slot order (insertion order = preserved order)
    const records: { station: string; product_group: string; source_file: string }[] = []

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
        const station = String(row[stationKey] ?? '').trim()
        if (!station) continue
        for (const gk of groupKeys) {
          const group = String(row[gk] ?? '').trim()
          if (!group) continue
          records.push({ station, product_group: group, source_file: filename ?? 'unknown' })
        }
      } else {
        // Fallback: old long format (product_group, station)
        const groupKey = keys.find(k => /กลุ่ม|product_group/i.test(k)) ?? keys[0]
        const sKey     = keys.find(k => /สายพาน|station/i.test(k))      ?? keys[1]
        const station  = String(row[sKey]     ?? '').trim()
        const group    = String(row[groupKey] ?? '').trim()
        if (station && group) records.push({ station, product_group: group, source_file: filename ?? 'unknown' })
      }
    }

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบข้อมูลที่ใช้งานได้' }, { status: 400 })

    const uploadLogId = crypto.randomUUID()
    const { error: logErr } = await supabase
      .from('upload_log')
      .insert({ id: uploadLogId, table_name: 'mas_sayapan', source_file: filename ?? 'unknown', record_count: records.length })
    if (logErr) throw logErr

    const recordsWithId = records.map(r => ({ ...r, upload_log_id: uploadLogId }))
    const { error } = await supabase.from('mas_sayapan').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', uploadLogId)
      throw error
    }

    await syncUploadToDev('mas_sayapan', filename ?? 'unknown', records)
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
    // ON DELETE CASCADE removes mas_sayapan rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
