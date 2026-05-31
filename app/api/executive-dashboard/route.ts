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
    { data: plan100 },
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
    supabase
      .from('production_plan_100')
      .select('plan_date, sap, makro_weight, cpft_weight, lotus_weight')
      .in('plan_date', histDates),
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

  // ── Order: normSku → total kg, latest upload_round only per channel
  const latestRound = (rows: { upload_round?: string | null }[]): string | null => {
    const rounds = [...new Set(rows.map(r => r.upload_round).filter(Boolean) as string[])]
    return rounds.sort((a, b) => b.localeCompare(a))[0] ?? null
  }
  const wmRound    = latestRound(wmOrders    ?? [])
  const lotusRound = latestRound(lotusOrders ?? [])
  const makroRound = latestRound(makroOrders ?? [])

  const filterLatest = <T extends { upload_round?: string | null }>(rows: T[], round: string | null) =>
    round ? rows.filter(r => r.upload_round === round) : rows

  const orderMap = new Map<string, { qty: number; sku_name: string }>()
  for (const row of [
    ...filterLatest(wmOrders    ?? [], wmRound),
    ...filterLatest(lotusOrders ?? [], lotusRound),
    ...filterLatest(makroOrders ?? [], makroRound),
  ]) {
    const norm = (row.sku ?? '').replace(/^0+/, '')
    const cur = orderMap.get(norm) ?? { qty: 0, sku_name: row.sku_name ?? '' }
    cur.qty += Number(row.quantity ?? 0)
    if (!cur.sku_name && row.sku_name) cur.sku_name = row.sku_name
    orderMap.set(norm, cur)
  }

  // ── Baseline: avg of last-3-days plan_100 per normSku
  // Makro uses makro_weight, Lotus/WM uses lotus_weight + cpft_weight
  // Sum per (plan_date, normSku) across stations, then average across dates
  const planByDateSku = new Map<string, number>() // "date|||normSku" → total kg
  for (const r of plan100 ?? []) {
    const norm = (r.sap ?? '').replace(/^0+/, '')
    const key = `${r.plan_date}|||${norm}`
    const kg = Number(r.makro_weight ?? 0) + Number(r.lotus_weight ?? 0) + Number(r.cpft_weight ?? 0)
    planByDateSku.set(key, (planByDateSku.get(key) ?? 0) + kg)
  }
  const baselineSumMap = new Map<string, number>()
  const baselineCntMap = new Map<string, number>()
  for (const [key, kg] of planByDateSku) {
    const norm = key.split('|||')[1]
    baselineSumMap.set(norm, (baselineSumMap.get(norm) ?? 0) + kg)
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

  // ── Build result rows
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
      baseline: round1(baselineMap.get(normSku) ?? 0),
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
