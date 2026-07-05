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

function subtractProducedTargetsWithField(
  targets: BasicSkuTarget[],
  producedTargets: BasicSkuTarget[],
  field: 'phase1DeductedKg' | 'phase2DeductedKg',
): BasicSkuTarget[] {
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
        requestedQuantityKg: Math.round((target.requestedQuantityKg ?? target.quantityKg) * 100) / 100,
        [field]: Math.round(Math.min(target.quantityKg, deductedKg) * 100) / 100,
        quantityKg: Math.round(remainingKg * 100) / 100,
      }
    })
    .filter(target => target.quantityKg > 0)
}

async function buildPhase1SkuTargets(
  date: string,
  lots: SelectedLot[],
  rateSecPerPig: number,
  masYield: Awaited<ReturnType<typeof fetchLatestMasYield>>,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
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
  return [...orderTargets, ...balanceTargets]
}

async function buildPhase2AllocatedTargets(
  date: string,
  lots: SelectedLot[],
  rateSecPerPig: number,
  masYield: Awaited<ReturnType<typeof fetchLatestMasYield>>,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
  subtractPhase1: boolean,
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
    ? await buildPhase1SkuTargets(date, lots, rateSecPerPig, masYield, productivityByGroup)
    : []
  const phase2OrderTargets = subtractPhase1
    ? subtractProducedTargets(baseOrderTargets, phase1Targets)
    : baseOrderTargets
  return allocateTargetsByYield(phase2Targets, phase2OrderTargets, channelPriority, includeZeroQuantity)
}

async function fetchLatestMakro0800Targets(
  date: string,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
): Promise<BasicSkuTarget[]> {
  const [data, varianceByGroupTrend, histSums] = await Promise.all([
    fetchPaged<{ sku: string; sku_name: string | null; quantity: number }>(
      'makro_orders',
      'sku, sku_name, quantity',
      query => query.eq('delivery_date', date).eq('upload_round', '0800'),
    ),
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
  const data = await fetchPaged<{ sku: string; sku_name: string | null; quantity: number }>(
    'makro_orders',
    'sku, sku_name, quantity',
    query => query.eq('delivery_date', date).eq('upload_round', '1400'),
  )

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
  return fetchLatestRoundUploadTargets('Wet Market', 'wet_market_orders', date, '1400', productivityByGroup)
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

  return Array.from(targetMap.values())
    .map(t => ({
      ...t,
      rawOrderKg: Math.round(t.rawOrderKg * 100) / 100,
      quantityKg: Math.round(t.quantityKg * 100) / 100,
    }))
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

async function buildPhase2MakroShortageTargets(
  date: string,
  lots: SelectedLot[],
  rateSecPerPig: number,
  masYield: Awaited<ReturnType<typeof fetchLatestMasYield>>,
  productivityByGroup: Map<string, { station: string; skus: BasicProductivitySku[] }>,
  subtractPhase1: boolean,
): Promise<BasicSkuTarget[]> {
  const phase2AllocatedTargets = await buildPhase2AllocatedTargets(
    date,
    lots,
    rateSecPerPig,
    masYield,
    productivityByGroup,
    subtractPhase1,
    true,
  )

  return phase2AllocatedTargets
    .filter(target => target.channel === 'Makro' && (target.shortageKg ?? 0) > 0)
    .map(target => ({
      ...target,
      rawOrderKg: Math.round((target.shortageKg ?? 0) * 100) / 100,
      requestedQuantityKg: Math.round((target.shortageKg ?? 0) * 100) / 100,
      shortageKg: undefined,
      allocationStatus: undefined,
      quantityKg: Math.round((target.shortageKg ?? 0) * 100) / 100,
    }))
    .filter(target => target.quantityKg > 0)
}

async function fetchMakroHistorySums(date: string): Promise<Map<string, { hist0800Kg: number; hist1400Kg: number }>> {
  const histDates = [shiftDate(date, -7), shiftDate(date, -14)]
  const data = await fetchPaged<{ sku: string; quantity: number; upload_round: string }>(
    'makro_orders',
    'sku, quantity, upload_round',
    query => query.in('delivery_date', histDates).in('upload_round', ['0800', '1400']),
  )

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
  const [varianceBySku, data] = await Promise.all([
    fetchWetMarketVarianceBasic(),
    fetchPaged<{ sku: string; sku_name: string | null; quantity: number }>(
      'wet_market_orders',
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
  const [{ lots, rateSecPerPig }, masYield, productivityByGroup] = await Promise.all([
    fetchSelectedLotsAndRate(),
    fetchLatestMasYield(supabase),
    fetchProductivityByGroup(),
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
            buildPhase2MakroShortageTargets(date, lots, rateSecPerPig, masYield, productivityByGroup, Boolean(params.subtractPhase1FromPhase3)),
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
    ? await buildPhase1SkuTargets(date, lots, rateSecPerPig, masYield, productivityByGroup)
    : []
  const phase3Phase1SkuTargets = shouldSubtractPhase1ForPhase3
    ? await buildPhase1SkuTargets(date, lots, rateSecPerPig, masYield, productivityByGroup)
    : []
  const phase3Phase2SkuTargets = shouldSubtractPhase2ForPhase3
    ? await buildPhase2AllocatedTargets(date, lots, rateSecPerPig, masYield, productivityByGroup, shouldSubtractPhase1ForPhase3)
    : []
  const phase3Plan100Targets = phase === 3
    ? (() => {
        let planTargets = [...wetMarketTargets, ...lotusTargets]
        if (shouldSubtractPhase1ForPhase3) {
          planTargets = subtractProducedTargetsWithField(planTargets, phase3Phase1SkuTargets, 'phase1DeductedKg')
        }
        if (shouldSubtractPhase2ForPhase3) {
          planTargets = subtractProducedTargetsWithField(planTargets, phase3Phase2SkuTargets, 'phase2DeductedKg')
        }
        return planTargets
      })()
    : []
  const phaseOrderTargets = phase === 2 && shouldSubtractPhase1
    ? subtractProducedTargets(baseOrderTargets, phase1SkuTargets)
    : phase === 3
      ? [...makroTargets, ...phase3Plan100Targets]
      : baseOrderTargets
  const shouldAllocateByYield = phase === 1 || phase === 2 || phase === 3
  const orderTargets = shouldAllocateByYield
    ? allocateTargetsByYield(targets, phaseOrderTargets, channelPriority)
    : phaseOrderTargets
  const balanceTargets = shouldAllocateByYield
    ? await buildEnoughYieldBalanceTargets(date, targets, orderTargets, productivityByGroup)
    : []
  const skuTargets = [...orderTargets, ...balanceTargets]

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
