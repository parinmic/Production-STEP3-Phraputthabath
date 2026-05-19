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
    // Excel serial จากปฏิทิน BE (Thai locale) → ปีจะเป็น พ.ศ. → ลบ 543
    const d = new Date(Math.round((num - 25569) * 86400 * 1000))
    const y = d.getUTCFullYear() > 2400 ? d.getUTCFullYear() - 543 : d.getUTCFullYear()
    return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  return null
}

export async function GET(req: NextRequest) {
  const round = req.nextUrl.searchParams.get('round')
  const tableName = round ? `makro_orders_${round}` : 'makro_orders'
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
    const { rows, filename, round } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const isPlanMapped  = 'sku' in rows[0] && 'delivery_date' in rows[0]
    const isMakroNative = !isPlanMapped && 'rProduct_code' in rows[0]

    const records = rows
      .map((r: Record<string, unknown>) => {
        if (isPlanMapped) {
          const today = new Date().toISOString().split('T')[0]
          return {
            order_date:    toISODate(r['order_date'] ?? r['delivery_date']) ?? today,
            delivery_date: toISODate(r['delivery_date']),
            sku:           String(r['sku'] ?? '').trim(),
            sku_name:      String(r['sku_name'] ?? '').trim(),
            quantity:      Number(r['quantity']) || 0,
            period:        String(r['period'] ?? '').trim() || null,
            upload_round:  round ?? '0800',
            source_file:   filename ?? 'unknown',
          }
        }
        if (isMakroNative) {
          const date = toISODate(r['rRDate2'])
          return {
            order_date:    date,
            delivery_date: date,
            sku:           String(r['rProduct_code'] ?? '').trim(),
            sku_name:      String(r['rProduct_name'] ?? '').trim(),
            quantity:      parseFloat(String(r['rStock_wgt'] ?? '0')) || 0,
            period:        String(r['rShip_name'] ?? '').trim() || null,
            upload_round:  round ?? '0800',
            source_file:   filename ?? 'unknown',
          }
        }
        return {
          order_date:    toISODate(r['วันที่สั่ง']),
          delivery_date: toISODate(r['วันที่ส่ง']),
          sku:           String(r['SKU'] ?? '').trim(),
          sku_name:      String(r['ชื่อสินค้า'] ?? '').trim(),
          quantity:      Number(r['ปริมาณ']) || 0,
          period:        String(r['ช่วงเวลา'] ?? '').trim() || null,
          upload_round:  round ?? '0800',
          source_file:   filename ?? 'unknown',
        }
      })
      .filter((r: { sku: string; quantity: number }) => r.sku && r.quantity > 0)

    if (!records.length) {
      return NextResponse.json({ success: false, message: 'ไม่พบรายการที่มี SKU และปริมาณ > 0' }, { status: 400 })
    }

    const deliveryDates = Array.from(new Set(records.map((r: { delivery_date: string }) => r.delivery_date).filter(Boolean)))
    if (deliveryDates.length) {
      await supabase.from('makro_orders')
        .delete()
        .in('delivery_date', deliveryDates)
        .eq('upload_round', round ?? '0800')
    }

    const { error } = await supabase.from('makro_orders').insert(records)
    if (error) throw error

    const tableName = round ? `makro_orders_${round}` : 'makro_orders'
    await supabase.from('upload_log').insert({
      table_name: tableName,
      source_file: filename ?? 'unknown',
      record_count: records.length,
    })

    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sourceFile = req.nextUrl.searchParams.get('file')
    const round      = req.nextUrl.searchParams.get('round')
    if (!sourceFile) return NextResponse.json({ success: false, message: 'missing file' }, { status: 400 })
    const tableName = round ? `makro_orders_${round}` : 'makro_orders'
    await supabase.from('makro_orders').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', tableName).eq('source_file', sourceFile)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
