import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

function shiftDate(iso: string | null, days: number): string | null {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

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

export async function GET(req: NextRequest) {
  const round = req.nextUrl.searchParams.get('round')
  const tableName = round ? `lotus_orders_${round}` : 'lotus_orders'
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', tableName)
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename, round, append } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const cols = Object.keys(rows[0])
    const sample = rows[0]

    const hasNativeFormat = cols.some(c => c.startsWith('r') && c.length > 2)
    const records = rows
      .map((r: Record<string, unknown>) => {
        if (hasNativeFormat) {
          const skuCol  = cols.includes('rProduct_code') ? 'rProduct_code'
                        : (cols.find(c => c.toLowerCase().includes('product') && c.toLowerCase().includes('code')) ?? '')
          const nameCol = cols.includes('rProduct_name') ? 'rProduct_name'
                        : (cols.find(c => c.toLowerCase().includes('product') && c.toLowerCase().includes('name')) ?? '')
          const qtyCol  = cols.includes('rStock_wgt') ? 'rStock_wgt'
                        : cols.includes('rPlan_wgt') ? 'rPlan_wgt'
                        : (cols.find(c => c.toLowerCase().includes('qty') || c.toLowerCase().includes('quantity') || c.toLowerCase().includes('wgt')) ?? '')
          const dateCol = cols.includes('rDoc_date') ? 'rDoc_date'
                        : (cols.find(c => c.toLowerCase().includes('doc') && c.toLowerCase().includes('date'))
                           ?? cols.find(c => c.toLowerCase().includes('date') && !c.toLowerCase().startsWith('rr')) ?? '')
          const dlvCol  = cols.includes('rRDate1') ? 'rRDate1'
                        : cols.includes('rReq_date') ? 'rReq_date'
                        : (cols.find(c => c.toLowerCase().includes('req') || c.toLowerCase().includes('delivery')) ?? '')
          return {
            order_date:    toISODate(r[dateCol]),
            delivery_date: shiftDate(toISODate(r[dlvCol]), -1),
            sku:           String(r[skuCol] ?? '').trim(),
            sku_name:      String(r[nameCol] ?? '').trim(),
            quantity:      parseFloat(String(r[qtyCol] || '0')) || 0,
            period:        null,
            upload_round:  round ?? '0800',
            source_file:   filename ?? 'unknown',
          }
        }
        return {
          order_date:    toISODate(r['วันที่สั่ง'] ?? r['order_date']),
          delivery_date: toISODate(r['วันที่ส่ง'] ?? r['delivery_date']),
          sku:           String(r['SKU'] ?? r['รหัสสินค้า'] ?? '').trim(),
          sku_name:      String(r['ชื่อสินค้า'] ?? r['product_name'] ?? '').trim(),
          quantity:      Number(r['ปริมาณ'] ?? r['จำนวน'] ?? r['qty'] ?? 0) || 0,
          period:        String(r['ช่วงเวลา'] ?? '').trim() || null,
          upload_round:  round ?? '0800',
          source_file:   filename ?? 'unknown',
        }
      })
      .filter((r: { sku: string; quantity: number }) => r.sku && r.quantity > 0)

    if (!records.length) {
      return NextResponse.json({
        success: false,
        message: `ไม่พบรายการที่ถูกต้อง — columns ที่พบ: ${cols.join(', ')}`,
        sample,
      }, { status: 400 })
    }

    if (!append) {
      const deliveryDates = Array.from(new Set(records.map((r: { delivery_date: string }) => r.delivery_date).filter(Boolean)))
      if (deliveryDates.length) {
        await supabase.from('lotus_orders')
          .delete()
          .in('delivery_date', deliveryDates)
          .eq('upload_round', round ?? '0800')
      }
    }

    const { error } = await supabase.from('lotus_orders').insert(records)
    if (error) throw error

    const tableName = round ? `lotus_orders_${round}` : 'lotus_orders'
    await supabase.from('upload_log').insert({
      table_name: tableName,
      source_file: filename ?? 'unknown',
      record_count: records.length,
    })

    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` })
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
    const round      = req.nextUrl.searchParams.get('round')
    if (!sourceFile) return NextResponse.json({ success: false, message: 'missing file' }, { status: 400 })
    const tableName = round ? `lotus_orders_${round}` : 'lotus_orders'
    await supabase.from('lotus_orders').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', tableName).eq('source_file', sourceFile)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
