import { supabase, latestStockLogId } from '@/lib/supabase'

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

type StockRow  = { material_code: string; material_name: string | null; weight_total: number }
type SkuQtyMap = Map<string, { station: string; qty: number; channel: string | null }>

const ALL_NON_SLIDE  = ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'เผาขา', 'เลาะขา']
const OTHER_STATIONS = ['สามชั้น', 'สะโพก', 'ไหล่', 'เผาขา', 'เลาะขา']
const PHASE_PERIOD: Record<string, string> = { '1': 'เช้า', '2': 'บ่าย', '3': 'ค่ำ' }

function extractCondChannel(condition: string): string | null {
  const c = condition.toLowerCase()
  if (c.includes('lotus')) return 'LOTUS'
  if (c.includes('makro')) return 'Makro'
  if (c.includes('wet'))   return 'Wet'
  return null
}

// Matches DB channel value against a condition-derived channel key.
// "Wet Market".startsWith("Wet") → true, "LOTUS" === "LOTUS" → true
function channelMatch(dbChannel: string | null | undefined, condChannel: string): boolean {
  if (!dbChannel) return false
  const db   = dbChannel.toLowerCase()
  const cond = condChannel.toLowerCase()
  return db === cond || db.startsWith(cond) || cond.startsWith(db)
}

/**
 * Compute priority-based pool allocation for all three phases.
 * Priority order is driven by the `mas_priority_withdrawal` table.
 * Pool depletes sequentially according to the table's phase/priority_order.
 */
