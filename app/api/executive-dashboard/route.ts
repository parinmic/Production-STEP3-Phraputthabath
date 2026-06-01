import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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
    { data: wmHist },
    { data: lotusHist },
    { data: makroHist },
    { data: yieldData },
    { data: pickingUnit },
  ] = await Promise.all([
    supabase
      .from('production_assignments')
      .select('table_name, sku, sku_name, target_quantity, period')
      .eq('production_date', date)
      .in('table_name', ['สามชั้น', 'สะโพก', 'ไหล่']),
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
    // BL3 history — Wet Market round 1600
    supabase
      .from('wet_market_orders')
      .select('sku, quantity, delivery_date')
      .in('delivery_date', histDates)
      .eq('upload_round', '1600'),
    // BL3 history — LOTUS round 1600
    supabase
      .from('lotus_orders')
      .select('sku, quantity, delivery_date')
      .in('delivery_date', histDates)
      .eq('upload_round', '1600'),
    // BL3 history — Makro round 1400 (แผน Makro 100%)
    supabase
      .from('makro_orders')
      .select('sku, quantity, delivery_date')
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
  const periodsGenerated = new Set((assignments ?? []).map(a => a.period))
  const hasPhase3 = periodsGenerated.has('ค่ำ')
  const hasPhase2 = periodsGenerated.has('บ่าย')

  // ── Order: logic depends on which phases have been generated
  //   Phase 3: Plan 100% (today) + Makro '1400' for SKUs not in Plan 100%
  //   Phase 2: Makro '1400' + LOTUS '1400' + WM '1400'
  //   Phase 1 only: Makro '0800'
  const orderMap = new Map<string, { qty: number; sku_name: string }>()

  const addOrder = (sku: string, qty: number, name: string) => {
    const norm = sku.replace(/^0+/, '')
    const cur = orderMap.get(norm) ?? { qty: 0, sku_name: name }
    cur.qty += qty
    if (!cur.sku_name && name) cur.sku_name = name
    orderMap.set(norm, cur)
  }

  const byRound = <T extends { upload_round?: string | number | null }>(rows: T[], round: string) =>
    rows.filter(r => String(r.upload_round ?? '') === round)

  if (hasPhase3) {
    // Primary: Plan 100% covers all planned SKUs
    const plan100Skus = new Set<string>()
    for (const r of plan100Today ?? []) {
      const norm = (r.sap ?? '').replace(/^0+/, '')
      plan100Skus.add(norm)
      addOrder(r.sap ?? '', Number(r.weight_total ?? 0), r.product_name ?? '')
    }
    // Remainder: SKUs not in Plan 100% come from all channels (mirrors generate-plan Phase 3 append logic)
    for (const r of [
      ...byRound(makroOrders ?? [], '1400'),
      ...byRound(lotusOrders ?? [], '1400'),
      ...byRound(wmOrders    ?? [], '1400'),
    ]) {
      const norm = (r.sku ?? '').replace(/^0+/, '')
      if (!plan100Skus.has(norm))
        addOrder(r.sku ?? '', Number(r.quantity ?? 0), r.sku_name ?? '')
    }
  } else if (hasPhase2) {
    for (const r of [
      ...byRound(makroOrders ?? [], '1400'),
      ...byRound(lotusOrders ?? [], '1400'),
      ...byRound(wmOrders    ?? [], '1400'),
    ]) {
      addOrder(r.sku ?? '', Number(r.quantity ?? 0), r.sku_name ?? '')
    }
  } else {
    for (const r of byRound(makroOrders ?? [], '0800')) {
      addOrder(r.sku ?? '', Number(r.quantity ?? 0), r.sku_name ?? '')
    }
  }

  // ── Baseline: avg of last-3-days orders per SKU (WM round 1600 + LOTUS round 1600 + Makro round 1400)
  // Sum per (date, normSku) across all channels first, then average across dates
  const baselineByDateSku = new Map<string, number>() // "date|||normSku" → total qty that day

  const addBaseline = (sku: string, qty: number, deliveryDate: string) => {
    const norm = sku.replace(/^0+/, '')
    const key  = `${deliveryDate}|||${norm}`
    baselineByDateSku.set(key, (baselineByDateSku.get(key) ?? 0) + qty)
  }

  for (const r of wmHist    ?? []) addBaseline(r.sku, Number(r.quantity), r.delivery_date)
  for (const r of lotusHist ?? []) addBaseline(r.sku, Number(r.quantity), r.delivery_date)
  for (const r of makroHist ?? []) addBaseline(r.sku, Number(r.quantity), r.delivery_date)

  const baselineSumMap = new Map<string, number>()
  const baselineCntMap = new Map<string, number>()
  for (const [key, qty] of baselineByDateSku) {
    const norm = key.split('|||')[1]
    baselineSumMap.set(norm, (baselineSumMap.get(norm) ?? 0) + qty)
    baselineCntMap.set(norm, (baselineCntMap.get(norm) ?? 0) + 1)
  }
  const baselineMap = new Map<string, number>()
  for (const [norm, sum] of baselineSumMap) {
    baselineMap.set(norm, sum / (baselineCntMap.get(norm) ?? 1))
  }

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
  const STATION_ORDER = ['สามชั้น', 'สะโพก', 'ไหล่']

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
