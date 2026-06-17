import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

type ChOrder = { sku?: string | null; sku_name?: string | null; quantity?: number | null; upload_round?: string | number | null }

function subDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date) return NextResponse.json({ rows: [] })

  const histDates = [1, 2, 3].map(n => subDays(date, n))

  const [
    { data: assignments },
    { data: wmOrders },
    { data: lotusOrders },
    { data: makroOrders },
    { data: plan100Today },
    { data: histPlan100 },
    { data: histMakro },
    { data: histLotus },
    { data: histWm },
    { data: yieldData },
    { data: pickingUnit },
  ] = await Promise.all([
    supabase
      .from('production_assignments')
      .select('table_name, sku, sku_name, target_quantity, period')
      .eq('production_date', date)
      .in('table_name', ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์', 'เผาขา', 'เลาะขา']),
    supabase
      .from('wet_market_orders')
      .select('sku, sku_name, quantity, upload_round')
      .eq('delivery_date', date),
    supabase
      .from('lotus_orders')
      .select('sku, sku_name, quantity, upload_round')
      .eq('delivery_date', date),
    supabase
      .from('makro_orders')
      .select('sku, sku_name, quantity, upload_round')
      .eq('delivery_date', date),
    // Plan 100% today — used for Phase 3 Order
    supabase
      .from('production_plan_100')
      .select('sap, product_name, weight_total')
      .eq('plan_date', date),
    // BL3 — plan100 ย้อนหลัง 3 วัน
    supabase
      .from('production_plan_100')
      .select('plan_date, sap, weight_total')
      .in('plan_date', histDates),
    // BL3 — makro ย้อนหลัง 3 วัน (ทุก round เพื่อ fallback 0800)
    supabase
      .from('makro_orders')
      .select('delivery_date, sku, quantity, upload_round')
      .in('delivery_date', histDates),
    // BL3 — lotus round 1400 ย้อนหลัง 3 วัน
    supabase
      .from('lotus_orders')
      .select('delivery_date, sku, quantity')
      .in('delivery_date', histDates)
      .eq('upload_round', '1400'),
    // BL3 — wet market round 1400 ย้อนหลัง 3 วัน
    supabase
      .from('wet_market_orders')
      .select('delivery_date, sku, quantity')
      .in('delivery_date', histDates)
      .eq('upload_round', '1400'),
    supabase
      .from('yield_bags')
      .select('sap_code, bags')
      .eq('work_date', date),
    supabase
      .from('picking_unit_master')
      .select('sap, weight_per_bag')
      .limit(5000),
  ])

  // ── Picking unit: sap → weight_per_bag (kg/bag)
  const wpbMap = new Map<string, number>()
  for (const r of pickingUnit ?? []) {
    const norm = r.sap.replace(/^0+/, '')
    wpbMap.set(r.sap, Number(r.weight_per_bag))
    wpbMap.set(norm, Number(r.weight_per_bag))
  }

  // ── Determine highest phase generated today
  const periodsGenerated = new Set((assignments as {period?: string|null}[] ?? []).map(a => a.period))
  const hasPhase3 = periodsGenerated.has('ค่ำ')
  const hasPhase2 = periodsGenerated.has('บ่าย')

  // วันที่ย้อนหลัง → แสดง Order แบบ Phase 3 เสมอ (Plan 100% + channel orders)
  const todayBKK = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const isHistorical = date !== todayBKK

  // ── Order
  const orderMap = new Map<string, { qty: number; sku_name: string }>()

  const addOrder = (sku: string, qty: number, name: string) => {
    const norm = sku.replace(/^0+/, '')
    const cur = orderMap.get(norm) ?? { qty: 0, sku_name: name }
    cur.qty += qty
    if (!cur.sku_name && name) cur.sku_name = name
    orderMap.set(norm, cur)
  }

  const byRound = (rows: ChOrder[], round: string): ChOrder[] =>
    rows.filter(r => String(r.upload_round ?? '') === round)

  const toChOrders = (data: unknown[] | null | undefined): ChOrder[] => (data ?? []) as ChOrder[]

  // Makro: '1400' is the updated afternoon round; fall back to '0800' for SKUs not in '1400'
  const makro1400 = byRound(toChOrders(makroOrders), '1400')
  const makro0800 = byRound(toChOrders(makroOrders), '0800')
  const makro1400Skus = new Set(makro1400.map(r => (r.sku ?? '').replace(/^0+/, '')))
  const makro0800Fallback = makro0800.filter(r => !makro1400Skus.has((r.sku ?? '').replace(/^0+/, '')))

  const buildPhase3Order = () => {
    const plan100Skus = new Set<string>()
    for (const r of plan100Today ?? []) {
      const norm = (r.sap ?? '').replace(/^0+/, '')
      plan100Skus.add(norm)
      addOrder(r.sap ?? '', Number(r.weight_total ?? 0), r.product_name ?? '')
    }
    // Makro '1400': รวมเสมอ แม้ SKU จะอยู่ใน plan100 (plan100 ครอบคลุม LOTUS+WM)
    for (const r of [...makro1400, ...makro0800Fallback]) {
      addOrder(r.sku ?? '', Number(r.quantity ?? 0), r.sku_name ?? '')
    }
    // LOTUS + WM '1400': เพิ่มเฉพาะ SKU ที่ไม่อยู่ใน plan100
    for (const r of [
      ...byRound(toChOrders(lotusOrders), '1400'),
      ...byRound(toChOrders(wmOrders),    '1400'),
    ]) {
      const norm = (r.sku ?? '').replace(/^0+/, '')
      if (!plan100Skus.has(norm))
        addOrder(r.sku ?? '', Number(r.quantity ?? 0), r.sku_name ?? '')
    }
  }

  if (isHistorical) {
    buildPhase3Order()
  } else if (hasPhase3) {
    buildPhase3Order()
  } else if (hasPhase2) {
    for (const r of [
      ...makro1400,
      ...makro0800Fallback,
      ...byRound(toChOrders(lotusOrders), '1400'),
      ...byRound(toChOrders(wmOrders),    '1400'),
    ]) {
      addOrder(r.sku ?? '', Number(r.quantity ?? 0), r.sku_name ?? '')
    }
  } else {
    for (const r of makro0800) {
      addOrder(r.sku ?? '', Number(r.quantity ?? 0), r.sku_name ?? '')
    }
  }

  // ── Baseline: avg Order ย้อนหลัง 3 วัน ใช้ logic เดียวกับ Order column (buildPhase3Order)
  // หาร 3 เสมอ (fixed denominator)
  type HP = { plan_date: string; sap: string | null; weight_total: number | null }
  type HO = { delivery_date: string; sku: string | null; quantity: number | null; upload_round?: string | number | null }

  const baselineSumMap = new Map<string, number>()

  for (const histDate of histDates) {
    const p100 = (histPlan100 as HP[]   ?? []).filter(r => r.plan_date === histDate)
    const mAll = (histMakro   as HO[]   ?? []).filter(r => r.delivery_date === histDate)
    const lot  = (histLotus   as HO[]   ?? []).filter(r => r.delivery_date === histDate)
    const wm   = (histWm      as HO[]   ?? []).filter(r => r.delivery_date === histDate)

    const dayOrder = new Map<string, number>()
    const p100Skus = new Set<string>()

    for (const r of p100) {
      const norm = (r.sap ?? '').replace(/^0+/, '')
      p100Skus.add(norm)
      dayOrder.set(norm, (dayOrder.get(norm) ?? 0) + Number(r.weight_total ?? 0))
    }

    const hm1400     = mAll.filter(r => String(r.upload_round) === '1400')
    const hm0800     = mAll.filter(r => String(r.upload_round) === '0800')
    const hm1400Skus = new Set(hm1400.map(r => (r.sku ?? '').replace(/^0+/, '')))

    for (const r of [...hm1400, ...hm0800.filter(r => !hm1400Skus.has((r.sku ?? '').replace(/^0+/, '')))]) {
      const norm = (r.sku ?? '').replace(/^0+/, '')
      dayOrder.set(norm, (dayOrder.get(norm) ?? 0) + Number(r.quantity ?? 0))
    }

    for (const r of [...lot, ...wm]) {
      const norm = (r.sku ?? '').replace(/^0+/, '')
      if (!p100Skus.has(norm))
        dayOrder.set(norm, (dayOrder.get(norm) ?? 0) + Number(r.quantity ?? 0))
    }

    for (const [norm, qty] of dayOrder)
      baselineSumMap.set(norm, (baselineSumMap.get(norm) ?? 0) + qty)
  }

  const baselineMap = new Map<string, number>()
  for (const [norm, sum] of baselineSumMap)
    baselineMap.set(norm, sum / 3)

  // ── Yield: normSku → bags count
  const yieldMap = new Map<string, number>()
  for (const r of yieldData ?? []) {
    const norm = (r.sap_code ?? '').replace(/^0+/, '')
    yieldMap.set(norm, (yieldMap.get(norm) ?? 0) + Number(r.bags ?? 0))
  }

  // ── Production: key="station|||normSku" → ph1/ph2/ph3 (กก.)
  type ProdEntry = { sku_name: string; ph1: number; ph2: number; ph3: number }
  const prodMap = new Map<string, ProdEntry>()
  for (const r of assignments ?? []) {
    const norm = (r.sku ?? '').replace(/^0+/, '')
    const key = `${r.table_name}|||${norm}`
    const cur = prodMap.get(key) ?? { sku_name: r.sku_name ?? '', ph1: 0, ph2: 0, ph3: 0 }
    const qty = Number(r.target_quantity ?? 0)
    if (r.period === 'เช้า') cur.ph1 += qty
    else if (r.period === 'บ่าย') cur.ph2 += qty
    else if (r.period === 'ค่ำ') cur.ph3 += qty
    if (!cur.sku_name && r.sku_name) cur.sku_name = r.sku_name
    prodMap.set(key, cur)
  }

  // ── Build result rows (sorted by station then sku_name)
  const round1 = (n: number) => Math.round(n * 10) / 10
  const STATION_ORDER = ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์', 'เผาขา', 'เลาะขา']

  const rows = Array.from(prodMap.entries()).map(([key, prod]) => {
    const sep = key.indexOf('|||')
    const station = key.slice(0, sep)
    const normSku = key.slice(sep + 3)
    const ph1 = round1(prod.ph1)
    const ph2 = round1(prod.ph2)
    const ph3 = round1(prod.ph3)
    const yieldBags = yieldMap.get(normSku) ?? 0
    const wpb = wpbMap.get(normSku)
    return {
      station,
      sku: normSku,
      sku_name: prod.sku_name || orderMap.get(normSku)?.sku_name || normSku,
      order_qty: round1(orderMap.get(normSku)?.qty ?? 0),
      baseline:  round1(baselineMap.get(normSku) ?? 0),
      ph1,
      ph2,
      ph3,
      total_prod: round1(prod.ph1 + prod.ph2 + prod.ph3),
      yield_bags: yieldBags,
      yield_kg: wpb && wpb > 0 ? round1(yieldBags * wpb) : null,
    }
  }).sort((a, b) => {
    const si = STATION_ORDER.indexOf(a.station) - STATION_ORDER.indexOf(b.station)
    return si !== 0 ? si : a.sku_name.localeCompare(b.sku_name, 'th')
  })

  return NextResponse.json({ rows })
}
