import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchOpeningStock0010, lookupOpeningStockKg, fetchPaged, fetchProductivityByGroup, buildSkuLookup, normalizeSku } from '@/lib/generate-plan-basic'

const STATION_ORDER = ['สามชั้นเบสิค', 'สะโพกเบสิค', 'ไหล่เบสิค']

// ลำดับกลุ่มสินค้าตามที่ปรากฏในไฟล์ Mas Yield ล่าสุด (เรียงตาม id/ลำดับแถวที่อัพโหลด ไม่ใช่ตัวอักษร)
async function fetchMasYieldGroupOrder(): Promise<string[]> {
  const { data: latestLog } = await supabase
    .from('upload_log')
    .select('id')
    .eq('table_name', 'mas_yield')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!latestLog?.id) return []

  const { data } = await supabase
    .from('mas_yield')
    .select('product_group')
    .eq('upload_log_id', latestLog.id)
    .order('id', { ascending: true })

  const seen = new Set<string>()
  const order: string[] = []
  for (const row of data ?? []) {
    const g = String(row.product_group ?? '').trim()
    if (g && !seen.has(g)) { seen.add(g); order.push(g) }
  }
  return order
}

// GET /api/basic/admin/production-plan?date=2026-05-18&period=เช้า
// Returns data aggregated by SKU + Channel with 7-day order history + average (เฉพาะ station เบสิค)
export async function GET(req: NextRequest) {
  const date   = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  const period = req.nextUrl.searchParams.get('period')

  let q = supabase
    .from('production_assignments')
    .select('table_name, sku, sku_name, target_quantity, period, channel')
    .eq('production_date', date)
    .in('table_name', STATION_ORDER)
    .order('period')

  if (period) q = q.eq('period', period)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ย้อนหลัง 7 วัน (D-7 ... D-1) เรียงเก่า→ใหม่ ใช้ตรรกะเดียวกับ generate-plan-basic (หารด้วย 7 เสมอ)
  const [yr, mo, dy] = date.split('-').map(Number)
  const getOffsetDate = (offset: number) => {
    const d = new Date(yr, mo - 1, dy)
    d.setDate(d.getDate() - offset)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const r = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${r}`
  }
  const histDates = Array.from({ length: 7 }, (_, i) => getOffsetDate(7 - i))

  // Query order history for unique SKUs
  const skus = Array.from(new Set(data?.map(r => r.sku) || []))
  const querySkus = new Set<string>()
  for (const s of skus) {
    if (s) {
      querySkus.add(s)
      const norm = s.replace(/^0+/, '')
      if (norm) {
        querySkus.add(norm)
        querySkus.add(norm.padStart(18, '0'))
      }
    }
  }
  const skusList = Array.from(querySkus)
  const openingStockPromise = fetchOpeningStock0010(date)
  const groupOrderPromise = fetchMasYieldGroupOrder()
  const productivityByGroupPromise = fetchProductivityByGroup()

  type OrderRow = { sku: string; quantity: number; delivery_date: string }
  let makroOrders: OrderRow[] = []
  let wetOrders: OrderRow[] = []
  let lotusOrders: OrderRow[] = []

  if (skusList.length > 0) {
    ;[makroOrders, wetOrders, lotusOrders] = await Promise.all([
      fetchPaged<OrderRow>('makro_orders', 'sku, quantity, delivery_date',
        q2 => q2.in('delivery_date', histDates).in('sku', skusList).eq('upload_round', '1400')),
      fetchPaged<OrderRow>('wet_market_orders', 'sku, quantity, delivery_date',
        q2 => q2.in('delivery_date', histDates).in('sku', skusList).eq('upload_round', '1600')),
      fetchPaged<OrderRow>('lotus_orders', 'sku, quantity, delivery_date',
        q2 => q2.in('delivery_date', histDates).in('sku', skusList).eq('upload_round', '1600')),
    ])
  }

  const orderMap = new Map<string, number>()
  const addOrders = (rows: OrderRow[], channelName: string) => {
    for (const r of rows) {
      const norm = r.sku.replace(/^0+/, '') || r.sku
      const key = `${channelName}||${norm}||${r.delivery_date}`
      orderMap.set(key, (orderMap.get(key) || 0) + Number(r.quantity))
    }
  }
  addOrders(makroOrders, 'Makro')
  addOrders(wetOrders, 'Wet Market')
  addOrders(lotusOrders, 'LOTUS')

  const [openingStock, groupOrder, productivityByGroup] = await Promise.all([
    openingStockPromise, groupOrderPromise, productivityByGroupPromise,
  ])
  const skuLookup = buildSkuLookup(productivityByGroup)
  const groupIndexOf = (sku: string) => {
    const productGroup = skuLookup.get(normalizeSku(sku))?.productGroup
    if (!productGroup) return groupOrder.length
    const idx = groupOrder.indexOf(productGroup)
    return idx === -1 ? groupOrder.length : idx
  }

  // Aggregate by channel + table_name + sku (รวมทุก phase)
  type AggRow = {
    channel: string | null; table_name: string; sku: string
    sku_name: string | null; daily_qty: number[]; avg_qty: number; total_qty: number
  }
  const map = new Map<string, AggRow>()

  for (const r of data ?? []) {
    const normSku = r.sku.replace(/^0+/, '') || r.sku
    const ch = r.channel || null
    const key = `${ch ?? ''}||${r.table_name}||${normSku}`
    const cur = map.get(key)
    if (cur) {
      cur.total_qty += Number(r.target_quantity)
    } else {
      map.set(key, {
        channel:    ch,
        table_name: r.table_name,
        sku:        normSku,
        sku_name:   r.sku_name ?? null,
        daily_qty:  new Array(histDates.length).fill(0),
        avg_qty:    0,
        total_qty:  Number(r.target_quantity),
      })
    }
  }

  // Populate 7-day history + average (หารด้วยจำนวนวันเสมอ ตาม logic ของ generate-plan-basic)
  map.forEach((r) => {
    if (r.channel) {
      r.daily_qty = histDates.map(d => orderMap.get(`${r.channel}||${r.sku}||${d}`) || 0)
      r.avg_qty = r.daily_qty.reduce((s, v) => s + v, 0) / histDates.length
    }
  })

  // Yield Balance filler เลือก SKU เป้าหมายจาก SKU ที่มียอด Wet Market สูงสุดของกลุ่ม (ดู
  // fetchWetMarketTopSkuByGroup/buildEnoughYieldBalanceTargets ใน generate-plan-basic.ts) — ถ้า SKU
  // เดียวกันมีทั้งแถว Wet Market และแถว Yield Balance ในตาราง แปลว่าจับคู่กันได้จริง ให้รวมเป็นแถว
  // เดียวโดยแสดง "ยอดผลิต" เป็นผลรวมทั้งสอง channel และ "ส่วนต่าง Yield" เป็นยอด Yield Balance
  // เพียวๆ (ไม่ใช่ผลลบ) ส่วน SKU ที่เป็น Raw เฉพาะ (ไม่มีคู่ Wet Market เพราะลูกค้าไม่สั่ง SKU Raw
  // ตรงๆ) จะไม่มีคู่ให้จับ จึงยังคงเป็นแถวเดี่ยวตามเดิมโดยอัตโนมัติ
  const CHANNEL_ORDER = ['Makro', 'Wet Market', 'LOTUS']
  const sorted = Array.from(map.values())
    .filter(r => {
      // ตัดแถว Yield Balance ที่จับคู่กับ Wet Market ได้ทิ้ง เพราะจะถูกรวมเข้าไปในแถว Wet Market แทน
      return !(r.channel === 'Yield Balance' && map.has(`Wet Market||${r.table_name}||${r.sku}`))
    })
    .map(r => {
      const yieldBalancePair = r.channel === 'Wet Market'
        ? map.get(`Yield Balance||${r.table_name}||${r.sku}`)
        : undefined
      return {
        ...r,
        total_qty: r.total_qty + (yieldBalancePair?.total_qty ?? 0),
        opening_stock_kg: lookupOpeningStockKg(openingStock, r.sku, r.sku_name),
        yield_diff: yieldBalancePair ? yieldBalancePair.total_qty : null,
        merged: !!yieldBalancePair,
        parts: yieldBalancePair
          ? [{ channel: r.channel, total_qty: r.total_qty }, { channel: 'Yield Balance', total_qty: yieldBalancePair.total_qty }]
          : undefined,
      }
    })
    .sort((a, b) => {
      const stationDiff = STATION_ORDER.indexOf(a.table_name) - STATION_ORDER.indexOf(b.table_name)
      if (stationDiff !== 0) return stationDiff
      const groupDiff = groupIndexOf(a.sku) - groupIndexOf(b.sku)
      if (groupDiff !== 0) return groupDiff
      const skuDiff = a.sku.localeCompare(b.sku)
      if (skuDiff !== 0) return skuDiff
      return CHANNEL_ORDER.indexOf(a.channel ?? '') - CHANNEL_ORDER.indexOf(b.channel ?? '')
    })

  return NextResponse.json({
    data: sorted,
    dates: histDates,
  })
}

// PATCH /api/basic/admin/production-plan
// body: { date, table_name, sku, channel, new_qty }
export async function PATCH(req: NextRequest) {
  const { date, table_name, sku, channel, new_qty } = await req.json()
  if (!date || !table_name || !sku || new_qty == null)
    return NextResponse.json({ error: 'ต้องระบุ date, table_name, sku, new_qty' }, { status: 400 })
  if (!STATION_ORDER.includes(table_name))
    return NextResponse.json({ error: 'table_name ไม่ใช่ station ของฝั่งเบสิค' }, { status: 400 })

  // Fetch all rows for this SKU + station + channel (all phases)
  const normSku = String(sku).replace(/^0+/, '') || sku
  let query = supabase
    .from('production_assignments')
    .select('id, target_quantity')
    .eq('production_date', date)
    .eq('table_name', table_name)
    .or(`sku.eq.${normSku},sku.like.%${normSku}`)

  if (channel) {
    query = query.eq('channel', channel)
  } else {
    query = query.is('channel', null)
  }

  const { data: rows, error: fetchErr } = await query

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!rows?.length) return NextResponse.json({ error: 'ไม่พบรายการ' }, { status: 404 })

  const newTotal  = Number(new_qty)
  const oldTotal  = rows.reduce((s, r) => s + Number(r.target_quantity), 0)

  // Distribute proportionally; if oldTotal=0 spread equally across workers
  const updates = rows.map((r, i) => {
    let qty: number
    if (oldTotal > 0) {
      qty = Math.round(Number(r.target_quantity) / oldTotal * newTotal)
    } else {
      // spread equally, remainder to first worker
      qty = Math.floor(newTotal / rows.length) + (i === 0 ? newTotal % rows.length : 0)
    }
    return { id: r.id, target_quantity: qty }
  })

  for (const u of updates) {
    const { error } = await supabase
      .from('production_assignments')
      .update({ target_quantity: u.target_quantity })
      .eq('id', u.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, updated: updates.length })
}

// DELETE /api/basic/admin/production-plan
// body: { date, period } — delete all rows for that date+period (เฉพาะ station เบสิค)
export async function DELETE(req: NextRequest) {
  const body = await req.json()

  if (body.date && body.period) {
    const { error, count } = await supabase
      .from('production_assignments')
      .delete({ count: 'exact' })
      .eq('production_date', body.date)
      .eq('period', body.period)
      .in('table_name', STATION_ORDER)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, deleted: count ?? 0 })
  }

  return NextResponse.json({ error: 'ต้องระบุ date และ period' }, { status: 400 })
}

// POST /api/basic/admin/production-plan
// body: { production_date, period, table_name, sku, sku_name, target_quantity, channel }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const productionDate = body.production_date
  const tableName = body.table_name
  const period = body.period
  const sku = String(body.sku ?? '').trim()

  if (!productionDate || !tableName || !sku || !period)
    return NextResponse.json({ error: 'กรุณากรอก production_date, table_name, sku, period' }, { status: 400 })
  if (!STATION_ORDER.includes(tableName))
    return NextResponse.json({ error: 'table_name ไม่ใช่ station ของฝั่งเบสิค' }, { status: 400 })

  const { data: latestRows, error: latestErr } = await supabase
    .from('production_assignments')
    .select('effective_from')
    .eq('production_date', productionDate)
    .eq('table_name', tableName)
    .eq('period', period)
    .order('effective_from', { ascending: false })
    .limit(1)

  if (latestErr) return NextResponse.json({ error: latestErr.message }, { status: 500 })

  const row = {
    production_date:  productionDate,
    table_name:       tableName,
    worker_code:      '-',
    worker_name:      '-',
    sku,
    sku_name:         body.sku_name ?? null,
    target_quantity:  Number(body.target_quantity ?? 0),
    unit:             'กก.',
    period,
    channel:          body.channel ?? null,
    status:           'รอดำเนินการ',
    effective_from:   latestRows?.[0]?.effective_from ?? new Date().toISOString(),
  }

  const { error } = await supabase.from('production_assignments').insert(row)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
