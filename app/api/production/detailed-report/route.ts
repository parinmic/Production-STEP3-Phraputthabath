import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/production/detailed-report?date=YYYY-MM-DD&phase=1
export async function GET(req: NextRequest) {
  const sp    = req.nextUrl.searchParams
  const date  = sp.get('date') ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const phase = sp.get('phase') // '1' | '2' | '3' | null = all

  const periodMap: Record<string, string> = { '1': 'เช้า', '2': 'บ่าย', '3': 'ค่ำ' }

  // ─── 1. Find most-recent effective batch per period ────────────────────────
  const { data: periodRows } = await supabase
    .from('production_assignments')
    .select('period, effective_from')
    .eq('production_date', date)
    .in('table_name', ['สามชั้น', 'สะโพก', 'ไหล่'])
    .order('effective_from', { ascending: false })

  const maxEffective: Record<string, string> = {}
  for (const row of periodRows ?? []) {
    const p = row.period as string
    const e = row.effective_from as string
    if (!maxEffective[p] || e > maxEffective[p]) maxEffective[p] = e
  }

  const targetPeriods = phase && periodMap[phase]
    ? [periodMap[phase]]
    : ['เช้า', 'บ่าย', 'ค่ำ']

  // ─── 2. Fetch assignments ─────────────────────────────────────────────────
  const allAssignments: any[] = []
  for (const period of targetPeriods) {
    const effectiveFrom = maxEffective[period]
    if (!effectiveFrom) continue
    const { data } = await supabase
      .from('production_assignments')
      .select('table_name, sku, sku_name, target_quantity, channel, period, deadline_time')
      .eq('production_date', date)
      .eq('period', period)
      .eq('effective_from', effectiveFrom)
      .in('table_name', ['สามชั้น', 'สะโพก', 'ไหล่'])
    if (data) allAssignments.push(...data)
  }

  if (!allAssignments.length) return NextResponse.json({ rows: [] })

  // ─── 3. Aggregate by channel + station + sku ──────────────────────────────
  // For Phase 1: tasks with deadline_time ≥ 13:00 are "deficit" tasks
  // (pushed after 13:00 because stock was insufficient at plan time)
  type Entry = {
    sku: string; sku_name: string | null
    station: string; channel: string | null
    total_qty: number
    phase1_stock_ok_qty: number   // Phase 1 tasks with deadline < 13:00
    phase1_deficit_qty: number    // Phase 1 tasks with deadline ≥ 13:00
    periods: Set<string>
  }

  const skuMap = new Map<string, Entry>()

  for (const a of allAssignments) {
    const cleanSku = String(a.sku ?? '').replace(/^0+/, '') || String(a.sku)
    const key = `${a.channel ?? ''}||${a.table_name}||${cleanSku}`
    const qty = Number(a.target_quantity ?? 0)

    // Detect deficit task: Phase 1 with deadline ≥ 13:00 (780 min)
    let isDeficitTask = false
    if (a.period === 'เช้า' && a.deadline_time) {
      const parts = String(a.deadline_time).split(':').map(Number)
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        if (parts[0] * 60 + parts[1] >= 780) isDeficitTask = true
      }
    }

    const cur = skuMap.get(key)
    if (cur) {
      cur.total_qty += qty
      cur.periods.add(a.period)
      if (a.period === 'เช้า') {
        if (isDeficitTask) cur.phase1_deficit_qty += qty
        else cur.phase1_stock_ok_qty += qty
      }
    } else {
      skuMap.set(key, {
        sku: cleanSku, sku_name: a.sku_name ?? null,
        station: a.table_name, channel: a.channel ?? null,
        total_qty: qty,
        phase1_stock_ok_qty: (a.period === 'เช้า' && !isDeficitTask) ? qty : 0,
        phase1_deficit_qty:  (a.period === 'เช้า' && isDeficitTask)  ? qty : 0,
        periods: new Set([a.period]),
      })
    }
  }

  // ─── 4. Fetch BOM ─────────────────────────────────────────────────────────
  const uniqueSkus = Array.from(new Set(Array.from(skuMap.values()).map(v => v.sku)))
  const { data: bomRows } = await supabase
    .from('bom_items')
    .select('product_sap, raw_sap, raw_name, yield_pct')
    .in('product_sap', uniqueSkus)

  type BomEntry = { raw_sap: string; raw_name: string | null; yield_pct: number }
  const bomByProduct = new Map<string, BomEntry[]>()
  for (const b of bomRows ?? []) {
    if (!b.raw_sap) continue
    const cleanProd = String(b.product_sap).replace(/^0+/, '')
    const list = bomByProduct.get(cleanProd) ?? []
    list.push({
      raw_sap: String(b.raw_sap).replace(/^0+/, ''),
      raw_name: b.raw_name ?? null,
      yield_pct: Number(b.yield_pct ?? 0),
    })
    bomByProduct.set(cleanProd, list)
  }

  // ─── 5. Fetch stock ───────────────────────────────────────────────────────
  const allRawSaps = Array.from(new Set(
    Array.from(bomByProduct.values()).flatMap(boms => boms.map(b => b.raw_sap))
  ))

  type StockRow = { material_code: string; material_name: string | null; weight_total: number }
  const stockRows: StockRow[] = []

  if (allRawSaps.length > 0) {
    const [r0, r20] = await Promise.all([
      supabase.from('stock_0010').select('material_code, material_name, weight_total').in('material_code', allRawSaps).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, material_name, weight_total').in('material_code', allRawSaps).gt('weight_total', 0),
    ])
    stockRows.push(...(r0.data ?? []) as StockRow[], ...(r20.data ?? []) as StockRow[])
  }

  const stockByCode = new Map<string, number>()
  const stockNameByCode = new Map<string, string>()
  for (const s of stockRows) {
    const code = String(s.material_code).replace(/^0+/, '')
    stockByCode.set(code, (stockByCode.get(code) ?? 0) + Number(s.weight_total))
    if (s.material_name && !stockNameByCode.has(code)) stockNameByCode.set(code, s.material_name)
  }

  // ─── 6. Build result rows ─────────────────────────────────────────────────
  type BomDetail = {
    raw_sap: string; raw_name: string | null
    stock_kg: number
    yield_pct: number
    max_producible_kg: number
    needed_raw_kg: number
    stock_ok: boolean
  }

  type ResultRow = {
    sku: string; sku_name: string | null
    station: string; channel: string | null
    total_scheduled_qty: number
    initial_target_qty: number        // same as total (normal + deficit combined)
    phase1_stock_ok_qty: number       // qty that had stock → produced morning Phase 1
    phase1_deficit_qty: number        // qty that lacked stock → pushed to afternoon Phase 1
    has_stock_shortage: boolean       // deficit tasks exist
    max_producible_kg: number | null  // max from current stock via BOM
    current_stock_deficit: number     // max(0, scheduled - max_producible) from current stock
    bom: BomDetail[]
    periods: string[]
  }

  const rows: ResultRow[] = []

  for (const item of Array.from(skuMap.values())) {
    const boms = bomByProduct.get(item.sku) ?? []
    let overall_max = Infinity

    const bomDetail: BomDetail[] = boms.map(b => {
      const stock = stockByCode.get(b.raw_sap) ?? 0
      const yp    = b.yield_pct > 0 ? b.yield_pct : 1.0
      const max   = stock * yp
      if (max < overall_max) overall_max = max
      const needed = yp > 0 ? item.total_qty / yp : item.total_qty
      return {
        raw_sap:          b.raw_sap,
        raw_name:         b.raw_name ?? stockNameByCode.get(b.raw_sap) ?? null,
        stock_kg:         Math.round(stock   * 100) / 100,
        yield_pct:        yp,
        max_producible_kg:Math.round(max     * 100) / 100,
        needed_raw_kg:    Math.round(needed  * 100) / 100,
        stock_ok:         stock >= needed - 0.01,
      }
    })

    const maxProducible = boms.length > 0 && isFinite(overall_max)
      ? Math.round(overall_max * 100) / 100
      : null

    const currentStockDeficit = maxProducible !== null
      ? Math.max(0, Math.round((item.total_qty - maxProducible) * 100) / 100)
      : 0

    const hasStockShortage = item.phase1_deficit_qty > 0.01 || currentStockDeficit > 0.01

    rows.push({
      sku:                  item.sku,
      sku_name:             item.sku_name,
      station:              item.station,
      channel:              item.channel,
      total_scheduled_qty:  Math.round(item.total_qty * 100) / 100,
      initial_target_qty:   Math.round(item.total_qty * 100) / 100,
      phase1_stock_ok_qty:  Math.round(item.phase1_stock_ok_qty * 100) / 100,
      phase1_deficit_qty:   Math.round(item.phase1_deficit_qty  * 100) / 100,
      has_stock_shortage:   hasStockShortage,
      max_producible_kg:    maxProducible,
      current_stock_deficit:currentStockDeficit,
      bom:                  bomDetail,
      periods:              Array.from(item.periods),
    })
  }

  // ─── Sort: station → channel → sku ────────────────────────────────────────
  const STATION_ORDER = ['สามชั้น', 'สะโพก', 'ไหล่']
  const CH_ORDER      = ['Makro', 'Wet Market', 'LOTUS']
  rows.sort((a, b) => {
    const si = STATION_ORDER.indexOf(a.station) - STATION_ORDER.indexOf(b.station)
    if (si !== 0) return si
    const ci = CH_ORDER.indexOf(a.channel ?? '') - CH_ORDER.indexOf(b.channel ?? '')
    if (ci !== 0) return ci
    return a.sku.localeCompare(b.sku)
  })

  const deficitCount = rows.filter(r => r.has_stock_shortage).length

  return NextResponse.json({ rows, date, deficitCount })
}
