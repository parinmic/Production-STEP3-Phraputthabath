import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

function toISODate(val: unknown): string | null {
  if (!val) return null
  const s = String(val).trim()
  if (!s || s === 'null') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (s.includes('T')) return s.split('T')[0]
  const parts = s.split('/')
  if (parts.length === 3) {
    const [d, m, y] = parts
    const year = parseInt(y) > 2400 ? parseInt(y) - 543 : parseInt(y)
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const num = parseFloat(s)
  if (!isNaN(num) && num > 40000) {
    const d = new Date(Math.round((num - 25569) * 86400 * 1000))
    const y = d.getUTCFullYear() > 2400 ? d.getUTCFullYear() - 543 : d.getUTCFullYear()
    return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  return null
}

export async function GET() {
  const { data: logs } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'production_plan_supplementary')
    .order('uploaded_at', { ascending: false })
    .limit(20)

  const uploads = await Promise.all((logs ?? []).map(async r => {
    const { data: rec } = await supabase
      .from('production_plan_supplementary')
      .select('loading_time, deadline_time')
      .eq('source_file', r.source_file)
      .limit(1)
      .maybeSingle()
    return {
      source_file:   r.source_file,
      record_count:  r.record_count,
      uploaded_at:   r.uploaded_at,
      loading_time:  rec?.loading_time ?? null,
      deadline_time: rec?.deadline_time ?? null,
    }
  }))

  return NextResponse.json({ uploads })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename, loading_time, deadline_time } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })
    if (!loading_time) return NextResponse.json({ success: false, message: 'กรุณาระบุเวลาโหลดจ่าย' }, { status: 400 })

    const cols = Object.keys(rows[0])
    const hasNativeFormat = cols.some(c => c.startsWith('r') && c.length > 2)

    const records = rows
      .map((r: Record<string, unknown>) => {
        let sku = '', sku_name = '', quantity = 0, delivery_date: string | null = null, order_date: string | null = null

        if (hasNativeFormat) {
          const skuCol  = cols.includes('rProduct_code') ? 'rProduct_code'
                        : (cols.find(c => c.toLowerCase().includes('product') && c.toLowerCase().includes('code')) ?? '')
          const nameCol = cols.includes('rProduct_name') ? 'rProduct_name'
                        : (cols.find(c => c.toLowerCase().includes('product') && c.toLowerCase().includes('name')) ?? '')
          const qtyCol  = cols.includes('rStock_wgt') ? 'rStock_wgt'
                        : cols.includes('rPlan_wgt') ? 'rPlan_wgt'
                        : (cols.find(c => c.toLowerCase().includes('wgt') || c.toLowerCase().includes('qty')) ?? '')
          const dateCol = cols.includes('rDoc_date') ? 'rDoc_date'
                        : (cols.find(c => c.toLowerCase().includes('doc') && c.toLowerCase().includes('date')) ?? '')
          const dlvCol  = cols.includes('rRDate1') ? 'rRDate1'
                        : cols.includes('rReq_date') ? 'rReq_date'
                        : (cols.find(c => c.toLowerCase().includes('req') || c.toLowerCase().includes('rdate')) ?? '')
          sku           = String(r[skuCol] ?? '').trim()
          sku_name      = String(r[nameCol] ?? '').trim()
          quantity      = parseFloat(String(r[qtyCol] || '0')) || 0
          order_date    = toISODate(r[dateCol])
          delivery_date = toISODate(r[dlvCol])
        } else {
          sku           = String(r['SKU'] ?? r['รหัสสินค้า'] ?? '').trim()
          sku_name      = String(r['ชื่อสินค้า'] ?? r['product_name'] ?? '').trim()
          quantity      = Number(r['ปริมาณ'] ?? r['จำนวน'] ?? r['qty'] ?? 0) || 0
          order_date    = toISODate(r['วันที่สั่ง'] ?? r['order_date'])
          delivery_date = toISODate(r['วันที่ส่ง'] ?? r['delivery_date'])
        }

        return { sku, sku_name, quantity, order_date, delivery_date, loading_time, deadline_time, source_file: filename ?? 'unknown' }
      })
      .filter((r: { sku: string; quantity: number }) => r.sku && r.quantity > 0)

    if (!records.length) {
      return NextResponse.json({
        success: false,
        message: `ไม่พบรายการที่ถูกต้อง — columns ที่พบ: ${cols.join(', ')}`,
      }, { status: 400 })
    }

    // Delete existing records with same source_file before re-inserting
    await supabase.from('production_plan_supplementary').delete().eq('source_file', filename ?? 'unknown')

    const { error } = await supabase.from('production_plan_supplementary').insert(records)
    if (error) throw error

    await supabase.from('upload_log').insert({
      table_name:   'production_plan_supplementary',
      source_file:  filename ?? 'unknown',
      record_count: records.length,
    })

    return NextResponse.json({
      success: true,
      message: `บันทึกสำเร็จ ${records.length} รายการ — โหลดจ่าย ${loading_time} น. (deadline ${deadline_time} น.)`,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sourceFile = req.nextUrl.searchParams.get('file')
    if (!sourceFile) return NextResponse.json({ success: false, message: 'missing file' }, { status: 400 })
    await supabase.from('production_plan_supplementary').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', 'production_plan_supplementary').eq('source_file', sourceFile)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
