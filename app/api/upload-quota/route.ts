import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDev, batchInsert } from '@/lib/sync-to-dev'

const TARGET_WAREHOUSE = 'โรงชำแหละสุกรพระพุทธบาท'

function daykeyToDate(daykey: unknown): string {
  if (!daykey) return ''
  if (typeof daykey === 'string' && daykey.includes('T')) return daykey.split('T')[0]
  const n = Number(daykey)
  if (!n || isNaN(n)) return ''
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000)
  return d.toISOString().split('T')[0]
}

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'channel_quotas')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const filtered = rows.filter((r: Record<string, unknown>) =>
      String(r['WarehouseForPlan1'] ?? '').trim() === TARGET_WAREHOUSE
    )
    if (!filtered.length) {
      return NextResponse.json({ success: false, message: 'ไม่พบข้อมูลของโรงชำแหละสุกรพระพุทธบาทในไฟล์' }, { status: 400 })
    }

    const records = filtered.map((r: Record<string, unknown>) => ({
      quota_date:  daykeyToDate(r['daykey']),
      channel:     String(r['CustomerForPlan2'] ?? '').trim(),
      sku:         String(r['ProductBKey'] ?? '').trim(),
      sku_name:    String(r['ProductNameTha'] ?? '').trim(),
      quantity:    Number(r['*Confirm_BaseUnit']) || Number(r['*Forecast_BaseUnit']) || 0,
      period:      null,
      source_file: filename ?? 'unknown',
    })).filter((r: { sku: string; channel: string; quantity: number }) =>
      r.sku && r.channel && r.quantity > 0
    )
    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ถูกต้อง' }, { status: 400 })

    const dates = Array.from(new Set(records.map((r: { quota_date: string }) => r.quota_date)))
    await supabase.from('channel_quotas').delete().in('quota_date', dates)

    const { error } = await supabase.from('channel_quotas').insert(records)
    if (error) throw error

    await supabase.from('upload_log').insert({
      table_name: 'channel_quotas',
      source_file: filename ?? 'unknown',
      record_count: records.length,
    })
    syncToDev(async (dev) => {
      await dev.from('channel_quotas').delete().in('quota_date', dates)
      await batchInsert(dev, 'channel_quotas', records)
    })
    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ (${dates.length} วัน)` })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message
      : typeof e === 'object' && e !== null && 'message' in e ? String((e as {message:unknown}).message)
      : 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sourceFile = req.nextUrl.searchParams.get('file')
    if (!sourceFile) return NextResponse.json({ success: false, message: 'missing file' }, { status: 400 })
    await supabase.from('channel_quotas').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', 'channel_quotas').eq('source_file', sourceFile)
    syncToDev(async (dev) => {
      await dev.from('channel_quotas').delete().eq('source_file', sourceFile)
    })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
