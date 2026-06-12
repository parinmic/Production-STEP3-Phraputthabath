import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const normName = (s: string) => s.trim().toLowerCase().replace(/\s*-\s*/g, '-')
const round2   = (n: number) => Math.round(n * 100) / 100

export interface RawNeed {
  raw_sap: string
  raw_name: string
  needed_kg: number
  allocated_kg: number
  shortage_kg: number
}

export interface AllocationGroup {
  phase: number
  priority: number
  station: string
  purpose: string
  items: RawNeed[]
  skipped?: string   // เหตุผลที่ข้าม (ถ้ามี)
}

export interface RmAllocationResult {
  date: string
  summary: { raw_name: string; total_stock: number; total_allocated: number; remaining: number }[]
  allocation: AllocationGroup[]
  message?: string
}

type StockRow = { material_code: string; material_name: string | null; weight_total: number }
type SkuQtyMap = Map<string, { station: string; sku_name: string | null; qty: number }>

const ALL_NON_SLIDE = ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด']
const OTHER_STATIONS = ['สามชั้น', 'สะโพก', 'ไหล่']

// period → phase number
const PERIOD_PHASE: Record<string, number> = { 'เช้า': 1, 'บ่าย': 2, 'ค่ำ': 3 }

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get('date')
    if (!date) return NextResponse.json({ error: 'missing date' }, { status: 400 })

    // ── 1. WIP Plan ──────────────────────────────────────────────────────────
    const { data: wipRows } = await supabase
      .from('wip_plan')
      .select('sap_code, quantity, wip_initial')
      .eq('plan_date', date)
      .gt('quantity', 0)

    if (!wipRows?.length) {
      return NextResponse.json({
        date, summary: [], allocation: [],
        message: `ไม่พบ WIP Plan สำหรับวันที่ ${date}`,
      })
    }

    const wipSaps = wipRows.map(w => w.sap_code)

    // ── 1b. WIP stock (สไลด์ finished WIP) ──────────────────────────────────
    const [wipStock0010, wipStock20] = await Promise.all([
      supabase.from('stock_0010').select('material_code, weight_total').in('material_code', wipSaps).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, weight_total').in('material_code', wipSaps).gt('weight_total', 0),
    ])
    const wipStockMap = new Map<string, number>()
    for (const row of [...(wipStock0010.data ?? []), ...(wipStock20.data ?? [])]) {
      const k = String(row.material_code)
      wipStockMap.set(k, (wipStockMap.get(k) ?? 0) + Number(row.weight_total))
    }

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

    // ── 3. Production assignments — ALL periods ──────────────────────────────
    const { data: assnRows } = await supabase
      .from('production_assignments')
      .select('table_name, sku, sku_name, target_quantity, period')
      .eq('production_date', date)
      .in('period', ['เช้า', 'บ่าย', 'ค่ำ'])
      .in('table_name', ALL_NON_SLIDE)

    // skuQtyByPeriod: period → skuQtyMap
    const skuQtyByPeriod = new Map<string, SkuQtyMap>([
      ['เช้า', new Map()], ['บ่าย', new Map()], ['ค่ำ', new Map()],
    ])
    for (const a of assnRows ?? []) {
      const pm = skuQtyByPeriod.get(a.period)
      if (!pm) continue
      const k = `${a.table_name}|||${a.sku}`
      const cur = pm.get(k) ?? { station: a.table_name, sku_name: a.sku_name ?? null, qty: 0 }
      cur.qty += Number(a.target_quantity)
      pm.set(k, cur)
    }

    // ── 4. BOM for all assignment SKUs ──────────────────────────────────────
    const assnSkus = Array.from(new Set((assnRows ?? []).map(a => a.sku)))
    const { data: assnBomRows } = await supabase
      .from('bom_items')
      .select('product_sap, raw_sap, raw_name, yield_pct')
      .in('product_sap', assnSkus.length ? assnSkus : ['__none__'])

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
    const normToDisplay = new Map<string, string>()

    for (const row of rawStockRows) {
      if (!row.material_name) continue
      const key = normName(row.material_name)
      pool.set(key, (pool.get(key) ?? 0) + Number(row.weight_total))
      normToDisplay.set(key, row.material_name)
    }

    const totalStock = new Map<string, number>(pool)

    // Build raw_sap lookup by norm name (for Phase 3 P3 remaining-raw allocation)
    const rawSapByNorm = new Map<string, string>()
    for (const b of [...(wipBomRows ?? []), ...(assnBomRows ?? [])]) {
      if (b.raw_name) rawSapByNorm.set(normName(b.raw_name), b.raw_sap)
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    function takeFromPool(rawName: string, amount: number): number {
      const key = normName(rawName)
      const avail = pool.get(key) ?? 0
      const taken = Math.min(amount, avail)
      pool.set(key, avail - taken)
      return taken
    }

    /** Compute raw needs for a station from a given period's skuQtyMap */
    function stationRawNeeds(
      station: string,
      periodMap: SkuQtyMap,
    ): Map<string, { raw_sap: string; raw_name: string; needed: number }> {
      const needs = new Map<string, { raw_sap: string; raw_name: string; needed: number }>()
      for (const [key, info] of Array.from(periodMap.entries())) {
        if (info.station !== station) continue
        const sku = key.split('|||')[1]
        for (const bom of assnBomMap.get(sku) ?? []) {
          if (!bom.raw_name) continue
          const nk = normName(bom.raw_name)
          const rawNeeded = bom.yield_pct > 0 ? info.qty / bom.yield_pct : info.qty
          const cur = needs.get(nk) ?? { raw_sap: bom.raw_sap, raw_name: bom.raw_name, needed: 0 }
          cur.needed += rawNeeded
          needs.set(nk, cur)
        }
      }
      return needs
    }

    /** Allocate raw for a station+period from the pool and return RawNeed[] */
    function allocateStation(station: string, period: string): RawNeed[] {
      const pm = skuQtyByPeriod.get(period) ?? new Map()
      const needs = stationRawNeeds(station, pm)
      if (!needs.size) return []
      const items: RawNeed[] = []
      for (const { raw_sap, raw_name, needed } of Array.from(needs.values())) {
        const allocated = takeFromPool(raw_name, needed)
        items.push({ raw_sap, raw_name, needed_kg: round2(needed), allocated_kg: round2(allocated), shortage_kg: round2(Math.max(0, needed - allocated)) })
      }
      return items.sort((a, b) => b.needed_kg - a.needed_kg)
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 1 (เช้า)
    // ════════════════════════════════════════════════════════════════════════

    // P1 — สไลด์: ผลิต WIP ตาม Final Plan วันนี้
    const p1Items: RawNeed[] = []
    const finalPlanByWip = new Map<string, number>()

    for (const wip of wipRows) {
      const productionQty   = Number(wip.quantity)
      if (productionQty < 0.005) continue

      // Cap: ผลิตได้ไม่เกิน (wip_initial - stock ปัจจุบัน)
      const wipInit         = Number(wip.wip_initial ?? 0)
      const currentWIPStock = wipStockMap.get(String(wip.sap_code)) ?? 0
      const effectiveQty    = wipInit > 0
        ? Math.min(productionQty, Math.max(0, wipInit - currentWIPStock))
        : productionQty

      if (effectiveQty < 0.005) continue
      finalPlanByWip.set(wip.sap_code, effectiveQty)

      for (const bom of wipBomMap.get(wip.sap_code) ?? []) {
        const rawNeeded = bom.yield_pct > 0 ? effectiveQty / bom.yield_pct : effectiveQty
        const allocated = takeFromPool(bom.raw_name, rawNeeded)
        p1Items.push({ raw_sap: bom.raw_sap, raw_name: bom.raw_name, needed_kg: round2(rawNeeded), allocated_kg: round2(allocated), shortage_kg: round2(Math.max(0, rawNeeded - allocated)) })
      }
    }

    // P2 — สามชั้น / สะโพก / ไหล่ (เช้า)
    const ph1P2Groups: AllocationGroup[] = []
    for (const st of OTHER_STATIONS) {
      const items = allocateStation(st, 'เช้า')
      if (!items.length) continue
      ph1P2Groups.push({ phase: 1, priority: 2, station: st, purpose: 'ผลิต Phase 1 ให้ครบ (เช้า)', items })
    }

    // P3 — หมูบด (เช้า)
    const ph1P3Items = allocateStation('หมูบด', 'เช้า')

    // P4 — สไลด์: WIP เพิ่ม ≤ 50% Final Plan
    const p4Items: RawNeed[] = []
    for (const wip of wipRows) {
      const fp = finalPlanByWip.get(wip.sap_code) ?? 0
      if (fp < 0.005) continue
      const maxExtra = fp * 0.5

      for (const bom of wipBomMap.get(wip.sap_code) ?? []) {
        const rawNeeded = bom.yield_pct > 0 ? maxExtra / bom.yield_pct : maxExtra
        const allocated = takeFromPool(bom.raw_name, rawNeeded)
        p4Items.push({ raw_sap: bom.raw_sap, raw_name: bom.raw_name, needed_kg: round2(rawNeeded), allocated_kg: round2(allocated), shortage_kg: round2(Math.max(0, rawNeeded - allocated)) })
      }
    }

    const p4Allocated = p4Items.reduce((s, i) => s + i.allocated_kg, 0)
    const p4WasDone   = p4Allocated > 0.005

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 2 (บ่าย)
    // ════════════════════════════════════════════════════════════════════════

    // P1 — สไลด์: ถ้า P4 Phase 1 ทำแล้ว → SKIP
    //             ถ้า P4 ไม่ได้ทำ → ลอง allocate quota เดียวกับ P4 จาก pool ที่เหลือ
    const ph2P1Items: RawNeed[] = []
    let ph2P1Skipped: string | undefined

    if (p4WasDone) {
      ph2P1Skipped = 'Phase 1 P4 ดำเนินการแล้ว — ไม่จำเป็นต้องผลิต WIP เพิ่ม'
    } else {
      for (const wip of wipRows) {
        const fp = finalPlanByWip.get(wip.sap_code) ?? 0
        if (fp < 0.005) continue
        const maxExtra = fp * 0.5

        for (const bom of wipBomMap.get(wip.sap_code) ?? []) {
          const rawNeeded = bom.yield_pct > 0 ? maxExtra / bom.yield_pct : maxExtra
          const allocated = takeFromPool(bom.raw_name, rawNeeded)
          ph2P1Items.push({ raw_sap: bom.raw_sap, raw_name: bom.raw_name, needed_kg: round2(rawNeeded), allocated_kg: round2(allocated), shortage_kg: round2(Math.max(0, rawNeeded - allocated)) })
        }
      }
      if (!ph2P1Items.length || ph2P1Items.every(i => i.allocated_kg < 0.005)) {
        ph2P1Skipped = 'ไม่มีวัตถุดิบเหลือสำหรับผลิต WIP เพิ่ม'
      }
    }

    // P2 — สามชั้น / สะโพก / ไหล่ (บ่าย)
    const ph2P2Groups: AllocationGroup[] = []
    for (const st of OTHER_STATIONS) {
      const items = allocateStation(st, 'บ่าย')
      if (!items.length) continue
      ph2P2Groups.push({ phase: 2, priority: 2, station: st, purpose: 'ผลิต Phase 2 ให้ครบ (บ่าย)', items })
    }

    // P3 — หมูบด (บ่าย)
    const ph2P3Items = allocateStation('หมูบด', 'บ่าย')

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 3 (ค่ำ)
    // ════════════════════════════════════════════════════════════════════════

    // P1 — สามชั้น / สะโพก / ไหล่ (ค่ำ)
    const ph3P1Groups: AllocationGroup[] = []
    for (const st of OTHER_STATIONS) {
      const items = allocateStation(st, 'ค่ำ')
      if (!items.length) continue
      ph3P1Groups.push({ phase: 3, priority: 1, station: st, purpose: 'ผลิต Phase 3 (ค่ำ)', items })
    }

    // P2 — หมูบด (ค่ำ)
    const ph3P2Items = allocateStation('หมูบด', 'ค่ำ')

    // P3 — สไลด์: รับเนื้อที่เหลือทั้งหมดจาก Phase 2
    const ph3P3Items: RawNeed[] = []
    const seenKeys = new Set<string>()
    for (const [key, remaining] of Array.from(pool.entries())) {
      if (remaining < 0.005 || seenKeys.has(key)) continue
      seenKeys.add(key)
      const displayName = normToDisplay.get(key) ?? key
      const allocated   = takeFromPool(displayName, remaining)
      ph3P3Items.push({
        raw_sap:      rawSapByNorm.get(key) ?? '',
        raw_name:     displayName,
        needed_kg:    round2(remaining),
        allocated_kg: round2(allocated),
        shortage_kg:  0,
      })
    }

    // ── Summary ─────────────────────────────────────────────────────────────
    const summaryMap = new Map<string, { raw_name: string; total_stock: number; total_allocated: number }>()
    for (const [key, stock] of Array.from(totalStock.entries())) {
      summaryMap.set(key, { raw_name: normToDisplay.get(key) ?? key, total_stock: round2(stock), total_allocated: 0 })
    }

    const allItems = [
      ...p1Items, ...ph1P2Groups.flatMap(g => g.items), ...ph1P3Items, ...p4Items,
      ...ph2P1Items, ...ph2P2Groups.flatMap(g => g.items), ...ph2P3Items,
      ...ph3P1Groups.flatMap(g => g.items), ...ph3P2Items, ...ph3P3Items,
    ]
    for (const item of allItems) {
      const key   = normName(item.raw_name)
      const entry = summaryMap.get(key)
      if (entry) entry.total_allocated = round2(entry.total_allocated + item.allocated_kg)
    }

    const summary = Array.from(summaryMap.values())
      .filter(s => s.total_stock > 0)
      .map(s => ({ ...s, remaining: round2(s.total_stock - s.total_allocated) }))
      .sort((a, b) => b.total_stock - a.total_stock)

    const allocation: AllocationGroup[] = [
      // ─ Phase 1 ─
      { phase: 1, priority: 1, station: 'สไลด์',  purpose: 'ผลิต WIP ตาม Final Plan',               items: p1Items },
      ...ph1P2Groups,
      ...(ph1P3Items.length ? [{ phase: 1, priority: 3, station: 'หมูบด', purpose: 'ผลิต Phase 1 (เช้า)', items: ph1P3Items }] : []),
      { phase: 1, priority: 4, station: 'สไลด์',  purpose: 'ผลิต WIP เพิ่มเติม (≤50% Final Plan)',  items: p4Items },
      // ─ Phase 2 ─
      { phase: 2, priority: 1, station: 'สไลด์',  purpose: 'ผลิต WIP เพิ่ม (กรณี P4 Phase 1 ไม่ได้ทำ)', items: ph2P1Items, ...(ph2P1Skipped ? { skipped: ph2P1Skipped } : {}) },
      ...ph2P2Groups,
      ...(ph2P3Items.length ? [{ phase: 2, priority: 3, station: 'หมูบด', purpose: 'ผลิต Phase 2 (บ่าย)', items: ph2P3Items }] : []),
      // ─ Phase 3 ─
      ...ph3P1Groups,
      ...(ph3P2Items.length ? [{ phase: 3, priority: 2, station: 'หมูบด', purpose: 'ผลิต Phase 3 (ค่ำ)',  items: ph3P2Items }] : []),
      ...(ph3P3Items.length ? [{ phase: 3, priority: 3, station: 'สไลด์', purpose: 'รับเนื้อที่เหลือทั้งหมด',  items: ph3P3Items }] : []),
    ]

    return NextResponse.json({ date, summary, allocation })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
