import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const PERIODS       = ['เช้า', 'บ่าย', 'ค่ำ']
const STATION_ORDER = ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์', 'เผาขา', 'เลาะขา']

// GET /api/admin/production-plan?date=2026-05-18&period=เช้า
// Returns data aggregated by SKU + Channel with 3-day history
export async function GET(req: NextRequest) {
  const date   = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  const period = req.nextUrl.searchParams.get('period')

  let q = supabase
    .from('production_assignments')
    .select('table_name, sku, sku_name, target_quantity, period, channel')
    .eq('production_date', date)
    .order('period')

  if (period) q = q.eq('period', period)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Calculate 3 prior dates (D-3, D-2, D-1) safely without UTC shift issues
  const [yr, mo, dy] = date.split('-').map(Number)
  const getOffsetDate = (offset: number) => {
    const d = new Date(yr, mo - 1, dy)
    d.setDate(d.getDate() - offset)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const r = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${r}`
  }
  const dateD1 = getOffsetDate(1)
  const dateD2 = getOffsetDate(2)
  const dateD3 = getOffsetDate(3)
  const histDates = [dateD3, dateD2, dateD1]

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

  let makroOrders: any[] = []
  let wetOrders: any[] = []
  let lotusOrders: any[] = []

  if (skusList.length > 0) {
    // Query per-date to avoid server-side row cap (each date ~500 rows, combined 1600+ exceeds default limit)
    const [mD3, mD2, mD1, wD3, wD2, wD1, lD3, lD2, lD1] = await Promise.all([
      supabase.from('makro_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD3).in('sku', skusList).eq('upload_round', '1400'),
      supabase.from('makro_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD2).in('sku', skusList).eq('upload_round', '1400'),
      supabase.from('makro_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD1).in('sku', skusList).eq('upload_round', '1400'),
      supabase.from('wet_market_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD3).in('sku', skusList).eq('upload_round', '1600'),
      supabase.from('wet_market_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD2).in('sku', skusList).eq('upload_round', '1600'),
      supabase.from('wet_market_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD1).in('sku', skusList).eq('upload_round', '1600'),
      supabase.from('lotus_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD3).in('sku', skusList).eq('upload_round', '1600'),
      supabase.from('lotus_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD2).in('sku', skusList).eq('upload_round', '1600'),
      supabase.from('lotus_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD1).in('sku', skusList).eq('upload_round', '1600'),
    ])
    makroOrders = [...(mD3.data ?? []), ...(mD2.data ?? []), ...(mD1.data ?? [])]
    wetOrders   = [...(wD3.data ?? []), ...(wD2.data ?? []), ...(wD1.data ?? [])]
    lotusOrders = [...(lD3.data ?? []), ...(lD2.data ?? []), ...(lD1.data ?? [])]
  }

  const orderMap = new Map<string, number>()
  const addOrders = (rows: any[], channelName: string) => {
    for (const r of rows) {
      const norm = r.sku.replace(/^0+/, '') || r.sku
      const key = `${channelName}||${norm}||${r.delivery_date}`
      orderMap.set(key, (orderMap.get(key) || 0) + Number(r.quantity))
    }
  }
  addOrders(makroOrders, 'Makro')
  addOrders(wetOrders, 'Wet Market')
  addOrders(lotusOrders, 'LOTUS')

  // Aggregate by channel + table_name + sku (รวมทุก phase)
  const map = new Map<string, {
    channel: string | null; table_name: string; sku: string
    sku_name: string | null; qty_d3: number; qty_d2: number; qty_d1: number; total_qty: number
  }>()

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
        qty_d3:     0,
        qty_d2:     0,
        qty_d1:     0,
        total_qty:  Number(r.target_quantity),
      })
    }
  }

  // Populate history quantities
  map.forEach((r) => {
    if (r.channel) {
      r.qty_d3 = orderMap.get(`${r.channel}||${r.sku}||${dateD3}`) || 0
      r.qty_d2 = orderMap.get(`${r.channel}||${r.sku}||${dateD2}`) || 0
      r.qty_d1 = orderMap.get(`${r.channel}||${r.sku}||${dateD1}`) || 0
    }
  })

  const CHANNEL_ORDER = ['Makro', 'Wet Market', 'LOTUS']
  const sorted = Array.from(map.values()).sort((a, b) => {
    const stationDiff = STATION_ORDER.indexOf(a.table_name) - STATION_ORDER.indexOf(b.table_name)
    if (stationDiff !== 0) return stationDiff
    const skuDiff = a.sku.localeCompare(b.sku)
    if (skuDiff !== 0) return skuDiff
    return CHANNEL_ORDER.indexOf(a.channel ?? '') - CHANNEL_ORDER.indexOf(b.channel ?? '')
  })

  return NextResponse.json({
    data: sorted,
    dates: { d3: dateD3, d2: dateD2, d1: dateD1 }
  })
}

// PATCH /api/admin/production-plan
// body: { date, table_name, sku, channel, new_qty }
export async function PATCH(req: NextRequest) {
  const { date, table_name, sku, channel, new_qty } = await req.json()
  if (!date || !table_name || !sku || new_qty == null)
    return NextResponse.json({ error: 'ต้องระบุ date, table_name, sku, new_qty' }, { status: 400 })

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

// DELETE /api/admin/production-plan
// body: { date, period } — delete all rows for that date+period
export async function DELETE(req: NextRequest) {
  const body = await req.json()

  if (body.date && body.period) {
    const { error, count } = await supabase
      .from('production_assignments')
      .delete({ count: 'exact' })
      .eq('production_date', body.date)
      .eq('period', body.period)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, deleted: count ?? 0 })
  }

  return NextResponse.json({ error: 'ต้องระบุ date และ period' }, { status: 400 })
}

// POST /api/admin/production-plan
// body: { production_date, period, table_name, sku, sku_name, target_quantity, channel }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const productionDate = body.production_date
  const tableName = body.table_name
  const period = body.period
  const sku = String(body.sku ?? '').trim()

  if (!productionDate || !tableName || !sku || !period)
    return NextResponse.json({ error: 'กรุณากรอก production_date, table_name, sku, period' }, { status: 400 })

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
