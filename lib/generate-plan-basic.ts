import { supabase } from '@/lib/supabase'
import { fetchLatestMasYield } from '@/lib/mas-yield'

export type BasicPhase = 1 | 2 | 3

export interface GenerateBasicPlanParams {
  date?: string
  phase?: BasicPhase
  subtractPhase1FromPhase2?: boolean
  subtractPhase1FromPhase3?: boolean
  subtractPhase2FromPhase3?: boolean
}

export interface BasicYieldTarget {
  productGroup: string
  station: string | null
  quantityKg: number
  yieldPct: number
  skus: BasicProductivitySku[]
}

export interface BasicProductivitySku {
  sku: string
  skuName: string | null
  product: string | null
}

export interface BasicSkuTarget {
  channel: string
  sku: string
  skuName: string | null
  productGroup: string
  station: string | null
  rawOrderKg: number
  hist0800Kg: number
  hist1400Kg: number
  hist1600Kg?: number
  histDays?: number
  avgOrderKg?: number
  ratio: number | null
  variance: number
  requestedQuantityKg?: number
  shortageKg?: number
  allocationStatus?: 'full' | 'partial'
  channelPriority?: number
  phase1DeductedKg?: number
  phase2DeductedKg?: number
  openingStockKg?: number
  quantityKg: number
}

export interface GenerateBasicPlanResult {
  success: boolean
  message: string
  phase?: BasicPhase
  period?: string
  startTime?: string
  endTime?: string | null
  pigsPlanned?: number
  rateSecPerPig?: number
  targets?: BasicYieldTarget[]
  skuTargets?: BasicSkuTarget[]
}

interface BasicPhaseConfig {
  phase: BasicPhase
  period: string
  startTime: string
  endTime: string | null
  startMins: number
  endMins: number | null
  breaks: BasicBreakWindow[]
}

interface SelectedLot {
  spec_code: string
  qty: number
  avg_weight: number
  order: number
}

interface BasicBreakWindow {
  startTime: string
  endTime: string
  startMins: number
  endMins: number
}

export const BASIC_PHASES: Record<BasicPhase, BasicPhaseConfig> = {
  1: {
    phase: 1,
    period: 'เช้า',
    startTime: '08:30:00',
    endTime: '14:30:00',
    startMins: 8 * 60 + 30,
    endMins: 14 * 60 + 30,
    breaks: [
      {
        startTime: '12:00:00',
        endTime: '13:00:00',
        startMins: 12 * 60,
        endMins: 13 * 60,
      },
    ],
  },
  2: {
    phase: 2,
    period: 'บ่าย',
    startTime: '14:30:00',
    endTime: '16:30:00',
    startMins: 14 * 60 + 30,
    endMins: 16 * 60 + 30,
    breaks: [],
  },
  3: {
    phase: 3,
    period: 'ค่ำ',
    startTime: '16:30:00',
    endTime: null,
    startMins: 16 * 60 + 30,
    endMins: null,
    breaks: [
      {
        startTime: '17:00:00',
        endTime: '18:00:00',
        startMins: 17 * 60,
        endMins: 18 * 60,
      },
    ],
  },
}

function isBasicPhase(value: unknown): value is BasicPhase {
  return value === 1 || value === 2 || value === 3
}

function todayBangkok(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

export function normalizeSku(sku: string): string {
  return sku.trim().replace(/^0+/, '')
}

function normMatName(name: string): string {
  return name.trim().toLowerCase().replace(/\s*-\s*/g, '-')
}

function findClosestWeight(avg: number, weights: number[]): number {
  return weights.reduce((best, w) => Math.abs(w - avg) < Math.abs(best - avg) ? w : best, weights[0])
}

function phaseCapacityPigs(phaseCfg: BasicPhaseConfig, rateSecPerPig: number): number {
  if (rateSecPerPig <= 0) return 0
  if (phaseCfg.endMins == null) return Number.MAX_SAFE_INTEGER
  const grossMins = phaseCfg.endMins - phaseCfg.startMins
  const breakMins = phaseCfg.breaks.reduce((sum, br) => {
    const overlapStart = Math.max(phaseCfg.startMins, br.startMins)
    const overlapEnd = Math.min(phaseCfg.endMins!, br.endMins)
    return sum + Math.max(0, overlapEnd - overlapStart)
  }, 0)
  return Math.floor(((grossMins - breakMins) * 60) / rateSecPerPig)
}

function consumeLotsForPhase(lots: SelectedLot[], phase: BasicPhase, phaseCfg: BasicPhaseConfig, rateSecPerPig: number): SelectedLot[] {
  const capacityByPhase = {
    1: phaseCapacityPigs(BASIC_PHASES[1], rateSecPerPig),
    2: phaseCapacityPigs(BASIC_PHASES[2], rateSecPerPig),
    3: phaseCapacityPigs(BASIC_PHASES[3], rateSecPerPig),
  } satisfies Record<BasicPhase, number>

  const sorted = lots.slice().sort((a, b) => a.order - b.order)
  let skip = phase === 1 ? 0 : capacityByPhase[1]
  if (phase === 3) skip += capacityByPhase[2]

  const result: SelectedLot[] = []
  let need = capacityByPhase[phase]

  for (const lot of sorted) {
    let remaining = Math.max(0, Number(lot.qty ?? 0))
    if (skip > 0) {
      const skipped = Math.min(skip, remaining)
      remaining -= skipped
      skip -= skipped
    }
    if (remaining <= 0 || need <= 0) continue

    const take = Math.min(need, remaining)
    if (take > 0) result.push({ ...lot, qty: take })
    need -= take
  }

  return result
}

async function fetchSelectedLotsAndRate() {
  const { data, error } = await supabase
    .from('pig_carcass_lot_selection')
    .select('selected, rate')
    .eq('id', 1)
    .maybeSingle()

  if (error) throw error
  return {
    lots: ((data?.selected ?? []) as SelectedLot[]).filter(l => Number(l.qty) > 0 && Number(l.avg_weight) > 0),
    rateSecPerPig: Number(data?.rate ?? 90) || 90,
  }
}

export async function fetchPaged<T>(
  table: string,
  select: string,
  apply: (query: any) => any = query => query,
): Promise<T[]> {
  const PAGE = 1000
  const all: T[] = []
  let from = 0

  while (true) {
    const query = apply(supabase.from(table).select(select)).range(from, from + PAGE - 1)
    const { data, error } = await query
    if (error) throw error
    all.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) break
    from += PAGE
  }

  return all
}

