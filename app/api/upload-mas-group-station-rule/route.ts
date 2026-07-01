import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncUploadToDev } from '@/lib/sync-to-dev'

type GroupStationRuleRecord = {
  product_group: string
  station: string
  is_enabled: boolean
  split_mode: string
  priority: number
  share_pct: number | null
  allow_same_sku: boolean
  sku_route_mode: string
  raw_remainder_mode: string
  overflow_station: string | null
  notes: string | null
  source_file: string
}

const truthy = new Set(['y', 'yes', 'true', '1', 'ใช่', 'เปิด'])
const falsy = new Set(['n', 'no', 'false', '0', 'ไม่', 'ปิด'])

function pick(row: Record<string, unknown>, names: string[]) {
  const keys = Object.keys(row)
  for (const name of names) {
    const key = keys.find(k => k.trim().toLowerCase() === name.toLowerCase())
    if (key) return row[key]
  }
  return undefined
}

function str(row: Record<string, unknown>, names: string[], fallback = '') {
  const value = pick(row, names)
  return value == null ? fallback : String(value).trim()
}

function bool(row: Record<string, unknown>, names: string[], fallback: boolean) {
  const value = str(row, names)
  if (!value) return fallback
  const normalized = value.toLowerCase()
  if (truthy.has(normalized)) return true
  if (falsy.has(normalized)) return false
  return fallback
}

function num(row: Record<string, unknown>, names: string[], fallback: number) {
  const value = Number(str(row, names))
  return Number.isFinite(value) ? value : fallback
}

function nullableNum(row: Record<string, unknown>, names: string[]) {
  const raw = str(row, names)
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get('file')
  if (file) {
    const { data } = await supabase
      .from('mas_group_station_rule')
      .select('product_group, station, is_enabled, split_mode, priority, share_pct, allow_same_sku, sku_route_mode, raw_remainder_mode, overflow_station, notes, source_file')
      .eq('source_file', file)
      .order('id', { ascending: true })
    return NextResponse.json({ data: data ?? [] })
  }

  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
    .eq('table_name', 'mas_group_station_rule')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const records: GroupStationRuleRecord[] = []
    for (const row of rows as Record<string, unknown>[]) {
      const product_group = str(row, ['product_group', 'กลุ่มสินค้า', 'กลุ่มชิ้นส่วน'])
      const station = str(row, ['station', 'สายพาน', 'สถานี', 'จุดงาน'])
      if (!product_group || !station) continue

      const sharePct = nullableNum(row, ['share_pct', 'share', 'สัดส่วน', 'เปอร์เซ็นต์'])
      records.push({
        product_group,
        station,
        is_enabled: bool(row, ['is_enabled', 'enabled', 'ใช้งาน'], true),
        split_mode: str(row, ['split_mode', 'mode', 'วิธีแบ่งงาน'], 'primary'),
        priority: num(row, ['priority', 'ลำดับ'], 1),
        share_pct: sharePct,
        allow_same_sku: bool(row, ['allow_same_sku', 'แบ่ง_sku_เดียวกัน', 'sku_ซ้ำข้ามสายพาน'], false),
        sku_route_mode: str(row, ['sku_route_mode', 'route_mode'], 'master_productivity'),
        raw_remainder_mode: str(row, ['raw_remainder_mode', 'raw_mode'], 'raw_sku_station'),
        overflow_station: str(row, ['overflow_station', 'station_สำรอง']) || null,
        notes: str(row, ['notes', 'note', 'หมายเหตุ']) || null,
        source_file: filename ?? 'unknown',
      })
    }

    if (!records.length) {
      return NextResponse.json({ success: false, message: 'ไม่พบข้อมูลที่ใช้งานได้' }, { status: 400 })
    }

    const uploadLogId = crypto.randomUUID()
    const { error: logErr } = await supabase
      .from('upload_log')
      .insert({ id: uploadLogId, table_name: 'mas_group_station_rule', source_file: filename ?? 'unknown', record_count: records.length })
    if (logErr) throw logErr

    const recordsWithId = records.map(r => ({ ...r, upload_log_id: uploadLogId }))
    const { error } = await supabase.from('mas_group_station_rule').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', uploadLogId)
      throw error
    }

    await syncUploadToDev('mas_group_station_rule', filename ?? 'unknown', records)
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
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
