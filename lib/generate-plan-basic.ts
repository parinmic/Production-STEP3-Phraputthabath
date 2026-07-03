import { supabase, fetchLatestPlan100 } from '@/lib/supabase'
import { computeRawShortageRows } from '@/lib/compute-raw-shortage'
import { fetchLatestMasYield } from '@/lib/mas-yield'

// ========== Types ==========

interface WorkforceRow {
  emp_id: string
  name: string
  work_station: string
  shift: string
}

interface OrderRow {
  sku: string
  sku_name: string | null
  quantity: number
  delivery_date: string
}

interface ProductivityRow {
  station: string
  product_group: string
  sku: string
  sku_name: string
  rate: number
  product: string
}

interface MasYieldRow {
  carcass_weight: number
  product_group: string
  yield_pct: number
  notes?: string | null
}

interface GroupStationRule {
  product_group: string
  station: string
  is_enabled: boolean
  split_mode: string | null
  priority: number | null
  share_pct: number | null
  allow_same_sku: boolean | null
  sku_route_mode: string | null
  raw_remainder_mode: string | null
  overflow_station: string | null
}

interface SkuTarget {
  sku: string
  skuName: string | null
  targetQty: number
  channel: string
  isDeficit?: boolean
  planOrder?: number
  rawNeedTime?: string | null
  rawFinishByMins?: number | null
}

interface CarcassLot {
  spec_code:  string
  qty:        number
  avg_weight: number
  order:      number
}

interface LineBreakRow {
  station: string
  start_time: string
  end_time: string
}

export interface GenerateBasicPlanParams {
  date?: string
  phase?: number
  deductMode?: 'plan' | 'actual' | 'yield'
  carcassLots?: CarcassLot[]
  carcassRate?: number
  trimmingQty?: number
}

export interface GenerateBasicPlanResult {
  success: boolean
  isScheduled?: boolean
  effectiveFrom?: string
  message: string
  count?: number
}

// ========== Constants ==========

const BASIC_TABLE_NAMES = ['สะโพกเบสิค', 'ไหล่เบสิค', 'สามชั้นเบสิค'] as const

const PHASE_CONFIG = [
  { phase: 1, period: 'เช้า', deadline: '14:30:00', hours: 6.0, startH: 8.5,  endH: 14.5 },
  { phase: 2, period: 'บ่าย', deadline: '16:30:00', hours: 2.0, startH: 14.5, endH: 16.5 },
  { phase: 3, period: 'ค่ำ',  deadline: null,        hours: 7.5, startH: 16.5, endH: 30  },
]

const PHASE_ROUND_MINS: Record<number, number[]> = {
  1: [510, 600, 780],
  2: [870],
  3: [990, 1080, 1200],
}

const BREAKS: [number, number][] = [
  [720,  780],  // 12:00–13:00
  [1020, 1080], // 17:00–18:00
]

// Active (non-break) carcass processing segments, matching CarcassGanttPanel
const CARCASS_ACTIVE_SEGS = [
  { phase: 1, mins: 210 },  // 08:30–12:00
  { phase: 1, mins: 90  },  // 13:00–14:30  (break excluded)
  { phase: 2, mins: 120 },  // 14:30–16:30
  { phase: 3, mins: 30  },  // 16:30–17:00  (before break)
  { phase: 3, mins: 720 },  // 18:00–06:00  (post-break, stops when lots exhausted)
]

const RAW_REMAINDER_MIN_KG = 20

// Basic master calculation_type strings
const CALC = {
  productivity: 'Mas Productivity Basic',
  channel:      'Mas Channel Basic',
  varMakro:     'Mas %Variance Makro Basic',
  varWM:        'Mas %Variance Wet Market Basic',
  varLotus:     'Mas %Variance LOTUS Basic',
  special:      'Mas Special Basic',
  productType:  'Mas Product Type Basic',
} as const

// ========== Pure Utilities ==========