// Re-uploading a round (or stale rows left over from a template/import predating upload_log_id
// tracking) never replaces prior rows for that delivery_date+upload_round, so summing raw rows
// can double-count. Keep only rows from each (delivery_date, upload_round) group's most recent
// upload_log_id; groups with no upload_log_id on any row are returned unfiltered.
export async function fetchLatestMakroOrders(
  dates: string[],
  rounds: string[],
): Promise<Array<{ delivery_date: string; upload_round: string; sku: string; sku_name: string | null; quantity: number }>> {
  if (!dates.length || !rounds.length) return []

  type RawRow = {
    delivery_date: string
    upload_round: string
    sku: string
    sku_name: string | null
    quantity: number
    upload_log_id: string | null
    uploaded_at: string | null
  }
  const all = await fetchPaged<RawRow>(
    'makro_orders',
    'delivery_date, upload_round, sku, sku_name, quantity, upload_log_id, uploaded_at',
    query => query.in('delivery_date', dates).in('upload_round', rounds),
  )

  const latestByGroup = new Map<string, { uploadedAt: string; uploadLogId: string }>()
  for (const r of all) {
    if (!r.uploaded_at || !r.upload_log_id) continue
    const key = `${r.delivery_date}|||${r.upload_round}`
    const cur = latestByGroup.get(key)
    if (!cur || r.uploaded_at > cur.uploadedAt) {
      latestByGroup.set(key, { uploadedAt: r.uploaded_at, uploadLogId: r.upload_log_id })
    }
  }

  return all
    .filter(r => {
      const latest = latestByGroup.get(`${r.delivery_date}|||${r.upload_round}`)
      return !latest || r.upload_log_id === latest.uploadLogId
    })
    .map(({ delivery_date, upload_round, sku, sku_name, quantity }) => ({ delivery_date, upload_round, sku, sku_name, quantity }))
}

// Rounds down to the nearest picking-unit (bag) multiple so packed output never exceeds the
// order/yield target that fed into it — matches roundDownToBag() in lib/generate-plan.ts.
async function fetchBagSizeMap(): Promise<Map<string, number>> {
  const data = await fetchPaged<{ sap: string; weight_per_bag: number }>(
    'picking_unit_master',
    'sap, weight_per_bag',
  )
  const map = new Map<string, number>()
  for (const r of data) {
    const sap = String(r.sap ?? '').trim()
    const wpb = Number(r.weight_per_bag ?? 0)
    if (sap && wpb > 0) {
      map.set(sap, wpb)
      map.set(sap.replace(/^0+/, ''), wpb)
    }
  }
  return map
}

// Carried-over Wet Market stock (คลัง 0010) nets against demand at every Basic phase before the
// existing phase1/phase2-produced deduction runs. Subtracting the same full opening balance
// independently at each phase looks like double-counting but telescopes to exactly one deduction
// from the day's final order total, since each phase's "already produced" figure already reflects
// its own stock-adjusted target.
export async function fetchOpeningStock0010(): Promise<{ byCode: Map<string, number>; byName: Map<string, number> }> {
  const byCode = new Map<string, number>()
  const byName = new Map<string, number>()

  const { data: latestLog, error: logError } = await supabase
    .from('upload_log')
    .select('id')
    .eq('table_name', 'stock_0010')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (logError) throw logError
  if (!latestLog?.id) return { byCode, byName }

  const rows = await fetchPaged<{ material_code: string | null; material_name: string | null; weight_total: number | null }>(
    'stock_0010',
    'material_code, material_name, weight_total',
    query => query.eq('upload_log_id', latestLog.id).gt('weight_total', 0),
  )

  for (const row of rows) {
    const qty = Number(row.weight_total ?? 0) || 0
    if (qty <= 0) continue
    const code = normalizeSku(String(row.material_code ?? ''))
    if (code) byCode.set(code, (byCode.get(code) ?? 0) + qty)
    const name = normMatName(String(row.material_name ?? ''))
    if (name) byName.set(name, (byName.get(name) ?? 0) + qty)
  }

  return { byCode, byName }
}

export function lookupOpeningStockKg(stock: { byCode: Map<string, number>; byName: Map<string, number> }, sku: string, skuName: string | null): number {
  return stock.byCode.get(normalizeSku(sku)) ?? stock.byName.get(normMatName(skuName ?? '')) ?? 0
}

function roundDownToBag(bagSizeMap: Map<string, number>, sku: string, qty: number): number {
  const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, ''))
  if (!wpb || wpb <= 0) return qty
  return Math.floor((qty / wpb) + 1e-9) * wpb
}

// A SKU's demand often lands in this list as several rows (Makro order + Wet Market order +
// Yield Balance filler, split further across allocation attempts). Flooring each row to the
// nearest bag independently zeroes out any row smaller than one bag even when the SKU's combined
// output easily covers a whole bag — e.g. Wet Market 3kg + Yield Balance 4kg both vanish under a
// 5kg bag even though together they're 7kg. Instead, floor the SKU's total once, then trim only
// the Yield Balance row (discretionary filler, not a placed order) to absorb the remainder;
// firm channel orders are only trimmed if Yield Balance alone can't cover the loss.
function roundSkuTargetsDownToBag(list: BasicSkuTarget[], bagSizeMap: Map<string, number>): BasicSkuTarget[] {
  const bySku = new Map<string, BasicSkuTarget[]>()
  for (const t of list) {
    const group = bySku.get(t.sku) ?? []
    group.push(t)
    bySku.set(t.sku, group)
  }

  const result: BasicSkuTarget[] = []
  for (const [sku, group] of Array.from(bySku.entries())) {
    const total = group.reduce((sum: number, t: BasicSkuTarget) => sum + t.quantityKg, 0)
    const roundedTotal = roundDownToBag(bagSizeMap, sku, total)
    let trim = Math.round((total - roundedTotal) * 100) / 100

    const trimOrder = [...group].sort((a, b) => {
      const aBalance = a.channel === 'Yield Balance' ? 0 : 1
      const bBalance = b.channel === 'Yield Balance' ? 0 : 1
      if (aBalance !== bBalance) return aBalance - bBalance
      return (b.channelPriority ?? 999) - (a.channelPriority ?? 999)
    })

    for (const t of trimOrder) {
      if (trim <= 0) {
        result.push(t)
        continue
      }
      const take = Math.min(trim, t.quantityKg)
      const newQty = Math.round((t.quantityKg - take) * 100) / 100
      trim = Math.round((trim - take) * 100) / 100
      if (newQty > 0) result.push({ ...t, quantityKg: newQty })
    }
  }
  return result
}

export async function fetchProductivityByGroup(): Promise<Map<string, { station: string; skus: BasicProductivitySku[] }>> {
  const data = await fetchPaged<{ row_data: Record<string, unknown> }>(
    'master_logic_calculation',
    'row_data',
    query => query.eq('calculation_type', 'Mas Productivity Basic').order('uploaded_at', { ascending: false }),
  )

  const map = new Map<string, { station: string; skus: BasicProductivitySku[] }>()
  const seenSkuByGroup = new Set<string>()
  for (const row of data ?? []) {
    const r = row.row_data as Record<string, unknown>
    const sku = String(r['SAP'] ?? '').trim()
    const skuName = String(r['ชื่อสินค้า'] ?? '').trim() || null
    const productGroup = String(r['กลุ่มสินค้า'] ?? '').trim()
    const station = String(r['จุดงาน'] ?? '').trim()
    const product = String(r['Product'] ?? '').trim() || null
    if (!productGroup) continue

    const current = map.get(productGroup) ?? { station, skus: [] }
    if (!current.station && station) current.station = station

    const seenKey = `${productGroup}|||${sku}`
    if (sku && !seenSkuByGroup.has(seenKey)) {
      current.skus.push({ sku, skuName, product })
      seenSkuByGroup.add(seenKey)
    }
    map.set(productGroup, current)
  }
  return map
}

