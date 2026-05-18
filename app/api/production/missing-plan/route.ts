import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/production/missing-plan?date=2026-05-18
// Returns SKUs at ไหล่พิเศษ / สะโพกพิเศษ / สามชั้นพิเศษ that have orders but no production plan today

const TARGET_STATIONS = ['ไหล่พิเศษ', 'สะโพกพิเศษ', 'สามชั้นพิเศษ']

async function fetchAll<T = Record<string, unknown>>(
  table: string,
  select: string,
  filters: { col: string; op: 'eq' | 'in'; val: unknown }[],
): Promise<T[]> {
  const PAGE = 1000
  const all: T[] = []
  let from = 0
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + PAGE - 1)
    for (const f of filters) {
      if (f.op === 'eq') q = q.eq(f.col, f.val)
      else if (f.op === 'in') q = q.in(f.col, f.val as string[])
    }
    const { data, error } = await q
    if (error) throw error
    all.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return all
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]

  const d = new Date(date)
  const histDates = [1, 2, 3].map(n => {
    const h = new Date(d); h.setDate(d.getDate() - n)
    return h.toISOString().split('T')[0]
  })

  const [
    { data: masterProd },
    assigned,
    makro0800,
    makro1400,
    wm1400,
    wmBL3,
    lotus1400,
    lotusBL3,
    makroBL3,
  ] = await Promise.all([
    supabase.from('master_logic_calculation')
      .select('row_data')
      .eq('calculation_type', 'Mas Productivity')
      .order('uploaded_at', { ascending: false }),
    fetchAll<{ sku: string; period: string; channel: string }>('production_assignments', 'sku, period, channel', [
      { col: 'production_date', op: 'eq', val: date },
    ]),
    fetchAll<{ sku: string; sku_name: string | null; quantity: number }>('makro_orders', 'sku, sku_name, quantity', [
      { col: 'delivery_date', op: 'eq', val: date },
      { col: 'upload_round', op: 'eq', val: '0800' },
    ]),
    fetchAll<{ sku: string; sku_name: string | null; quantity: number }>('makro_orders', 'sku, sku_name, quantity', [
      { col: 'delivery_date', op: 'eq', val: date },
      { col: 'upload_round', op: 'eq', val: '1400' },
    ]),
    fetchAll<{ sku: string; sku_name: string | null; quantity: number }>('wet_market_orders', 'sku, sku_name, quantity', [
      { col: 'delivery_date', op: 'eq', val: date },
      { col: 'upload_round', op: 'eq', val: '1400' },
    ]),
    fetchAll<{ sku: string; quantity: number; delivery_date: string }>('wet_market_orders', 'sku, quantity, delivery_date', [
      { col: 'delivery_date', op: 'in', val: histDates },
      { col: 'upload_round', op: 'eq', val: '1600' },
    ]),
    fetchAll<{ sku: string; sku_name: string | null; quantity: number }>('lotus_orders', 'sku, sku_name, quantity', [
      { col: 'delivery_date', op: 'eq', val: date },
      { col: 'upload_round', op: 'eq', val: '1400' },
    ]),
    fetchAll<{ sku: string; quantity: number; delivery_date: string }>('lotus_orders', 'sku, quantity, delivery_date', [
      { col: 'delivery_date', op: 'in', val: histDates },
      { col: 'upload_round', op: 'eq', val: '1600' },
    ]),
    fetchAll<{ sku: string; quantity: number; delivery_date: string }>('makro_orders', 'sku, quantity, delivery_date', [
      { col: 'delivery_date', op: 'in', val: histDates },
      { col: 'upload_round', op: 'eq', val: '1400' },
    ]),
  ])

  // ── Parse Mas Productivity: get SKUs at target stations ──
  const prodRows = (masterProd ?? []).map(r => r.row_data as Record<string, unknown>)
  const skuInfo = new Map<string, { station: string; skuName: string; group: string; rate: number }>()
  for (const r of prodRows) {
    const station = String(r['จุดงาน'] ?? '').trim()
    if (!TARGET_STATIONS.includes(station)) continue
    const rawSku = String(r['SAP'] ?? '').trim()
    if (!rawSku) continue
    const sku = rawSku.replace(/^0+/, '')
    if (!skuInfo.has(sku)) {
      skuInfo.set(sku, {
        station,
        skuName: String(r['ชื่อสินค้า'] ?? '').trim(),
        group:   String(r['กลุ่มสินค้า'] ?? '').trim(),
        rate:    Number(r['กำลังการผลิต (กก./ชม./คน)'] ?? 0),
      })
    }
  }

  // ── Assigned SKUs today ──
  const assignedSkus = new Set(assigned.map(a => a.sku.replace(/^0+/, '')))

  // ── Aggregate order qty per SKU (normalize leading zeros) ──
  const agg = (rows: { sku: string; quantity: number }[]) => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const sku = r.sku.replace(/^0+/, '')
      m.set(sku, (m.get(sku) ?? 0) + r.quantity)
    }
    return m
  }

  const makro0800Map = agg(makro0800)
  const makro1400Map = agg(makro1400)
  const wm1400Map    = agg(wm1400)
  const lotus1400Map = agg(lotus1400)

  // BL3 avg
  const bl3Avg = (rows: { sku: string; quantity: number; delivery_date: string }[]) => {
    const bySkuDate: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      const sku = r.sku.replace(/^0+/, '')
      if (!bySkuDate[sku]) bySkuDate[sku] = {}
      bySkuDate[sku][r.delivery_date] = (bySkuDate[sku][r.delivery_date] ?? 0) + r.quantity
    }
    const result = new Map<string, number>()
    for (const [sku, byDate] of Object.entries(bySkuDate)) {
      const vals = Object.values(byDate)
      result.set(sku, vals.reduce((s, v) => s + v, 0) / vals.length)
    }
    return result
  }

  const wmBL3Map    = bl3Avg(wmBL3)
  const lotusBL3Map = bl3Avg(lotusBL3)
  const makroBL3Map = bl3Avg(makroBL3)

  // ── Build result: SKUs with orders/BL3 but no plan ──
  const missing: {
    sku: string
    sku_name: string
    station: string
    group: string
    assigned: boolean
    orders: {
      makro_0800: number; makro_1400: number
      wm_1400: number;   wm_bl3_avg: number
      lotus_1400: number; lotus_bl3_avg: number
    }
    likely_reason: string
  }[] = []

  for (const [sku, info] of Array.from(skuInfo.entries())) {
    const mk0800  = makro0800Map.get(sku) ?? 0
    const mk1400  = makro1400Map.get(sku) ?? 0
    const wmToday = wm1400Map.get(sku) ?? 0
    const wmBL3v  = wmBL3Map.get(sku) ?? 0
    const loToday = lotus1400Map.get(sku) ?? 0
    const loBL3v  = lotusBL3Map.get(sku) ?? 0
    const mkBL3v  = makroBL3Map.get(sku) ?? 0

    const hasOrder = mk0800 > 0 || mk1400 > 0 || wmToday > 0 || loToday > 0
    const hasBL3   = wmBL3v > 0 || loBL3v > 0 || mkBL3v > 0
    const isAssigned = assignedSkus.has(sku)

    if (!hasOrder && !hasBL3) continue  // ไม่มีทั้ง order และ BL3 → ข้าม
    if (isAssigned) continue            // มีแผนแล้ว → ข้าม

    // Diagnose likely reason
    let reason = ''
    if (!hasOrder && hasBL3) {
      reason = 'มี BL3 แต่ไม่มี Order วันนี้ — Phase 1 ควรวางแผน ตรวจสอบว่า Worker station ตรงกันไหม'
    } else if (hasOrder && !hasBL3) {
      reason = 'มี Order แต่ไม่มี BL3 — Phase 2 ควรวางแผน (BL3=0 ดังนั้น Phase 1 ข้าม)'
    } else {
      reason = 'มีทั้ง Order และ BL3 — ตรวจสอบว่า Worker หมดชั่วโมงหรือ station ไม่ตรงกัน'
    }

    missing.push({
      sku,
      sku_name: info.skuName,
      station:  info.station,
      group:    info.group,
      assigned: false,
      orders: {
        makro_0800: mk0800,
        makro_1400: mk1400,
        wm_1400:    wmToday,
        wm_bl3_avg: Math.round(wmBL3v),
        lotus_1400: loToday,
        lotus_bl3_avg: Math.round(loBL3v),
      },
      likely_reason: reason,
    })
  }

  // Group by station
  const byStation: Record<string, typeof missing> = {}
  for (const row of missing) {
    byStation[row.station] ??= []
    byStation[row.station].push(row)
  }
  for (const st of Object.keys(byStation)) {
    byStation[st].sort((a, b) => {
      const aMax = Math.max(a.orders.makro_0800, a.orders.makro_1400, a.orders.wm_1400, a.orders.lotus_1400, a.orders.wm_bl3_avg, a.orders.lotus_bl3_avg)
      const bMax = Math.max(b.orders.makro_0800, b.orders.makro_1400, b.orders.wm_1400, b.orders.lotus_1400, b.orders.wm_bl3_avg, b.orders.lotus_bl3_avg)
      return bMax - aMax
    })
  }

  return NextResponse.json({
    date,
    hist_dates: histDates,
    target_stations: TARGET_STATIONS,
    total_missing: missing.length,
    by_station: byStation,
  })
}
