import { supabase } from '@/lib/supabase'
import { ParsedRow } from '@/lib/parser'

// ─── Date helpers ─────────────────────────────────────────────────────────────

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
    const dt = new Date(Math.round((num - 25569) * 86400 * 1000))
    const y  = dt.getUTCFullYear() > 2400 ? dt.getUTCFullYear() - 543 : dt.getUTCFullYear()
    return `${y}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
  }
  return null
}

function shiftDate(iso: string | null, days: number): string | null {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

// ─── Column detection & row transformation ────────────────────────────────────

type OrderRecord = {
  order_date: string | null
  delivery_date: string | null
  sku: string
  sku_name: string
  quantity: number
  period: string | null
  upload_round: string
  source_file: string
}

function transformRows(
  rows: ParsedRow[],
  filename: string,
  round: string,
  deliveryShiftDays = 0,
  channel?: 'lotus' | 'wet_market',
): OrderRecord[] {
  if (!rows.length) return []
  const cols = Object.keys(rows[0])
  const hasNative = cols.some(c => c.startsWith('r') && c.length > 2)

  const getRowValue = (r: ParsedRow, targetKey: string): string | null => {
    const key = Object.keys(r).find(k => k.toLowerCase() === targetKey.toLowerCase())
    if (key === undefined || r[key] === null || r[key] === undefined) return null
    return String(r[key]).trim()
  }

  // Filter rows based on channel constraints if native columns exist
  let filteredRows = rows
  if (channel === 'wet_market') {
    filteredRows = rows.filter(r => {
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
  } else if (channel === 'lotus') {
    filteredRows = rows.filter(r => {
      const bst = getRowValue(r, 'rBst_code')
      const oper = getRowValue(r, 'rOper_code')
      const cvChannel = getRowValue(r, 'rCv_channel') || ''
      const cvName = getRowValue(r, 'rCv_name') || ''
      if (bst === '923' || oper === '489') return true
      if (cvChannel.toLowerCase().includes('lotus') || cvName.toLowerCase().includes('lotus')) return true
      if ((bst === null || bst === '' || bst === 'null') && (oper === null || oper === '' || oper === 'null')) {
        if (cvChannel === '' || cvChannel === 'null' || cvChannel.toLowerCase().includes('lotus')) {
          return true
        }
      }
      return false
    })
  }

  const skuCol  = hasNative
    ? (cols.includes('rProduct_code') ? 'rProduct_code' : cols.find(c => c.toLowerCase().includes('product') && c.toLowerCase().includes('code')) ?? '')
    : ''
  const nameCol = hasNative
    ? (cols.includes('rProduct_name') ? 'rProduct_name' : cols.find(c => c.toLowerCase().includes('product') && c.toLowerCase().includes('name')) ?? '')
    : ''
  const qtyCol  = hasNative
    ? (cols.includes('rStock_wgt') ? 'rStock_wgt' : cols.includes('rPlan_wgt') ? 'rPlan_wgt' : cols.find(c => ['qty','quantity','wgt'].some(k => c.toLowerCase().includes(k))) ?? '')
    : ''
  const dateCol = hasNative
    ? (cols.includes('rDoc_date') ? 'rDoc_date' : cols.find(c => c.toLowerCase().includes('doc') && c.toLowerCase().includes('date')) ?? cols.find(c => c.toLowerCase().includes('date') && !c.toLowerCase().startsWith('rr')) ?? '')
    : ''
  const dlvCol  = hasNative
    ? (cols.includes('rRDate2') ? 'rRDate2' : cols.includes('rRDate1') ? 'rRDate1' : cols.includes('rReq_date') ? 'rReq_date' : cols.find(c => c.toLowerCase().includes('req') || c.toLowerCase().includes('delivery')) ?? '')
    : ''

  return filteredRows.map(r => {
    if (hasNative) {
      let qty = parseFloat(String(r[qtyCol] ?? '0')) || 0
      if (qty === 0 && cols.includes('rPlan_wgt')) {
        qty = parseFloat(String(r['rPlan_wgt'] ?? '0')) || 0
      }
      return {
        order_date:    toISODate(r[dateCol]),
        delivery_date: shiftDate(toISODate(r[dlvCol]), deliveryShiftDays),
        sku:           String(r[skuCol] ?? '').trim(),
        sku_name:      String(r[nameCol] ?? '').trim(),
        quantity:      qty,
        period:        null,
        upload_round:  round,
        source_file:   filename,
      }
    }
    return {
      order_date:    toISODate(r['วันที่สั่ง'] ?? r['order_date']),
      delivery_date: shiftDate(toISODate(r['วันที่ส่ง'] ?? r['delivery_date']), deliveryShiftDays),
      sku:           String(r['SKU'] ?? r['รหัสสินค้า'] ?? '').trim(),
      sku_name:      String(r['ชื่อสินค้า'] ?? r['product_name'] ?? '').trim(),
      quantity:      Number(r['ปริมาณ'] ?? r['จำนวน'] ?? r['qty'] ?? 0) || 0,
      period:        String(r['ช่วงเวลา'] ?? '').trim() || null,
      upload_round:  round,
      source_file:   filename,
    }
  }).filter(r => r.sku && r.quantity > 0)
}

// ─── Direct Supabase upload (no Vercel function, no size limit) ───────────────

const BATCH = 1000

async function insertDirect(
  table: 'lotus_orders' | 'wet_market_orders',
  logTable: string,
  records: OrderRecord[],
  filename: string,
  round: string,
): Promise<{ success: boolean; message: string }> {
  // Delete existing rows for these delivery dates
  const deliveryDates = Array.from(new Set(records.map(r => r.delivery_date).filter(Boolean)))
  if (deliveryDates.length) {
    const { error: delErr } = await supabase.from(table).delete()
      .in('delivery_date', deliveryDates as string[])
      .eq('upload_round', round)
    if (delErr) return { success: false, message: delErr.message }
  }

  // Insert in batches of BATCH rows
  for (let i = 0; i < records.length; i += BATCH) {
    const { error } = await supabase.from(table).insert(records.slice(i, i + BATCH))
    if (error) return { success: false, message: error.message }
  }

  // Replace any previous log entries for this file (clean up old chunks)
  await supabase.from('upload_log').delete()
    .eq('table_name', logTable)
    .eq('source_file', filename)
  await supabase.from('upload_log').insert({
    table_name:   logTable,
    source_file:  filename,
    record_count: records.length,
  })

  return { success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` }
}

export async function uploadLotusOrders(
  rows: ParsedRow[],
  filename: string,
  round: string,
): Promise<{ success: boolean; message: string }> {
  const records = transformRows(rows, filename, round, -1, 'lotus')  // lotus shifts delivery by -1
  if (!records.length) {
    const cols = rows.length ? Object.keys(rows[0]).join(', ') : '-'
    return { success: false, message: `ไม่พบรายการที่ถูกต้อง — columns ที่พบ: ${cols}` }
  }
  const logTable = round ? `lotus_orders_${round}` : 'lotus_orders'
  return insertDirect('lotus_orders', logTable, records, filename, round)
}

export async function uploadWetMarketOrders(
  rows: ParsedRow[],
  filename: string,
  round: string,
): Promise<{ success: boolean; message: string }> {
  const records = transformRows(rows, filename, round, 0, 'wet_market')  // wet market no shift
  if (!records.length) {
    const cols = rows.length ? Object.keys(rows[0]).join(', ') : '-'
    return { success: false, message: `ไม่พบรายการที่ถูกต้อง — columns ที่พบ: ${cols}` }
  }
  const logTable = round ? `wet_market_orders_${round}` : 'wet_market_orders'
  return insertDirect('wet_market_orders', logTable, records, filename, round)
}
