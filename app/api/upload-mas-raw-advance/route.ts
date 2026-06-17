import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'mas_raw_production_advance')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const records = (rows as Record<string, unknown>[]).flatMap(r => {
      const keys = Object.keys(r)
      const get = (...patterns: RegExp[]) => {
        const key = keys.find(k => patterns.some(p => p.test(k)))
        return key ? String(r[key] ?? '').trim() : ''
      }
      const station   = get(/สายพาน/i, /station/i) || String(r[keys[0]] ?? '').trim()
      const startTime = get(/เวลา/i, /start/i)      || String(r[keys[1]] ?? '').trim()
      const fgSap     = get(/fg.*sap|sap.*fg/i)      || String(r[keys[2]] ?? '').trim()
      const fgName    = get(/fg.*ชื่อ|ชื่อ.*fg/i)   || String(r[keys[3]] ?? '').trim()
      const rawSap    = get(/raw.*sap|sap.*raw/i)    || String(r[keys[4]] ?? '').trim()
      const rawName   = get(/raw.*ชื่อ|ชื่อ.*raw/i) || String(r[keys[5]] ?? '').trim()

      if (!station || !fgSap || !rawSap) return []

      // Normalize station: สามชั้นพิเศษ → สามชั้น etc.
      const STATION_MAP: Record<string, string> = {
        'สามชั้นพิเศษ': 'สามชั้น', 'ไหล่พิเศษ': 'ไหล่',
        'สะโพกพิเศษ': 'สะโพก', 'หมูบดพิเศษ': 'หมูบด', 'สไลด์พิเศษ': 'สไลด์',
      }
      const normStation = STATION_MAP[station] ?? station

      // Normalize time to HH:MM:SS — handle Excel Date objects like "Sat Dec 30 1899 21:00:00 GMT+..."
      const normalizeTime = (t: string) => {
        if (!t) return '00:00:00'
        const match = String(t).match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?/)
        if (match) return `${match[1].padStart(2, '0')}:${match[2]}:00`
        return '00:00:00'
      }

      return [{ station: normStation, start_time: normalizeTime(startTime), fg_sap: fgSap, fg_name: fgName || null, raw_sap: rawSap, raw_name: rawName || null }]
    })

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ถูกต้อง (ต้องมี สายพาน, SAP FG, SAP Raw)' }, { status: 400 })

    await supabase.from('mas_raw_production_advance').delete().gte('id', 1)
    const { error } = await supabase.from('mas_raw_production_advance').insert(records)
    if (error) throw error

    await supabase.from('upload_log').delete().eq('table_name', 'mas_raw_production_advance')
    await supabase.from('upload_log').insert({ table_name: 'mas_raw_production_advance', source_file: filename ?? 'unknown', record_count: records.length })

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
    await supabase.from('mas_raw_production_advance').delete().gte('id', 1)
    await supabase.from('upload_log').delete().eq('table_name', 'mas_raw_production_advance').eq('source_file', sourceFile)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
