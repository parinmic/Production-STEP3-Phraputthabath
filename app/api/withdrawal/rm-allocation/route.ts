import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const normName = (s: string) => s.trim().toLowerCase().replace(/\s*-\s*/g, '-')
const round2 = (n: number) => Math.round(n * 100) / 100

export interface RawNeed {
  raw_sap: string
  raw_name: string
  needed_kg: number
  allocated_kg: number
  shortage_kg: number
}

export interface AllocationGroup {
  priority: number
  station: string
  purpose: string
  items: RawNeed[]
}

export interface RmAllocationResult {
  date: string
  summary: { raw_name: string; total_stock: number; total_allocated: number; remaining: number }[]
  allocation: AllocationGroup[]
  message?: string
}

type StockRow = { material_code: string; material_name: string | null; weight_total: number }

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get('date')
    if (!date) return NextResponse.json({ error: 'missing date' }, { status: 400 })

    // ── 1. WIP Plan ──────────────────────────────────────────────────────────
    const { data: wipRows } = await supabase
      .from('wip_plan')
      .select('sap_code, quantity')
      .eq('plan_date', date)
      .gt('quantity', 0)

    if (!wipRows?.length) {
      return NextResponse.json({
        date, summary: [], allocation: [],
        message: `ไม่พบ WIP Plan สำหรับวันที่ ${date}`,
      })
    }

    const wipSaps = wipRows.map(w => w.sap_code)

    // ── 2. BOM for WIP items ────────────────────────────────────────────────
    const { data: wipBomRows } = await supabase
      .from('bom_items')
      .select('product_sap, raw_sap, raw_name, yield_pct')
      .in('product_sap', wipSaps)

    const wipBomMap = new Map<string, { raw_sap: string; raw_name: string; yield_pct: number }[]>()
    for (const b of wipBomRows ?? []) {
      const list = wipBomMap.get(b.product_sap) ?? []
      list.push({ raw_sap: b.raw_sap, raw_name: b.raw_name ?? '', yield_pct: Number(b.yield_pct) })
      wipBomMap.set(b.product_sap, list)
    }

    // ── 3. Phase 1 (เช้า) production assignments — non-สไลด์ stations ────────
    const PHASE1_STATIONS = ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด']
    const { data: assnRows } = await supabase
      .from('production_assignments')
      .select('table_name, sku, sku_name, target_quantity')
      .eq('production_date', date)
      .eq('period', 'เช้า')
      .in('table_name', PHASE1_STATIONS)

    // Aggregate target_quantity per (station, sku)
    const skuQtyMap = new Map<string, { station: string; sku_name: string | null; qty: number }>()
    for (const a of assnRows ?? []) {
      const k = `${a.table_name}|||${a.sku}`
      const cur = skuQtyMap.get(k) ?? { station: a.table_name, sku_name: a.sku_name ?? null, qty: 0 }
      cur.qty += Number(a.target_quantity)
      skuQtyMap.set(k, cur)
    }

    // ── 4. BOM for station assignments ──────────────────────────────────────
    const assnSkus = Array.from(new Set(Array.from(skuQtyMap.keys()).map(k => k.split('|||')[1])))
    const { data: assnBomRows } = await supabase
      .from('bom_items')
      .select('product_sap, raw_sap, raw_name, yield_pct')
      .in('product_sap', assnSkus)

    const assnBomMap = new Map<string, { raw_sap: string; raw_name: string; yield_pct: number }[]>()
    for (const b of assnBomRows ?? []) {
      const list = assnBomMap.get(b.product_sap) ?? []
      list.push({ raw_sap: b.raw_sap, raw_name: b.raw_name ?? '', yield_pct: Number(b.yield_pct) })
      assnBomMap.set(b.product_sap, list)
    }

    // ── 5. Fetch raw material stock ─────────────────────────────────────────
    const allRawNames = Array.from(new Set([
      ...(wipBomRows ?? []).map(b => b.raw_name).filter(Boolean) as string[],
      ...(assnBomRows ?? []).map(b => b.raw_name).filter(Boolean) as string[],
    ]))
    const expandedNames = Array.from(new Set(
      allRawNames.flatMap(n => [n, n.replace(/\s*-\s*/g, '-'), n.replace(/\s*-\s*/g, ' - ')])
    ))

    let rawStockRows: StockRow[] = []
    if (expandedNames.length > 0) {
      const [r0010, r20] = await Promise.all([
        supabase.from('stock_0010').select('material_code, material_name, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
        supabase.from('stock_20').select('material_code, material_name, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
      ])
      rawStockRows = [...((r0010.data ?? []) as StockRow[]), ...((r20.data ?? []) as StockRow[])]
    }

    // Build raw pool keyed by normalized name
    const pool = new Map<string, number>()
    const normToDisplay = new Map<string, string>() // normName → display name

    for (const row of rawStockRows) {
      if (!row.material_name) continue
      const key = normName(row.material_name)
      pool.set(key, (pool.get(key) ?? 0) + Number(row.weight_total))
      normToDisplay.set(key, row.material_name)
    }

    const totalStock = new Map<string, number>(pool) // snapshot before allocation

    function takeFromPool(rawName: string, amount: number): number {
      const key = normName(rawName)
      const avail = pool.get(key) ?? 0
      const taken = Math.min(amount, avail)
      pool.set(key, avail - taken)
      return taken
    }

    // Helper: aggregate raw needs across all SKUs for a station
    function stationRawNeeds(station: string): Map<string, { raw_sap: string; raw_name: string; needed: number }> {
      const needs = new Map<string, { raw_sap: string; raw_name: string; needed: number }>()
      for (const [key, info] of Array.from(skuQtyMap.entries())) {
        if (info.station !== station) continue
        const sku = key.split('|||')[1]
        for (const bom of assnBomMap.get(sku) ?? []) {
          if (!bom.raw_name) continue
          const nameKey = normName(bom.raw_name)
          const rawNeeded = bom.yield_pct > 0 ? info.qty / bom.yield_pct : info.qty
          const cur = needs.get(nameKey) ?? { raw_sap: bom.raw_sap, raw_name: bom.raw_name, needed: 0 }
          cur.needed += rawNeeded
          needs.set(nameKey, cur)
        }
      }
      return needs
    }

    // ════════════════════════════════════════════════════════════════════════
    // P1 — สไลด์: ผลิต WIP ตามแผน (wip_plan.quantity = Final Plan วันนี้)
    // ════════════════════════════════════════════════════════════════════════
    const p1Items: RawNeed[] = []
    const finalPlanByWip = new Map<string, number>() // wip_sap → productionQty (used for P4 cap)

    for (const wip of wipRows) {
      const productionQty = Number(wip.quantity) // = Final Plan (แผนผลิตวันนี้)
      if (productionQty < 0.005) continue
      finalPlanByWip.set(wip.sap_code, productionQty)

      for (const bom of wipBomMap.get(wip.sap_code) ?? []) {
        const rawNeeded = bom.yield_pct > 0 ? productionQty / bom.yield_pct : productionQty
        const allocated = takeFromPool(bom.raw_name, rawNeeded)
        p1Items.push({
          raw_sap: bom.raw_sap,
          raw_name: bom.raw_name,
          needed_kg: round2(rawNeeded),
          allocated_kg: round2(allocated),
          shortage_kg: round2(Math.max(0, rawNeeded - allocated)),
        })
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // P2 — อื่น ๆ: สามชั้น, สะโพก, ไหล่
    // ════════════════════════════════════════════════════════════════════════
    const p2Groups: AllocationGroup[] = []
    for (const station of ['สามชั้น', 'สะโพก', 'ไหล่']) {
      const needs = stationRawNeeds(station)
      if (!needs.size) continue
      const items: RawNeed[] = []
      for (const { raw_sap, raw_name, needed } of Array.from(needs.values())) {
        const allocated = takeFromPool(raw_name, needed)
        items.push({
          raw_sap, raw_name,
          needed_kg: round2(needed),
          allocated_kg: round2(allocated),
          shortage_kg: round2(Math.max(0, needed - allocated)),
        })
      }
      items.sort((a, b) => b.needed_kg - a.needed_kg)
      p2Groups.push({ priority: 2, station, purpose: 'ผลิต Phase 1 ให้ครบ', items })
    }

    // ════════════════════════════════════════════════════════════════════════
    // P3 — หมูบด
    // ════════════════════════════════════════════════════════════════════════
    const p3Needs = stationRawNeeds('หมูบด')
    const p3Items: RawNeed[] = []
    for (const { raw_sap, raw_name, needed } of Array.from(p3Needs.values())) {
      const allocated = takeFromPool(raw_name, needed)
      p3Items.push({
        raw_sap, raw_name,
        needed_kg: round2(needed),
        allocated_kg: round2(allocated),
        shortage_kg: round2(Math.max(0, needed - allocated)),
      })
    }
    p3Items.sort((a, b) => b.needed_kg - a.needed_kg)

    // ════════════════════════════════════════════════════════════════════════
    // P4 — สไลด์: ผลิต WIP เพิ่ม ≤ 50% ของ Final Plan
    // ════════════════════════════════════════════════════════════════════════
    const p4Items: RawNeed[] = []
    for (const wip of wipRows) {
      const fp = finalPlanByWip.get(wip.sap_code) ?? 0
      if (fp < 0.005) continue
      const maxAdditional = fp * 0.5 // 50% ของ Final Plan

      for (const bom of wipBomMap.get(wip.sap_code) ?? []) {
        const rawNeeded = bom.yield_pct > 0 ? maxAdditional / bom.yield_pct : maxAdditional
        const allocated = takeFromPool(bom.raw_name, rawNeeded)
        p4Items.push({
          raw_sap: bom.raw_sap,
          raw_name: bom.raw_name,
          needed_kg: round2(rawNeeded),
          allocated_kg: round2(allocated),
          shortage_kg: round2(Math.max(0, rawNeeded - allocated)),
        })
      }
    }

    // ── Summary ─────────────────────────────────────────────────────────────
    const summaryMap = new Map<string, { raw_name: string; total_stock: number; total_allocated: number }>()
    for (const [key, stock] of Array.from(totalStock.entries())) {
      summaryMap.set(key, { raw_name: normToDisplay.get(key) ?? key, total_stock: round2(stock), total_allocated: 0 })
    }

    const allItems = [...p1Items, ...p2Groups.flatMap(g => g.items), ...p3Items, ...p4Items]
    for (const item of allItems) {
      const key = normName(item.raw_name)
      const entry = summaryMap.get(key)
      if (entry) entry.total_allocated = round2(entry.total_allocated + item.allocated_kg)
    }

    const summary = Array.from(summaryMap.values())
      .filter(s => s.total_stock > 0)
      .map(s => ({ ...s, remaining: round2(s.total_stock - s.total_allocated) }))
      .sort((a, b) => b.total_stock - a.total_stock)

    const allocation: AllocationGroup[] = [
      { priority: 1, station: 'สไลด์', purpose: 'เติม WIP ตั้งต้น', items: p1Items },
      ...p2Groups,
      ...(p3Items.length ? [{ priority: 3, station: 'หมูบด', purpose: 'ผลิต Phase 1', items: p3Items }] : []),
      ...(p4Items.length ? [{ priority: 4, station: 'สไลด์', purpose: 'ผลิต WIP เพิ่มเติม (≤50% Final Plan)', items: p4Items }] : []),
    ]

    return NextResponse.json({ date, summary, allocation })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