export async function computeRmAllocation(date: string): Promise<RmGroup[]> {
  // 0. Load priority table
  const { data: priorityRowsRaw } = await supabase
    .from('mas_priority_withdrawal')
    .select('phase, station, priority_order, condition')

  const DEFAULT_PRIORITY_ROWS = [
    { phase: '1', station: 'สไลด์', priority_order: 1, condition: 'WIP Crisis' },
    { phase: '1', station: 'อื่น ๆ',  priority_order: 2, condition: '' },
    { phase: '1', station: 'หมูบด',  priority_order: 3, condition: '' },
    { phase: '1', station: 'สไลด์', priority_order: 4, condition: '25%' },
    { phase: '2', station: 'สไลด์', priority_order: 1, condition: '' },
    { phase: '2', station: 'อื่น ๆ',  priority_order: 2, condition: '' },
    { phase: '2', station: 'หมูบด',  priority_order: 3, condition: '' },
    { phase: '3', station: 'อื่น ๆ',  priority_order: 1, condition: '' },
    { phase: '3', station: 'หมูบด',  priority_order: 2, condition: '' },
    { phase: '3', station: 'สไลด์', priority_order: 3, condition: '' },
  ]
  const raw = priorityRowsRaw ?? []
  const priorityRows = (raw.length ? raw : DEFAULT_PRIORITY_ROWS).sort((a, b) =>
    (Number(a.phase) - Number(b.phase)) || (Number(a.priority_order) - Number(b.priority_order))
  )

  // 1. WIP Plan
  const { data: wipRows } = await supabase
    .from('wip_plan')
    .select('sap_code, quantity, wip_initial')
    .eq('plan_date', date)
    .gt('quantity', 0)

  const wipSaps = (wipRows ?? []).map(w => w.sap_code)

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

  // 1c. WIP current stock from stock_20
  const wipNames = wipSaps.map(s => wipSkuNameBySap.get(s)).filter(Boolean) as string[]
  const wipStockMap = new Map<string, number>()
  if (wipNames.length) {
    const wipStockId20 = await latestStockLogId('stock_20')
    const { data: rows } = await supabase.from('stock_20').select('material_name, weight_total').eq('upload_log_id', wipStockId20).in('material_name', wipNames)
    for (const r of rows ?? []) {
      const skuName = String(r.material_name ?? '').trim()
      for (const [sap, name] of Array.from(wipSkuNameBySap.entries())) {
        if (name === skuName) wipStockMap.set(sap, (wipStockMap.get(sap) ?? 0) + Number(r.weight_total))
      }
    }
  }

  // 2. BOM for WIP — only priority 1 (or no priority) for shortage display
  const wipSapsExpanded = Array.from(new Set([...wipSaps, ...wipSaps.map(s => s.replace(/^0+/, ''))]))
  const { data: wipBomRows } = wipSapsExpanded.length
    ? await supabase.from('bom_items').select('product_sap, raw_sap, raw_name, yield_pct, priority').in('product_sap', wipSapsExpanded)
    : { data: [] }

  const wipBomMap = new Map<string, { raw_sap: string; raw_name: string; yield_pct: number }[]>()
  for (const b of wipBomRows ?? []) {
    const prio = (b as { priority?: number | null }).priority ?? null
    if (prio !== null && prio !== 1) continue  // only use priority 1 or no-priority rows
    const entry = { raw_sap: b.raw_sap, raw_name: b.raw_name ?? '', yield_pct: Number(b.yield_pct) }
    for (const k of [b.product_sap, b.product_sap.replace(/^0+/, '')]) {
      const list = wipBomMap.get(k) ?? []
      if (!list.some(x => x.raw_sap === entry.raw_sap)) list.push(entry)
      wipBomMap.set(k, list)
    }
  }

  // 3. Production assignments (all stations including สไลด์) — include channel
  const { data: assnRows } = await supabase
    .from('production_assignments')
    .select('table_name, sku, sku_name, target_quantity, period, channel, note')
    .eq('production_date', date)
    .in('period', ['เช้า', 'บ่าย', 'ค่ำ'])
    .in('table_name', [...ALL_NON_SLIDE, 'สไลด์'])

  const skuQtyByPeriod = new Map<string, SkuQtyMap>([
    ['เช้า', new Map()], ['บ่าย', new Map()], ['ค่ำ', new Map()],
  ])
  for (const a of assnRows ?? []) {
    const pm = skuQtyByPeriod.get(a.period)
    if (!pm) continue
    // Cross-table assignments (สะโพก workers helping สามชั้น) are re-attributed to สามชั้น
    // so their RM withdrawal appears under สามชั้น, not สะโพก.
    const effectiveStation = String(a.note ?? '').includes('cross:สามชั้น') ? 'สามชั้น' : a.table_name
    const k   = `${effectiveStation}|||${a.sku}|||${a.channel ?? ''}`
    const cur = pm.get(k) ?? { station: effectiveStation, qty: 0, channel: a.channel ?? null }
    cur.qty += Number(a.target_quantity)
    pm.set(k, cur)
  }

  // 4. BOM for assignment SKUs — only priority 1 (or no priority) for shortage display
  const assnSkus = Array.from(new Set((assnRows ?? []).map(a => a.sku)))
  const { data: assnBomRows } = await supabase
    .from('bom_items').select('product_sap, raw_sap, raw_name, yield_pct, priority')
    .in('product_sap', assnSkus.length ? assnSkus : ['__none__'])

  const assnBomMap = new Map<string, { raw_sap: string; raw_name: string; yield_pct: number }[]>()
  for (const b of assnBomRows ?? []) {
    const prio = (b as { priority?: number | null }).priority ?? null
    if (prio !== null && prio !== 1) continue  // only use priority 1 or no-priority rows
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
    const [rmId0010, rmId20] = await Promise.all([latestStockLogId('stock_0010'), latestStockLogId('stock_20')])
    const [r0010, r20] = await Promise.all([
      supabase.from('stock_0010').select('material_code, material_name, weight_total').eq('upload_log_id', rmId0010).in('material_name', expandedNames).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, material_name, weight_total').eq('upload_log_id', rmId20).in('material_name', expandedNames).gt('weight_total', 0),
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
    const key  = normName(rawName)
    const avail = pool.get(key) ?? 0
    const taken = Math.min(amount, avail)
    pool.set(key, avail - taken)
    return taken
  }

  // ── Mas Moo Chod (หมูบด) ─────────────────────────────────────────────────

  interface MooIngAlloc {
    ingredient_type: string; priority: number
    sap_code: string | null; product_name: string
  }

  const [mooMasterAllocRes, mooWithdrawalAllocRes] = await Promise.all([
    supabase.from('moo_chod_master').select('sap_code, fat_percent'),
    supabase.from('moo_chod_withdrawal_master')
      .select('ingredient_type, priority, sap_code, product_name')
      .order('ingredient_type').order('priority').order('id'),
  ])

  const mooFatPercentBySap = new Map<string, number>()
  for (const r of mooMasterAllocRes.data ?? []) {
    if (!r.sap_code) continue
    const s = String(r.sap_code).trim()
    mooFatPercentBySap.set(s, Number(r.fat_percent ?? 0))
    mooFatPercentBySap.set(s.replace(/^0+/, ''), Number(r.fat_percent ?? 0))
  }

  const mooIngsAlloc     = (mooWithdrawalAllocRes.data ?? []) as MooIngAlloc[]
  const mooMeatIngsAlloc = mooIngsAlloc.filter(i => i.ingredient_type === 'เนื้อ')
  const mooFatIngsAlloc  = mooIngsAlloc.filter(i => i.ingredient_type === 'มัน')

  const nonSharedMooIngs  = mooIngsAlloc.filter(ing => !pool.has(normName(ing.product_name)))
  const nonSharedMooSaps  = nonSharedMooIngs.map(i => i.sap_code).filter(Boolean) as string[]
  const nonSharedMooNames = nonSharedMooIngs.map(i => i.product_name).filter(Boolean)
  const nonSharedExpanded = Array.from(new Set(
    nonSharedMooNames.flatMap(n => [n, n.replace(/\s*-\s*/g, '-'), n.replace(/\s*-\s*/g, ' - ')])
  ))

  const mooOwnStockByNorm = new Map<string, number>()
  const mooOwnStockBySap  = new Map<string, number>()
  {
    const [mooOwnId0010, mooOwnId20] = await Promise.all([latestStockLogId('stock_0010'), latestStockLogId('stock_20')])
    const proms: Promise<{ data: StockRow[] | null }>[] = []
    if (nonSharedMooSaps.length)
      proms.push(
        supabase.from('stock_0010').select('material_code, material_name, weight_total').eq('upload_log_id', mooOwnId0010).in('material_code', nonSharedMooSaps).gt('weight_total', 0) as Promise<{ data: StockRow[] | null }>,
        supabase.from('stock_20').select('material_code, material_name, weight_total').eq('upload_log_id', mooOwnId20).in('material_code', nonSharedMooSaps).gt('weight_total', 0) as Promise<{ data: StockRow[] | null }>,
      )
    if (nonSharedExpanded.length)
      proms.push(
        supabase.from('stock_0010').select('material_code, material_name, weight_total').eq('upload_log_id', mooOwnId0010).in('material_name', nonSharedExpanded).gt('weight_total', 0) as Promise<{ data: StockRow[] | null }>,
        supabase.from('stock_20').select('material_code, material_name, weight_total').eq('upload_log_id', mooOwnId20).in('material_name', nonSharedExpanded).gt('weight_total', 0) as Promise<{ data: StockRow[] | null }>,
      )
    const results = await Promise.all(proms)
    for (const r of results) {
      for (const row of r.data ?? []) {
        if (row.material_name) {
          const k = normName(row.material_name)
          mooOwnStockByNorm.set(k, (mooOwnStockByNorm.get(k) ?? 0) + Number(row.weight_total))
        }
        if (row.material_code)
          mooOwnStockBySap.set(row.material_code, (mooOwnStockBySap.get(row.material_code) ?? 0) + Number(row.weight_total))
      }
    }
  }

  function allocateMooStation(period: string, channelFilter: string | null = null): RmRawNeed[] {
    const pm = skuQtyByPeriod.get(period) ?? new Map()

    let totalFatKg  = 0
    let totalMeatKg = 0
    for (const [key, info] of Array.from(pm.entries())) {
      if (info.station !== 'หมูบด') continue
      if (channelFilter != null && !channelMatch(info.channel, channelFilter)) continue
      const sku = key.split('|||')[1]
      const fatPct = mooFatPercentBySap.get(sku) ?? mooFatPercentBySap.get(sku.replace(/^0+/, '')) ?? 0
      totalFatKg  += info.qty * fatPct / 100
      totalMeatKg += info.qty * (1 - fatPct / 100)
    }
    if (totalFatKg + totalMeatKg < 0.005) return []

    const result: RmRawNeed[] = []

    function processIngType(demandKg: number, ings: MooIngAlloc[]) {
      let remaining = demandKg
      const priorities = Array.from(new Set(ings.map(i => i.priority))).sort((a, b) => a - b)
      for (const prio of priorities) {
        if (remaining < 0.005) break
        for (const ing of ings.filter(i => i.priority === prio)) {
          if (remaining < 0.005) break
          const normN = normName(ing.product_name)
          const inPool = pool.has(normN)
          if (inPool) {
            const allocated = takeFromPool(ing.product_name, remaining)
            result.push({
              raw_sap:      ing.sap_code ?? normN,
              raw_name:     ing.product_name,
              needed_kg:    round2(remaining),
              allocated_kg: round2(allocated),
              shortage_kg:  round2(Math.max(0, remaining - allocated)),
            })
            remaining -= allocated
          } else {
            const ownSap    = ing.sap_code ?? ''
            const sapAvail  = mooOwnStockBySap.get(ownSap) ?? 0
            const normAvail = mooOwnStockByNorm.get(normN) ?? 0
            const avail     = ownSap ? sapAvail : normAvail
            const take      = Math.min(remaining, avail)
            if (ownSap) mooOwnStockBySap.set(ownSap, sapAvail - take)
            mooOwnStockByNorm.set(normN, Math.max(0, normAvail - take))
            result.push({
              raw_sap:      ing.sap_code ?? normN,
              raw_name:     ing.product_name,
              needed_kg:    round2(remaining),
              allocated_kg: round2(take),
              shortage_kg:  round2(Math.max(0, remaining - take)),
            })
            remaining -= take
          }
        }
      }
    }

    processIngType(totalFatKg,  mooFatIngsAlloc)
    processIngType(totalMeatKg, mooMeatIngsAlloc)

    return result.sort((a, b) => b.needed_kg - a.needed_kg)
  }

  function stationRawNeeds(station: string, periodMap: SkuQtyMap, channelFilter: string | null = null) {
    const needs = new Map<string, { raw_sap: string; raw_name: string; needed: number }>()
    for (const [key, info] of Array.from(periodMap.entries())) {
      if (info.station !== station) continue
      if (channelFilter != null && !channelMatch(info.channel, channelFilter)) continue
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

  function allocateStation(station: string, period: string, channelFilter: string | null = null): RmRawNeed[] {
    const pm    = skuQtyByPeriod.get(period) ?? new Map()
    const needs = stationRawNeeds(station, pm, channelFilter)
    if (!needs.size) return []
    return Array.from(needs.values()).map(({ raw_sap, raw_name, needed }) => {
      const allocated = takeFromPool(raw_name, needed)
      return { raw_sap, raw_name, needed_kg: round2(needed), allocated_kg: round2(allocated), shortage_kg: round2(Math.max(0, needed - allocated)) }
    }).sort((a, b) => b.needed_kg - a.needed_kg)
  }

  // ════ Data-driven allocation loop ════════════════════════════════════════

  // Phase 2 uploads a fresh stock file (overwrites Phase 1's stock), so Phase 1
  // and Phase 2 each draw from independent pools. Phase 3 shares Phase 2's pool.
  // Snapshot the pool before Phase 1 and restore it at the start of Phase 2.
  const poolSnapshot         = new Map(pool)
  const mooNormSnapshot      = new Map(mooOwnStockByNorm)
  const mooSapSnapshot       = new Map(mooOwnStockBySap)

  const groups: RmGroup[] = []
  const wipFinalPlanByWip = new Map<string, number>() // SAP → crisis qty allocated in P1
  const wipFullPlan       = new Map<string, number>() // SAP → original Final Plan qty
  let lastPhase = 0

  for (const row of priorityRows) {
    const phase    = Number(row.phase)
    const priority = Number(row.priority_order)
    const station  = String(row.station ?? '')
    const condition = String(row.condition ?? '')
    const period   = PHASE_PERIOD[String(phase)]
    if (!period) continue

    // At the boundary between Phase 1 → Phase 2, restore pool to fresh state
    if (phase === 2 && lastPhase < 2) {
      for (const [k, v] of poolSnapshot) pool.set(k, v)
      for (const k of Array.from(pool.keys())) { if (!poolSnapshot.has(k)) pool.delete(k) }
      for (const [k, v] of mooNormSnapshot) mooOwnStockByNorm.set(k, v)
      for (const k of Array.from(mooOwnStockByNorm.keys())) { if (!mooNormSnapshot.has(k)) mooOwnStockByNorm.delete(k) }
      for (const [k, v] of mooSapSnapshot) mooOwnStockBySap.set(k, v)
      for (const k of Array.from(mooOwnStockBySap.keys())) { if (!mooSapSnapshot.has(k)) mooOwnStockBySap.delete(k) }
    }
    lastPhase = phase

    const isWipCrisis = condition.includes('WIP Crisis')
    const isWipExtra  = condition.includes('25%')
    const isRemainder = station === 'สไลด์' && !isWipCrisis && !isWipExtra
    const condChannel = extractCondChannel(condition)

    if (station === 'สไลด์' && isWipCrisis) {
      // Produce WIP up to WIP Crisis amount: max(0, avgKg×1.2 − stock)
      // avgKg = wip_initial / (3×1.2) = wip_initial / 3.6
      // crisis = avgKg×1.2 − stock = wip_initial/3 − stock
      const items: RmRawNeed[] = []
      for (const wip of wipRows ?? []) {
        const productionQty = Number(wip.quantity)
        if (productionQty < 0.005) continue
        const wipInit      = Number(wip.wip_initial ?? 0)
        const currentStock = wipStockMap.get(String(wip.sap_code)) ?? 0
        const crisisQty    = wipInit > 0 ? Math.max(0, wipInit / 3 - currentStock) : productionQty
        const effectiveQty = Math.min(productionQty, crisisQty)
        if (effectiveQty < 0.005) continue
        wipFinalPlanByWip.set(wip.sap_code, effectiveQty)
        wipFullPlan.set(wip.sap_code, productionQty)
        for (const bom of wipBomMap.get(wip.sap_code) ?? []) {
          const rawNeeded = bom.yield_pct > 0 ? effectiveQty / bom.yield_pct : effectiveQty
          const allocated = takeFromPool(bom.raw_name, rawNeeded)
          items.push({ raw_sap: bom.raw_sap, raw_name: bom.raw_name, needed_kg: round2(rawNeeded), allocated_kg: round2(allocated), shortage_kg: round2(Math.max(0, rawNeeded - allocated)) })
        }
      }
      if (items.length) groups.push({ phase, priority, station: 'สไลด์', purpose: 'ผลิต WIP ตาม WIP Crisis', items })

    } else if (station === 'สไลด์' && isWipExtra) {
      // P4: top up WIP so total (P1 crisis + P4) ≤ 25% of Final Plan.
      // If P1 crisis already ≥ 25% of Final Plan, skip entirely.
      const items: RmRawNeed[] = []
      for (const wip of wipRows ?? []) {
        const p1Qty      = wipFinalPlanByWip.get(wip.sap_code) ?? 0
        const fullPlan   = wipFullPlan.get(wip.sap_code) ?? Number(wip.quantity)
        const cap25      = fullPlan * 0.25
        const extraQty   = Math.max(0, cap25 - p1Qty)
        if (extraQty < 0.005) continue  // P1 already covered ≥25% of Final Plan
        for (const bom of wipBomMap.get(wip.sap_code) ?? []) {
          const rawNeeded = bom.yield_pct > 0 ? extraQty / bom.yield_pct : extraQty
          const allocated = takeFromPool(bom.raw_name, rawNeeded)
          items.push({ raw_sap: bom.raw_sap, raw_name: bom.raw_name, needed_kg: round2(rawNeeded), allocated_kg: round2(allocated), shortage_kg: round2(Math.max(0, rawNeeded - allocated)) })
        }
      }
      if (items.length) groups.push({ phase, priority, station: 'สไลด์', purpose: 'ผลิต WIP เพิ่มเติม (≤25% Final Plan)', items })

    } else if (station === 'สไลด์' && isRemainder) {
      // BOM-based allocation for สไลด์ regular production.
      // Filter to only materials present in warehouse pool — WIP(F) items produced in-house are
      // not in the pool and must not appear as false shortages.
      const pm    = skuQtyByPeriod.get(period) ?? new Map()
      const needs = stationRawNeeds('สไลด์', pm, null)
      if (needs.size) {
        const items = Array.from(needs.values())
          .filter(({ raw_name }) => pool.has(normName(raw_name)))
          .map(({ raw_sap, raw_name, needed }) => {
            const allocated = takeFromPool(raw_name, needed)
            return { raw_sap, raw_name, needed_kg: round2(needed), allocated_kg: round2(allocated), shortage_kg: round2(Math.max(0, needed - allocated)) }
          })
          .sort((a, b) => b.needed_kg - a.needed_kg)
        if (items.length) groups.push({ phase, priority, station: 'สไลด์', purpose: `ผลิต Phase ${phase} (${period})`, items })
      }

    } else if (station === 'อื่น ๆ') {
      const purpose = condChannel
        ? `ผลิต Phase ${phase} ${condChannel} (${period})`
        : `ผลิต Phase ${phase} ให้ครบ (${period})`
      for (const st of OTHER_STATIONS) {
        const items = allocateStation(st, period, condChannel)
        if (items.length) groups.push({ phase, priority, station: st, purpose, items })
      }

    } else if (station === 'หมูบด') {
      const purpose = condChannel
        ? `ผลิต Phase ${phase} ${condChannel} (${period})`
        : `ผลิต Phase ${phase} (${period})`
      const items = allocateMooStation(period, condChannel)
      if (items.length) groups.push({ phase, priority, station: 'หมูบด', purpose, items })
    }
  }

  return groups
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