export function buildSkuLookup(productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>) {
  const lookup = new Map<string, { sku: string; skuName: string | null; productGroup: string; station: string | null }>()
  for (const [productGroup, group] of productivityByGroup.entries()) {
    for (const sku of group.skus) {
      const norm = normalizeSku(sku.sku)
      if (!norm || lookup.has(norm)) continue
      lookup.set(norm, {
        sku: sku.sku,
        skuName: sku.skuName,
        productGroup,
        station: group.station || null,
      })
    }
  }
  return lookup
}

function channelPriorityKey(channel: string): string {
  return channel.trim().toLowerCase()
}

async function fetchBasicChannelPriority(phase: BasicPhase): Promise<Map<string, number>> {
  const { data: latestLog, error: logError } = await supabase
    .from('upload_log')
    .select('id')
    .eq('table_name', 'master_logic_calc_mas_channel_basic')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (logError) throw logError
  if (!latestLog?.id) return new Map()

  const { data, error } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('upload_log_id', latestLog.id)
    .eq('calculation_type', 'Mas Channel Basic')

  if (error) throw error

  const map = new Map<string, number>()
  for (const row of data ?? []) {
    const r = row.row_data as Record<string, unknown>
    if (Number(r['Phase'] ?? 0) !== phase) continue

    const channel = String(r['Channel'] ?? '').trim()
    const priority = Number(r['Priority'] ?? 0)
    if (!channel || priority <= 0) continue
    map.set(channelPriorityKey(channel), priority)
  }
  return map
}

function allocateTargetsByYield(
  targets: BasicYieldTarget[],
  skuTargets: BasicSkuTarget[],
  channelPriority: Map<string, number>,
  includeZeroQuantity = false,
): BasicSkuTarget[] {
  const yieldByGroup = new Map(targets.map(target => [target.productGroup, target.quantityKg]))
  const targetsByGroup = new Map<string, BasicSkuTarget[]>()

  for (const skuTarget of skuTargets) {
    const groupTargets = targetsByGroup.get(skuTarget.productGroup) ?? []
    groupTargets.push(skuTarget)
    targetsByGroup.set(skuTarget.productGroup, groupTargets)
  }

  const allocated: BasicSkuTarget[] = []
  for (const [productGroup, groupTargets] of targetsByGroup.entries()) {
    let remainingKg = yieldByGroup.get(productGroup) ?? 0
    const sortedTargets = groupTargets
      .map((target, index) => ({ target, index }))
      .sort((a, b) => {
        const pa = channelPriority.get(channelPriorityKey(a.target.channel)) ?? 999
        const pb = channelPriority.get(channelPriorityKey(b.target.channel)) ?? 999
        return pa - pb || b.target.quantityKg - a.target.quantityKg || a.index - b.index
      })

    for (const { target } of sortedTargets) {
      const requestedQuantityKg = Math.round(target.quantityKg * 100) / 100
      const allocatedQuantityKg = Math.max(0, Math.min(remainingKg, target.quantityKg))
      remainingKg -= allocatedQuantityKg

      allocated.push({
        ...target,
        requestedQuantityKg,
        shortageKg: Math.round(Math.max(0, requestedQuantityKg - allocatedQuantityKg) * 100) / 100,
        allocationStatus: allocatedQuantityKg >= requestedQuantityKg ? 'full' : 'partial',
        channelPriority: channelPriority.get(channelPriorityKey(target.channel)) ?? 999,
        quantityKg: Math.round(allocatedQuantityKg * 100) / 100,
      })
    }
  }

  return allocated
    .filter(target => includeZeroQuantity || target.quantityKg > 0)
    .sort((a, b) => {
      const pa = channelPriority.get(channelPriorityKey(a.channel)) ?? 999
      const pb = channelPriority.get(channelPriorityKey(b.channel)) ?? 999
      return (a.station ?? '').localeCompare(b.station ?? '') || a.productGroup.localeCompare(b.productGroup) || pa - pb || a.sku.localeCompare(b.sku)
    })
}

function buildYieldTargetsFromLots(
  phaseLots: SelectedLot[],
  masYield: Awaited<ReturnType<typeof fetchLatestMasYield>>,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): BasicYieldTarget[] {
  const weights = Array.from(new Set(masYield.map(r => Number(r.carcass_weight)).filter(n => n > 0))).sort((a, b) => a - b)
  const targetMap = new Map<string, BasicYieldTarget>()

  for (const lot of phaseLots) {
    const matchedWeight = findClosestWeight(lot.avg_weight, weights)
    for (const row of masYield.filter(r => Number(r.carcass_weight) === matchedWeight)) {
      const productGroup = String(row.product_group ?? '').trim()
      if (!productGroup) continue
      const quantityKg = (Number(row.yield_pct) / 100) * lot.qty * lot.avg_weight
      const productivity = productivityByGroup.get(productGroup)
      const current = targetMap.get(productGroup) ?? {
        productGroup,
        station: productivity?.station ?? null,
        quantityKg: 0,
        yieldPct: 0,
        skus: productivity?.skus ?? [],
      }
      current.quantityKg += quantityKg
      current.yieldPct += Number(row.yield_pct) || 0
      targetMap.set(productGroup, current)
    }
  }

  return Array.from(targetMap.values())
    .map(t => ({ ...t, quantityKg: Math.round(t.quantityKg * 100) / 100, yieldPct: Math.round(t.yieldPct * 100) / 100 }))
    .sort((a, b) => (a.station ?? '').localeCompare(b.station ?? '') || a.productGroup.localeCompare(b.productGroup))
}

function targetDeductKey(target: BasicSkuTarget): string {
  return `${normalizeSku(target.sku)}|||${channelPriorityKey(target.channel)}`
}

function subtractProducedTargets(targets: BasicSkuTarget[], producedTargets: BasicSkuTarget[]): BasicSkuTarget[] {
  const producedBySkuChannel = producedTargets.reduce((map, target) => {
    const key = targetDeductKey(target)
    map.set(key, (map.get(key) ?? 0) + target.quantityKg)
    return map
  }, new Map<string, number>())

  return targets
    .map(target => {
      const deductedKg = producedBySkuChannel.get(targetDeductKey(target)) ?? 0
      const remainingKg = Math.max(0, target.quantityKg - deductedKg)
      return {
        ...target,
        rawOrderKg: Math.round(remainingKg * 100) / 100,
        requestedQuantityKg: Math.round(target.quantityKg * 100) / 100,
        phase1DeductedKg: Math.round(Math.min(target.quantityKg, deductedKg) * 100) / 100,
        quantityKg: Math.round(remainingKg * 100) / 100,
      }
    })
    .filter(target => target.quantityKg > 0)
}

