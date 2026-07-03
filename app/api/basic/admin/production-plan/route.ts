import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/basic/admin/production-plan?date=2026-07-02&period=เช้า
// Returns rows for the date (optionally filtered by period), augmented with
// 3-day order history (D-3, D-2, D-1) summed across Makro + LOTUS by normalized sap.
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  const period = req.nextUrl.searchParams.get('period')
  if (!date) return NextResponse.json({ rows: [] })

  let q = supabase
    .from('production_plan_100')
    .select('*')
    .eq('plan_date', date)
    .order('station')
    .order('seq')
  if (period) q = q.eq('period', period)

  const { data, error } = await q
  if (error) return NextResponse.json({ rows: [], error: error.message }, { status: 500 })

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

  // Build normalized sap lookup set (strip/pad leading zeros, same pattern as Special)
  const saps = Array.from(new Set((data ?? []).map(r => r.sap)))
  const querySaps = new Set<string>()
  for (const s of saps) {
    if (s) {
      querySaps.add(s)
      const norm = s.replace(/^0+/, '')
      if (norm) {
        querySaps.add(norm)
        querySaps.add(norm.padStart(18, '0'))
      }
    }
  }
  const sapsList = Array.from(querySaps)

  let makroOrders: any[] = []
  let lotusOrders: any[] = []

  if (sapsList.length > 0) {
    const [mD3, mD2, mD1, lD3, lD2, lD1] = await Promise.all([
      supabase.from('makro_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD3).in('sku', sapsList).eq('upload_round', '1400'),
      supabase.from('makro_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD2).in('sku', sapsList).eq('upload_round', '1400'),
      supabase.from('makro_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD1).in('sku', sapsList).eq('upload_round', '1400'),
      supabase.from('lotus_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD3).in('sku', sapsList).eq('upload_round', '1600'),
      supabase.from('lotus_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD2).in('sku', sapsList).eq('upload_round', '1600'),
      supabase.from('lotus_orders').select('sku, quantity, delivery_date').eq('delivery_date', dateD1).in('sku', sapsList).eq('upload_round', '1600'),
    ])
    makroOrders = [...(mD3.data ?? []), ...(mD2.data ?? []), ...(mD1.data ?? [])]
    lotusOrders = [...(lD3.data ?? []), ...(lD2.data ?? []), ...(lD1.data ?? [])]
  }

  const orderMap = new Map<string, number>()
  const addOrders = (rows: any[]) => {
    for (const r of rows) {
      const norm = r.sku.replace(/^0+/, '') || r.sku
      const key = `${norm}||${r.delivery_date}`
      orderMap.set(key, (orderMap.get(key) || 0) + Number(r.quantity))
    }
  }
  addOrders(makroOrders)
  addOrders(lotusOrders)

  const rows = (data ?? []).map(r => {
    const normSap = String(r.sap).replace(/^0+/, '') || r.sap
    return {
      ...r,
      qty_d3: orderMap.get(`${normSap}||${dateD3}`) || 0,
      qty_d2: orderMap.get(`${normSap}||${dateD2}`) || 0,
      qty_d1: orderMap.get(`${normSap}||${dateD1}`) || 0,
    }
  })

  return NextResponse.json({ rows, dates: { d3: dateD3, d2: dateD2, d1: dateD1 } })
}

// PATCH /api/basic/admin/production-plan
// body: { id, qty_bags, weight_total } — each row is already atomic (no worker
// dimension to redistribute across), so editing is a direct single-row update.
export async function PATCH(req: NextRequest) {
  try {
    const { id, qty_bags, weight_total } = await req.json()
    if (!id) return NextResponse.json({ success: false, message: 'ไม่พบ id' }, { status: 400 })

    const { error } = await supabase
      .from('production_plan_100')
      .update({ qty_bags, weight_total })
      .eq('id', id)

    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

// DELETE /api/basic/admin/production-plan?id=123           — single-row delete (existing)
// DELETE /api/basic/admin/production-plan  body:{date,period} — bulk delete a whole phase
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')

  if (id) {
    const { error } = await supabase.from('production_plan_100').delete().eq('id', id)
    if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  const body = await req.json().catch(() => ({}))
  if (body.date && body.period) {
    const { error, count } = await supabase
      .from('production_plan_100')
      .delete({ count: 'exact' })
      .eq('plan_date', body.date)
      .eq('period', body.period)
    if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 })
    return NextResponse.json({ success: true, deleted: count ?? 0 })
  }

  return NextResponse.json({ success: false, message: 'ต้องระบุ id หรือ (date และ period)' }, { status: 400 })
}

// POST /api/basic/admin/production-plan
// body: { plan_date, station, sap, product_name, weight_per_bag, qty_bags, weight_total, period }
export async function POST(req: NextRequest) {
  const body = await req.json()

  const row = {
    plan_date:      body.plan_date,
    station:        body.station,
    seq:            null,
    step:           null,
    unix_code:      null,
    sap:            String(body.sap ?? '').trim(),
    product_name:   body.product_name || null,
    weight_per_bag: Number(body.weight_per_bag ?? 0),
    qty_bags:       Number(body.qty_bags ?? 0),
    weight_total:   Number(body.weight_total ?? 0),
    lotus_bags:     0,
    lotus_weight:   0,
    cpft_bags:      0,
    cpft_weight:    0,
    makro_bags:     0,
    makro_weight:   0,
    period:         body.period || null,
    source_file:    'manual-admin-entry',
  }

  if (!row.plan_date || !row.station || !row.sap)
    return NextResponse.json({ success: false, message: 'กรุณากรอก plan_date, station, sap' }, { status: 400 })

  const { error } = await supabase.from('production_plan_100').insert(row)
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
