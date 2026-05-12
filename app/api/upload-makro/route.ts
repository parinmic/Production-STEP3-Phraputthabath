import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

function toISODate(val: unknown): string {
  if (!val) return ''
  const s = String(val).trim()
  const parts = s.split('/')
  if (parts.length === 3) {
    const [d, m, y] = parts
    const year = parseInt(y) > 2400 ? parseInt(y) - 543 : parseInt(y)
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return s
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

    const isMakroNative = 'rProduct_code' in rows[0]

    const records = rows
      .map((r: Record<string, unknown>) => {
        if (isMakroNative) {
          return {
            order_date:    toISODate(r['rDoc_date']),
            delivery_date: toISODate(r['rReq_date']),
            sku:           String(r['rProduct_code'] ?? '').trim(),
            sku_name:      String(r['rProduct_name'] ?? '').trim(),
            quantity:      parseFloat(String(r['rPlan_qty'] || '0')) || 0,
            period:        String(r['rShip_name'] ?? '').trim() || null,
            upload_round:  round ?? '0800',
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
        }
      })
      .filter((r: { sku: string; quantity: number }) => r.sku && r.quantity > 0)

    if (!records.length) {
      return NextResponse.json({ success: false, message: 'ไม่พบรายการที่มี SKU และปริมาณ > 0' }, { status: 400 })
    }

    // Replace existing records for same delivery dates + round to prevent duplicates
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
