import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDev, batchInsert } from '@/lib/sync-to-dev'

function toISODate(val: unknown): string | null {
  if (!val) return null
  const s = String(val).trim()
  if (!s || s === 'null') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const y = parseInt(s); return y > 2400 ? `${y - 543}${s.slice(4)}` : s }
  if (s.includes('T')) { const d = s.split('T')[0]; const y = parseInt(d); return y > 2400 ? `${y - 543}${d.slice(4)}` : d }
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
  const tableName = round ? `wet_market_orders_${round}` : 'wet_market_orders'
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
    const getRowValue = (r: Record<string, unknown>, targetKey: string): string | null => {
      const key = Object.keys(r).find(k => k.toLowerCase() === targetKey.toLowerCase())
      if (key === undefined || r[key] === null || r[key] === undefined) return null
      return String(r[key]).trim()
    }

    const records = rows
      .filter((r: Record<string, unknown>) => {
        const bst = getRowValue(r, 'rBst_code')
        const cvChannel = getRowValue(r, 'rCv_channel') || ''
        if (bst === '250') return true
        if (
          cvChannel.toLowerCase().includes('wet') ||
          cvChannel.includes('ตลาดสด') ||
          cvChannel.toLowerCase().includes('food service') ||
          cvChannel.includes('ค้าส่ง') ||
          cvChannel.includes('ในเครือ') ||
          cvChannel.includes('นอกเครือ')
        ) return true
        if (bst === null || bst === '' || bst === 'null') {
          if (!cvChannel.toLowerCase().includes('lotus') && !cvChannel.toLowerCase().includes('makro')) {
            return true
          }
        }
        return false
      })
      .map((r: Record<string, unknown>) => {
        if (hasNativeFormat) {
          const skuCol = cols.includes('rProduct_code') ? 'rProduct_code' : cols.find(c => c.toLowerCase().includes('product') && c.toLowerCase().includes('code')) ?? ''
          const nameCol = cols.includes('rProduct_name') ? 'rProduct_name' : cols.find(c => c.toLowerCase().includes('product') && c.toLowerCase().includes('name')) ?? ''
          const qtyCol = cols.includes('rStock_wgt') ? 'rStock_wgt' : cols.includes('rPlan_wgt') ? 'rPlan_wgt' : cols.find(c => ['qty','quantity','wgt'].some(k => c.toLowerCase().includes(k))) ?? ''
          const dateCol = cols.includes('rDoc_date') ? 'rDoc_date' : cols.find(c => c.toLowerCase().includes('doc') && c.toLowerCase().includes('date')) ?? cols.find(c => c.toLowerCase().includes('date') && !c.toLowerCase().startsWith('rr')) ?? ''
          const dlvCol = cols.includes('rRDate2') ? 'rRDate2' : cols.includes('rRDate1') ? 'rRDate1' : cols.includes('rReq_date') ? 'rReq_date' : cols.find(c => c.toLowerCase().includes('req') || c.toLowerCase().includes('delivery')) ?? ''

          const orderDate = toISODate(r[dateCol])
          const deliveryDate = toISODate(r[dlvCol])

          let qty = parseFloat(String(r[qtyCol] ?? '0')) || 0
          if (qty === 0 && cols.includes('rPlan_wgt')) {
            qty = parseFloat(String(r['rPlan_wgt'] ?? '0')) || 0
          }
          return {
            order_date:    orderDate,
            delivery_date: deliveryDate,
            sku:           String(r[skuCol] ?? '').trim(),
            sku_name:      String(r[nameCol] ?? '').trim(),
            quantity:      qty,
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
        await supabase.from('wet_market_orders')
          .delete()
          .in('delivery_date', deliveryDates)
          .eq('upload_round', round ?? '0800')
      }
    }

    const { error } = await supabase.from('wet_market_orders').insert(records)
    if (error) throw error

    const tableName = round ? `wet_market_orders_${round}` : 'wet_market_orders'
    await supabase.from('upload_log').insert({
      table_name: tableName,
      source_file: filename ?? 'unknown',
      record_count: records.length,
    })

    syncToDev(async (dev) => {
      if (!append) {
        const dDates = Array.from(new Set(records.map((r: { delivery_date: string }) => r.delivery_date).filter(Boolean)))
        if (dDates.length) {
          await dev.from('wet_market_orders').delete().in('delivery_date', dDates).eq('upload_round', round ?? '0800')
        }
      }
      await batchInsert(dev, 'wet_market_orders', records)
    })

    // Fire-and-forget Phase 2 auto-gen (runs in its own serverless function to avoid timeout)
    if (round === '1400') {
      fetch(`${req.nextUrl.origin}/api/auto-generate-phase2`, { method: 'POST' }).catch(() => {})
    }

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
    const tableName = round ? `wet_market_orders_${round}` : 'wet_market_orders'
    await supabase.from('wet_market_orders').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete().eq('table_name', tableName).eq('source_file', sourceFile)
    syncToDev(async (dev) => {
      await dev.from('wet_market_orders').delete().eq('source_file', sourceFile)
    })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