function isLotusWetChannel(channel: string): boolean {
  const key = channelPriorityKey(channel)
  return key === 'lotus' || key === 'wet market'
}

function subtractProducedTargetsAcrossLotusWetPool(
  targets: BasicSkuTarget[],
  producedTargets: BasicSkuTarget[],
  field: 'phase1DeductedKg' | 'phase2DeductedKg',
): BasicSkuTarget[] {
  const producedBySkuPool = producedTargets.reduce((map, target) => {
    if (!isLotusWetChannel(target.channel)) return map
    const sku = normalizeSku(target.sku)
    map.set(sku, (map.get(sku) ?? 0) + target.quantityKg)
    return map
  }, new Map<string, number>())

  const producedBySkuChannel = producedTargets.reduce((map, target) => {
    if (!isLotusWetChannel(target.channel)) return map
    const key = targetDeductKey(target)
    map.set(key, (map.get(key) ?? 0) + target.quantityKg)
    return map
  }, new Map<string, number>())

  const targetsBySku = targets.reduce((map, target) => {
    const sku = normalizeSku(target.sku)
    const list = map.get(sku) ?? []
    list.push(target)
    map.set(sku, list)
    return map
  }, new Map<string, BasicSkuTarget[]>())

  const result: BasicSkuTarget[] = []
  for (const [sku, skuTargets] of targetsBySku.entries()) {
    const targetTotal = skuTargets.reduce((sum, target) => sum + target.quantityKg, 0)
    const remainingTotal = Math.max(0, targetTotal - (producedBySkuPool.get(sku) ?? 0))
    const deficits = skuTargets.map(target => ({
      target,
      deficitKg: Math.max(0, target.quantityKg - (producedBySkuChannel.get(targetDeductKey(target)) ?? 0)),
    }))
    const totalDeficit = deficits.reduce((sum, row) => sum + row.deficitKg, 0)
    let remainingToAllocate = remainingTotal

    for (const { target, deficitKg } of deficits) {
      const allocatedKg = totalDeficit > 0
        ? Math.min(deficitKg, remainingToAllocate)
        : Math.min(target.quantityKg, remainingToAllocate)
      remainingToAllocate -= allocatedKg
      const roundedAllocated = Math.round(Math.max(0, allocatedKg) * 100) / 100
      if (roundedAllocated <= 0) continue

      result.push({
        ...target,
        rawOrderKg: roundedAllocated,
        requestedQuantityKg: Math.round((target.requestedQuantityKg ?? target.quantityKg) * 100) / 100,
        [field]: Math.round(Math.max(0, target.quantityKg - roundedAllocated) * 100) / 100,
        quantityKg: roundedAllocated,
      })
    }
  }

  return result
}

// Reconstructs what phase 1 actually saved to production_assignments (bag-rounded), so that
// later phases subtract the real produced amount instead of the pre-rounding theoretical one —
// otherwise the subtraction overestimates what's already made and under-serves the remainder.
async function buildPhase1SkuTargets(
  date: string,
  lots: SelectedLot[],
  rateSecPerPig: number,
  masYield: Awaited<ReturnType<typeof fetchLatestMasYield>>,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
  bagSizeMap: Map<string, number>,
): Promise<BasicSkuTarget[]> {
  const phase1Lots = consumeLotsForPhase(lots, 1, BASIC_PHASES[1], rateSecPerPig)
  if (!phase1Lots.length) return []

  const phase1Targets = buildYieldTargetsFromLots(phase1Lots, masYield, productivityByGroup)
  const [makroTargets, wetMarketTargets, lotusTargets, channelPriority] = await Promise.all([
    fetchLatestMakro0800Targets(date, productivityByGroup),
    fetchWetMarket1600AverageTargets(date, productivityByGroup),
    fetchLotus1600AverageTargets(date, productivityByGroup),
    fetchBasicChannelPriority(1),
  ])
  const orderTargets = allocateTargetsByYield(phase1Targets, [...makroTargets, ...wetMarketTargets, ...lotusTargets], channelPriority)
  const balanceTargets = await buildEnoughYieldBalanceTargets(date, phase1Targets, orderTargets, productivityByGroup)
  return roundSkuTargetsDownToBag([...orderTargets, ...balanceTargets], bagSizeMap)
}

async function buildPhase2AllocatedTargets(
  date: string,
  lots: SelectedLot[],
  rateSecPerPig: number,
  masYield: Awaited<ReturnType<typeof fetchLatestMasYield>>,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
  subtractPhase1: boolean,
  bagSizeMap: Map<string, number>,
  includeZeroQuantity = false,
): Promise<BasicSkuTarget[]> {
  const phase2Lots = consumeLotsForPhase(lots, 2, BASIC_PHASES[2], rateSecPerPig)
  if (!phase2Lots.length) return []

  const phase2Targets = buildYieldTargetsFromLots(phase2Lots, masYield, productivityByGroup)
  const [makroTargets, wetMarketTargets, lotusTargets, channelPriority] = await Promise.all([
    fetchMakro1400Targets(date, productivityByGroup),
    fetchWetMarket1400Targets(date, productivityByGroup),
    fetchLotus1400Targets(date, productivityByGroup),
    fetchBasicChannelPriority(2),
  ])
  const baseOrderTargets = [...makroTargets, ...wetMarketTargets, ...lotusTargets]
  const phase1Targets = subtractPhase1
    ? await buildPhase1SkuTargets(date, lots, rateSecPerPig, masYield, productivityByGroup, bagSizeMap)
    : []
  const phase2OrderTargets = subtractPhase1
    ? subtractProducedTargets(baseOrderTargets, phase1Targets)
    : baseOrderTargets
  const allocated = allocateTargetsByYield(phase2Targets, phase2OrderTargets, channelPriority, includeZeroQuantity)
  return includeZeroQuantity ? allocated : roundSkuTargetsDownToBag(allocated, bagSizeMap)
}