function minsToTimeStr(mins: number): string {
  const wrapped = ((mins % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = Math.floor(wrapped % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

function minsToHHMM(mins: number): string {
  const wrapped = ((Math.round(mins) % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function hhmmToMins(t: string | null | undefined): number | null {
  if (!t) return null
  const [h, m] = String(t).slice(0, 5).split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

function availableWorkMins(fromMins: number, toMins: number): number {
  const total = Math.max(0, toMins - fromMins)
  const overlap = BREAKS.reduce((sum, [bs, be]) =>
    sum + Math.max(0, Math.min(be, toMins) - Math.max(bs, fromMins)), 0)
  return Math.max(0, total - overlap)
}

function timeStrToMins(t: string): number {
  const [h, m] = String(t).split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return 0
  return h * 60 + m
}

function lineBreakActiveMins(
  breaks: { start_time: string; end_time: string }[],
  phaseStartMins: number,
  phaseEndMins: number,
): number {
  const intervals = breaks
    .map(b => ({
      start: Math.max(timeStrToMins(b.start_time), phaseStartMins),
      end:   Math.min(timeStrToMins(b.end_time), phaseEndMins),
    }))
    .filter(b => b.end > b.start)
    .sort((a, b) => a.start - b.start)

  let total = 0
  let cur: { start: number; end: number } | null = null
  for (const interval of intervals) {
    if (!cur) {
      cur = { ...interval }
      continue
    }
    if (interval.start <= cur.end) {
      cur.end = Math.max(cur.end, interval.end)
    } else {
      total += availableWorkMins(cur.start, cur.end)
      cur = { ...interval }
    }
  }
  if (cur) total += availableWorkMins(cur.start, cur.end)
  return total
}

function lineBreakSegments(
  breaks: LineBreakRow[],
  station: string,
  phaseStartMins: number,
  phaseEndMins: number,
): { start: number; end: number }[] {
  return breaks
    .filter(b => b.station === station || b.station === 'ทั้งหมด')
    .map(b => ({
      start: Math.max(timeStrToMins(b.start_time), phaseStartMins),
      end:   Math.min(timeStrToMins(b.end_time), phaseEndMins),
    }))
    .filter(b => b.end > b.start)
}

function segmentActiveMins(segments: { start: number; end: number }[], fromMins: number, toMins: number): number {
  return segments.reduce((sum, seg) => {
    const start = Math.max(seg.start, fromMins)
    const end = Math.min(seg.end, toMins)
    return end > start ? sum + availableWorkMins(start, end) : sum
  }, 0)
}

function wallClockFinish(fromMins: number, workMins: number): number {
  if (workMins <= 0) return fromMins
  let pos = fromMins
  let remaining = workMins
  for (const [bs, be] of BREAKS) {
    if (pos >= bs && pos < be) pos = be
    if (pos >= be) continue
    if (remaining <= 0) break
    const beforeBreak = bs - pos
    if (remaining <= beforeBreak) return pos + remaining
    remaining -= beforeBreak
    pos = be
  }
  return pos + remaining
}

// Approach B: find which carcass lot is active at a given wall-clock time.
// Pig position = floor(active_work_minutes_from_08:30 × 60 / carcassRate)
function computeTaskDuration(params: {
  qty: number
  productGroup: string | undefined
  startMins: number
  sortedLots: { qty: number; avg_weight: number }[]
  carcassRateSec: number
  masYield: MasYieldRow[]
  capUniqWts: number[]
  fallbackRate: number
}): number {
  const { qty, productGroup, startMins, sortedLots, carcassRateSec, masYield, capUniqWts, fallbackRate } = params
  const fallback = fallbackRate > 0 ? Math.round((qty / fallbackRate) * 60) : 0

  if (!sortedLots.length || !carcassRateSec || !masYield.length || !productGroup || !capUniqWts.length) {
    return fallback
  }

  const carcassStartMins = 510 // 08:30
  const activeMins = availableWorkMins(carcassStartMins, startMins)
  const pigIndex = Math.floor(activeMins * 60 / carcassRateSec)

  let consumed = 0
  let activeLot: { qty: number; avg_weight: number } | null = null
  for (const lot of sortedLots) {
    if (pigIndex < consumed + lot.qty) { activeLot = lot; break }
    consumed += lot.qty
  }
  if (!activeLot) activeLot = sortedLots[sortedLots.length - 1]
  if (!activeLot) return fallback

  const nearestWt = capUniqWts.reduce((b, w) =>
    Math.abs(w - activeLot!.avg_weight) < Math.abs(b - activeLot!.avg_weight) ? w : b, capUniqWts[0])
  const yieldPct = masYield
    .filter(r => r.carcass_weight === nearestWt && r.product_group === productGroup)
    .reduce((sum, r) => sum + Number(r.yield_pct ?? 0), 0)
  if (yieldPct <= 0) return fallback

  const yieldPerPig = (yieldPct / 100) * activeLot.avg_weight
  if (yieldPerPig <= 0) return fallback

  return Math.round((qty / yieldPerPig) * carcassRateSec / 60)
}

function normalizeRow(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(r)) out[k.trim()] = v
  return out
}

const normalizeStation = (s: string) => s.replace(/[()]/g, '').trim()

// Map short station names from Productivity Master to Basic station names used in workforce
const BASIC_STATION_MAP: Record<string, string> = {
  'สะโพก':  'สะโพกเบสิค',
  'ไหล่':   'ไหล่เบสิค',
  'สามชั้น': 'สามชั้นเบสิค',
}
const toBasicStation = (s: string): string => BASIC_STATION_MAP[normalizeStation(s)] ?? normalizeStation(s)

const normName = (s: string) => {
  if (!s) return ''
  return s.replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}

// ========== Master Data Parsers ==========

function parseProductivity(rows: Record<string, unknown>[]): ProductivityRow[] {
  return rows
    .map(r => { const n = normalizeRow(r); return ({
      station:       String(n['จุดงาน'] ?? '').trim(),
      product_group: String(n['กลุ่มสินค้า'] ?? '').trim(),
      sku:           String(n['SAP'] ?? '').trim(),
      sku_name:      String(n['ชื่อสินค้า'] ?? '').trim(),
      rate:          Number(n['กำลังการผลิต (กก./ชม./คน)'] ?? 0),
      product:       String(n['Product'] ?? '').trim(),
    })})
    .filter(r => r.station && r.sku && r.rate > 0)
}

function percentValue(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace('%', '').trim())
  if (!isFinite(n) || n <= 0) return 0
  return n > 1 ? n / 100 : n
}

function parseYieldNoteSplits(note: string | null | undefined): { product_group: string; share: number }[] {
  if (!note) return []
  const splits: { product_group: string; share: number }[] = []
  for (const line of note.split(/\r?\n/)) {
    const m = line.trim().match(/^(.+?)\s*([0-9]+(?:\.[0-9]+)?)\s*%$/)
    if (!m) continue
    const share = Number(m[2]) / 100
    if (!m[1].trim() || !isFinite(share) || share <= 0) continue
    splits.push({ product_group: m[1].trim(), share })
  }
  return splits
}

function isMainProduct(p: ProductivityRow): boolean {
  const product = p.product.trim().toUpperCase()
  return product === 'RAW' || p.sku_name.trim().toLowerCase().endsWith('-raw')
}

function isJobAssignGroupColumn(key: string): boolean {
  const clean = key.replace(/_\d+$/, '').trim()
  if (!clean || clean.startsWith('__EMPTY')) return false
  if (['จุดงาน', 'รายชื่อพนักงาน', 'ชื่อเล่น', 'ชั่งน้ำหนัก', 'ผลได้'].includes(clean)) return false
  return true
}

function buildJobAssignMap(rows: { row_data: Record<string, unknown> }[]) {
  const map = new Map<string, { isWeigher: boolean; groups: Map<string, number> }>()
  for (const row of rows) {
    const r = normalizeRow(row.row_data)
    const fullName = normName(String(r['รายชื่อพนักงาน'] ?? ''))
    if (!fullName) continue
    const isWeigher = Number(r['ชั่งน้ำหนัก'] ?? 0) === 1
    const groups = new Map<string, number>()
    for (const [key, val] of Object.entries(r)) {
      if (!isJobAssignGroupColumn(key)) continue
      if (val === null || val === undefined) continue
      const level = Number(val)
      if (!isFinite(level) || level <= 0) continue
      const cleanKey = key.replace(/_\d+$/, '').trim()
      if (!groups.has(cleanKey) || level < (groups.get(cleanKey) ?? 99))
        groups.set(cleanKey, level)
    }
    map.set(fullName, { isWeigher, groups })
  }
  return map
}

function buildAvgMap(rows: OrderRow[]): Map<string, number> {
  const bySkuDate: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    const sku = r.sku.replace(/^0+/, '')
    if (!bySkuDate[sku]) bySkuDate[sku] = {}
    bySkuDate[sku][r.delivery_date] = (bySkuDate[sku][r.delivery_date] ?? 0) + r.quantity
  }
  const result = new Map<string, number>()
  for (const sku of Object.keys(bySkuDate)) {
    const vals = Object.values(bySkuDate[sku])
    result.set(sku, vals.reduce((s: number, v: number) => s + v, 0) / vals.length)
  }
  return result
}

function getWetMarketVariance(
  isShared: boolean, quotaToday: number, avgBL3: number, lotusBL3: number,
  params: [number, number, number, number] = [0.5, 0.3, 0.5, 0.7],
): number {
  const [nsHigh, nsLow, sHigh, sLow] = params
  if (!isShared) return Math.min(quotaToday, avgBL3) > 100 ? nsHigh : nsLow
  const ratio = lotusBL3 > 0 ? Math.min(quotaToday, avgBL3) / lotusBL3 : 999
  return ratio > 0.5 ? sHigh : sLow
}

// ========== Worker Scheduling Helpers ==========

function getWorkerFreeAt(
  nameKey: string,
  workerFreeAtMins: Map<string, number>,
  workerBusySegments: Map<string, { start: number; end: number }[]>,
  phaseStartMins: number,
): number {
  let freeAt = workerFreeAtMins.get(nameKey) ?? phaseStartMins
  const sorted = [...(workerBusySegments.get(nameKey) ?? [])].sort((a, b) => a.start - b.start)
  let advanced = true
  while (advanced) {
    advanced = false
    for (const seg of sorted) {
      if (freeAt >= seg.start - 0.01 && freeAt < seg.end) { freeAt = seg.end; advanced = true }
    }
  }
  return freeAt
}

function estimateWorkerFinish(
  freeAt: number,
  durationMins: number,
  busySegments: { start: number; end: number }[],
  limitEnd: number,
  specialStart: number | null,
  specialStop: number | null,
): number | null {
  let pos = (specialStart !== null) ? Math.max(freeAt, specialStart) : freeAt
  const targetEnd = (specialStop !== null) ? Math.min(limitEnd, specialStop) : limitEnd
  let remaining = durationMins
  const sortedSegs = [...busySegments].sort((a, b) => a.start - b.start)

  while (remaining > 0.01) {
    let advanced = true
    while (advanced) {
      advanced = false
      for (const seg of sortedSegs) {
        if (pos >= seg.start - 0.01 && pos < seg.end) { pos = seg.end; advanced = true }
      }
      for (const [bs, be] of BREAKS) {
        if (pos >= bs && pos < be) { pos = be; advanced = true }
      }
    }
    if (pos >= targetEnd) return null
    let nextEvent = targetEnd
    for (const seg of sortedSegs) {
      if (seg.start > pos) nextEvent = Math.min(nextEvent, seg.start)
    }
    for (const [bs] of BREAKS) {
      if (bs > pos) nextEvent = Math.min(nextEvent, bs)
    }
    const chunk = nextEvent - pos
    if (remaining <= chunk) return pos + remaining
    remaining -= chunk
    pos = nextEvent
  }
  return pos
}

// ========== Worker Allocation (balanced LPT) ==========

function allocateBalanced(params: {
  productionDate: string
  tableName: string
  targets: SkuTarget[]
  workers: WorkforceRow[]
  skuMap: Map<string, ProductivityRow>
  jobAssignMap: Map<string, { isWeigher: boolean; groups: Map<string, number> }>
  workerHours: Map<string, number>
  workerFreeAtMins: Map<string, number>
  workerBusySegments: Map<string, { start: number; end: number }[]>
  phaseEndMins: number
  period: string
  phaseRoundMins: number[]
  wpbMap: Map<string, number>
  specialTimeMap: Map<string, { startMins: number | null; stopMins: number | null }>
  skuTotalQtyOverride?: Map<string, number>
  skuRateOverrideMap?: Map<string, number>
}): Record<string, unknown>[] {
  const {
    productionDate, tableName, targets, workers, skuMap, jobAssignMap,
    workerHours, workerFreeAtMins, workerBusySegments, phaseEndMins,
    period, phaseRoundMins, wpbMap, specialTimeMap, skuTotalQtyOverride, skuRateOverrideMap,
  } = params

  if (!targets.length || !workers.length) return []

  interface ChEntry {
    channel: string
    qty: number
    isDeficit: boolean
    planOrder: number
    rawNeedTime?: string | null
    rawFinishByMins?: number | null
  }
  interface SkuBlock {
    normSku: string; rawSku: string; skuName: string | null
    totalQty: number; isDeficit: boolean; productGroup: string
    rate: number; personRate: number; channels: ChEntry[]
    isYieldCapped: boolean; planOrder: number
  }
  interface GroupBlock {
    productGroup: string
    blocks: SkuBlock[]
    totalQty: number
    manMins: number
    flowMins: number; planOrder: number
    isYieldCapped: boolean
  }

  const skuBlockMap = new Map<string, SkuBlock>()
  for (const t of targets) {
    if (!t.sku) continue
    const cleanSku = t.sku.replace(/^0+/, '')
    const prod = skuMap.get(cleanSku) ?? skuMap.get(t.sku)
    if (!prod || prod.rate <= 0) continue
    const existing = skuBlockMap.get(cleanSku)
    if (existing) {
      existing.totalQty += t.targetQty
      existing.channels.push({
        channel: t.channel,
        qty: t.targetQty,
        isDeficit: t.isDeficit || false,
        planOrder: t.planOrder ?? 999999,
        rawNeedTime: t.rawNeedTime ?? null,
        rawFinishByMins: t.rawFinishByMins ?? null,
      })
      if (t.isDeficit) existing.isDeficit = true
      existing.planOrder = Math.min(existing.planOrder, t.planOrder ?? 999999)
    } else {
      skuBlockMap.set(cleanSku, {
        normSku: cleanSku, rawSku: t.sku,
        skuName: prod.sku_name || t.skuName || null,
        totalQty: t.targetQty, isDeficit: t.isDeficit || false,
        productGroup: prod.product_group,
        rate: skuRateOverrideMap?.get(cleanSku) ?? prod.rate,
        personRate: prod.rate,
        channels: [{
          channel: t.channel,
          qty: t.targetQty,
          isDeficit: t.isDeficit || false,
          planOrder: t.planOrder ?? 999999,
          rawNeedTime: t.rawNeedTime ?? null,
          rawFinishByMins: t.rawFinishByMins ?? null,
        }],
        isYieldCapped: skuRateOverrideMap?.has(cleanSku) ?? false,
        planOrder: t.planOrder ?? 999999,
      })
    }
  }
  const skuBlocks = Array.from(skuBlockMap.values())
  skuBlocks.sort((a, b) => {
    if (a.planOrder !== b.planOrder) return a.planOrder - b.planOrder
    return (b.totalQty / b.rate) - (a.totalQty / a.rate)
  })

  const isWorkerEligible = (worker: WorkforceRow, skuGroup: string): boolean => {
    if (jobAssignMap.size === 0) return true
    const jobInfo = jobAssignMap.get(normName(worker.name))
    if (!jobInfo) return true
    if (jobInfo.isWeigher && (!skuGroup || !jobInfo.groups.has(skuGroup))) return false
    return skuGroup ? jobInfo.groups.has(skuGroup) : true
  }

  const getWorkerSkillLevel = (worker: WorkforceRow, skuGroup: string): number => {
    if (jobAssignMap.size === 0) return 1
    const jobInfo = jobAssignMap.get(normName(worker.name))
    return jobInfo?.groups.get(skuGroup) ?? 99
  }

  const workerSkuRoundQty    = new Map<string, Map<string, Map<number, number>>>()
  const workerSkuQty         = new Map<string, Map<string, number>>()
  const workerSkuDeficit     = new Map<string, Map<string, boolean>>()
  const workerSkuEarliestStart = new Map<string, Map<string, number>>()

  const getRoundMinsLocal = (t: number, roundMinsList: number[]): number => {
    let round = roundMinsList[0]
    for (const r of roundMinsList) {
      if (t >= r) round = r
      else break
    }
    return round
  }

  const phaseStartMins = phaseRoundMins[0] ?? 510
  const isPhaseOne = period === 'เช้า'
  const splitQtyForWorker = (qty: number, workerIdx: number, workerCount: number, wpb: number): number => {
    if (!wpb || wpb <= 0) {
      const baseQty = Math.floor((qty / workerCount) * 100) / 100
      return workerIdx === workerCount - 1
        ? Math.round((qty - baseQty * workerIdx) * 100) / 100
        : baseQty
    }
    const totalBags = isPhaseOne ? Math.round(qty / wpb) : Math.floor(qty / wpb)
    const baseBags = Math.floor(totalBags / workerCount)
    const extraBags = totalBags % workerCount
    return (baseBags + (workerIdx < extraBags ? 1 : 0)) * wpb
  }

  const groupedAssignments: Record<string, unknown>[] = []
  const groupMap = new Map<string, GroupBlock>()

  for (const block of skuBlocks) {
    const key = block.productGroup || '__ungrouped__'
    const manMins = block.personRate > 0 ? (block.totalQty / block.personRate) * 60 : 0
    const flowMins = block.rate > 0 ? (block.totalQty / block.rate) * 60 : 0
    const existing = groupMap.get(key)
    if (existing) {
      existing.blocks.push(block)
      existing.totalQty += block.totalQty
      existing.manMins += manMins
      existing.flowMins += flowMins
      existing.planOrder = Math.min(existing.planOrder, block.planOrder)
      existing.isYieldCapped = existing.isYieldCapped || block.isYieldCapped
    } else {
      groupMap.set(key, {
        productGroup: key,
        blocks: [block],
        totalQty: block.totalQty,
        manMins,
        flowMins,
        planOrder: block.planOrder,
        isYieldCapped: block.isYieldCapped,
      })
    }
  }

  const groupedBlocks = Array.from(groupMap.values()).sort((a, b) => {
    if (a.planOrder !== b.planOrder) return a.planOrder - b.planOrder
    return b.manMins - a.manMins
  })

  const groupStartFor = (worker: WorkforceRow, group: GroupBlock): number => {
    const nameKey = normName(worker.name)
    let start = getWorkerFreeAt(nameKey, workerFreeAtMins, workerBusySegments, phaseStartMins)
    for (const block of group.blocks) {
      const specialEntry = specialTimeMap.get(block.normSku) ?? specialTimeMap.get(block.rawSku)
      if (specialEntry?.startMins !== null && specialEntry?.startMins !== undefined) {
        start = Math.max(start, specialEntry.startMins)
      }
    }
    return start
  }

  const groupDurationFor = (group: GroupBlock): number => {
    return group.flowMins
  }

  const canScheduleGroupWith = (group: GroupBlock, groupWorkers: WorkforceRow[]): boolean => {
    if (!groupWorkers.length) return false
    const duration = groupDurationFor(group)
    return groupWorkers.every(worker => {
      const nameKey = normName(worker.name)
      const startAt = groupStartFor(worker, group)
      const busySegs = workerBusySegments.get(nameKey) ?? []
      return estimateWorkerFinish(startAt, duration, busySegs, phaseEndMins, null, null) !== null
    })
  }

  for (const group of groupedBlocks) {
    let eligibleWorkers = workers.filter(w => isWorkerEligible(w, group.productGroup))
    if (!eligibleWorkers.length) eligibleWorkers = workers
    if (!eligibleWorkers.length) continue

    const sortedWorkers = [...eligibleWorkers].sort((a, b) => {
      const skillA = getWorkerSkillLevel(a, group.productGroup)
      const skillB = getWorkerSkillLevel(b, group.productGroup)
      if (skillA !== skillB) return skillA - skillB
      const freeA = getWorkerFreeAt(normName(a.name), workerFreeAtMins, workerBusySegments, phaseStartMins)
      const freeB = getWorkerFreeAt(normName(b.name), workerFreeAtMins, workerBusySegments, phaseStartMins)
      return freeA - freeB
    })

    const groupWorkers: WorkforceRow[] = []
    for (const worker of sortedWorkers) {
      groupWorkers.push(worker)
      const enoughForLine = group.flowMins <= 0 || group.manMins <= 0 || (group.manMins / groupWorkers.length) <= group.flowMins + 0.01
      if (enoughForLine && canScheduleGroupWith(group, groupWorkers)) break
    }
    if (!groupWorkers.length || !canScheduleGroupWith(group, groupWorkers)) continue

    const groupStart = Math.max(...groupWorkers.map(w => groupStartFor(w, group)))
    let cursor = groupStart

    for (const block of group.blocks) {
      const specialEntry = specialTimeMap.get(block.normSku) ?? specialTimeMap.get(block.rawSku)
      const specialStart = specialEntry?.startMins ?? null
      if (specialStart !== null) cursor = Math.max(cursor, specialStart)

      const wpb = wpbMap.get(block.normSku) ?? wpbMap.get(block.rawSku.replace(/^0+/, '')) ?? 0
      const blockFlowDur = block.rate > 0 ? (block.totalQty / block.rate) * 60 : 0
      const blockDur = blockFlowDur
      const roundMins = getRoundMinsLocal(cursor, phaseRoundMins)

      for (let workerIdx = 0; workerIdx < groupWorkers.length; workerIdx++) {
        const worker = groupWorkers[workerIdx]
        const finalQty = block.channels.reduce((sum, ch) =>
          sum + splitQtyForWorker(ch.qty, workerIdx, groupWorkers.length, wpb), 0)
        if (finalQty <= 0) continue

        let remainingForWorker = finalQty
        for (const ch of block.channels) {
          if (remainingForWorker <= 0) break
          const chQty = splitQtyForWorker(ch.qty, workerIdx, groupWorkers.length, wpb)
          const finalChQty = Math.round(chQty * 100) / 100
          if (finalChQty <= 0) continue
          remainingForWorker -= finalChQty

          const noteRoundStr = `round:${roundMins}:${finalChQty}`
          const rawQueueNote = ch.channel === 'RAW_QUEUE' && ch.rawNeedTime && ch.rawFinishByMins !== null && ch.rawFinishByMins !== undefined
            ? `${noteRoundStr}|raw-queue|need=${ch.rawNeedTime}|target=${minsToHHMM(ch.rawFinishByMins)}`
            : noteRoundStr
          groupedAssignments.push({
            production_date: productionDate,
            table_name:      tableName,
            worker_code:     worker.emp_id,
            worker_name:     worker.name,
            sku:             block.rawSku,
            sku_name:        block.skuName,
            target_quantity: finalChQty,
            unit:            'กก.',
            period,
            deadline_time:   minsToTimeStr(cursor),
            status:          'รอผลิต',
            seq:             ch.planOrder,
            channel:         ch.channel,
            note:            block.isDeficit ? `${rawQueueNote}|deficit` : rawQueueNote,
            is_deficit:      block.isDeficit,
          })
        }
      }

      cursor = wallClockFinish(cursor, blockDur)
    }

    for (const worker of groupWorkers) {
      const nameKey = normName(worker.name)
      workerFreeAtMins.set(nameKey, cursor)
      const busySegs = workerBusySegments.get(nameKey) ?? []
      busySegs.push({ start: groupStart, end: cursor })
      workerBusySegments.set(nameKey, busySegs)
    }
  }

  return groupedAssignments
  /*

  const skuAssignedWorkers = new Map<string, Set<string>>()

  const assignments: Record<string, unknown>[] = []

  for (const block of skuBlocks) {
    const { normSku, rawSku, skuName, totalQty, productGroup, rate, personRate, channels, isYieldCapped } = block

    let eligibleWorkers = workers.filter(w => isWorkerEligible(w, productGroup))
    if (!eligibleWorkers.length) eligibleWorkers = workers
    if (!eligibleWorkers.length) continue

    const workersForSku: WorkforceRow[] = []
    const forcedDeficitWorkers = new Set<string>()

    const assignedSet = skuAssignedWorkers.get(normSku) ?? new Set<string>()

    const sortedWorkers = [...eligibleWorkers].sort((a, b) => {
      const skillA = getWorkerSkillLevel(a, productGroup)
      const skillB = getWorkerSkillLevel(b, productGroup)
      if (skillA !== skillB) return skillA - skillB
      const freeA = getWorkerFreeAt(normName(a.name), workerFreeAtMins, workerBusySegments, phaseStartMins)
      const freeB = getWorkerFreeAt(normName(b.name), workerFreeAtMins, workerBusySegments, phaseStartMins)
      return freeA - freeB
    })

    const specialEntryForBlock = specialTimeMap.get(normSku) ?? specialTimeMap.get(rawSku)
    const specialStartForBlock = specialEntryForBlock?.startMins ?? null
    const specialStopForBlock  = specialEntryForBlock?.stopMins  ?? null
    const flowDur = rate > 0 ? (totalQty / rate) * 60 : 0

    const canScheduleWith = (candidateWorkers: WorkforceRow[]): boolean => {
      if (!candidateWorkers.length || personRate <= 0) return false
      const perWorkerWorkDur = (totalQty / candidateWorkers.length / personRate) * 60
      const scheduledDur = isYieldCapped ? Math.max(flowDur, perWorkerWorkDur) : perWorkerWorkDur
      if (isYieldCapped && perWorkerWorkDur > flowDur + 0.01) return false
      return candidateWorkers.every(worker => {
        const nameKey = normName(worker.name)
        const freeAt = getWorkerFreeAt(nameKey, workerFreeAtMins, workerBusySegments, phaseStartMins)
        const busySegs = workerBusySegments.get(nameKey) ?? []
        return estimateWorkerFinish(
          freeAt, scheduledDur, busySegs, phaseEndMins, specialStartForBlock, specialStopForBlock,
        ) !== null
      })
    }

    for (const worker of sortedWorkers) {
      const nameKey = normName(worker.name)
      if (assignedSet.has(nameKey)) {
        workersForSku.push(worker)
        if (canScheduleWith(workersForSku)) break
        continue
      }
      workersForSku.push(worker)
      if (canScheduleWith(workersForSku)) break
    }

    if (workersForSku.length && !canScheduleWith(workersForSku) && !block.isDeficit) {
      continue
    }

    if (!workersForSku.length) {
      // No one fit within available time — for deficit (raw-material-short) blocks,
      // still queue it onto the best-matching real worker instead of dropping the row,
      // so it stays visible in the Raw รอผลิต shortage report. Free time isn't advanced
      // for them below — this is backlog, not a real timeslot.
      if (block.isDeficit && sortedWorkers.length) {
        workersForSku.push(sortedWorkers[0])
        forcedDeficitWorkers.add(normName(sortedWorkers[0].name))
      } else {
        continue
      }
    }

    skuAssignedWorkers.set(normSku, new Set([...Array.from(assignedSet), ...workersForSku.map(w => normName(w.name))]))

    // Distribute kg directly for Basic; do not convert to picking-unit bags.
    for (let workerIdx = 0; workerIdx < workersForSku.length; workerIdx++) {
      const worker = workersForSku[workerIdx]
      const nameKey = normName(worker.name)
      const freeAt = getWorkerFreeAt(nameKey, workerFreeAtMins, workerBusySegments, phaseStartMins)
      const specialEntry = specialTimeMap.get(normSku) ?? specialTimeMap.get(rawSku)
      const specialStart = specialEntry?.startMins ?? null
      const startMins = forcedDeficitWorkers.has(nameKey)
        ? phaseEndMins
        : (specialStart !== null ? Math.max(freeAt, specialStart ?? freeAt) : freeAt)
      const roundMins = getRoundMinsLocal(startMins, phaseRoundMins)
      const baseQty = Math.floor((totalQty / workersForSku.length) * 100) / 100
      const assignedBefore = baseQty * workerIdx
      const finalQty = workerIdx === workersForSku.length - 1
        ? Math.round((totalQty - assignedBefore) * 100) / 100
        : baseQty
      if (finalQty <= 0) continue

      if (!workerSkuRoundQty.has(nameKey)) workerSkuRoundQty.set(nameKey, new Map())
      if (!workerSkuQty.has(nameKey))      workerSkuQty.set(nameKey, new Map())
      if (!workerSkuDeficit.has(nameKey))  workerSkuDeficit.set(nameKey, new Map())
      if (!workerSkuEarliestStart.has(nameKey)) workerSkuEarliestStart.set(nameKey, new Map())

      const skuRoundMap = workerSkuRoundQty.get(nameKey)!
      if (!skuRoundMap.has(normSku)) skuRoundMap.set(normSku, new Map())
      const rMap = skuRoundMap.get(normSku)!
      rMap.set(roundMins, (rMap.get(roundMins) ?? 0) + finalQty)

      const skuQtyMap = workerSkuQty.get(nameKey)!
      skuQtyMap.set(normSku, (skuQtyMap.get(normSku) ?? 0) + finalQty)

      const defMap = workerSkuDeficit.get(nameKey)!
      defMap.set(normSku, block.isDeficit)

      const startMap = workerSkuEarliestStart.get(nameKey)!
      const cur = startMap.get(normSku)
      if (cur === undefined || startMins < (cur ?? startMins)) startMap.set(normSku, startMins)

      // Advance worker free time — skip for forced deficit backlog (not a real timeslot)
      if (!forcedDeficitWorkers.has(nameKey)) {
        const workDur = personRate > 0 ? (finalQty / personRate * 60) : 0
        const dur = isYieldCapped ? Math.max(flowDur, workDur) : workDur
        const endMins = wallClockFinish(startMins, dur)
        const busySegs = workerBusySegments.get(nameKey) ?? []
        if (specialStart === null) {
          workerFreeAtMins.set(nameKey, endMins)
          busySegs.push({ start: startMins, end: endMins })
          workerBusySegments.set(nameKey, busySegs)
        }
      }
    }

    // Build assignment rows per worker per channel
    for (const worker of workersForSku) {
      const nameKey = normName(worker.name)
      const totalAssigned = workerSkuQty.get(nameKey)?.get(normSku) ?? 0
      const startMap = workerSkuEarliestStart.get(nameKey)
      const startMins = startMap?.get(normSku) ?? phaseStartMins
      const specialEntry = specialTimeMap.get(normSku) ?? specialTimeMap.get(rawSku)
      const specialStart = specialEntry?.startMins ?? null
      const effectiveStart = specialStart !== null ? Math.max(startMins, specialStart ?? startMins) : startMins
      const deadline = minsToTimeStr(effectiveStart)
      const isDeficit = workerSkuDeficit.get(nameKey)?.get(normSku) ?? false

      let remainingForWorker = totalAssigned
      for (const ch of channels) {
        if (remainingForWorker <= 0) break
        const chQty = Math.min(remainingForWorker, ch.qty / workersForSku.length)
        const finalChQty = Math.round(chQty * 100) / 100
        if (finalChQty <= 0) continue
        remainingForWorker -= finalChQty

        const roundMinsLocal = getRoundMinsLocal(effectiveStart, phaseRoundMins)
        const noteRoundStr = `round:${roundMinsLocal}:${finalChQty}`

        assignments.push({
          production_date: productionDate,
          table_name:      tableName,
          worker_code:     worker.emp_id,
          worker_name:     worker.name,
          sku:             rawSku,
          sku_name:        skuName,
          target_quantity: finalChQty,
          unit:            'กก.',
          period,
          deadline_time:   deadline,
          status:          'รอผลิต',
          seq:             null,
          channel:         ch.channel,
          note:            isDeficit ? `${noteRoundStr}|deficit` : noteRoundStr,
          is_deficit:      isDeficit,
        })
      }
    }
  }

  return assignments
  */
}

// ========== Helpers ==========

function mergeAssignList(list: SkuTarget[]): SkuTarget[] {
  const merged = new Map<string, SkuTarget>()
  const order: string[] = []
  for (const item of list) {
    if (!item.sku) continue
    const skuClean = item.sku.replace(/^0+/, '')
    const rawDeadlineKey = item.channel === 'RAW_QUEUE' ? `_${item.rawNeedTime ?? ''}` : ''
    const key = item.isDeficit ? `${item.channel}_${skuClean}${rawDeadlineKey}_deficit` : `${item.channel}_${skuClean}${rawDeadlineKey}`
    if (merged.has(key)) {
      merged.get(key)!.targetQty += item.targetQty
    } else {
      merged.set(key, { ...item })
      order.push(key)
    }
  }
  return order.map(k => merged.get(k)!)
}

async function fetchAll<T = Record<string, unknown>>(
  table: string,
  select: string,
  filters: { col: string; op: 'eq' | 'in'; val: unknown }[],
): Promise<T[]> {
  const PAGE = 1000
  const all: T[] = []
  let from = 0
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + PAGE - 1)
    for (const f of filters) {
      if (f.op === 'eq') q = q.eq(f.col, f.val)
      else if (f.op === 'in') q = q.in(f.col, f.val as string[])
    }
    const { data, error } = await q
    if (error) throw error
    all.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return all
}

function getNextCheckpoint(t: Date): Date {
  const result = new Date(t)
  result.setSeconds(0)
  result.setMilliseconds(0)
  const m = t.getMinutes()
  if (m < 20) {
    result.setMinutes(30)
  } else if (m < 50) {
    result.setMinutes(0)
    result.setHours(result.getHours() + 1)
  } else {
    result.setMinutes(30)
    result.setHours(result.getHours() + 1)
  }
  return result
}

// ========== Basic Workforce Fetch ==========

async function fetchWeeklyWorkforceBasic(productionDate: string): Promise<WorkforceRow[]> {
  const types = ['sa-phok-basic', 'lai-basic', 'sam-chan-basic'] as const

  const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
  const DAY_ALIASES: Record<string, string[]> = {
    'อาทิตย์':  ['อาทิตย์', 'อา.'],
    'จันทร์':   ['จันทร์', 'จ.'],
    'อังคาร':   ['อังคาร', 'อ.'],
    'พุธ':      ['พุธ', 'พ.'],
    'พฤหัสบดี': ['พฤหัสบดี', 'พฤหัส', 'พฤ.'],
    'ศุกร์':    ['ศุกร์', 'ศ.'],
    'เสาร์':    ['เสาร์', 'ส.'],
  }

  const checkIsDayOff = (dayOffVal: string, dateStr: string) => {
    if (!dayOffVal || !dateStr) return false
    const parts = dateStr.split('-')
    if (parts.length !== 3) return false
    const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    const dayName = THAI_DAYS[dateObj.getDay()]
    const normalizedVal = dayOffVal.trim().toLowerCase()
    return (DAY_ALIASES[dayName] || [dayName]).some(a => normalizedVal.includes(a.toLowerCase()))
  }

  const getFieldValue = (rowData: Record<string, any>, prefixes: string[]): string => {
    if (!rowData) return ''
    for (const prefix of prefixes) {
      if (rowData[prefix] !== undefined && rowData[prefix] !== null)
        return String(rowData[prefix]).trim()
    }
    const keys = Object.keys(rowData)
    for (const prefix of prefixes) {
      const foundKey = keys.find(k => k.toLowerCase().includes(prefix.toLowerCase()))
      if (foundKey && rowData[foundKey] !== undefined && rowData[foundKey] !== null)
        return String(rowData[foundKey]).trim()
    }
    return ''
  }

  const stationMap: Record<string, string> = {
    'sa-phok-basic':  'สะโพกเบสิค',
    'lai-basic':      'ไหล่เบสิค',
    'sam-chan-basic':  'สามชั้นเบสิค',
  }

  const { data: statusOverrides } = await supabase
    .from('workforce_daily_status')
    .select('weekly_type, worker_name, status')
    .eq('work_date', productionDate)

  const overrideMap = new Map<string, string>()
  for (const item of statusOverrides ?? [])
    overrideMap.set(`${item.weekly_type}_${item.worker_name}`, item.status)

  const workforce: WorkforceRow[] = []

  for (const type of types) {
    const logTableName = `workforce_weekly_${type.replace(/-/g, '_')}`
    const { data: latestLog } = await supabase
      .from('upload_log').select('source_file')
      .eq('table_name', logTableName)
      .order('uploaded_at', { ascending: false }).limit(1).maybeSingle()
    if (!latestLog) continue

    const { data: weeklyData } = await supabase
      .from('workforce_weekly').select('row_data')
      .eq('weekly_type', type).eq('source_file', latestLog.source_file)
    if (!weeklyData) continue

    for (const row of weeklyData) {
      const rowData = (row.row_data ?? {}) as Record<string, any>
      const name = getFieldValue(rowData, ['รายชื่อพนักงาน', 'ชื่อจริง', 'ชื่อพนักงาน', 'ชื่อ', 'name', 'full_name'])
      if (!name) continue

      const overrideStatus = overrideMap.get(`${type}_${name}`)
      let isWorking = true
      if (overrideStatus) {
        isWorking = overrideStatus === 'ทำงาน'
      } else {
        const dayOffStr = getFieldValue(rowData, ['วันหยุดประจำสัปดาห์', 'วันหยุดประจำ', 'วันหยุด', 'หยุด', 'dayoff', 'day_off', 'day off'])
        isWorking = !checkIsDayOff(dayOffStr, productionDate)
      }
      if (!isWorking) continue

      const shiftStr = getFieldValue(rowData, ['กะทำงาน', 'กะ', 'กะงาน', 'shift'])
      const shift = shiftStr.trim() === '2' || shiftStr.includes('2') ? 'กะ 2' : 'กะ 1'
      workforce.push({ emp_id: name, name, work_station: stationMap[type] ?? type, shift })
    }
  }
  return workforce
}

// Fetch Phase 1/2 assignments for deduction — filtered to basic stations only
async function fetchLatestBatchAssignmentsBasic(
  productionDate: string,
  periods: string[],
  deductMode: 'plan' | 'actual' | 'yield',
): Promise<{ sku: string; target_quantity: number; channel: string | null }[]> {
  type PrevAssignment = {
    sku: string
    target_quantity: number
    channel: string | null
    table_name: string
    period: string
  }
  const all: PrevAssignment[] = []
  for (const period of periods) {
    const { data: latest } = await supabase
      .from('production_assignments')
      .select('effective_from')
      .eq('production_date', productionDate)
      .eq('period', period)
      .in('table_name', BASIC_TABLE_NAMES as unknown as string[])
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!latest?.effective_from) continue
    const filters: { col: string; op: 'eq' | 'in'; val: unknown }[] = [
      { col: 'production_date', op: 'eq', val: productionDate },
      { col: 'period',          op: 'eq', val: period },
      { col: 'effective_from',  op: 'eq', val: latest.effective_from },
      { col: 'table_name',      op: 'in', val: BASIC_TABLE_NAMES as unknown as string[] },
    ]
    if (deductMode === 'actual') filters.push({ col: 'status', op: 'eq', val: 'เสร็จแล้ว' })
    const rows = await fetchAll<PrevAssignment>(
      'production_assignments', 'sku, target_quantity, channel, table_name, period', filters,
    )
    all.push(...rows)
  }
  if (deductMode !== 'plan' || all.length === 0) return all

  const { data: lineBreaks } = await supabase
    .from('basic_line_breaks')
    .select('station, start_time, end_time')
    .eq('production_date', productionDate)

  return all.map(row => {
    const cfg = PHASE_CONFIG.find(p => p.period === row.period)
    if (!cfg) return row
    const phaseStartMins = cfg.startH * 60
    const phaseEndMins = cfg.endH * 60
    const phaseNetMins = availableWorkMins(phaseStartMins, phaseEndMins)
    if (phaseNetMins <= 0) return row

    const stationBreaks = ((lineBreaks ?? []) as { station: string; start_time: string; end_time: string }[])
      .filter(b => b.station === row.table_name || b.station === 'ทั้งหมด')
    const lostMins = lineBreakActiveMins(stationBreaks, phaseStartMins, phaseEndMins)
    if (lostMins <= 0) return row

    const factor = Math.max(0, (phaseNetMins - lostMins) / phaseNetMins)
    return { ...row, target_quantity: Math.round(Number(row.target_quantity) * factor * 100) / 100 }
  })
}

// ========== Main: generateBasicPlan ==========

export async function generateBasicPlan(params: GenerateBasicPlanParams): Promise<GenerateBasicPlanResult> {
  const defaultDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const productionDate: string = params.date ?? defaultDate
  const selectedPhase: number  = params.phase ? Number(params.phase) : 1
  const deductMode: 'plan' | 'actual' | 'yield' =
    params.deductMode === 'actual' || params.deductMode === 'yield' ? params.deductMode : 'plan'

  const isPhase2 = selectedPhase === 2
  const isPhase3 = selectedPhase === 3

  const phaseCfg = PHASE_CONFIG.find(p => p.phase === selectedPhase)
  if (!phaseCfg) return { success: false, message: 'Phase ไม่ถูกต้อง' }

  // Checkpoint scheduling (same logic as special, but filtered to basic tables)
  const now = new Date()
  const { data: latestAssign } = await supabase
    .from('production_assignments').select('effective_from')
    .eq('production_date', productionDate)
    .eq('period', phaseCfg.period)
    .in('table_name', BASIC_TABLE_NAMES as unknown as string[])
    .lte('effective_from', now.toISOString())
    .order('effective_from', { ascending: false }).limit(1).maybeSingle()

  const useRegen = !!latestAssign?.effective_from && selectedPhase === 1
  const effectiveFrom: Date = useRegen ? getNextCheckpoint(now) : now
  const effectiveFromISO = effectiveFrom.toISOString()

  const bangkokTime = new Date(effectiveFrom.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  const effectiveTimeStr = `${String(bangkokTime.getHours()).padStart(2, '0')}:${String(bangkokTime.getMinutes()).padStart(2, '0')}`
  const isScheduled = effectiveFrom > now

  const checkpointMins = useRegen
    ? (bangkokTime.getHours() * 60 + bangkokTime.getMinutes())
    : (phaseCfg.startH * 60)

  const d = new Date(productionDate)
  const histDates = [1, 2, 3, 4, 5, 6, 7].map(n => {
    const h = new Date(d); h.setDate(d.getDate() - n)
    return h.toISOString().split('T')[0]
  })
  const makroTrendDates = [7, 14].map(n => {
    const h = new Date(d); h.setDate(d.getDate() - n)
    return h.toISOString().split('T')[0]
  })

  const orderRound = (isPhase2 || isPhase3) ? '1400' : '0800'

  // Fetch all data in parallel
  const [
    { data: workforceRawManual },
    { data: workforceRaw0930 },
    { data: workforceRaw1530 },
    wmTodayRaw, wmHistRaw,
    lotusTodayRaw, lotusHistRaw,
    makroTodayRaw, makroTrend0800Raw, makroTrend1400Raw,
    { data: masterProdRaw },
    { data: masterChannelRaw },
    { data: jobAssignRaw },
    prevAssignedRaw, yieldBagsRaw,
    plan100Raw,
    { data: pickingUnitRaw },
    { data: masterVarLotusRaw },
    { data: masterVarWMRaw },
    { data: masterVarMakroRaw },
    { data: masterSpecialRaw },
    { data: masterProductTypeRaw },
    { data: oldAssignmentsRaw },
    { data: quotasRaw },
    masYieldRaw,
    { data: masSayapanRaw },
    { data: masGroupStationRuleRaw },
    { data: lineBreakRaw },
  ] = await Promise.all([
    supabase.from('daily_workforce').select('emp_id, name, work_station, shift')
      .eq('work_date', productionDate).eq('upload_round', 'manual').neq('work_station', ''),
    supabase.from('daily_workforce').select('emp_id, name, work_station, shift')
      .eq('work_date', productionDate).eq('upload_round', '0930').neq('work_station', ''),
    supabase.from('daily_workforce').select('emp_id, name, work_station, shift')
      .eq('work_date', productionDate).eq('upload_round', '1530').neq('work_station', ''),
    fetchAll<OrderRow>('wet_market_orders', 'sku, sku_name, quantity, delivery_date',
      [{ col: 'delivery_date', op: 'eq', val: productionDate }, { col: 'upload_round', op: 'eq', val: '1400' }]),
    fetchAll<OrderRow>('wet_market_orders', 'sku, sku_name, quantity, delivery_date',
      [{ col: 'delivery_date', op: 'in', val: histDates }, { col: 'upload_round', op: 'eq', val: '1600' }]),
    fetchAll<OrderRow>('lotus_orders', 'sku, sku_name, quantity, delivery_date',
      [{ col: 'delivery_date', op: 'eq', val: productionDate }, { col: 'upload_round', op: 'eq', val: '1400' }]),
    fetchAll<OrderRow>('lotus_orders', 'sku, sku_name, quantity, delivery_date',
      [{ col: 'delivery_date', op: 'in', val: histDates }, { col: 'upload_round', op: 'eq', val: '1600' }]),
    fetchAll<OrderRow>('makro_orders', 'sku, sku_name, quantity, delivery_date',
      [{ col: 'delivery_date', op: 'eq', val: productionDate }, { col: 'upload_round', op: 'eq', val: orderRound }]),
    fetchAll<OrderRow>('makro_orders', 'sku, sku_name, quantity, delivery_date',
      [{ col: 'delivery_date', op: 'in', val: makroTrendDates }, { col: 'upload_round', op: 'eq', val: '0800' }]),
    fetchAll<OrderRow>('makro_orders', 'sku, sku_name, quantity, delivery_date',
      [{ col: 'delivery_date', op: 'in', val: makroTrendDates }, { col: 'upload_round', op: 'eq', val: '1400' }]),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', CALC.productivity).order('uploaded_at', { ascending: false }).limit(5000),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', CALC.channel).order('uploaded_at', { ascending: false }).limit(5000),
    supabase.from('master_logic_manpower').select('row_data').order('uploaded_at', { ascending: true }).limit(5000),
    (isPhase2 || isPhase3) && deductMode !== 'yield'
      ? fetchLatestBatchAssignmentsBasic(productionDate, isPhase3 ? ['เช้า', 'บ่าย'] : ['เช้า'], deductMode)
      : Promise.resolve([] as { sku: string; target_quantity: number; channel: string | null }[]),
    (isPhase2 || isPhase3) && deductMode === 'yield'
      ? fetchAll<{ sap_code: string; bags: number }>('yield_bags', 'sap_code, bags',
          [{ col: 'work_date', op: 'eq', val: productionDate }])
      : Promise.resolve([] as { sap_code: string; bags: number }[]),
    isPhase3
      ? fetchLatestPlan100([productionDate])
      : Promise.resolve([] as { sap: string; product_name: string | null; weight_total: number }[]),
    supabase.from('picking_unit_master').select('sap, weight_per_bag').limit(5000),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', CALC.varLotus).order('uploaded_at', { ascending: false }).limit(5000),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', CALC.varWM).order('uploaded_at', { ascending: false }).limit(5000),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', CALC.varMakro).order('uploaded_at', { ascending: false }).limit(5000),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', CALC.special).order('uploaded_at', { ascending: false }).limit(5000),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', CALC.productType).order('uploaded_at', { ascending: false }).limit(5000),
    useRegen
      ? supabase.from('production_assignments').select('*')
          .eq('production_date', productionDate).eq('period', phaseCfg.period)
          .in('table_name', BASIC_TABLE_NAMES as unknown as string[])
          .eq('effective_from', latestAssign!.effective_from)
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase.from('channel_quotas').select('sku, quantity')
      .eq('quota_date', productionDate).eq('channel', 'Wet Market'),
    fetchLatestMasYield(supabase),
    supabase.from('mas_sayapan').select('product_group, station'),
    supabase.from('mas_group_station_rule')
      .select('product_group, station, is_enabled, split_mode, priority, share_pct, allow_same_sku, sku_route_mode, raw_remainder_mode, overflow_station'),
    supabase.from('basic_line_breaks')
      .select('station, start_time, end_time')
      .eq('production_date', productionDate),
  ])

  // Merge daily workforce: manual > 1530 > 0930 → fallback weekly
  const seenWf = new Set<string>()
  let workforce: WorkforceRow[] = []
  for (const w of [
    ...(workforceRawManual ?? []),
    ...(workforceRaw1530   ?? []),
    ...(workforceRaw0930   ?? []),
  ] as WorkforceRow[]) {
    const k = normName(w.name)
    if (seenWf.has(k)) continue
    seenWf.add(k); workforce.push(w)
  }
  // Only keep workers at basic stations
  workforce = workforce.filter(w =>
    (BASIC_TABLE_NAMES as readonly string[]).includes(normalizeStation(w.work_station ?? ''))
  )

  // Per-station fallback: stations missing from daily → fill from weekly workforce
  const stationsWithDaily = new Set(workforce.map(w => normalizeStation(w.work_station ?? '')))
  const missingStations = (BASIC_TABLE_NAMES as readonly string[]).filter(s => !stationsWithDaily.has(s))
  if (missingStations.length > 0) {
    const weeklyWorkers = await fetchWeeklyWorkforceBasic(productionDate)
    for (const w of weeklyWorkers) {
      if (!missingStations.includes(normalizeStation(w.work_station ?? ''))) continue
      const k = normName(w.name)
      if (!seenWf.has(k)) { seenWf.add(k); workforce.push(w) }
    }
  }

  if (!workforce.length) {
    return { success: false, message: 'ไม่มีข้อมูลกำลังคน กรุณาอัปโหลดข้อมูลกำลังคนก่อนสร้างแผน' }
  }

  const wmToday    = (wmTodayRaw    ?? []) as OrderRow[]
  const wmHist     = (wmHistRaw     ?? []) as OrderRow[]
  const lotusToday = (lotusTodayRaw ?? []) as OrderRow[]
  const lotusHist  = (lotusHistRaw  ?? []) as OrderRow[]
  const makroToday = (makroTodayRaw ?? []) as OrderRow[]
  const makroTrend0800 = (makroTrend0800Raw ?? []) as OrderRow[]
  const makroTrend1400 = (makroTrend1400Raw ?? []) as OrderRow[]

  if (isPhase3) {
    if (!(plan100Raw ?? []).length)
      return { success: false, message: 'ไม่พบแผนผลิต 100% วันนี้ — กรุณาอัพโหลดก่อน' }
  } else {
    const hasOrders = isPhase2
      ? (wmToday.length || lotusToday.length || makroToday.length)
      : (wmHist.length  || lotusHist.length  || makroToday.length)
    if (!hasOrders) return {
      success: false,
      message: `ไม่พบข้อมูล Order วันนี้ — กรุณาอัพโหลด Wet Market / LOTUS / Makro ก่อน`,
    }
  }

  // Bag size map
  const bagSizeMap = new Map<string, number>()
  for (const r of (pickingUnitRaw ?? []) as { sap: string; weight_per_bag: number }[]) {
    const sap = String(r.sap ?? '').trim()
    const wpb = Number(r.weight_per_bag ?? 0)
    if (sap && wpb > 0) { bagSizeMap.set(sap, wpb); bagSizeMap.set(sap.replace(/^0+/, ''), wpb) }
  }
  const roundDownToBag = (sku: string, qty: number): number => {
    const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, ''))
    if (!wpb || wpb <= 0) return Math.round(qty * 100) / 100
    return Math.round(Math.floor(qty / wpb) * wpb * 100) / 100
  }
  const roundUpToBag = (sku: string, qty: number): number => {
    const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, ''))
    if (!wpb || wpb <= 0) return Math.round(qty * 100) / 100
    return Math.round(Math.ceil(qty / wpb) * wpb * 100) / 100
  }
  const floorToBag = (sku: string, qty: number): number => {
    const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, ''))
    if (!wpb || wpb <= 0) return Math.round(qty * 100) / 100
    return Math.round(Math.floor(qty / wpb) * wpb * 100) / 100
  }
  const roundPhaseTarget = (sku: string, qty: number): number => {
    return selectedPhase === 1 ? roundUpToBag(sku, qty) : roundDownToBag(sku, qty)
  }
  const capPhaseTarget = (sku: string, qty: number): number => {
    return selectedPhase === 1 ? floorToBag(sku, qty) : roundDownToBag(sku, qty)
  }

  // Parse special time windows
  const parseExcelTime = (val: unknown): number | null => {
    if (val === null || val === undefined || val === '') return null
    if (typeof val === 'string') {
      const str = val.trim()
      if (str.includes('T')) {
        const dt = new Date(str)
        if (!isNaN(dt.getTime())) {
          const localMs = dt.getTime() + (6 * 3600 + 42 * 60 + 4) * 1000
          const dayMs = 24 * 3600 * 1000
          return Math.round(((localMs % dayMs) + dayMs) % dayMs / 1000 / 60)
        }
      }
      if (str.includes(':')) {
        const parts = str.split(':').map(Number)
        if (parts.length >= 2 && !parts.some(isNaN)) return parts[0] * 60 + parts[1]
      }
    }
    const num = Number(val)
    return isNaN(num) ? null : Math.round(num * 24 * 60)
  }

  const specialTimeMap = new Map<string, { startMins: number | null; stopMins: number | null }>()
  for (const row of masterSpecialRaw ?? []) {
    const r = normalizeRow(row.row_data as Record<string, unknown>)
    const sap = String(r['SAP'] ?? '').trim()
    if (!sap) continue
    const startMins = parseExcelTime(r['ช่วงเวลาเริ่มผลิต'])
    const stopMins  = parseExcelTime(r['ช่วงเวลาหยุดผลิต'])
    if (startMins !== null || stopMins !== null) {
      const entry = { startMins, stopMins }
      specialTimeMap.set(sap, entry)
      specialTimeMap.set(sap.replace(/^0+/, ''), entry)
    }
  }

  // Parse productivity master
  const productivity: ProductivityRow[] = masterProdRaw?.length
    ? parseProductivity((masterProdRaw as { row_data: Record<string, unknown> }[]).map(r => r.row_data)) : []

  if (!productivity.length) return {
    success: false,
    message: `ไม่พบ Master Productivity Basic — กรุณาอัพโหลด "${CALC.productivity}" ก่อน`,
  }

  const skuMap = new Map<string, ProductivityRow>()
  for (const p of productivity) {
    if (!skuMap.has(p.sku))                    skuMap.set(p.sku, p)
    if (!skuMap.has(p.sku.replace(/^0+/, ''))) skuMap.set(p.sku.replace(/^0+/, ''), p)
  }

  const bestWetMarketSkuByGroup = new Map<string, ProductivityRow>()
  const wetMarketQtyByGroupSku = new Map<string, Map<string, { product: ProductivityRow; qty: number }>>()
  for (const row of wmHist) {
    const cleanSku = String(row.sku ?? '').replace(/^0+/, '')
    const prod = skuMap.get(cleanSku) ?? skuMap.get(String(row.sku ?? ''))
    if (!prod?.product_group) continue
    const groupMap = wetMarketQtyByGroupSku.get(prod.product_group) ?? new Map<string, { product: ProductivityRow; qty: number }>()
    const entry = groupMap.get(prod.sku) ?? { product: prod, qty: 0 }
    entry.qty += Number(row.quantity ?? 0)
    groupMap.set(prod.sku, entry)
    wetMarketQtyByGroupSku.set(prod.product_group, groupMap)
  }
  wetMarketQtyByGroupSku.forEach((skuQtyMap, group) => {
    const best = Array.from(skuQtyMap.values()).sort((a, b) => {
      if (b.qty !== a.qty) return b.qty - a.qty
      return a.product.sku.localeCompare(b.product.sku)
    })[0]
    if (best?.qty > 0) bestWetMarketSkuByGroup.set(group, best.product)
  })

  const groupRulesByGroup = new Map<string, GroupStationRule[]>()
  for (const rawRule of (masGroupStationRuleRaw ?? []) as GroupStationRule[]) {
    if (!rawRule?.product_group || !rawRule.station || rawRule.is_enabled === false) continue
    const rule: GroupStationRule = {
      ...rawRule,
      station: toBasicStation(String(rawRule.station)),
      split_mode: String(rawRule.split_mode ?? 'primary'),
      sku_route_mode: String(rawRule.sku_route_mode ?? 'master_productivity'),
      raw_remainder_mode: String(rawRule.raw_remainder_mode ?? 'raw_sku_station'),
      priority: Number(rawRule.priority ?? 999),
      share_pct: rawRule.share_pct === null || rawRule.share_pct === undefined ? null : Number(rawRule.share_pct),
      allow_same_sku: rawRule.allow_same_sku !== false,
    }
    const list = groupRulesByGroup.get(rule.product_group) ?? []
    list.push(rule)
    groupRulesByGroup.set(rule.product_group, list)
  }
  groupRulesByGroup.forEach((list: GroupStationRule[], grp: string) => {
    groupRulesByGroup.set(grp, list.sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999)))
  })

  const sayapanStationsByGroup = new Map<string, string[]>()
  for (const row of (masSayapanRaw ?? []) as { product_group: string; station: string }[]) {
    if (!row.product_group || !row.station) continue
    const station = toBasicStation(String(row.station))
    const list = sayapanStationsByGroup.get(row.product_group) ?? []
    if (!list.includes(station)) list.push(station)
    sayapanStationsByGroup.set(row.product_group, list)
  }

  const allowedStationsForGroup = (group: string): string[] => {
    const rules = groupRulesByGroup.get(group) ?? []
    if (rules.length) return rules.map(r => r.station).filter(Boolean)
    return sayapanStationsByGroup.get(group) ?? []
  }

  const resolveStationForProduct = (prod: ProductivityRow): string => {
    const masterStation = toBasicStation(prod.station)
    const rules = groupRulesByGroup.get(prod.product_group) ?? []
    if (!rules.length) {
      const sayapanStations = sayapanStationsByGroup.get(prod.product_group) ?? []
      if (!sayapanStations.length) return masterStation
      if (sayapanStations.includes(masterStation)) return masterStation
      return sayapanStations[0]
    }
    const sorted = [...rules].sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999))
    const primary = sorted[0]?.station ?? masterStation
    const mode = String(sorted[0]?.split_mode ?? 'primary')
    const routeMode = String(sorted[0]?.sku_route_mode ?? 'master_productivity')
    if (mode === 'primary' || routeMode === 'station_only') return primary
    const allowed = new Set(sorted.map(r => r.station))
    if (allowed.has(masterStation)) return masterStation
    return primary
  }

  const resolveRemainderStation = (group: string, rawProd: ProductivityRow | undefined, usedStations: string[]): string | null => {
    const rules = groupRulesByGroup.get(group) ?? []
    const mode = String(rules[0]?.raw_remainder_mode ?? 'raw_sku_station')
    const allowed = allowedStationsForGroup(group)
    const rawStation = rawProd ? resolveStationForProduct(rawProd) : ''
    if (mode === 'primary_station') return rules[0]?.station || usedStations[0] || rawStation || null
    if (rawStation && (!allowed.length || allowed.includes(rawStation))) return rawStation
    for (const station of usedStations) if (!allowed.length || allowed.includes(station)) return station
    return rules[0]?.station || rawStation || usedStations[0] || null
  }

  const syncRoundNoteQty = (row: Record<string, unknown>) => {
    const note = String(row['note'] ?? '')
    if (!note.includes('round:')) return
    const qty = Math.round(Number(row['target_quantity'] ?? 0) * 100) / 100
    row['note'] = note.replace(/round:(\d+):[0-9.]+/, `round:$1:${qty}`)
  }

  const annotateRawQueueFinish = (row: Record<string, unknown>, finishMins: number) => {
    const note = String(row['note'] ?? '')
    if (!note.includes('raw-queue')) return
    const needMatch = note.match(/(?:^|\|)need=([0-9]{2}:[0-9]{2})/)
    const targetMatch = note.match(/(?:^|\|)target=([0-9]{2}:[0-9]{2})/)
    const needMins = hhmmToMins(needMatch?.[1])
    const targetMins = hhmmToMins(targetMatch?.[1])
    const status = targetMins !== null && finishMins <= targetMins
      ? 'on_time'
      : needMins !== null && finishMins <= needMins
        ? 'buffer_missed'
        : 'late'
    const clean = note
      .replace(/\|finish=[^|]*/g, '')
      .replace(/\|status=[^|]*/g, '')
    row['note'] = `${clean}|finish=${minsToHHMM(finishMins)}|status=${status}`
  }

  const productGroupForAssignment = (row: Record<string, unknown>): string | null => {
    const normSku = String(row['sku'] ?? '').replace(/^0+/, '')
    const prod = skuMap.get(normSku) ?? skuMap.get(String(row['sku'] ?? ''))
    return prod?.product_group ?? null
  }

  const yieldConsumptionByGroup = new Map<string, { product_group: string; share: number }[]>()
  for (const row of (masYieldRaw ?? []) as MasYieldRow[]) {
    const splits = parseYieldNoteSplits(row.notes)
    if (row.product_group && splits.length) yieldConsumptionByGroup.set(row.product_group, splits)
  }

  const yieldConsumptionForGroup = (group: string): { product_group: string; share: number }[] =>
    yieldConsumptionByGroup.get(group) ?? [{ product_group: group, share: 1 }]

  const capResequencedToGroupYield = (rows: Record<string, unknown>[]): Record<string, unknown>[] => {
    if (!Object.keys(groupYieldCap).length) return [...rows]
    const remainingByGroup = new Map<string, number>()
    for (const [grp, qty] of Object.entries(groupYieldCap)) {
      remainingByGroup.set(grp, Math.round(qty * 100) / 100)
    }

    const kept: Record<string, unknown>[] = []
    for (const row of rows) {
      if (String(row['note'] ?? '').includes('remainder')) {
        kept.push(row)
        continue
      }
      const grp = productGroupForAssignment(row)
      if (!grp) {
        kept.push(row)
        continue
      }
      const qty = Number(row['target_quantity'] ?? 0)
      const consumption = yieldConsumptionForGroup(grp)
      let maxQty = qty
      let hasCap = false
      for (const c of consumption) {
        const remaining = remainingByGroup.get(c.product_group)
        if (remaining === undefined) continue
        hasCap = true
        maxQty = Math.min(maxQty, remaining / c.share)
      }
      if (hasCap && maxQty <= 0) continue
      const cappedQty = hasCap ? Math.min(qty, maxQty) : qty
      const finalQty = selectedPhase === 1
        ? floorToBag(String(row['sku'] ?? ''), cappedQty)
        : Math.round(cappedQty * 100) / 100
      if (finalQty <= 0) continue
      row['target_quantity'] = finalQty
      syncRoundNoteQty(row)
      for (const c of consumption) {
        if (!remainingByGroup.has(c.product_group)) continue
        const remaining = remainingByGroup.get(c.product_group) ?? 0
        remainingByGroup.set(c.product_group, Math.round((remaining - finalQty * c.share) * 100) / 100)
      }
      kept.push(row)
    }
    return kept
  }

  // Build main SKU set: Product='RAW' from productivity master (fallback: sku_name ending '-Raw')
  const mainSkuSet = new Set<string>()
  for (const p of productivity) {
    if (isMainProduct(p)) {
      mainSkuSet.add(p.sku.replace(/^0+/, ''))
    }
  }
  for (const row of masterProductTypeRaw ?? []) {
    const r = normalizeRow(row.row_data as Record<string, unknown>)
    const sap  = String(r['SAP'] ?? '').trim().replace(/^0+/, '')
    const type = String(r['ประเภท'] ?? r['product_type'] ?? '').trim().toLowerCase()
    if (sap && (type === 'main' || type === 'หลัก')) mainSkuSet.add(sap)
  }

  // Carcass-yield-derived rate per product_group — replaces Mas Productivity rate as the
  // time driver for groups gated by carcass cutting throughput (yield kg ÷ carving minutes).
  let groupYieldCap: Record<string, number> = {}
  const skuEffectiveRateMap = new Map<string, number>()
  // Hoisted for use in both groupYieldCap computation and resequenced-pass approach B duration.
  const capYield = (masYieldRaw ?? []) as MasYieldRow[]
  const capUniqWts = Array.from(new Set(capYield.map(r => r.carcass_weight))).sort((a, b) => a - b)
  const sortedLotsForDuration: { spec_code: string; qty: number; avg_weight: number; order: number }[] =
    params.carcassLots?.length ? [...params.carcassLots].sort((a, b) => a.order - b.order) : []

  if (params.carcassLots?.length && params.carcassRate && capYield.length > 0) {
    const capLots    = sortedLotsForDuration.map(l => ({ ...l, remaining: l.qty }))
    const capRate    = params.carcassRate

    // Cap total pigs available at the trimming target — once the ordered lots reach
    // trimmingQty, stop using more even if later lots still have qty left.
    if (params.trimmingQty && params.trimmingQty > 0) {
      let budget = params.trimmingQty
      for (const lot of capLots) {
        lot.remaining = Math.min(lot.remaining, Math.max(0, budget))
        budget -= lot.remaining
      }
    }

    let capPoolIdx = 0
    for (const seg of CARCASS_ACTIVE_SEGS) {
      const pigs = Math.floor((seg.mins * 60) / capRate)
      let need   = pigs
      const usages: { qty: number; avg: number }[] = []
      while (need > 0 && capPoolIdx < capLots.length) {
        const lot  = capLots[capPoolIdx]
        const take = Math.min(need, lot.remaining)
        if (take > 0) { usages.push({ qty: take, avg: lot.avg_weight }); lot.remaining -= take; need -= take }
        if (lot.remaining === 0) capPoolIdx++
      }
      if (seg.phase !== selectedPhase) continue
      for (const u of usages) {
        const wt = capUniqWts.reduce((b, w) => Math.abs(w - u.avg) < Math.abs(b - u.avg) ? w : b, capUniqWts[0] ?? 0)
        for (const my of capYield) {
          if (my.carcass_weight !== wt) continue
          if (parseYieldNoteSplits(my.notes).length) continue
          const kg = (my.yield_pct / 100) * u.avg * u.qty
          groupYieldCap[my.product_group] = (groupYieldCap[my.product_group] ?? 0) + kg
        }
      }
    }

    // Throughput (กก./ชม.) per group = yield kg available this phase ÷ carcass-cutting minutes
    // for this phase — used in place of Mas Productivity rate for SKUs in capped groups.
    const phaseNetMins = CARCASS_ACTIVE_SEGS
      .filter(s => s.phase === selectedPhase)
      .reduce((s, seg) => s + seg.mins, 0)

    if (phaseNetMins > 0) {
      for (const [grp, kg] of Object.entries(groupYieldCap)) {
        const rateKgPerHr = kg / (phaseNetMins / 60)
        for (const p of productivity) {
          if (p.product_group !== grp) continue
          skuEffectiveRateMap.set(p.sku, rateKgPerHr)
          skuEffectiveRateMap.set(p.sku.replace(/^0+/, ''), rateKgPerHr)
        }
      }
    }
  }

  // Fallback groupYieldCap: selected lots fall short of the trimming target → fill the
  // gap with shortage pigs × 90 kg default weight, on top of whatever real lots cover.
  // shortage = trimmingQty − sum(selected lots) (= trimmingQty when no lots selected)
  const selectedLotQty = sortedLotsForDuration.reduce((s, l) => s + l.qty, 0)
  const shortage = params.trimmingQty ? params.trimmingQty - selectedLotQty : 0
  if (shortage > 0 && capYield.length > 0) {
    const defaultWeight = 90
    const nearestWt = capUniqWts.reduce((b, w) =>
      Math.abs(w - defaultWeight) < Math.abs(b - defaultWeight) ? w : b, capUniqWts[0] ?? 0)
    for (const my of capYield) {
      if (my.carcass_weight !== nearestWt) continue
      if (parseYieldNoteSplits(my.notes).length) continue
      const kg = (my.yield_pct / 100) * defaultWeight * shortage
      groupYieldCap[my.product_group] = (groupYieldCap[my.product_group] ?? 0) + kg
    }
  }

  // Parse variance masters
  const lotusVarianceMap = new Map<string, number>()
  const lotusSkuVarianceMap = new Map<string, number>()
  for (const row of masterVarLotusRaw ?? []) {
    const r = normalizeRow(row.row_data as Record<string, unknown>)
    const sku = String(r['SAP'] ?? '').trim().replace(/^0+/, '')
    const station = normalizeStation(String(r['จุดงาน'] ?? r['Station'] ?? r['PFP10'] ?? '').trim())
    const pct = percentValue(r['%Var'] ?? r['%Variance'])
    if (sku && pct > 0) lotusSkuVarianceMap.set(sku, pct)
    if (station && pct > 0) lotusVarianceMap.set(station, pct)
  }

  const wmSkuVarianceMap = new Map<string, number>()
  let wmVarParams: [number, number, number, number] | undefined
  for (const row of masterVarWMRaw ?? []) {
    const r = normalizeRow(row.row_data as Record<string, unknown>)
    const sku = String(r['SAP'] ?? '').trim().replace(/^0+/, '')
    const pct = percentValue(r['%Var'] ?? r['%Variance'])
    if (sku && pct > 0) wmSkuVarianceMap.set(sku, pct)

    const vals = Object.values(r)
    if (vals.some(v => String(v ?? '').trim() === '%Variance')) {
      const nums = vals.filter(v => typeof v === 'number').map(v => v > 1 ? v / 100 : v) as number[]
      if (nums.length >= 4) { wmVarParams = [nums[0], nums[1], nums[2], nums[3]]; break }
    }
  }

  const makroGroupVarianceMap = new Map<string, { ltOne?: number; gteOne?: number }>()
  for (const row of masterVarMakroRaw ?? []) {
    const r = normalizeRow(row.row_data as Record<string, unknown>)
    const group = String(r['กลุ่มสินค้า'] ?? r['PFP10'] ?? r['product_group'] ?? '').trim()
    const trend = String(r['แนวโน้ม <1 = เพิ่ม, >1 = ลด'] ?? r['แนวโน้ม'] ?? r['trend'] ?? '').trim()
    const pct = percentValue(r['%Variance'] ?? r['%Var'])
    if (group && trend && pct > 0) {
      const entry = makroGroupVarianceMap.get(group) ?? {}
      if (/^</.test(trend)) entry.ltOne = pct
      else entry.gteOne = pct
      makroGroupVarianceMap.set(group, entry)
    }
  }

  const jobAssignMap = buildJobAssignMap((jobAssignRaw ?? []) as { row_data: Record<string, unknown> }[])

  // Channel priority from Mas Channel Basic
  const channelPriority: Record<string, number> = {}
  for (const row of masterChannelRaw ?? []) {
    const r = normalizeRow(row.row_data as Record<string, unknown>)
    if (Number(r['Phase']) === selectedPhase) {
      const ch = String(r['Channel'])
      if (!(ch in channelPriority)) channelPriority[ch] = Number(r['Priority'])
    }
  }
  const channelOrder = Object.entries(channelPriority).sort((a, b) => a[1] - b[1]).map(([ch]) => ch)
  const activeChannels = channelOrder.length ? channelOrder : ['Makro', 'Wet Market', 'LOTUS']
  channelPriority['RAW_QUEUE'] = -1
  if (!activeChannels.includes('RAW_QUEUE')) activeChannels.unshift('RAW_QUEUE')

  // Workers by station (direct: work_station = productivity station name)
  const workersByStation: Record<string, WorkforceRow[]> = {}
  for (const w of workforce) {
    const station = normalizeStation(w.work_station ?? '')
    if (!station) continue
    workersByStation[station] ??= []
    workersByStation[station].push(w)
  }

  const phaseStartMins = phaseCfg.startH * 60
  const phaseEndMins   = phaseCfg.endH   * 60
  const lineBreakRows = (lineBreakRaw ?? []) as LineBreakRow[]
  const stationLineBreaks = (station: string) =>
    lineBreakSegments(lineBreakRows, station, phaseStartMins, phaseEndMins)

  const currentWorkforceNames = new Set(workforce.map((w: WorkforceRow) => normName(w.name)))

  // Kept assignments for checkpoint regeneration
  const keptAssignments: any[] = []
  const keptChannelQtyMap = new Map<string, number>()
  const workerKeptMaxEndMins = new Map<string, number>()

  if (useRegen && oldAssignmentsRaw) {
    // Yield-capped SKUs: total kept qty across every worker sharing the SKU before the
    // checkpoint, since duration is gated by raw-material throughput, not worker split share.
    const keptSkuTotalQty = new Map<string, number>()
    for (const a of oldAssignmentsRaw) {
      const wName = normName(a.worker_name || '')
      if (!currentWorkforceNames.has(wName)) continue
      const deadlineStr = a.deadline_time as string | null
      if (!deadlineStr?.includes(':')) continue
      const [h, m] = deadlineStr.split(':').map(Number)
      if (h * 60 + m >= checkpointMins) continue
      const cleanSku = (a.sku as string).replace(/^0+/, '')
      keptSkuTotalQty.set(cleanSku, (keptSkuTotalQty.get(cleanSku) ?? 0) + Number(a.target_quantity))
    }

    for (const a of oldAssignmentsRaw) {
      const wName = normName(a.worker_name || '')
      if (currentWorkforceNames.has(wName)) {
        const deadlineStr = a.deadline_time as string | null
        if (deadlineStr?.includes(':')) {
          const [h, m] = deadlineStr.split(':').map(Number)
          const startMins = h * 60 + m
          if (startMins < checkpointMins) {
            const cleanSku = (a.sku as string).replace(/^0+/, '')
            const prod = skuMap.get(cleanSku) ?? skuMap.get(a.sku as string)
            const isYieldCapped = skuEffectiveRateMap.has(cleanSku)
            const fallbackRate = prod?.rate ?? 27.0
            const qtyForDuration = isYieldCapped ? (keptSkuTotalQty.get(cleanSku) ?? Number(a.target_quantity)) : Number(a.target_quantity)
            const duration = isYieldCapped
              ? computeTaskDuration({ qty: qtyForDuration, productGroup: prod?.product_group, startMins, sortedLots: sortedLotsForDuration, carcassRateSec: params.carcassRate ?? 0, masYield: capYield, capUniqWts, fallbackRate })
              : (fallbackRate > 0 ? Math.round((qtyForDuration / fallbackRate) * 60) : 0)
            const endMins = wallClockFinish(startMins, duration)
            workerKeptMaxEndMins.set(wName, Math.max(workerKeptMaxEndMins.get(wName) ?? 0, endMins))
            const { id, created_at, updated_at, ...rest } = a
            keptAssignments.push({ ...rest, isKept: true })
            const sku = (a.sku as string).replace(/^0+/, '')
            const key = `${a.channel || ''}_${sku}`
            keptChannelQtyMap.set(key, (keptChannelQtyMap.get(key) ?? 0) + Number(a.target_quantity))
          }
        }
      }
    }
  }

  const workerHours = new Map<string, number>()
  const workerFreeAtMins = new Map<string, number>()
  const workerBusySegments = new Map<string, { start: number; end: number }[]>()
  for (const w of workforce) {
    let shiftStartMins = phaseCfg.startH * 60
    let shiftEndMins = phaseEndMins
    if (w.shift === 'กะ 1') { shiftStartMins = 8.5 * 60; shiftEndMins = isPhase3 ? phaseEndMins : 17.5 * 60 }
    else if (w.shift === 'กะ 2') { shiftStartMins = 14.5 * 60; shiftEndMins = isPhase3 ? phaseEndMins : 23.5 * 60 }
    const actualEndMins = Math.min(phaseEndMins, shiftEndMins)
    const nameKey = normName(w.name)
    const keptMaxEnd = workerKeptMaxEndMins.get(nameKey) ?? 0
    const startFreeMins = Math.max(checkpointMins, shiftStartMins, keptMaxEnd)
    workerHours.set(nameKey, Math.max(0, actualEndMins - startFreeMins) / 60)
    workerFreeAtMins.set(nameKey, startFreeMins)
    workerBusySegments.set(nameKey, stationLineBreaks(normalizeStation(w.work_station ?? '')))
  }

  // Picking unit map
  const wpbMap = new Map<string, number>()
  for (const r of pickingUnitRaw ?? [])
    wpbMap.set((r as any).sap.replace(/^0+/, ''), (r as any).weight_per_bag ?? 0)

  // Historical averages
  const avgWM    = buildAvgMap(wmHist)
  const avgLotus = buildAvgMap(lotusHist)

  const quotaMap = new Map<string, number>()
  for (const q of (quotasRaw ?? []) as { sku: string; quantity: number }[]) {
    const sku = String(q.sku).replace(/^0+/, '')
    quotaMap.set(sku, Number(q.quantity))
  }

  // Phase 1/2 deduction state
  const phase1Assigned  = new Map<string, number>()
  const phase1ByChannel = new Map<string, Map<string, number>>()
  const useChannelDeduct = deductMode !== 'yield'

  if (deductMode === 'yield') {
    for (const y of yieldBagsRaw as { sap_code: string; bags: number }[]) {
      const sku = y.sap_code.replace(/^0+/, '')
      phase1Assigned.set(sku, (phase1Assigned.get(sku) ?? 0) + y.bags * (wpbMap.get(sku) ?? 0))
    }
  } else {
    for (const a of prevAssignedRaw as { sku: string; target_quantity: number; channel: string | null }[]) {
      const sku = a.sku.replace(/^0+/, '')
      const qty = Number(a.target_quantity)
      phase1Assigned.set(sku, (phase1Assigned.get(sku) ?? 0) + qty)
      if (a.channel) {
        if (!phase1ByChannel.has(a.channel)) phase1ByChannel.set(a.channel, new Map())
        const m = phase1ByChannel.get(a.channel)!
        m.set(sku, (m.get(sku) ?? 0) + qty)
      }
    }
  }

  // Cross-channel over-production cap
  const crossChannelCap = (
    targetsMap: Record<string, SkuTarget[]>,
    rawOrderBySku: Map<string, number>,
    priorityChannels: string[],
  ): void => {
    const allSkus = new Set(Object.values(targetsMap).flatMap(arr => arr.map(t => t.sku)))
    for (const sku of Array.from(allSkus)) {
      const p1Total = phase1Assigned.get(sku) ?? 0
      if (p1Total === 0) continue
      const rawTotal = rawOrderBySku.get(sku) ?? 0
      const budget = Math.max(0, rawTotal - p1Total)
      let currentTotal = 0
      for (const arr of Object.values(targetsMap))
        for (const t of arr) if (t.sku === sku) currentTotal += t.targetQty
      if (currentTotal <= budget) continue
      let excess = currentTotal - budget
      for (const ch of [...priorityChannels].reverse()) {
        if (excess <= 0) break
        const arr = targetsMap[ch] ?? []
        const idx = arr.findIndex(t => t.sku === sku)
        if (idx === -1) continue
        const cut = Math.min(excess, arr[idx].targetQty)
        arr[idx].targetQty -= cut
        excess -= cut
        if (arr[idx].targetQty <= 0) arr.splice(idx, 1)
      }
    }
  }

  // Aggregate today's orders
  const aggregateToday = (rows: OrderRow[]): Record<string, { qty: number; name: string | null }> => {
    const m: Record<string, { qty: number; name: string | null }> = {}
    for (const r of rows) {
      const sku = r.sku.replace(/^0+/, '')
      m[sku] = { qty: (m[sku]?.qty ?? 0) + r.quantity, name: m[sku]?.name ?? r.sku_name }
    }
    return m
  }
  const aggregateQty = (rows: OrderRow[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const sku = r.sku.replace(/^0+/, '')
      m.set(sku, (m.get(sku) ?? 0) + Number(r.quantity ?? 0))
    }
    return m
  }
  const wmMap    = aggregateToday(wmToday)
  const lotusMap = aggregateToday(lotusToday)
  const makroMap = aggregateToday(makroToday)
  const makroTrend0800BySku = aggregateQty(makroTrend0800)
  const makroTrend1400BySku = aggregateQty(makroTrend1400)

  // Build targets per channel
  const buildWetMarketTargets = (): SkuTarget[] => {
    const ch = 'Wet Market'
    if (isPhase2) {
      const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
      return Object.entries(wmMap).map(([sku, { qty: orderQty, name }]) => {
        const p1Actual = p1.get(sku) ?? 0
        const targetQty = Math.max(0, orderQty - p1Actual)
        return { sku, skuName: name, targetQty, channel: ch }
      }).filter(s => s.targetQty > 0)
    }
    const wmHistNames = new Map(wmHist.map(r => [r.sku.replace(/^0+/, ''), r.sku_name]))
    const lotusHistSkus = new Set(avgLotus.keys())
    return Array.from(avgWM.entries())
      .map(([sku, avg]) => {
        const isShared = lotusHistSkus.has(sku)
        const quotaToday = quotaMap.get(sku) ?? avg
        const variance = wmSkuVarianceMap.get(sku)
          ?? getWetMarketVariance(isShared, quotaToday, avg, avgLotus.get(sku) ?? 0, wmVarParams)
        return { sku, skuName: wmHistNames.get(sku) ?? null, targetQty: roundPhaseTarget(sku, avg * variance), channel: ch }
      }).filter(s => s.targetQty > 0)
  }

  const buildMakroTargets = (): SkuTarget[] => {
    const ch = 'Makro'
    if (isPhase2) {
      const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
      return Object.entries(makroMap).map(([sku, { qty: orderQty, name }]) => {
        const p1Actual = p1.get(sku) ?? 0
        const targetQty = Math.max(0, orderQty - p1Actual)
        return { sku, skuName: name, targetQty, channel: ch }
      }).filter(s => s.targetQty > 0)
    }
    const getSkuGroup = (sku: string): string => {
      const clean = sku.replace(/^0+/, '')
      const prod = skuMap.get(clean) ?? skuMap.get(sku)
      return prod ? prod.product_group : ''
    }
    return Object.entries(makroMap).map(([sku, { qty: orderQty, name }]) => {
      const grp = getSkuGroup(sku)
      const groupVariance = makroGroupVarianceMap.get(grp)
      const hist0800 = makroTrend0800BySku.get(sku) ?? 0
      const hist1400 = makroTrend1400BySku.get(sku) ?? 0
      const trend = hist1400 > 0 ? hist0800 / hist1400 : null
      const variance = trend !== null && trend < 1 ? (groupVariance?.ltOne ?? 1)
        : (groupVariance?.gteOne ?? 1)
      return { sku, skuName: name, targetQty: roundPhaseTarget(sku, orderQty * variance), channel: ch }
    }).filter(s => s.targetQty > 0)
  }

  const buildLotusTargets = (): SkuTarget[] => {
    const ch = 'LOTUS'
    if (isPhase2) {
      const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
      return Object.entries(lotusMap).map(([sku, { qty: orderQty, name }]) => {
        const p1Actual = p1.get(sku) ?? 0
        const targetQty = Math.max(0, orderQty - p1Actual)
        return { sku, skuName: name, targetQty, channel: ch }
      }).filter(s => s.targetQty > 0)
    }
    const lotusHistNames = new Map(lotusHist.map(r => [r.sku.replace(/^0+/, ''), r.sku_name]))
    return Array.from(avgLotus.entries())
      .map(([sku, avg]) => {
        const prod = skuMap.get(sku) ?? skuMap.get(sku.replace(/^0+/, ''))
        const station = prod ? normalizeStation(prod.station) : ''
        const variance = lotusSkuVarianceMap.get(sku)
          ?? (lotusVarianceMap.size > 0 ? (lotusVarianceMap.get(station) ?? 1.0) : 1.0)
        return { sku, skuName: lotusHistNames.get(sku) ?? null, targetQty: roundPhaseTarget(sku, avg * variance), channel: ch }
      }).filter(s => s.targetQty > 0)
  }

  const channelTargets: Record<string, SkuTarget[]> = {
    'Wet Market': buildWetMarketTargets(),
    'Makro':      buildMakroTargets(),
    'LOTUS':      buildLotusTargets(),
  }

  const rawShortageRows = await computeRawShortageRows(productionDate, selectedPhase)
  const rawQueueTargets: SkuTarget[] = []
  for (const row of rawShortageRows) {
      const sku = String(row.sku ?? '').replace(/^0+/, '')
      const prod = skuMap.get(sku) ?? skuMap.get(String(row.sku ?? ''))
      const needMins = hhmmToMins(row.productionTime)
      const qty = Number(row.deficit ?? row.quantity ?? 0)
      if (!prod || needMins === null || qty <= 0) continue
      rawQueueTargets.push({
        sku,
        skuName: prod.sku_name || row.sku_name,
        targetQty: qty,
        channel: 'RAW_QUEUE',
        rawNeedTime: row.productionTime,
        rawFinishByMins: needMins - 5,
      })
  }
  rawQueueTargets.sort((a, b) => {
    const at = a.rawFinishByMins ?? 999999
    const bt = b.rawFinishByMins ?? 999999
    if (at !== bt) return at - bt
    return a.sku.localeCompare(b.sku)
  })

  channelTargets['RAW_QUEUE'] = rawQueueTargets

  if (isPhase2) {
    const p2RawBySku = new Map<string, number>()
    for (const [sku, { qty }] of Object.entries(wmMap))    p2RawBySku.set(sku, (p2RawBySku.get(sku) ?? 0) + qty)
    for (const [sku, { qty }] of Object.entries(makroMap)) p2RawBySku.set(sku, (p2RawBySku.get(sku) ?? 0) + qty)
    for (const [sku, { qty }] of Object.entries(lotusMap)) p2RawBySku.set(sku, (p2RawBySku.get(sku) ?? 0) + qty)
    crossChannelCap(channelTargets, p2RawBySku, activeChannels.filter(ch => ch !== 'RAW_QUEUE'))
  }

  // Build assign list
  let assignList: SkuTarget[]
  const planMap = new Map<string, { name: string | null; qty: number }>()

  if (isPhase3) {
    const plan100 = (plan100Raw ?? []) as { sap: string; product_name: string | null; weight_total: number }[]
    for (const r of plan100) {
      const sap = r.sap.replace(/^0+/, '')
      const cur = planMap.get(sap) ?? { name: r.product_name ?? null, qty: 0 }
      cur.qty += Number(r.weight_total)
      planMap.set(sap, cur)
    }
    const allPhase3Targets = Array.from(planMap.entries()).map(([sku, { name, qty }]) => {
      let channel = 'plan100'
      for (const [ch, m] of Array.from(phase1ByChannel.entries())) {
        if (m.has(sku)) { channel = ch; break }
      }
      const p12Actual = phase1Assigned.get(sku) ?? 0
      const targetQty = Math.max(0, qty - p12Actual)
      return { sku, skuName: name, targetQty, channel }
    }).filter(t => t.targetQty > 0)

    if (wmToday.length || lotusToday.length || makroToday.length) {
      const phase3SkuSet = new Set(allPhase3Targets.map(t => t.sku.replace(/^0+/, '')))
      const appendRemaining = (orderMap: Record<string, { qty: number; name: string | null }>, ch: string) => {
        for (const [sku, { qty: orderQty, name }] of Object.entries(orderMap)) {
          if (phase3SkuSet.has(sku)) continue
          const p12 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
          const p12Actual = p12.get(sku) ?? 0
          const targetQty = Math.max(0, orderQty - p12Actual)
          if (targetQty > 0) allPhase3Targets.push({ sku, skuName: name, targetQty, channel: ch })
        }
      }
      appendRemaining(wmMap, 'Wet Market')
      appendRemaining(lotusMap, 'LOTUS')
      appendRemaining(makroMap, 'Makro')
    }
    assignList = mergeAssignList([...rawQueueTargets, ...allPhase3Targets])
  } else {
    const raw: SkuTarget[] = []
    for (const ch of activeChannels) {
      raw.push(...(channelTargets[ch] ?? []))
    }
    assignList = mergeAssignList(raw)
  }

  if (useRegen && keptChannelQtyMap.size > 0) {
    assignList = assignList
      .map(item => {
        const sku = item.sku.replace(/^0+/, '')
        const keptQty = keptChannelQtyMap.get(`${item.channel}_${sku}`) ?? 0
        return keptQty > 0
          ? { ...item, targetQty: Math.max(0, item.targetQty - keptQty) }
          : item
      })
      .filter(item => item.targetQty > 0)
  }

  // Special time SKUs first
  const hasSpecialTimes = (sku: string) => {
    const t = specialTimeMap.get(sku.replace(/^0+/, ''))
    return !!(t && (t.startMins !== null || t.stopMins !== null))
  }
  const specialList = assignList.filter(i => hasSpecialTimes(i.sku))
    .sort((a, b) => {
      const pa = channelPriority[a.channel] ?? 99
      const pb = channelPriority[b.channel] ?? 99
      if (pa !== pb) return pa - pb
      const sa = specialTimeMap.get(a.sku.replace(/^0+/, ''))?.startMins ?? 0
      const sb = specialTimeMap.get(b.sku.replace(/^0+/, ''))?.startMins ?? 0
      return sa !== sb ? sa - sb : b.targetQty - a.targetQty
    })
  assignList = [...specialList, ...assignList.filter(i => !hasSpecialTimes(i.sku))]

  // Cap assignList to carcass yield per product group (assignList is already priority-ordered)
  // groupYieldCap was already computed above alongside skuEffectiveRateMap.
  if (Object.keys(groupYieldCap).length > 0) {
    // Skip cap entirely if this phase has no carcass yield (e.g. all lots consumed by earlier phases).
    const hasYieldCap = Object.values(groupYieldCap).some(v => v > 0)
    if (hasYieldCap) {
      const groupRemaining = { ...groupYieldCap }
      for (const item of assignList) {
        const normSku = item.sku.replace(/^0+/, '')
        const prod    = skuMap.get(normSku) ?? skuMap.get(item.sku)
        if (!prod?.product_group) continue
        const grp       = prod.product_group
        const consumption = yieldConsumptionForGroup(grp)
        let maxQty = item.targetQty
        let hasGroupCap = false
        for (const c of consumption) {
          const remaining = groupRemaining[c.product_group]
          if (remaining === undefined) continue
          hasGroupCap = true
          maxQty = Math.min(maxQty, remaining / c.share)
        }
        if (hasGroupCap && maxQty <= 0) { item.targetQty = 0; continue }
        if (hasGroupCap && item.targetQty > maxQty) item.targetQty = capPhaseTarget(normSku, maxQty)
        for (const c of consumption) {
          if (groupRemaining[c.product_group] === undefined) continue
          groupRemaining[c.product_group] = Math.max(0, groupRemaining[c.product_group] - item.targetQty * c.share)
        }
      }
      assignList = assignList.filter(item => item.targetQty > 0)
    }
  }

  // Assign workers per channel pass
  const assignments: Record<string, unknown>[] = []
  let nextPlanOrder = 0

  const runChannelPass = (passList: SkuTarget[]) => {
    const globalSkuTotalQty = new Map<string, number>()
    for (const item of assignList) {
      const k = item.sku.replace(/^0+/, '')
      globalSkuTotalQty.set(k, (globalSkuTotalQty.get(k) ?? 0) + item.targetQty)
    }

    const chsInPass = activeChannels.filter(ch => passList.some(item => item.channel === ch))
    for (const item of passList) {
      if (!chsInPass.includes(item.channel)) chsInPass.push(item.channel)
    }
    const handled = new Set<string>()
    const channelSeqPriority = (channel: string) => channelPriority[channel] ?? 99

    for (let chIdx = 0; chIdx < chsInPass.length; chIdx++) {
      const ch = chsInPass[chIdx]
      const chItems = passList.filter(item => {
        const key = `${item.channel}|||${item.sku.replace(/^0+/, '')}`
        return item.channel === ch && !handled.has(key)
      })
      if (!chItems.length) continue

      const targetsByStation: Record<string, SkuTarget[]> = {}

      for (const item of chItems) {
        const normSku = item.sku.replace(/^0+/, '')
        handled.add(`${item.channel}|||${normSku}`)

        const targetQty = (() => {
          let qty = roundPhaseTarget(item.sku, item.targetQty)
          if (isPhase3) {
            const planItem = planMap.get(normSku)
            if (planItem) {
              const remaining = Math.max(0, planItem.qty - (phase1Assigned.get(normSku) ?? 0))
              if (qty > remaining) qty = capPhaseTarget(normSku, remaining)
            }
          }
          return qty
        })()
        if (targetQty <= 0) continue

        const prod = skuMap.get(normSku) ?? skuMap.get(item.sku)
        if (!prod) continue
        const station = resolveStationForProduct(prod)
        const currentPlanOrder = nextPlanOrder++
        targetsByStation[station] ??= []
        targetsByStation[station].push({ ...item, targetQty, planOrder: currentPlanOrder })

        let prevCh = ch
        for (let nextIdx = chIdx + 1; nextIdx < chsInPass.length; nextIdx++) {
          const nextCh = chsInPass[nextIdx]
          if (channelSeqPriority(nextCh) !== channelSeqPriority(prevCh) + 1) break

          const nextKey = `${nextCh}|||${normSku}`
          if (handled.has(nextKey)) break

          const nextItem = passList.find(i => i.channel === nextCh && i.sku.replace(/^0+/, '') === normSku)
          if (!nextItem) break

          handled.add(nextKey)
          const nextQty = roundPhaseTarget(nextItem.sku, nextItem.targetQty)
          if (nextQty <= 0) break
          const adjacentPlanOrder = nextPlanOrder++
          targetsByStation[station].push({ ...nextItem, targetQty: nextQty, planOrder: adjacentPlanOrder })
          prevCh = nextCh
        }
      }

      for (const [station, stationTargets] of Object.entries(targetsByStation)) {
        const stationWorkers = workersByStation[station] ?? []
        if (!stationWorkers.length) continue
        assignments.push(...allocateBalanced({
          productionDate,
          tableName: station,
          targets: stationTargets,
          workers: stationWorkers,
          skuMap,
          jobAssignMap,
          workerHours,
          workerFreeAtMins,
          workerBusySegments,
          phaseEndMins,
          period: phaseCfg.period,
          phaseRoundMins: PHASE_ROUND_MINS[selectedPhase] ?? [phaseCfg.startH * 60],
          wpbMap,
          specialTimeMap,
          skuTotalQtyOverride: globalSkuTotalQty,
          skuRateOverrideMap: skuEffectiveRateMap,
        }))
      }
    }
  }

  runChannelPass(assignList)
  assignments.push(...keptAssignments)

  if (!assignments.length) {
    return {
      success: false,
      message: `ไม่สามารถสร้างคำสั่ง Basic — targets: WM ${channelTargets['Wet Market']?.length ?? 0} / Makro ${channelTargets['Makro']?.length ?? 0} / LOTUS ${channelTargets['LOTUS']?.length ?? 0}`,
    }
  }

  // Resequence wall-clock start times per worker
  const byWorkerPost: Record<string, any[]> = {}
  // Yield-capped SKUs: total qty across every worker sharing the SKU, since duration is
  // gated by raw-material throughput, not by any one worker's split share.
  const skuTotalQtyAcrossWorkers = new Map<string, number>()
  for (const a of assignments) {
    const name = a.worker_name as string
    byWorkerPost[name] ??= []
    byWorkerPost[name].push({ ...a, is_deficit: !!(a as any).is_deficit })
    const cleanSku = (a.sku as string).replace(/^0+/, '')
    skuTotalQtyAcrossWorkers.set(cleanSku, (skuTotalQtyAcrossWorkers.get(cleanSku) ?? 0) + Number(a.target_quantity))
  }

  const resequenced: any[] = []
  for (const workerTasks of Object.values(byWorkerPost)) {
    const getPriority = (ch: string) => ch === 'เสริม' ? 0 : channelPriority[ch] ?? 99

    const skuFirstKey = new Map<string, { minPrio: number; minDeadline: string }>()
    for (const task of workerTasks) {
      if (task.isKept) continue
      const normSku = (task.sku as string).replace(/^0+/, '')
      const p = getPriority(task.channel as string)
      const dt = (task.deadline_time as string) || ''
      const cur = skuFirstKey.get(normSku)
      if (!cur || p < cur.minPrio || (p === cur.minPrio && dt < cur.minDeadline))
        skuFirstKey.set(normSku, { minPrio: p, minDeadline: dt })
    }
    const skuGroupOrder = new Map<string, number>()
    Array.from(skuFirstKey.entries())
      .sort(([, a], [, b]) => a.minPrio !== b.minPrio ? a.minPrio - b.minPrio : a.minDeadline.localeCompare(b.minDeadline))
      .forEach(([sku], i) => skuGroupOrder.set(sku, i))

    workerTasks.sort((a, b) => {
      if (a.isKept && !b.isKept) return -1
      if (!a.isKept && b.isKept) return 1
      if (a.isKept && b.isKept) return 0
      const defA = a.is_deficit ? 1 : 0
      const defB = b.is_deficit ? 1 : 0
      if (defA !== defB) return defA - defB
      const normSkuA = (a.sku as string).replace(/^0+/, '')
      const normSkuB = (b.sku as string).replace(/^0+/, '')
      const groupDiff = (skuGroupOrder.get(normSkuA) ?? 999) - (skuGroupOrder.get(normSkuB) ?? 999)
      if (groupDiff !== 0) return groupDiff
      const pDiff = getPriority(a.channel as string) - getPriority(b.channel as string)
      if (pDiff !== 0) return pDiff
      return ((a.deadline_time as string) || '').localeCompare((b.deadline_time as string) || '')
    })

    const taskStation = normalizeStation(String(workerTasks[0]?.table_name ?? ''))
    const busySegs: { start: number; end: number }[] = stationLineBreaks(taskStation)
    let curMins = phaseCfg.startH * 60
    const keptTasks: typeof workerTasks = []

    for (const task of workerTasks) {
      const cleanSku = (task.sku as string).replace(/^0+/, '')
      const prod = skuMap.get(cleanSku) ?? skuMap.get(task.sku as string)
      const isYieldCapped = skuEffectiveRateMap.has(cleanSku)
      const fallbackRate = prod?.rate ?? 27.0

      // Step 1: determine startMins before computing duration (required for approach B)
      let startMins: number
      let isSpecialTask = false

      if (task.isKept) {
        const [h, m] = (task.deadline_time as string).split(':').map(Number)
        startMins = h * 60 + m
      } else {
        if (curMins < checkpointMins) curMins = checkpointMins
        const specialStart = specialTimeMap.get(cleanSku)?.startMins ?? specialTimeMap.get(task.sku as string)?.startMins ?? null
        if (specialStart !== null) {
          isSpecialTask = true
          startMins = Math.max(curMins, specialStart)
          if (!isPhase3 && startMins >= phaseEndMins) continue
        } else {
          startMins = curMins
          let advanced = true
          while (advanced) {
            advanced = false
            for (const seg of busySegs) {
              if (startMins >= seg.start - 0.01 && startMins < seg.end) { startMins = seg.end; advanced = true }
            }
            for (const [bs, be] of BREAKS) {
              if (startMins >= bs && startMins < be) { startMins = be; advanced = true }
            }
          }
          if (!isPhase3 && startMins >= phaseEndMins) continue
        }
      }

      // Step 2: compute duration — approach B (per-pig) if yield-capped, else fallback rate
      const qty = isYieldCapped
        ? (skuTotalQtyAcrossWorkers.get(cleanSku) ?? Number(task.target_quantity))
        : Number(task.target_quantity)
      const duration = computeTaskDuration({
        qty,
        productGroup: prod?.product_group,
        startMins,
        sortedLots: isYieldCapped ? sortedLotsForDuration : [],
        carcassRateSec: params.carcassRate ?? 0,
        masYield: capYield,
        capUniqWts,
        fallbackRate,
      })

      // Step 3: compute endMins and finalize task
      if (task.isKept) {
        const endMins = wallClockFinish(startMins, duration)
        busySegs.push({ start: startMins, end: endMins })
        curMins = Math.max(curMins, endMins)
        delete task.isKept
        annotateRawQueueFinish(task, endMins)
        keptTasks.push(task)
      } else if (isSpecialTask) {
        task.deadline_time = minsToTimeStr(startMins)
        const endMins = wallClockFinish(startMins, duration)
        busySegs.push({ start: startMins, end: endMins })
        annotateRawQueueFinish(task, endMins)
        keptTasks.push(task)
      } else {
        task.deadline_time = minsToTimeStr(startMins)
        let endMins = wallClockFinish(startMins, duration)

        if (!isPhase3 && endMins > phaseEndMins) {
          const taskStationName = normalizeStation(String(task.table_name ?? taskStation))
          const stationBreakMins = segmentActiveMins(stationLineBreaks(taskStationName), startMins, phaseEndMins)
          const availMins = Math.max(0, availableWorkMins(startMins, phaseEndMins) - stationBreakMins)
          let truncQty: number
          if (isYieldCapped && sortedLotsForDuration.length && params.carcassRate) {
            const pigsAvail = Math.floor(availMins * 60 / params.carcassRate)
            const activeMinsAtStart = availableWorkMins(510, startMins)
            const pigIdx = Math.floor(activeMinsAtStart * 60 / params.carcassRate)
            let consumed2 = 0; let activeLot: typeof sortedLotsForDuration[0] | null = null
            for (const l of sortedLotsForDuration) { if (pigIdx < consumed2 + l.qty) { activeLot = l; break }; consumed2 += l.qty }
            if (!activeLot) activeLot = sortedLotsForDuration[sortedLotsForDuration.length - 1]
            if (activeLot && capUniqWts.length) {
              const nearWt = capUniqWts.reduce((b, w) => Math.abs(w - activeLot!.avg_weight) < Math.abs(b - activeLot!.avg_weight) ? w : b, capUniqWts[0])
              const yieldPct = capYield
                .filter(r => r.carcass_weight === nearWt && r.product_group === prod?.product_group)
                .reduce((sum, r) => sum + Number(r.yield_pct ?? 0), 0)
              const ypig = yieldPct > 0 ? (yieldPct / 100) * activeLot.avg_weight : 0
              truncQty = ypig > 0 ? pigsAvail * ypig : 0
            } else { truncQty = 0 }
          } else {
            truncQty = (availMins / 60) * fallbackRate
          }
          const originalQty = Number(task.target_quantity ?? 0)
          const originalSkuTotal = skuTotalQtyAcrossWorkers.get(cleanSku) ?? originalQty
          const rowShare = isYieldCapped && originalSkuTotal > 0 ? originalQty / originalSkuTotal : 1
          const cappedTruncQty = isYieldCapped ? Math.min(originalQty, truncQty * rowShare) : truncQty
          const finalQty = selectedPhase === 1
            ? floorToBag(String(task.sku ?? ''), cappedTruncQty)
            : Math.round(cappedTruncQty * 100) / 100
          if (finalQty <= 0) continue
          task.target_quantity = finalQty
          syncRoundNoteQty(task)
          endMins = wallClockFinish(startMins, computeTaskDuration({
            qty: finalQty, productGroup: prod?.product_group, startMins,
            sortedLots: isYieldCapped ? sortedLotsForDuration : [],
            carcassRateSec: params.carcassRate ?? 0, masYield: capYield, capUniqWts, fallbackRate,
          }))
        }

        busySegs.push({ start: startMins, end: endMins })
        curMins = endMins
        annotateRawQueueFinish(task, endMins)
        keptTasks.push(task)
      }
    }
    resequenced.push(...keptTasks)
  }

  resequenced.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    const wCmp = String(a['worker_name'] ?? '').localeCompare(String(b['worker_name'] ?? ''))
    if (wCmp !== 0) return wCmp
    const getP = (ch: string) => ch === 'เสริม' ? 0 : (channelPriority[ch] ?? 99)
    const pCmp = getP(String(a['channel'] ?? '')) - getP(String(b['channel'] ?? ''))
    if (pCmp !== 0) return pCmp
    const toMins = (s: string) => { const p = s.split(':').map(Number); return (p[0] ?? 0) * 60 + (p[1] ?? 0) }
    return toMins(String(a['deadline_time'] ?? '')) - toMins(String(b['deadline_time'] ?? ''))
  })

  const sortByPlanOrder = (rows: Record<string, unknown>[]) => {
    const toMins = (s: string) => {
      const p = s.split(':').map(Number)
      return (p[0] ?? 0) * 60 + (p[1] ?? 0)
    }
    rows.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const stationCmp = String(a['table_name'] ?? '').localeCompare(String(b['table_name'] ?? ''), 'th')
      if (stationCmp !== 0) return stationCmp
      const seqCmp = Number(a['seq'] ?? 999999) - Number(b['seq'] ?? 999999)
      if (seqCmp !== 0) return seqCmp
      const pCmp = (channelPriority[String(a['channel'] ?? '')] ?? 99) - (channelPriority[String(b['channel'] ?? '')] ?? 99)
      if (pCmp !== 0) return pCmp
      const grpCmp = String(productGroupForAssignment(a) ?? '').localeCompare(String(productGroupForAssignment(b) ?? ''), 'th')
      if (grpCmp !== 0) return grpCmp
      const timeCmp = toMins(String(a['deadline_time'] ?? '')) - toMins(String(b['deadline_time'] ?? ''))
      if (timeCmp !== 0) return timeCmp
      return String(a['worker_name'] ?? '').localeCompare(String(b['worker_name'] ?? ''), 'th')
    })
  }

  const rawWorkerEligible = (worker: WorkforceRow, productGroup: string): boolean => {
    if (jobAssignMap.size === 0) return true
    const jobInfo = jobAssignMap.get(normName(worker.name))
    if (!jobInfo) return true
    if (jobInfo.isWeigher && (!productGroup || !jobInfo.groups.has(productGroup))) return false
    return productGroup ? jobInfo.groups.has(productGroup) : true
  }

  const getRawWorkerSkillLevel = (worker: WorkforceRow, productGroup: string): number => {
    if (jobAssignMap.size === 0) return 1
    const jobInfo = jobAssignMap.get(normName(worker.name))
    return jobInfo?.groups.get(productGroup) ?? 99
  }

  const remainderTaskStartMins = (row: Record<string, unknown>): number => {
    const mins = hhmmToMins(String(row['deadline_time'] ?? '')) ?? phaseStartMins
    return phaseCfg.period === 'ค่ำ' && mins < phaseStartMins ? mins + 1440 : mins
  }

  const remainderTaskLineDurationMins = (row: Record<string, unknown>, qtyOverride?: number): number => {
    const sku = String(row['sku'] ?? '').replace(/^0+/, '')
    const prod = skuMap.get(sku) ?? skuMap.get(String(row['sku'] ?? ''))
    // Yield-capped groups are paced by the carcass rate line, not by any one worker's
    // manual speed — use the same line-rate lookup as computeTaskDuration/makeSmartRemainderRows,
    // falling back to the per-person Mas Productivity rate only for non-capped SKUs.
    const rate = skuEffectiveRateMap.get(sku) ?? skuEffectiveRateMap.get(String(row['sku'] ?? '')) ?? prod?.rate ?? 0
    const qty = qtyOverride ?? Number(row['target_quantity'] ?? 0)
    return rate > 0 ? (qty / rate) * 60 : 0
  }

  const resetWorkerTimelineFromRows = (rows: Record<string, unknown>[]) => {
    workerFreeAtMins.clear()
    workerBusySegments.clear()
    for (const w of workforce) {
      let shiftStartMins = phaseCfg.startH * 60
      let shiftEndMins = phaseEndMins
      if (w.shift === 'เธเธฐ 1') { shiftStartMins = 8.5 * 60; shiftEndMins = isPhase3 ? phaseEndMins : 17.5 * 60 }
      else if (w.shift === 'เธเธฐ 2') { shiftStartMins = 14.5 * 60; shiftEndMins = isPhase3 ? phaseEndMins : 23.5 * 60 }
      const nameKey = normName(w.name)
      const startFreeMins = Math.max(checkpointMins, shiftStartMins)
      workerFreeAtMins.set(nameKey, startFreeMins)
      workerBusySegments.set(nameKey, stationLineBreaks(normalizeStation(w.work_station ?? '')))
      workerHours.set(nameKey, Math.max(0, Math.min(phaseEndMins, shiftEndMins) - startFreeMins) / 60)
    }

    const lineQtyByStartSku = new Map<string, number>()
    for (const row of rows) {
      const key = [
        String(row['table_name'] ?? ''),
        String(row['sku'] ?? '').replace(/^0+/, ''),
        String(row['channel'] ?? ''),
        remainderTaskStartMins(row),
      ].join('|||')
      lineQtyByStartSku.set(key, (lineQtyByStartSku.get(key) ?? 0) + Number(row['target_quantity'] ?? 0))
    }

    for (const row of [...rows].sort((a, b) => remainderTaskStartMins(a) - remainderTaskStartMins(b))) {
      const nameKey = normName(String(row['worker_name'] ?? ''))
      if (!nameKey || !workerFreeAtMins.has(nameKey)) continue
      const start = remainderTaskStartMins(row)
      const lineKey = [
        String(row['table_name'] ?? ''),
        String(row['sku'] ?? '').replace(/^0+/, ''),
        String(row['channel'] ?? ''),
        start,
      ].join('|||')
      const lineQty = lineQtyByStartSku.get(lineKey) ?? Number(row['target_quantity'] ?? 0)
      const end = wallClockFinish(start, remainderTaskLineDurationMins(row, lineQty))
      const busySegs = workerBusySegments.get(nameKey) ?? []
      busySegs.push({ start, end })
      workerBusySegments.set(nameKey, busySegs)
      workerFreeAtMins.set(nameKey, Math.max(workerFreeAtMins.get(nameKey) ?? phaseStartMins, end))
    }
  }

  const makeSmartRemainderRows = (
    prod: ProductivityRow,
    station: string,
    remainKg: number,
    seqStart: number,
    channel: string,
    noteTag: string,
  ): Record<string, unknown>[] => {
    const stationWorkers = workersByStation[station] ?? []
    if (!stationWorkers.length) return []

    let eligible = stationWorkers.filter(w => rawWorkerEligible(w, prod.product_group))
    if (!eligible.length) eligible = stationWorkers
    if (!eligible.length) return []

    // Remainder kg comes out of the same carcass-yield pool as the group's capped SKUs, so its
    // production time must use the carcass Rate Line throughput (skuEffectiveRateMap), not the
    // Mas Productivity per-person rate — the latter is far slower and produces multi-day
    // durations that wrap the displayed clock time into nonsense hours outside the shift.
    const lineRate = skuEffectiveRateMap.get(prod.sku) ?? skuEffectiveRateMap.get(prod.sku.replace(/^0+/, '')) ?? prod.rate
    const duration = lineRate > 0 ? (remainKg / lineRate) * 60 : 0

    const candidateStarts = Array.from(new Set(eligible.map(w =>
      getWorkerFreeAt(normName(w.name), workerFreeAtMins, workerBusySegments, phaseStartMins),
    ))).sort((a, b) => a - b)

    // The carcass line keeps running regardless of any one worker's remaining shift time —
    // duration is already derived from the line rate above, so a worker only needs to be
    // free (not mid-way through another SKU) and job-assign-eligible for this group, not
    // have enough slack left to finish before the phase's nominal end.
    let firstFree: number | null = null
    let selectedWorkers: WorkforceRow[] = []
    for (const slot of candidateStarts) {
      if (!isPhase3 && slot >= phaseEndMins) continue
      const availableAtSlot = eligible.filter(worker => {
        const nameKey = normName(worker.name)
        const freeAt = getWorkerFreeAt(nameKey, workerFreeAtMins, workerBusySegments, phaseStartMins)
        return freeAt <= slot + 0.01
      })
      if (availableAtSlot.length) {
        firstFree = slot
        selectedWorkers = availableAtSlot
        break
      }
    }

    if (firstFree === null || !selectedWorkers.length) return []
    const endMins = wallClockFinish(firstFree, duration)

    const rows: Record<string, unknown>[] = []
    let assigned = 0
    for (let i = 0; i < selectedWorkers.length; i++) {
      const worker = selectedWorkers[i]
      const qty = i === selectedWorkers.length - 1
        ? Math.round((remainKg - assigned) * 10) / 10
        : Math.floor((remainKg / selectedWorkers.length) * 10) / 10
      assigned += qty
      if (qty <= 0) continue
      rows.push({
        production_date: productionDate,
        table_name:      station,
        worker_code:     worker.emp_id,
        worker_name:     worker.name,
        sku:             prod.sku,
        sku_name:        prod.sku_name,
        target_quantity: qty,
        unit:            channel === 'RAW' ? 'RAW' : 'เธเธ.',
        period:          phaseCfg.period,
        deadline_time:   minsToTimeStr(firstFree),
        status:          'เธฃเธญเธเธฅเธดเธ•',
        seq:             seqStart + i,
        channel,
        note:            noteTag,
        is_deficit:      false,
        effective_from:  effectiveFromISO,
      })
    }

    for (const worker of selectedWorkers) {
      const nameKey = normName(worker.name)
      const busySegs = workerBusySegments.get(nameKey) ?? []
      busySegs.push({ start: firstFree, end: endMins })
      workerBusySegments.set(nameKey, busySegs)
      workerFreeAtMins.set(nameKey, Math.max(workerFreeAtMins.get(nameKey) ?? phaseStartMins, endMins))
    }

    return rows
  }

  const makeRawRemainderRows = (
    rawProd: ProductivityRow,
    station: string,
    remainKg: number,
    seqStart: number,
  ): Record<string, unknown>[] => {
    const stationWorkers = workersByStation[station] ?? []
    if (!stationWorkers.length) return []

    const allocated = allocateBalanced({
      productionDate,
      tableName: station,
      targets: [{
        sku: rawProd.sku,
        skuName: rawProd.sku_name,
        targetQty: remainKg,
        channel: 'RAW',
        planOrder: seqStart,
      }],
      workers: stationWorkers,
      skuMap,
      jobAssignMap,
      workerHours,
      workerFreeAtMins,
      workerBusySegments,
      phaseEndMins,
      period: phaseCfg.period,
      phaseRoundMins: PHASE_ROUND_MINS[selectedPhase] ?? [phaseCfg.startH * 60],
      wpbMap: new Map<string, number>(),
      specialTimeMap,
    })

    const rows = allocated.length ? allocated : (() => {
      let eligible = stationWorkers.filter(w => rawWorkerEligible(w, rawProd.product_group))
      if (!eligible.length) eligible = stationWorkers
      const worker = [...eligible].sort((a, b) => {
        const skillA = getRawWorkerSkillLevel(a, rawProd.product_group)
        const skillB = getRawWorkerSkillLevel(b, rawProd.product_group)
        if (skillA !== skillB) return skillA - skillB
        const freeA = getWorkerFreeAt(normName(a.name), workerFreeAtMins, workerBusySegments, phaseStartMins)
        const freeB = getWorkerFreeAt(normName(b.name), workerFreeAtMins, workerBusySegments, phaseStartMins)
        return freeA - freeB
      })[0]
      if (!worker) return []
      return [{
        production_date: productionDate,
        table_name:      station,
        worker_code:     worker.emp_id,
        worker_name:     worker.name,
        sku:             rawProd.sku,
        sku_name:        rawProd.sku_name,
        target_quantity: remainKg,
        unit:            'กก.',
        period:          phaseCfg.period,
        deadline_time:   minsToTimeStr(Math.min(phaseEndMins, getWorkerFreeAt(normName(worker.name), workerFreeAtMins, workerBusySegments, phaseStartMins))),
        status:          'รอผลิต',
        seq:             seqStart,
        channel:         'RAW',
        note:            'raw_remainder',
        is_deficit:      false,
      }]
    })()

    return rows.map((row, idx) => ({
      ...row,
      unit:           'กก.',
      channel:        'RAW',
      note:           'raw_remainder',
      is_deficit:     false,
      seq:            seqStart + idx,
      effective_from: effectiveFromISO,
    }))
  }

  const makeWetMarketRemainderRows = (
    prod: ProductivityRow,
    station: string,
    remainKg: number,
    seqStart: number,
  ): Record<string, unknown>[] => {
    const stationWorkers = workersByStation[station] ?? []
    if (!stationWorkers.length) return []

    const allocated = allocateBalanced({
      productionDate,
      tableName: station,
      targets: [{
        sku: prod.sku,
        skuName: prod.sku_name,
        targetQty: remainKg,
        channel: 'Wet Market',
        planOrder: seqStart,
      }],
      workers: stationWorkers,
      skuMap,
      jobAssignMap,
      workerHours,
      workerFreeAtMins,
      workerBusySegments,
      phaseEndMins,
      period: phaseCfg.period,
      phaseRoundMins: PHASE_ROUND_MINS[selectedPhase] ?? [phaseCfg.startH * 60],
      wpbMap: new Map<string, number>(),
      specialTimeMap,
    })

    const rows = allocated.length ? allocated : (() => {
      let eligible = stationWorkers.filter(w => rawWorkerEligible(w, prod.product_group))
      if (!eligible.length) eligible = stationWorkers
      const worker = [...eligible].sort((a, b) => {
        const skillA = getRawWorkerSkillLevel(a, prod.product_group)
        const skillB = getRawWorkerSkillLevel(b, prod.product_group)
        if (skillA !== skillB) return skillA - skillB
        const freeA = getWorkerFreeAt(normName(a.name), workerFreeAtMins, workerBusySegments, phaseStartMins)
        const freeB = getWorkerFreeAt(normName(b.name), workerFreeAtMins, workerBusySegments, phaseStartMins)
        return freeA - freeB
      })[0]
      if (!worker) return []
      return [{
        production_date: productionDate,
        table_name:      station,
        worker_code:     worker.emp_id,
        worker_name:     worker.name,
        sku:             prod.sku,
        sku_name:        prod.sku_name,
        target_quantity: remainKg,
        unit:            'กก.',
        period:          phaseCfg.period,
        deadline_time:   minsToTimeStr(Math.min(phaseEndMins, getWorkerFreeAt(normName(worker.name), workerFreeAtMins, workerBusySegments, phaseStartMins))),
        status:          'รอผลิต',
        seq:             seqStart,
        channel:         'Wet Market',
        note:            'yield_remainder',
        is_deficit:      false,
      }]
    })()

    return rows.map((row, idx) => {
      const note = String(row.note ?? '')
      return {
        ...row,
        unit:           'กก.',
        channel:        'Wet Market',
        note:           note.includes('yield_remainder') ? note : (note ? `${note}|yield_remainder` : 'yield_remainder'),
        is_deficit:     false,
        seq:            seqStart + idx,
        effective_from: effectiveFromISO,
      }
    })
  }

  sortByPlanOrder(resequenced)

  resequenced.forEach((a, i) => {
    a['seq'] = i
    a['effective_from'] = effectiveFromISO
    if (a.is_deficit && !a.note?.includes('|deficit')) {
      a.note = (a.note ?? '') + '|deficit'
    }
    a['is_deficit'] = !!a.is_deficit
    const normSku = (a['sku'] as string ?? '').replace(/^0+/, '')
    if (mainSkuSet.has(normSku)) a['unit'] = 'RAW'
  })

  const cappedResequenced = capResequencedToGroupYield(resequenced)
  resequenced.length = 0
  resequenced.push(...cappedResequenced)
  sortByPlanOrder(resequenced)
  resequenced.forEach((a, i) => { a['seq'] = i })
  resetWorkerTimelineFromRows(resequenced)

  // Append remainder assignments once per product group. Groups with Mas Yield notes are
  // made from the remaining component yields first, then any unbalanced component yield
  // can fall back to the normal per-group remainder flow.
  if (Object.keys(groupYieldCap).length > 0) {
    let rawSeq = resequenced.length
    const isRawProd = (p: ProductivityRow) => isMainProduct(p)

    const remainingYield = { ...groupYieldCap }
    const consumeRemainingYield = (grp: string, qty: number) => {
      for (const c of yieldConsumptionForGroup(grp)) {
        if (remainingYield[c.product_group] === undefined) continue
        remainingYield[c.product_group] = Math.max(0, remainingYield[c.product_group] - qty * c.share)
      }
    }

    for (const a of resequenced) {
      if (String(a['note'] ?? '').includes('remainder')) continue
      const grp = productGroupForAssignment(a)
      if (!grp) continue
      consumeRemainingYield(grp, Number(a['target_quantity'] ?? 0))
    }

    for (const [sourceGrp, splits] of Array.from(yieldConsumptionByGroup.entries())) {
      const remainKg = Math.round(splits.reduce((minQty: number, c: { product_group: string; share: number }) => {
        const remaining = remainingYield[c.product_group]
        if (remaining === undefined) return minQty
        return Math.min(minQty, remaining / c.share)
      }, Number.POSITIVE_INFINITY) * 10) / 10
      if (!Number.isFinite(remainKg) || remainKg <= 0) continue

      const groupRows = resequenced.filter(a => {
        if (String(a['note'] ?? '').includes('remainder')) return false
        const normSku = String(a['sku'] ?? '').replace(/^0+/, '')
        const prod = skuMap.get(normSku) ?? skuMap.get(String(a['sku'] ?? ''))
        return prod?.product_group === sourceGrp
          || splits.some((c: { product_group: string; share: number }) => c.product_group === prod?.product_group)
      })
      const usedStations = Array.from(new Set(groupRows.map(a => String(a['table_name'] ?? '')).filter(Boolean)))
      const allSourceProds = productivity.filter(p => p.product_group === sourceGrp)
      const rawProd = allSourceProds.find(p => isRawProd(p))

      if (rawProd) {
        if (remainKg < RAW_REMAINDER_MIN_KG) continue
        const station = resolveRemainderStation(sourceGrp, rawProd, usedStations)
        if (!station) continue
        const rawRows = makeSmartRemainderRows(rawProd, station, remainKg, rawSeq, 'RAW', 'raw_remainder')
        rawSeq += rawRows.length
        resequenced.push(...rawRows)
        consumeRemainingYield(sourceGrp, remainKg)
        continue
      }

      const bestWetMarketProd = bestWetMarketSkuByGroup.get(sourceGrp)
      if (!bestWetMarketProd) continue
      const station = resolveRemainderStation(sourceGrp, bestWetMarketProd, usedStations)
      if (!station) continue
      const remainderRows = makeSmartRemainderRows(bestWetMarketProd, station, remainKg, rawSeq, 'Wet Market', 'yield_remainder')
      rawSeq += remainderRows.length
      resequenced.push(...remainderRows)
      consumeRemainingYield(sourceGrp, remainKg)
    }

    for (const [grp, yieldKg] of Object.entries(remainingYield)) {
      if (yieldKg <= 0) continue

      const groupRows = resequenced.filter(a => {
        if (String(a['note'] ?? '').includes('remainder')) return false
        const normSku = String(a['sku'] ?? '').replace(/^0+/, '')
        const prod = skuMap.get(normSku) ?? skuMap.get(String(a['sku'] ?? ''))
        return prod?.product_group === grp
      })

      const remainKg = Math.round(yieldKg * 10) / 10
      if (remainKg <= 0) continue

      const allGrpProds = productivity.filter(p => p.product_group === grp)
      const rawProd = allGrpProds.find(p => isRawProd(p))
      const usedStations = Array.from(new Set(groupRows.map(a => String(a['table_name'] ?? '')).filter(Boolean)))

      if (rawProd) {
        if (remainKg < RAW_REMAINDER_MIN_KG) continue
        const station = resolveRemainderStation(grp, rawProd, usedStations)
        if (!station) continue
        const rawRows = makeSmartRemainderRows(rawProd, station, remainKg, rawSeq, 'RAW', 'raw_remainder')
        rawSeq += rawRows.length
        resequenced.push(...rawRows)
        continue
      }

      const bestWetMarketProd = bestWetMarketSkuByGroup.get(grp)
      if (!bestWetMarketProd) continue
      const station = resolveRemainderStation(grp, bestWetMarketProd, usedStations)
      if (!station) continue
      const remainderRows = makeSmartRemainderRows(bestWetMarketProd, station, remainKg, rawSeq, 'Wet Market', 'yield_remainder')
      rawSeq += remainderRows.length
      resequenced.push(...remainderRows)
    }
  }

  // Delete previous basic assignments for this period
  if (useRegen) {
    await supabase.from('production_assignments').delete()
      .eq('production_date', productionDate)
      .eq('period', phaseCfg.period)
      .in('table_name', BASIC_TABLE_NAMES as unknown as string[])
      .eq('effective_from', latestAssign!.effective_from)
  } else {
    await supabase.from('production_assignments').delete()
      .eq('production_date', productionDate)
      .eq('period', phaseCfg.period)
      .in('table_name', BASIC_TABLE_NAMES as unknown as string[])
  }

  const { error } = await supabase.from('production_assignments').insert(resequenced)
  if (error) throw error

  const channelSummary = isPhase3
    ? 'แผน 100% − Ph1 − Ph2'
    : activeChannels
        .map(ch => {
          const targets = channelTargets[ch] ?? []
          const count = resequenced.filter(a => targets.find(t => t.sku === a['sku'])).length
          return count > 0 ? `${ch} ${count}` : null
        }).filter(Boolean).join(', ')

  return {
    success: true,
    isScheduled,
    effectiveFrom: effectiveTimeStr,
    message: isScheduled
      ? `Phase ${selectedPhase} (${phaseCfg.period}) Basic สร้างสำเร็จ ${resequenced.length} รายการ — มีผลตั้งแต่ ${effectiveTimeStr} น. (${channelSummary})`
      : `Phase ${selectedPhase} (${phaseCfg.period}) Basic สร้างสำเร็จ ${resequenced.length} รายการ — ${channelSummary}`,
    count: resequenced.length,
  }
}
