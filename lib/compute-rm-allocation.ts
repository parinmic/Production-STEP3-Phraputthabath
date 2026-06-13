import { supabase } from '@/lib/supabase'

const normName = (s: string) => s.trim().toLowerCase().replace(/\s*-\s*/g, '-')
const round2   = (n: number) => Math.round(n * 100) / 100

export interface RmRawNeed {
  raw_sap:      string
  raw_name:     string
  needed_kg:    number
  allocated_kg: number
  shortage_kg:  number
}

export interface RmGroup {
  phase:    number
  priority: number
  station:  string
  purpose:  string
  items:    RmRawNeed[]
  skipped?: string
}

type StockRow   = { material_code: string; material_name: string | null; weight_total: number }
type SkuQtyMap  = Map<string, { station: string; qty: number }>

const ALL_NON_SLIDE  = ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด']
const OTHER_STATIONS = ['สามชั้น', 'สะโพก', 'ไหล่']

/**
 * Compute priority-based pool allocation for all three phases.
 * Pool depletes sequentially: Phase 1 P1 → P2 → P3 → P4 → Phase 2 → Phase 3.
 * Returns all RmGroup entries with allocated_kg reflecting actual pool availability.
 */
export async function computeRmAllocation(date: string): Promise<RmGroup[]> {
  // 1. WIP Plan
  const { data: wipRows } = await supabase
    .from('wip_plan')
    .select('sap_code, quantity, wip_initial')
    .eq('plan_date', date)
    .gt('quantity', 0)

  if (!wipRows?.length) return []

  const wipSaps = wipRows.map(w => w.sap_code)

  // 1b. WIP sku_name from master_logic_calculation
  const { data: masterRows } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('calculation_type', 'Mas Productivity')
    .order('uploaded_at', { ascending: false })

  const wipSkuNameBySap = new Map<string, string>()
  const seenWip = new Set<string>()
  for (const r of masterRows ?? []) {
    const row = r.row_data as Record<string, unknown>
    if (String(row['กลุ่มสินค้า'] ?? '') !== 'กลุ่ม WIP') continue
    const sap = String(row['SAP'] ?? '').trim()
    if (!sap || seenWip.has(sap)) continue
    seenWip.add(sap)
    wipSkuNameBySap.set(sap, String(row['ชื่อสินค้า'] ?? '').trim())
  }

  // 1c. WIP current stock from stock_20 by material_name
  const wipNames = wipSaps.map(s => wipSkuNameBySap.get(s)).filter(Boolean) as string[]
  const wipStockMap = new Map<string, number>()
  if (wipNames.length) {
    const { data: rows } = await supabase.from('stock_20').select('material_name, weight_total').in('material_name', wipNames)
    for (const r of rows ?? []) {
      const skuName = String(r.material_name ?? '').trim()
      for (const [sap, name] of Array.from(wipSkuNameBySap.entries())) {
        if (name === skuName) wipStockMap.set(sap, (wipStockMap.get(sap) ?? 0) + Number(r.weight_total))
      }
    }
  }

  // 2. BOM for WIP — query with both padded and stripped SAP codes to handle zero-padding mismatch
  const wipSapsExpanded = Array.from(new Set([...wipSaps, ...wipSaps.map(s => s.replace(/^0+/, ''))]))
  const { data: wipBomRows } = await supabase
    .from('bom_items').select('product_sap, raw_sap, raw_name, yield_pct').in('product_sap', wipSapsExpanded)

  const wipBomMap = new Map<string, { raw_sap: string; raw_name: string; yield_pct: number }[]>()
  for (const b of wipBomRows ?? []) {
    const entry = { raw_sap: b.raw_sap, raw_name: b.raw_name ?? '', yield_pct: Number(b.yield_pct) }
    // Store under both original and stripped key so lookup works regardless of zero-padding
    for (const k of [b.product_sap, b.product_sap.replace(/^0+/, '')]) {
      const list = wipBomMap.get(k) ?? []
      if (!list.some(x => x.raw_sap === entry.raw_sap)) list.push(entry)
      wipBomMap.set(k, list)
    }
  }

  // 3. Production assignments — all periods (non-สไลด์ stations)
  const { data: assnRows } = await supabase
    .from('production_assignments')
    .select('table_name, sku, sku_name, target_quantity, period')
    .eq('production_date', date)
    .in('period', ['เช้า', 'บ่าย', 'ค่ำ'])
    .in('table_name', ALL_NON_SLIDE)

  const skuQtyByPeriod = new Map<string, SkuQtyMap>([
    ['เช้า', new Map()], ['บ่าย', new Map()], ['ค่ำ', new Map()],
  ])
  for (const a of assnRows ?? []) {
    const pm = skuQtyByPeriod.get(a.period)
    if (!pm) continue
    const k = `${a.table_name}|||${a.sku}`
    const cur = pm.get(k) ?? { station: a.table_name, qty: 0 }
    cur.qty += Number(a.target_quantity)
    pm.set(k, cur)
  }

  // 4. BOM for assignment SKUs
  const assnSkus = Array.from(new Set((assnRows ?? []).map(a => a.sku)))
  const { data: assnBomRows } = await supabase
    .from('bom_items').select('product_sap, raw_sap, raw_name, yield_pct')
    .in('product_sap', assnSkus.length ? assnSkus : ['__none__'])

  const assnBomMap = new Map<string, { raw_sap: string; raw_name: string; yield_pct: number }[]>()
  for (const b of assnBomRows ?? []) {
    const list = assnBomMap.get(b.product_sap) ?? []
    list.push({ raw_sap: b.raw_sap, raw_name: b.raw_name ?? '', yield_pct: Number(b.yield_pct) })
    assnBomMap.set(b.product_sap, list)
  }

  // 5. Raw material stock → pool
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

  const pool = new Map<string, number>()
  const normToDisplay = new Map<string, string>()
  for (const row of rawStockRows) {
    if (!row.material_name) continue
    const key = normName(row.material_name)
    pool.set(key, (pool.get(key) ?? 0) + Number(row.weight_total))
    normToDisplay.set(key, row.material_name)
  }

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

  function stationRawNeeds(station: string, periodMap: SkuQtyMap) {
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

  function allocateStation(station: string, period: string): RmRawNeed[] {
    const pm    = skuQtyByPeriod.get(period) ?? new Map()
    const needs = stationRawNeeds(station, pm)
    if (!needs.size) return []
    return Array.from(needs.values()).map(({ raw_sap, raw_name, needed }) => {
      const allocated = takeFromPool(raw_name, needed)
      return { raw_sap, raw_name, needed_kg: round2(needed), allocated_kg: round2(allocated), shortage_kg: round2(Math.max(0, needed - allocated)) }
    }).sort((a, b) => b.needed_kg - a.needed_kg)
  }

  // ════ PHASE 1 ════

  const p1Items: RmRawNeed[] = []
  const finalPlanByWip = new Map<string, number>()

  for (const wip of wipRows) {
    const productionQty   = Number(wip.quantity)
    if (productionQty < 0.005) continue
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

  const ph1P2Groups: RmGroup[] = []
  for (const st of OTHER_STATIONS) {
    const items = allocateStation(st, 'เช้า')
    if (items.length) ph1P2Groups.push({ phase: 1, priority: 2, station: st, purpose: 'ผลิต Phase 1 ให้ครบ (เช้า)', items })
  }
  const ph1P3Items = allocateStation('หมูบด', 'เช้า')

  const p4Items: RmRawNeed[] = []
  for (const wip of wipRows) {
    const fp = finalPlanByWip.get(wip.sap_code) ?? 0
    if (fp < 0.005) continue
    for (const bom of wipBomMap.get(wip.sap_code) ?? []) {
      const rawNeeded = bom.yield_pct > 0 ? (fp * 0.5) / bom.yield_pct : fp * 0.5
      const allocated = takeFromPool(bom.raw_name, rawNeeded)
      p4Items.push({ raw_sap: bom.raw_sap, raw_name: bom.raw_name, needed_kg: round2(rawNeeded), allocated_kg: round2(allocated), shortage_kg: round2(Math.max(0, rawNeeded - allocated)) })
    }
  }
  const p4WasDone = p4Items.reduce((s, i) => s + i.allocated_kg, 0) > 0.005

  // ════ PHASE 2 ════

  const ph2P1Items: RmRawNeed[] = []
  let ph2P1Skipped: string | undefined

  if (p4WasDone) {
    ph2P1Skipped = 'Phase 1 P4 ดำเนินการแล้ว — ไม่จำเป็นต้องผลิต WIP เพิ่ม'
  } else {
    for (const wip of wipRows) {
      const fp = finalPlanByWip.get(wip.sap_code) ?? 0
      if (fp < 0.005) continue
      for (const bom of wipBomMap.get(wip.sap_code) ?? []) {
        const rawNeeded = bom.yield_pct > 0 ? (fp * 0.5) / bom.yield_pct : fp * 0.5
        const allocated = takeFromPool(bom.raw_name, rawNeeded)
        ph2P1Items.push({ raw_sap: bom.raw_sap, raw_name: bom.raw_name, needed_kg: round2(rawNeeded), allocated_kg: round2(allocated), shortage_kg: round2(Math.max(0, rawNeeded - allocated)) })
      }
    }
    if (!ph2P1Items.length || ph2P1Items.every(i => i.allocated_kg < 0.005))
      ph2P1Skipped = 'ไม่มีวัตถุดิบเหลือสำหรับผลิต WIP เพิ่ม'
  }

  const ph2P2Groups: RmGroup[] = []
  for (const st of OTHER_STATIONS) {
    const items = allocateStation(st, 'บ่าย')
    if (items.length) ph2P2Groups.push({ phase: 2, priority: 2, station: st, purpose: 'ผลิต Phase 2 ให้ครบ (บ่าย)', items })
  }
  const ph2P3Items = allocateStation('หมูบด', 'บ่าย')

  // ════ PHASE 3 ════

  const ph3P1Groups: RmGroup[] = []
  for (const st of OTHER_STATIONS) {
    const items = allocateStation(st, 'ค่ำ')
    if (items.length) ph3P1Groups.push({ phase: 3, priority: 1, station: st, purpose: 'ผลิต Phase 3 (ค่ำ)', items })
  }
  const ph3P2Items = allocateStation('หมูบด', 'ค่ำ')

  const ph3P3Items: RmRawNeed[] = []
  const seenKeys = new Set<string>()
  for (const [key, remaining] of Array.from(pool.entries())) {
    if (remaining < 0.005 || seenKeys.has(key)) continue
    seenKeys.add(key)
    const displayName = normToDisplay.get(key) ?? key
    const allocated   = takeFromPool(displayName, remaining)
    ph3P3Items.push({ raw_sap: rawSapByNorm.get(key) ?? '', raw_name: displayName, needed_kg: round2(remaining), allocated_kg: round2(allocated), shortage_kg: 0 })
  }

  return [
    { phase: 1, priority: 1, station: 'สไลด์',  purpose: 'ผลิต WIP ตาม Final Plan',                    items: p1Items },
    ...ph1P2Groups,
    ...(ph1P3Items.length ? [{ phase: 1, priority: 3, station: 'หมูบด', purpose: 'ผลิต Phase 1 (เช้า)', items: ph1P3Items }] : []),
    { phase: 1, priority: 4, station: 'สไลด์',  purpose: 'ผลิต WIP เพิ่มเติม (≤50% Final Plan)',       items: p4Items },
    { phase: 2, priority: 1, station: 'สไลด์',  purpose: 'ผลิต WIP เพิ่ม (กรณี P4 Phase 1 ไม่ได้ทำ)', items: ph2P1Items, ...(ph2P1Skipped ? { skipped: ph2P1Skipped } : {}) },
    ...ph2P2Groups,
    ...(ph2P3Items.length ? [{ phase: 2, priority: 3, station: 'หมูบด', purpose: 'ผลิต Phase 2 (บ่าย)', items: ph2P3Items }] : []),
    ...ph3P1Groups,
    ...(ph3P2Items.length ? [{ phase: 3, priority: 2, station: 'หมูบด', purpose: 'ผลิต Phase 3 (ค่ำ)',  items: ph3P2Items }] : []),
    ...(ph3P3Items.length ? [{ phase: 3, priority: 3, station: 'สไลด์', purpose: 'รับเนื้อที่เหลือทั้งหมด',  items: ph3P3Items }] : []),
  ]
}

/**
 * Build a lookup map from rm-allocation groups for a specific phase.
 * Key: "station|||normalized_raw_name"  Value: total allocated_kg
 */
export function buildRmAllocMap(groups: RmGroup[], phase: number): Map<string, number> {
  const map = new Map<string, number>()
  for (const g of groups) {
    if (g.phase !== phase) continue
    for (const item of g.items) {
      const key = `${g.station}|||${normName(item.raw_name)}`
      map.set(key, (map.get(key) ?? 0) + item.allocated_kg)
    }
  }
  return map
}