async function fetchLatestMakro0800Targets(
  date: string,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<BasicSkuTarget[]> {
  const [data, varianceByGroupTrend, histSums] = await Promise.all([
    fetchLatestMakroOrders([date], ['0800']),
    fetchMakroVarianceBasic(),
    fetchMakroHistorySums(date),
  ])

  const skuLookup = buildSkuLookup(productivityByGroup)
  const targetMap = new Map<string, BasicSkuTarget>()

  for (const row of data ?? []) {
    const norm = normalizeSku(String(row.sku ?? ''))
    const prod = skuLookup.get(norm)
    if (!prod) continue

    const current = targetMap.get(norm) ?? {
      channel: 'Makro',
      sku: prod.sku,
      skuName: prod.skuName || String(row.sku_name ?? '').trim() || null,
      productGroup: prod.productGroup,
      station: prod.station,
      rawOrderKg: 0,
      hist0800Kg: 0,
      hist1400Kg: 0,
      ratio: null,
      variance: 1,
      quantityKg: 0,
    }
    current.rawOrderKg += Number(row.quantity ?? 0) || 0
    targetMap.set(norm, current)
  }

  return Array.from(targetMap.values())
    .map(t => {
      const hist = histSums.get(normalizeSku(t.sku)) ?? { hist0800Kg: 0, hist1400Kg: 0 }
      const ratio = hist.hist0800Kg > 0 ? hist.hist1400Kg / hist.hist0800Kg : null
      const trendKey = ratio !== null && ratio >= 1 ? '>= 1.0' : '< 1.0'
      const variance = varianceByGroupTrend.get(`${t.productGroup}|||${trendKey}`) ?? 1
      const quantityKg = t.rawOrderKg * variance
      return {
        ...t,
        rawOrderKg: Math.round(t.rawOrderKg * 100) / 100,
        hist0800Kg: Math.round(hist.hist0800Kg * 100) / 100,
        hist1400Kg: Math.round(hist.hist1400Kg * 100) / 100,
        ratio: ratio === null ? null : Math.round(ratio * 10000) / 10000,
        variance,
        quantityKg: Math.round(quantityKg * 100) / 100,
      }
    })
    .filter(t => t.quantityKg > 0)
    .sort((a, b) => (a.station ?? '').localeCompare(b.station ?? '') || a.productGroup.localeCompare(b.productGroup) || a.sku.localeCompare(b.sku))
}

async function fetchMakro1400Targets(
  date: string,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<BasicSkuTarget[]> {
  const data = await fetchLatestMakroOrders([date], ['1400'])

  const skuLookup = buildSkuLookup(productivityByGroup)
  const targetMap = new Map<string, BasicSkuTarget>()

  for (const row of data) {
    const norm = normalizeSku(String(row.sku ?? ''))
    const prod = skuLookup.get(norm)
    if (!prod) continue

    const current = targetMap.get(norm) ?? {
      channel: 'Makro',
      sku: prod.sku,
      skuName: prod.skuName || String(row.sku_name ?? '').trim() || null,
      productGroup: prod.productGroup,
      station: prod.station,
      rawOrderKg: 0,
      hist0800Kg: 0,
      hist1400Kg: 0,
      ratio: null,
      variance: 1,
      quantityKg: 0,
    }
    current.rawOrderKg += Number(row.quantity ?? 0) || 0
    current.quantityKg = current.rawOrderKg
    targetMap.set(norm, current)
  }

  return Array.from(targetMap.values())
    .map(t => ({
      ...t,
      rawOrderKg: Math.round(t.rawOrderKg * 100) / 100,
      quantityKg: Math.round(t.quantityKg * 100) / 100,
    }))
    .filter(t => t.quantityKg > 0)
    .sort((a, b) => (a.station ?? '').localeCompare(b.station ?? '') || a.productGroup.localeCompare(b.productGroup) || a.sku.localeCompare(b.sku))
}

async function fetchLatestRoundUploadTargets(
  channel: string,
  ordersTable: 'lotus_orders' | 'wet_market_orders',
  date: string,
  uploadRound: '1400',
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<BasicSkuTarget[]> {
  const data = await fetchPaged<{ sku: string; sku_name: string | null; quantity: number }>(
    ordersTable,
    'sku, sku_name, quantity',
    query => query.eq('delivery_date', date).eq('upload_round', uploadRound),
  )

  const skuLookup = buildSkuLookup(productivityByGroup)
  const targetMap = new Map<string, BasicSkuTarget>()

  for (const row of data) {
    const norm = normalizeSku(String(row.sku ?? ''))
    const prod = skuLookup.get(norm)
    if (!prod) continue

    const current = targetMap.get(norm) ?? {
      channel,
      sku: prod.sku,
      skuName: prod.skuName || String(row.sku_name ?? '').trim() || null,
      productGroup: prod.productGroup,
      station: prod.station,
      rawOrderKg: 0,
      hist0800Kg: 0,
      hist1400Kg: 0,
      ratio: null,
      variance: 1,
      quantityKg: 0,
    }
    current.rawOrderKg += Number(row.quantity ?? 0) || 0
    current.quantityKg = current.rawOrderKg
    targetMap.set(norm, current)
  }

  return Array.from(targetMap.values())
    .map(t => ({
      ...t,
      rawOrderKg: Math.round(t.rawOrderKg * 100) / 100,
      quantityKg: Math.round(t.quantityKg * 100) / 100,
    }))
    .filter(t => t.quantityKg > 0)
    .sort((a, b) => (a.station ?? '').localeCompare(b.station ?? '') || a.productGroup.localeCompare(b.productGroup) || a.sku.localeCompare(b.sku))
}

async function fetchWetMarket1400Targets(
  date: string,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<BasicSkuTarget[]> {
  const [targets, openingStock] = await Promise.all([
    fetchLatestRoundUploadTargets('Wet Market', 'wet_market_orders', date, '1400', productivityByGroup),
    fetchOpeningStock0010(),
  ])

  return targets
    .map(t => {
      const openingStockKg = lookupOpeningStockKg(openingStock, t.sku, t.skuName)
      const quantityKg = Math.max(0, t.quantityKg - openingStockKg)
      return {
        ...t,
        openingStockKg: Math.round(openingStockKg * 100) / 100,
        quantityKg: Math.round(quantityKg * 100) / 100,
      }
    })
    .filter(t => t.quantityKg > 0)
}

async function fetchLotus1400Targets(
  date: string,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<BasicSkuTarget[]> {
  return fetchLatestRoundUploadTargets('LOTUS', 'lotus_orders', date, '1400', productivityByGroup)
}

async function fetchPlan100ChannelTargets(
  date: string,
  channel: 'LOTUS' | 'Wet Market',
  weightColumn: 'lotus_weight' | 'cpft_weight',
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<BasicSkuTarget[]> {
  const data = await fetchPaged<{
    sap: string
    product_name: string | null
    lotus_weight: number | null
    cpft_weight: number | null
  }>(
    'production_plan_100',
    'sap, product_name, lotus_weight, cpft_weight',
    query => query.eq('plan_date', date),
  )

  const skuLookup = buildSkuLookup(productivityByGroup)
  const targetMap = new Map<string, BasicSkuTarget>()

  for (const row of data ?? []) {
    const norm = normalizeSku(String(row.sap ?? ''))
    const prod = skuLookup.get(norm)
    const quantityKg = Number(row[weightColumn] ?? 0) || 0
    if (!prod || quantityKg <= 0) continue

    const current = targetMap.get(norm) ?? {
      channel,
      sku: prod.sku,
      skuName: prod.skuName || String(row.product_name ?? '').trim() || null,
      productGroup: prod.productGroup,
      station: prod.station,
      rawOrderKg: 0,
      hist0800Kg: 0,
      hist1400Kg: 0,
      ratio: null,
      variance: 1,
      quantityKg: 0,
    }
    current.rawOrderKg += quantityKg
    current.quantityKg = current.rawOrderKg
    targetMap.set(norm, current)
  }

  const openingStock = channel === 'Wet Market' ? await fetchOpeningStock0010() : null

  return Array.from(targetMap.values())
    .map(t => {
      const openingStockKg = openingStock ? lookupOpeningStockKg(openingStock, t.sku, t.skuName) : 0
      const quantityKg = Math.max(0, t.quantityKg - openingStockKg)
      return {
        ...t,
        rawOrderKg: Math.round(t.rawOrderKg * 100) / 100,
        openingStockKg: Math.round(openingStockKg * 100) / 100,
        quantityKg: Math.round(quantityKg * 100) / 100,
      }
    })
    .filter(t => t.quantityKg > 0)
    .sort((a, b) => (a.station ?? '').localeCompare(b.station ?? '') || a.productGroup.localeCompare(b.productGroup) || a.sku.localeCompare(b.sku))
}

async function fetchPlan100LotusTargets(
  date: string,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<BasicSkuTarget[]> {
  return fetchPlan100ChannelTargets(date, 'LOTUS', 'lotus_weight', productivityByGroup)
}

async function fetchPlan100WetMarketTargets(
  date: string,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<BasicSkuTarget[]> {
  return fetchPlan100ChannelTargets(date, 'Wet Market', 'cpft_weight', productivityByGroup)
}

async function fetchMakroHistorySums(date: string): Promise<Map<string, { hist0800Kg: number; hist1400Kg: number }>> {
  const histDates = [shiftDate(date, -7), shiftDate(date, -14)]
  const data = await fetchLatestMakroOrders(histDates, ['0800', '1400'])

  const map = new Map<string, { hist0800Kg: number; hist1400Kg: number }>()
  for (const row of data) {
    const sku = normalizeSku(String(row.sku ?? ''))
    if (!sku) continue
    const current = map.get(sku) ?? { hist0800Kg: 0, hist1400Kg: 0 }
    const qty = Number(row.quantity ?? 0) || 0
    if (String(row.upload_round) === '1400') current.hist1400Kg += qty
    else current.hist0800Kg += qty
    map.set(sku, current)
  }
  return map
}

async function fetchMakroVarianceBasic(): Promise<Map<string, number>> {
  const { data: latestLog, error: logError } = await supabase
    .from('upload_log')
    .select('id')
    .eq('table_name', 'master_logic_calc_mas_variance_makro_basic')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (logError) throw logError
  if (!latestLog?.id) return new Map()

  const { data, error } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('upload_log_id', latestLog.id)
    .eq('calculation_type', 'Mas %Variance Makro Basic')

  if (error) throw error

  const map = new Map<string, number>()
  for (const row of data ?? []) {
    const r = row.row_data as Record<string, unknown>
    const productGroup = String(r['กลุ่มสินค้า'] ?? '').trim()
    const trend = String(r['แนวโน้ม <1 = เพิ่ม, >1 = ลด'] ?? '').trim()
    const varianceRaw = Number(r['%Variance'] ?? 0)
    const variance = varianceRaw > 1 ? varianceRaw / 100 : varianceRaw
    if (!productGroup || !trend || variance <= 0) continue
    map.set(`${productGroup}|||${trend}`, variance)
  }
  return map
}

async function fetchWetMarket1600AverageTargets(
  date: string,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<BasicSkuTarget[]> {
  const histDates = Array.from({ length: 7 }, (_, i) => shiftDate(date, -(i + 1)))
  const [varianceBySku, data, openingStock] = await Promise.all([
    fetchWetMarketVarianceBasic(),
    fetchPaged<{ sku: string; sku_name: string | null; quantity: number }>(
      'wet_market_orders',
      'sku, sku_name, quantity',
      query => query.in('delivery_date', histDates).eq('upload_round', '1600'),
    ),
    fetchOpeningStock0010(),
  ])

  const skuLookup = buildSkuLookup(productivityByGroup)
  const targetMap = new Map<string, BasicSkuTarget>()

  for (const row of data) {
    const norm = normalizeSku(String(row.sku ?? ''))
    const prod = skuLookup.get(norm)
    if (!prod) continue

    const current = targetMap.get(norm) ?? {
      channel: 'Wet Market',
      sku: prod.sku,
      skuName: prod.skuName || String(row.sku_name ?? '').trim() || null,
      productGroup: prod.productGroup,
      station: prod.station,
      rawOrderKg: 0,
      hist0800Kg: 0,
      hist1400Kg: 0,
      hist1600Kg: 0,
      histDays: histDates.length,
      avgOrderKg: 0,
      ratio: null,
      variance: 1,
      quantityKg: 0,
    }

    current.hist1600Kg = (current.hist1600Kg ?? 0) + (Number(row.quantity ?? 0) || 0)
    targetMap.set(norm, current)
  }

  return Array.from(targetMap.values())
    .map(t => {
      const hist1600Kg = t.hist1600Kg ?? 0
      const avgOrderKg = hist1600Kg / histDates.length
      const variance = varianceBySku.get(normalizeSku(t.sku)) ?? 1
      const demandKg = avgOrderKg * variance
      const openingStockKg = lookupOpeningStockKg(openingStock, t.sku, t.skuName)
      const quantityKg = Math.max(0, demandKg - openingStockKg)
      return {
        ...t,
        rawOrderKg: Math.round(avgOrderKg * 100) / 100,
        hist1600Kg: Math.round(hist1600Kg * 100) / 100,
        avgOrderKg: Math.round(avgOrderKg * 100) / 100,
        histDays: histDates.length,
        variance,
        openingStockKg: Math.round(openingStockKg * 100) / 100,
        quantityKg: Math.round(quantityKg * 100) / 100,
      }
    })
    .filter(t => t.quantityKg > 0)
    .sort((a, b) => (a.station ?? '').localeCompare(b.station ?? '') || a.productGroup.localeCompare(b.productGroup) || a.sku.localeCompare(b.sku))
}

async function fetchWetMarketVarianceBasic(): Promise<Map<string, number>> {
  const { data: latestLog, error: logError } = await supabase
    .from('upload_log')
    .select('id')
    .eq('table_name', 'master_logic_calc_mas_variance_wet_market_basic')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (logError) throw logError
  if (!latestLog?.id) return new Map()

  const { data, error } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('upload_log_id', latestLog.id)
    .eq('calculation_type', 'Mas %Variance Wet Market Basic')

  if (error) throw error

  const map = new Map<string, number>()
  for (const row of data ?? []) {
    const r = row.row_data as Record<string, unknown>
    const sku = normalizeSku(String(r['SAP'] ?? '').trim())
    const varianceRaw = Number(r['%Var'] ?? r['%Variance'] ?? 0)
    const variance = varianceRaw > 1 ? varianceRaw / 100 : varianceRaw
    if (!sku || variance <= 0) continue
    map.set(sku, variance)
  }
  return map
}

async function fetchLotus1600AverageTargets(
  date: string,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<BasicSkuTarget[]> {
  const histDates = Array.from({ length: 7 }, (_, i) => shiftDate(date, -(i + 1)))
  const [varianceBySku, data] = await Promise.all([
    fetchLotusVarianceBasic(),
    fetchPaged<{ sku: string; sku_name: string | null; quantity: number }>(
      'lotus_orders',
      'sku, sku_name, quantity',
      query => query.in('delivery_date', histDates).eq('upload_round', '1600'),
    ),
  ])

  const skuLookup = buildSkuLookup(productivityByGroup)
  const targetMap = new Map<string, BasicSkuTarget>()

  for (const row of data) {
    const norm = normalizeSku(String(row.sku ?? ''))
    const prod = skuLookup.get(norm)
    if (!prod) continue

    const current = targetMap.get(norm) ?? {
      channel: 'LOTUS',
      sku: prod.sku,
      skuName: prod.skuName || String(row.sku_name ?? '').trim() || null,
      productGroup: prod.productGroup,
      station: prod.station,
      rawOrderKg: 0,
      hist0800Kg: 0,
      hist1400Kg: 0,
      hist1600Kg: 0,
      histDays: histDates.length,
      avgOrderKg: 0,
      ratio: null,
      variance: 1,
      quantityKg: 0,
    }

    current.hist1600Kg = (current.hist1600Kg ?? 0) + (Number(row.quantity ?? 0) || 0)
    targetMap.set(norm, current)
  }

  return Array.from(targetMap.values())
    .map(t => {
      const hist1600Kg = t.hist1600Kg ?? 0
      const avgOrderKg = hist1600Kg / histDates.length
      const variance = varianceBySku.get(normalizeSku(t.sku)) ?? 1
      const quantityKg = avgOrderKg * variance
      return {
        ...t,
        rawOrderKg: Math.round(avgOrderKg * 100) / 100,
        hist1600Kg: Math.round(hist1600Kg * 100) / 100,
        avgOrderKg: Math.round(avgOrderKg * 100) / 100,
        histDays: histDates.length,
        variance,
        quantityKg: Math.round(quantityKg * 100) / 100,
      }
    })
    .filter(t => t.quantityKg > 0)
    .sort((a, b) => (a.station ?? '').localeCompare(b.station ?? '') || a.productGroup.localeCompare(b.productGroup) || a.sku.localeCompare(b.sku))
}

async function fetchLotusVarianceBasic(): Promise<Map<string, number>> {
  const { data: latestLog, error: logError } = await supabase
    .from('upload_log')
    .select('id')
    .eq('table_name', 'master_logic_calc_mas_variance_lotus_basic')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (logError) throw logError
  if (!latestLog?.id) return new Map()

  const { data, error } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('upload_log_id', latestLog.id)
    .eq('calculation_type', 'Mas %Variance LOTUS Basic')

  if (error) throw error

  const map = new Map<string, number>()
  for (const row of data ?? []) {
    const r = row.row_data as Record<string, unknown>
    const sku = normalizeSku(String(r['SAP'] ?? '').trim())
    const varianceRaw = Number(r['%Var'] ?? r['%Variance'] ?? 0)
    const variance = varianceRaw > 1 ? varianceRaw / 100 : varianceRaw
    if (!sku || variance <= 0) continue
    map.set(sku, variance)
  }
  return map
}

async function fetchWetMarketTopSkuByGroup(
  date: string,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<Map<string, { sku: string; skuName: string | null; station: string | null; quantityKg: number }>> {
  const histDates = Array.from({ length: 7 }, (_, i) => shiftDate(date, -(i + 1)))
  const data = await fetchPaged<{ sku: string; sku_name: string | null; quantity: number }>(
    'wet_market_orders',
    'sku, sku_name, quantity',
    query => query.in('delivery_date', histDates).eq('upload_round', '1600'),
  )

  const skuLookup = buildSkuLookup(productivityByGroup)
  const sumByGroupSku = new Map<string, { sku: string; skuName: string | null; station: string | null; quantityKg: number }>()

  for (const row of data) {
    const norm = normalizeSku(String(row.sku ?? ''))
    const prod = skuLookup.get(norm)
    if (!prod) continue

    const key = `${prod.productGroup}|||${prod.sku}`
    const current = sumByGroupSku.get(key) ?? {
      sku: prod.sku,
      skuName: prod.skuName || String(row.sku_name ?? '').trim() || null,
      station: prod.station,
      quantityKg: 0,
    }
    current.quantityKg += Number(row.quantity ?? 0) || 0
    sumByGroupSku.set(key, current)
  }

  const topByGroup = new Map<string, { sku: string; skuName: string | null; station: string | null; quantityKg: number }>()
  for (const [key, value] of sumByGroupSku.entries()) {
    const productGroup = key.split('|||')[0]
    const current = topByGroup.get(productGroup)
    if (!current || value.quantityKg > current.quantityKg) {
      topByGroup.set(productGroup, value)
    }
  }
  return topByGroup
}

async function buildEnoughYieldBalanceTargets(
  date: string,
  targets: BasicYieldTarget[],
  skuTargets: BasicSkuTarget[],
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<BasicSkuTarget[]> {
  const wetMarketTopByGroup = await fetchWetMarketTopSkuByGroup(date, productivityByGroup)
  const demandByGroup = skuTargets.reduce((map, target) => {
    map.set(target.productGroup, (map.get(target.productGroup) ?? 0) + target.quantityKg)
    return map
  }, new Map<string, number>())

  const balanceTargets: BasicSkuTarget[] = []
  for (const target of targets) {
    const demandKg = demandByGroup.get(target.productGroup) ?? 0
    const balanceKg = target.quantityKg - demandKg
    if (balanceKg <= 0) continue

    const productivity = productivityByGroup.get(target.productGroup)
    const rawSku = productivity?.skus.find(sku => (sku.skuName ?? '').toLowerCase().includes('raw'))
    const fallbackSku = rawSku ? null : wetMarketTopByGroup.get(target.productGroup)
    const chosenSku = rawSku
      ? {
          sku: rawSku.sku,
          skuName: rawSku.skuName,
          station: productivity?.station || target.station,
        }
      : fallbackSku

    if (!chosenSku) continue

    balanceTargets.push({
      channel: 'Yield Balance',
      sku: chosenSku.sku,
      skuName: chosenSku.skuName,
      productGroup: target.productGroup,
      station: chosenSku.station ?? target.station,
      rawOrderKg: 0,
      hist0800Kg: 0,
      hist1400Kg: 0,
      hist1600Kg: fallbackSku?.quantityKg ? Math.round(fallbackSku.quantityKg * 100) / 100 : undefined,
      histDays: fallbackSku ? 7 : undefined,
      avgOrderKg: fallbackSku ? Math.round((fallbackSku.quantityKg / 7) * 100) / 100 : undefined,
      ratio: null,
      variance: 1,
      quantityKg: Math.round(balanceKg * 100) / 100,
    })
  }

  return balanceTargets.sort((a, b) => (a.station ?? '').localeCompare(b.station ?? '') || a.productGroup.localeCompare(b.productGroup) || a.sku.localeCompare(b.sku))
}

export async function generateBasicPlan(params: GenerateBasicPlanParams): Promise<GenerateBasicPlanResult> {
  const phase = Number(params.phase)
  if (!isBasicPhase(phase)) {
    return { success: false, message: 'กรุณาระบุ Phase 1, 2 หรือ 3' }
  }

  const date = params.date || todayBangkok()
  const phaseCfg = BASIC_PHASES[phase]
  const [{ lots, rateSecPerPig }, masYield, productivityByGroup, bagSizeMap] = await Promise.all([
    fetchSelectedLotsAndRate(),
    fetchLatestMasYield(supabase),
    fetchProductivityByGroup(),
    fetchBagSizeMap(),
  ])

  if (!lots.length) {
    return { success: false, message: 'ไม่พบ Lot หมูซีกที่เลือกไว้จากหน้าเบิกหมูซีก', phase, period: phaseCfg.period }
  }
  if (!masYield.length) {
    return { success: false, message: 'ไม่พบข้อมูล Mas Yield', phase, period: phaseCfg.period }
  }

  const phaseLots = consumeLotsForPhase(lots, phase, phaseCfg, rateSecPerPig)
  if (!phaseLots.length) {
    return { success: false, message: `ไม่มีจำนวนหมูซีกเหลือสำหรับ Phase ${phase}`, phase, period: phaseCfg.period }
  }

  const targets = buildYieldTargetsFromLots(phaseLots, masYield, productivityByGroup)
  const [makroTargets, wetMarketTargets, lotusTargets, channelPriority] = phase === 1
    ? await Promise.all([
        fetchLatestMakro0800Targets(date, productivityByGroup),
        fetchWetMarket1600AverageTargets(date, productivityByGroup),
        fetchLotus1600AverageTargets(date, productivityByGroup),
        fetchBasicChannelPriority(phase),
      ])
    : phase === 2
      ? await Promise.all([
          fetchMakro1400Targets(date, productivityByGroup),
          fetchWetMarket1400Targets(date, productivityByGroup),
          fetchLotus1400Targets(date, productivityByGroup),
          fetchBasicChannelPriority(phase),
        ])
      : phase === 3
        ? await Promise.all([
            fetchMakro1400Targets(date, productivityByGroup),
            fetchPlan100WetMarketTargets(date, productivityByGroup),
            fetchPlan100LotusTargets(date, productivityByGroup),
            fetchBasicChannelPriority(phase),
          ])
        : [[], [], [], new Map<string, number>()]
  const shouldSubtractPhase1 = phase === 2 && Boolean(params.subtractPhase1FromPhase2)
  const shouldSubtractPhase1ForPhase3 = phase === 3 && Boolean(params.subtractPhase1FromPhase3)
  const shouldSubtractPhase2ForPhase3 = phase === 3 && Boolean(params.subtractPhase2FromPhase3)
  const baseOrderTargets = [...makroTargets, ...wetMarketTargets, ...lotusTargets]
  const phase1SkuTargets = shouldSubtractPhase1
    ? await buildPhase1SkuTargets(date, lots, rateSecPerPig, masYield, productivityByGroup, bagSizeMap)
    : []
  const phase3Phase1SkuTargets = shouldSubtractPhase1ForPhase3
    ? await buildPhase1SkuTargets(date, lots, rateSecPerPig, masYield, productivityByGroup, bagSizeMap)
    : []
  const phase3Phase2SkuTargets = shouldSubtractPhase2ForPhase3
    ? await buildPhase2AllocatedTargets(date, lots, rateSecPerPig, masYield, productivityByGroup, shouldSubtractPhase1ForPhase3, bagSizeMap)
    : []
  const phase3Plan100Targets = phase === 3
    ? (() => {
        let planTargets = [...wetMarketTargets, ...lotusTargets]
        if (shouldSubtractPhase1ForPhase3) {
          planTargets = subtractProducedTargetsAcrossLotusWetPool(planTargets, phase3Phase1SkuTargets, 'phase1DeductedKg')
        }
        if (shouldSubtractPhase2ForPhase3) {
          planTargets = subtractProducedTargetsAcrossLotusWetPool(planTargets, phase3Phase2SkuTargets, 'phase2DeductedKg')
        }
        return planTargets
      })()
    : []
  const phase3MakroTargets = phase === 3
    ? (() => {
        let planTargets = makroTargets
        if (shouldSubtractPhase1ForPhase3) {
          planTargets = subtractProducedTargets(planTargets, phase3Phase1SkuTargets.filter(target => target.channel === 'Makro'))
        }
        if (shouldSubtractPhase2ForPhase3) {
          planTargets = subtractProducedTargets(planTargets, phase3Phase2SkuTargets.filter(target => target.channel === 'Makro'))
        }
        return planTargets
      })()
    : []
  const phaseOrderTargets = phase === 2 && shouldSubtractPhase1
    ? subtractProducedTargets(baseOrderTargets, phase1SkuTargets)
    : phase === 3
      ? [...phase3MakroTargets, ...phase3Plan100Targets]
      : baseOrderTargets
  const shouldAllocateByYield = phase === 1 || phase === 2 || phase === 3
  const orderTargets = shouldAllocateByYield
    ? allocateTargetsByYield(targets, phaseOrderTargets, channelPriority)
    : phaseOrderTargets
  const balanceTargets = shouldAllocateByYield
    ? await buildEnoughYieldBalanceTargets(date, targets, orderTargets, productivityByGroup)
    : []
  const skuTargets = roundSkuTargetsDownToBag([...orderTargets, ...balanceTargets], bagSizeMap)

  return {
    success: true,
    message: `คำนวณ Yield Basic วันที่ ${date} Phase ${phase} ได้ ${targets.length} กลุ่มสินค้า${shouldAllocateByYield ? ` / Makro ${makroTargets.length} SKU / Wet Market ${wetMarketTargets.length} SKU / LOTUS ${lotusTargets.length} SKU / Balance ${balanceTargets.length} SKU${shouldSubtractPhase1 ? ` / หัก Phase 1 ${phase1SkuTargets.length} SKU` : ''}${shouldSubtractPhase1ForPhase3 ? ` / หัก Phase 1 ${phase3Phase1SkuTargets.length} SKU` : ''}${shouldSubtractPhase2ForPhase3 ? ` / หัก Phase 2 ${phase3Phase2SkuTargets.length} SKU` : ''}` : ''}`,
    phase,
    period: phaseCfg.period,
    startTime: phaseCfg.startTime,
    endTime: phaseCfg.endTime,
    pigsPlanned: phaseLots.reduce((sum, lot) => sum + lot.qty, 0),
    rateSecPerPig,
    targets,
    skuTargets,
  }
}
