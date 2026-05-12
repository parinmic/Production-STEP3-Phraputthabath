import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const TARGET_WAREHOUSE = 'โรงชำแหละสุกรพระพุทธบาท'

function daykeyToDate(daykey: unknown): string {
  if (!daykey) return ''
  // cellDates:true in the parser serializes Excel date cells to ISO strings via JSON
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
      return NextResponse.json({ success: false, message: `ไม่พบข้อมูลของโรงชำแหละสุกรพระพุทธบาทในไฟล์` }, { status: 400 })
    }

    const records = filtered.map((r: Record<string, unknown>) => ({
      quota_date: daykeyToDate(r['daykey']),
      channel:    String(r['CustomerForPlan2'] ?? '').trim(),
      sku:        String(r['ProductBKey'] ?? '').trim(),
      sku_name:   String(r['ProductNameTha'] ?? '').trim(),
      quantity:   Number(r['*Confirm_BaseUnit']) || Number(r['*Forecast_BaseUnit']) || 0,
      period:     null,
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
    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ (${dates.length} วัน)` })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message
      : typeof e === 'object' && e !== null && 'message' in e ? String((e as {message:unknown}).message)
      : 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}
