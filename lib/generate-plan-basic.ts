import { supabase } from '@/lib/supabase'

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
}

interface SkuTarget {
  sku: string
  skuName: string | null
  targetQty: number
  channel: string
  isDeficit?: boolean
}

interface CarcassLot {
  spec_code:  string
  qty:        number
  avg_weight: number
  order:      number
}

export interface GenerateBasicPlanParams {
  date?: string
  phase?: number
  deductMode?: 'plan' | 'actual' | 'yield'
  carcassLots?: CarcassLot[]
  carcassRate?: number
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
  { phase: 2, mins: 90  },  // 14:30–16:00
  { phase: 3, mins: 60  },  // 16:00–17:00
]

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

function availableWorkMins(fromMins: number, toMins: number): number {
  const total = Math.max(0, toMins - fromMins)
  const overlap = BREAKS.reduce((sum, [bs, be]) =>
    sum + Math.max(0, Math.min(be, toMins) - Math.max(bs, fromMins)), 0)
  return Math.max(0, total - overlap)
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
    })})
    .filter(r => r.station && r.sku && r.rate > 0)
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
      if (!key.startsWith('กลุ่ม')) continue
      if (val === null || val === undefined) continue
      const level = Number(val)
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

function getMakroVariance(
  proportionAbove10pct: boolean, orderQty: number, avgBL3: number,
  params: [number, number, number, number, number, number] = [0.9, 0.8, 0.6, 0.8, 0.6, 0.4],
): number {
  const [phTL, phTM, phTH, plTL, plTM, plTH] = params
  const trend = avgBL3 > 0 ? orderQty / avgBL3 : 2
  if (proportionAbove10pct) {
    if (trend > 1.0) return phTH
    if (trend > 0.8) return phTM
    return phTL
  } else {
    if (trend > 1.0) return plTH
    if (trend > 0.8) return plTM
    return plTL
  }
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
}): Record<string, unknown>[] {
  const {
    productionDate, tableName, targets, workers, skuMap, jobAssignMap,
    workerHours, workerFreeAtMins, workerBusySegments, phaseEndMins,
    period, phaseRoundMins, wpbMap, specialTimeMap, skuTotalQtyOverride,
  } = params

  if (!targets.length || !workers.length) return []

  interface ChEntry { channel: string; qty: number; isDeficit: boolean }
  interface SkuBlock {
    normSku: string; rawSku: string; skuName: string | null
    totalQty: number; isDeficit: boolean; productGroup: string
    rate: number; wpb: number; channels: ChEntry[]
  }

  const skuBlockMap = new Map<string, SkuBlock>()
  for (const t of targets) {
    if (!t.sku) continue
    const cleanSku = t.sku.replace(/^0+/, '')
    const prod = skuMap.get(cleanSku) ?? skuMap.get(t.sku)
    if (!prod || prod.rate <= 0) continue
    const rawWpb = wpbMap.get(cleanSku) ?? wpbMap.get(t.sku) ?? 1
    const wpb = rawWpb > 0 ? rawWpb : 1
    const existing = skuBlockMap.get(cleanSku)
    if (existing) {
      existing.totalQty += t.targetQty
      existing.channels.push({ channel: t.channel, qty: t.targetQty, isDeficit: t.isDeficit || false })
      if (t.isDeficit) existing.isDeficit = true
    } else {
      skuBlockMap.set(cleanSku, {
        normSku: cleanSku, rawSku: t.sku,
        skuName: prod.sku_name || t.skuName || null,
        totalQty: t.targetQty, isDeficit: t.isDeficit || false,
        productGroup: prod.product_group, rate: prod.rate, wpb,
        channels: [{ channel: t.channel, qty: t.targetQty, isDeficit: t.isDeficit || false }],
      })
    }
  }
  const skuBlocks = Array.from(skuBlockMap.values())
  skuBlocks.sort((a, b) => (b.totalQty / b.rate) - (a.totalQty / a.rate))

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

  const skuTotalQty: Map<string, number> = skuTotalQtyOverride ?? (() => {
    const m = new Map<string, number>()
    for (const t of targets) {
      if (!t.sku) continue
      const k = t.sku.replace(/^0+/, '')
      m.set(k, (m.get(k) ?? 0) + t.targetQty)
    }
    return m
  })()
  const getMaxWorkers = (normSku: string): number => {
    const qty = skuTotalQty.get(normSku) ?? 0
    if (qty <= 15) return 1
    if (qty <= 30) return 2
    if (qty <= 45) return 3
    return Infinity
  }
  const skuAssignedWorkers = new Map<string, Set<string>>()

  const assignments: Record<string, unknown>[] = []

  for (const block of skuBlocks) {
    const { normSku, rawSku, skuName, totalQty, productGroup, rate, wpb, channels } = block

    let eligibleWorkers = workers.filter(w => isWorkerEligible(w, productGroup))
    if (!eligibleWorkers.length) eligibleWorkers = workers
    if (!eligibleWorkers.length) continue

    const maxW = getMaxWorkers(normSku)

    let remaining = totalQty
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

    for (const worker of sortedWorkers) {
      if (workersForSku.length >= maxW) break
      const nameKey = normName(worker.name)
      if (assignedSet.has(nameKey)) {
        workersForSku.push(worker)
        continue
      }
      const freeAt = getWorkerFreeAt(nameKey, workerFreeAtMins, workerBusySegments, phaseStartMins)
      const busySegs = workerBusySegments.get(nameKey) ?? []
      const specialEntry = specialTimeMap.get(normSku) ?? specialTimeMap.get(rawSku)
      const specialStart = specialEntry?.startMins ?? null
      const specialStop  = specialEntry?.stopMins  ?? null
      const estimatedDur = remaining / rate * 60
      const finish = estimateWorkerFinish(freeAt, estimatedDur / Math.max(workersForSku.length + 1, 1), busySegs, phaseEndMins, specialStart, specialStop)
      if (finish === null) continue
      workersForSku.push(worker)
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

    skuAssignedWorkers.set(normSku, new Set([...assignedSet, ...workersForSku.map(w => normName(w.name))]))

    // Distribute quantity evenly and track per-round
    const perWorker = remaining / workersForSku.length
    for (const worker of workersForSku) {
      const nameKey = normName(worker.name)
      const freeAt = getWorkerFreeAt(nameKey, workerFreeAtMins, workerBusySegments, phaseStartMins)
      const specialEntry = specialTimeMap.get(normSku) ?? specialTimeMap.get(rawSku)
      const specialStart = specialEntry?.startMins ?? null
      const startMins = forcedDeficitWorkers.has(nameKey)
        ? phaseEndMins
        : (specialStart !== null ? Math.max(freeAt, specialStart) : freeAt)
      const roundMins = getRoundMinsLocal(startMins, phaseRoundMins)
      const bagQty = wpb > 0 ? Math.floor(perWorker / wpb) * wpb : perWorker
      const finalQty = Math.max(bagQty, wpb > 0 ? wpb : bagQty)

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
      if (cur === undefined || startMins < cur) startMap.set(normSku, startMins)

      // Advance worker free time — skip for forced deficit backlog (not a real timeslot)
      if (!forcedDeficitWorkers.has(nameKey)) {
        const dur = finalQty / rate * 60
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
      const effectiveStart = specialStart !== null ? Math.max(startMins, specialStart) : startMins
      const deadline = minsToTimeStr(effectiveStart)
      const isDeficit = workerSkuDeficit.get(nameKey)?.get(normSku) ?? false

      let remainingForWorker = totalAssigned
      for (const ch of channels) {
        if (remainingForWorker <= 0) break
        const chQty = Math.min(remainingForWorker, ch.qty / workersForSku.length)
        const bagQty = wpb > 0 ? Math.floor(chQty / wpb) * wpb : chQty
        if (bagQty <= 0) continue
        remainingForWorker -= bagQty

        const roundMinsLocal = getRoundMinsLocal(effectiveStart, phaseRoundMins)
        const noteRoundStr = `round:${roundMinsLocal}:${bagQty}`

        assignments.push({
          production_date: productionDate,
          table_name:      tableName,
          worker_code:     worker.emp_id,
          worker_name:     worker.name,
          sku:             rawSku,
          sku_name:        skuName,
          target_quantity: bagQty,
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
}

// ========== Helpers ==========

function mergeAssignList(list: SkuTarget[]): SkuTarget[] {
  const merged = new Map<string, SkuTarget>()
  const order: string[] = []
  for (const item of list) {
    if (!item.sku) continue
    const skuClean = item.sku.replace(/^0+/, '')
    const key = item.isDeficit ? `${item.channel}_${skuClean}_deficit` : `${item.channel}_${skuClean}`
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
  const all: { sku: string; target_quantity: number; channel: string | null }[] = []
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
    const rows = await fetchAll<{ sku: string; target_quantity: number; channel: string | null }>(
      'production_assignments', 'sku, target_quantity, channel', filters,
    )
    all.push(...rows)
  }
  return all
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

  const orderRound = (isPhase2 || isPhase3) ? '1400' : '0800'

  // Fetch all data in parallel
  const [
    { data: workforceRawManual },
    { data: workforceRaw0930 },
    { data: workforceRaw1530 },
    wmTodayRaw, wmHistRaw,
    lotusTodayRaw, lotusHistRaw,
    makroTodayRaw, makroHistRaw,
    { data: masterProdRaw },
    { data: masterChannelRaw },
    { data: jobAssignRaw },
    prevAssignedRaw, yieldBagsRaw,
    { data: plan100Raw },
    { data: pickingUnitRaw },
    { data: masterVarLotusRaw },
    { data: masterVarWMRaw },
    { data: masterVarMakroRaw },
    { data: masterSpecialRaw },
    { data: masterProductTypeRaw },
    { data: oldAssignmentsRaw },
    { data: quotasRaw },
    { data: masYieldRaw },
    { data: masSayapanRaw },
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
      [{ col: 'delivery_date', op: 'in', val: histDates }, { col: 'upload_round', op: 'eq', val: '1400' }]),
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
      ? supabase.from('production_plan_100').select('sap, product_name, weight_total').eq('plan_date', productionDate)
      : Promise.resolve({ data: [] as { sap: string; product_name: string | null; weight_total: number }[], error: null }),
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
    supabase.from('mas_yield').select('carcass_weight, product_group, yield_pct'),
    supabase.from('mas_sayapan').select('product_group, station'),
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

  if (!workforce.length) return {
    success: false,
    message: 'ไม่พบข้อมูลกำลังคน Basic — กรุณารอ Sync รอบ 9:30 หรือตั้งค่า Workforce Weekly (Basic)',
  }

  const wmToday    = (wmTodayRaw    ?? []) as OrderRow[]
  const wmHist     = (wmHistRaw     ?? []) as OrderRow[]
  const lotusToday = (lotusTodayRaw ?? []) as OrderRow[]
  const lotusHist  = (lotusHistRaw  ?? []) as OrderRow[]
  const makroToday = (makroTodayRaw ?? []) as OrderRow[]
  const makroHist  = (makroHistRaw  ?? []) as OrderRow[]

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
    if (!wpb || wpb <= 0) return qty
    return Math.floor(qty / wpb) * wpb
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

  // Build main SKU set: auto-detect sku_name ending '-Raw' + explicit Mas Product Type Basic overrides
  const mainSkuSet = new Set<string>()
  for (const p of productivity) {
    if (p.sku_name && p.sku_name.trim().toLowerCase().endsWith('-raw')) {
      mainSkuSet.add(p.sku.replace(/^0+/, ''))
    }
  }
  for (const row of masterProductTypeRaw ?? []) {
    const r = normalizeRow(row.row_data as Record<string, unknown>)
    const sap  = String(r['SAP'] ?? '').trim().replace(/^0+/, '')
    const type = String(r['ประเภท'] ?? r['product_type'] ?? '').trim().toLowerCase()
    if (sap && (type === 'main' || type === 'หลัก')) mainSkuSet.add(sap)
  }

  // Parse variance masters
  const lotusVarianceMap = new Map<string, number>()
  for (const row of masterVarLotusRaw ?? []) {
    const r = normalizeRow(row.row_data as Record<string, unknown>)
    const station = normalizeStation(String(r['จุดงาน'] ?? r['Station'] ?? '').trim())
    let pct = Number(r['%Variance'] ?? 0)
    if (pct > 1) pct = pct / 100
    if (station && pct > 0) lotusVarianceMap.set(station, pct)
  }

  let wmVarParams: [number, number, number, number] | undefined
  for (const row of masterVarWMRaw ?? []) {
    const vals = Object.values(row.row_data as Record<string, unknown>)
    if (vals.some(v => String(v ?? '').trim() === '%Variance')) {
      const nums = vals.filter(v => typeof v === 'number').map(v => v > 1 ? v / 100 : v) as number[]
      if (nums.length >= 4) { wmVarParams = [nums[0], nums[1], nums[2], nums[3]]; break }
    }
  }

  let makroVarParams: [number, number, number, number, number, number] | undefined
  for (const row of masterVarMakroRaw ?? []) {
    const vals = Object.values(row.row_data as Record<string, unknown>)
    if (vals.some(v => String(v ?? '').trim() === '%Variance')) {
      const nums = vals.filter(v => typeof v === 'number').map(v => v > 1 ? v / 100 : v) as number[]
      if (nums.length >= 6) { makroVarParams = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]]; break }
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

  const currentWorkforceNames = new Set(workforce.map((w: WorkforceRow) => normName(w.name)))

  // Kept assignments for checkpoint regeneration
  const keptAssignments: any[] = []
  const keptChannelQtyMap = new Map<string, number>()
  const workerKeptMaxEndMins = new Map<string, number>()

  if (useRegen && oldAssignmentsRaw) {
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
            const rate = prod?.rate ?? 27.0
            const duration = rate > 0 ? Math.round((Number(a.target_quantity) / rate) * 60) : 0
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
    workerBusySegments.set(nameKey, [])
  }

  // Picking unit map
  const wpbMap = new Map<string, number>()
  for (const r of pickingUnitRaw ?? [])
    wpbMap.set((r as any).sap.replace(/^0+/, ''), (r as any).weight_per_bag ?? 0)

  // Historical averages
  const avgWM    = buildAvgMap(wmHist)
  const avgLotus = buildAvgMap(lotusHist)
  const avgMakro = buildAvgMap(makroHist)

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
    for (const sku of allSkus) {
      const p1Total = phase1Assigned.get(sku) ?? 0
      if (p1Total === 0) continue
      const rawTotal = rawOrderBySku.get(sku) ?? 0
      const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, '')) ?? 0
      const budget = wpb > 0
        ? Math.floor(Math.max(0, rawTotal - p1Total) / wpb) * wpb
        : Math.max(0, rawTotal - p1Total)
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
        if (wpb > 0) arr[idx].targetQty = Math.floor(arr[idx].targetQty / wpb) * wpb
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
  const wmMap    = aggregateToday(wmToday)
  const lotusMap = aggregateToday(lotusToday)
  const makroMap = aggregateToday(makroToday)

  // Build targets per channel
  const buildWetMarketTargets = (): SkuTarget[] => {
    const ch = 'Wet Market'
    if (isPhase2) {
      const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
      return Object.entries(wmMap).map(([sku, { qty: orderQty, name }]) => {
        const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, '')) ?? 0
        const p1Actual = p1.get(sku) ?? 0
        const targetQty = wpb > 0
          ? Math.floor(Math.max(0, orderQty - p1Actual) / wpb) * wpb
          : Math.max(0, orderQty - p1Actual)
        return { sku, skuName: name, targetQty, channel: ch }
      }).filter(s => s.targetQty > 0)
    }
    const wmHistNames = new Map(wmHist.map(r => [r.sku.replace(/^0+/, ''), r.sku_name]))
    const lotusHistSkus = new Set(avgLotus.keys())
    return Array.from(avgWM.entries())
      .map(([sku, avg]) => {
        const isShared = lotusHistSkus.has(sku)
        const quotaToday = quotaMap.get(sku) ?? avg
        const variance = getWetMarketVariance(isShared, quotaToday, avg, avgLotus.get(sku) ?? 0, wmVarParams)
        return { sku, skuName: wmHistNames.get(sku) ?? null, targetQty: roundDownToBag(sku, roundDownToBag(sku, avg) * variance), channel: ch }
      }).filter(s => s.targetQty > 0)
  }

  const buildMakroTargets = (): SkuTarget[] => {
    const ch = 'Makro'
    if (isPhase2) {
      const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
      return Object.entries(makroMap).map(([sku, { qty: orderQty, name }]) => {
        const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, '')) ?? 0
        const p1Actual = p1.get(sku) ?? 0
        const targetQty = wpb > 0
          ? Math.floor(Math.max(0, orderQty - p1Actual) / wpb) * wpb
          : Math.max(0, orderQty - p1Actual)
        return { sku, skuName: name, targetQty, channel: ch }
      }).filter(s => s.targetQty > 0)
    }
    const getSkuGroup = (sku: string): string => {
      const clean = sku.replace(/^0+/, '')
      const prod = skuMap.get(clean) ?? skuMap.get(sku)
      return prod ? prod.product_group : ''
    }
    const makroTotal = Object.values(makroMap).reduce((s, v) => s + v.qty, 0)
    const groupQtyMap = new Map<string, number>()
    for (const [sku, { qty }] of Object.entries(makroMap)) {
      const grp = getSkuGroup(sku)
      groupQtyMap.set(grp, (groupQtyMap.get(grp) ?? 0) + qty)
    }
    return Object.entries(makroMap).map(([sku, { qty: orderQty, name }]) => {
      const grp = getSkuGroup(sku)
      const groupQty = groupQtyMap.get(grp) ?? 0
      const proportion = makroTotal > 0 ? groupQty / makroTotal : 0
      const avgBL3 = avgMakro.get(sku) ?? 0
      const baggedOrderQty = roundDownToBag(sku, orderQty)
      if (avgBL3 === 0) return { sku, skuName: name, targetQty: baggedOrderQty, channel: ch }
      const variance = getMakroVariance(proportion > 0.1, orderQty, avgBL3, makroVarParams)
      return { sku, skuName: name, targetQty: Math.min(baggedOrderQty * variance, baggedOrderQty), channel: ch }
    }).filter(s => s.targetQty > 0)
  }

  const buildLotusTargets = (): SkuTarget[] => {
    const ch = 'LOTUS'
    if (isPhase2) {
      const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
      return Object.entries(lotusMap).map(([sku, { qty: orderQty, name }]) => {
        const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, '')) ?? 0
        const p1Actual = p1.get(sku) ?? 0
        const targetQty = wpb > 0
          ? Math.floor(Math.max(0, orderQty - p1Actual) / wpb) * wpb
          : Math.max(0, orderQty - p1Actual)
        return { sku, skuName: name, targetQty, channel: ch }
      }).filter(s => s.targetQty > 0)
    }
    const lotusHistNames = new Map(lotusHist.map(r => [r.sku.replace(/^0+/, ''), r.sku_name]))
    return Array.from(avgLotus.entries())
      .map(([sku, avg]) => {
        const prod = skuMap.get(sku) ?? skuMap.get(sku.replace(/^0+/, ''))
        const station = prod ? normalizeStation(prod.station) : ''
        const variance = lotusVarianceMap.size > 0 ? (lotusVarianceMap.get(station) ?? 1.0) : 1.0
        return { sku, skuName: lotusHistNames.get(sku) ?? null, targetQty: roundDownToBag(sku, roundDownToBag(sku, avg) * variance), channel: ch }
      }).filter(s => s.targetQty > 0)
  }

  const channelTargets: Record<string, SkuTarget[]> = {
    'Wet Market': buildWetMarketTargets(),
    'Makro':      buildMakroTargets(),
    'LOTUS':      buildLotusTargets(),
  }

  if (isPhase2) {
    const p2RawBySku = new Map<string, number>()
    for (const [sku, { qty }] of Object.entries(wmMap))    p2RawBySku.set(sku, (p2RawBySku.get(sku) ?? 0) + qty)
    for (const [sku, { qty }] of Object.entries(makroMap)) p2RawBySku.set(sku, (p2RawBySku.get(sku) ?? 0) + qty)
    for (const [sku, { qty }] of Object.entries(lotusMap)) p2RawBySku.set(sku, (p2RawBySku.get(sku) ?? 0) + qty)
    crossChannelCap(channelTargets, p2RawBySku, activeChannels)
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
      const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, '')) ?? 0
      const p12Actual = phase1Assigned.get(sku) ?? 0
      const targetQty = wpb > 0
        ? Math.floor(Math.max(0, qty - p12Actual) / wpb) * wpb
        : Math.max(0, qty - p12Actual)
      return { sku, skuName: name, targetQty, channel }
    }).filter(t => t.targetQty > 0)

    if (wmToday.length || lotusToday.length || makroToday.length) {
      const phase3SkuSet = new Set(allPhase3Targets.map(t => t.sku.replace(/^0+/, '')))
      const appendRemaining = (orderMap: Record<string, { qty: number; name: string | null }>, ch: string) => {
        for (const [sku, { qty: orderQty, name }] of Object.entries(orderMap)) {
          if (phase3SkuSet.has(sku)) continue
          const p12 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
          const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, '')) ?? 0
          const p12Actual = p12.get(sku) ?? 0
          const targetQty = wpb > 0
            ? Math.floor(Math.max(0, orderQty - p12Actual) / wpb) * wpb
            : Math.max(0, orderQty - p12Actual)
          if (targetQty > 0) allPhase3Targets.push({ sku, skuName: name, targetQty, channel: ch })
        }
      }
      appendRemaining(wmMap, 'Wet Market')
      appendRemaining(lotusMap, 'LOTUS')
      appendRemaining(makroMap, 'Makro')
    }
    assignList = mergeAssignList(allPhase3Targets)
  } else {
    const raw: SkuTarget[] = []
    for (const ch of activeChannels) {
      raw.push(...(channelTargets[ch] ?? []))
    }
    assignList = mergeAssignList(raw)
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
  if (params.carcassLots?.length && params.carcassRate && (masYieldRaw ?? []).length > 0) {
    const capLots    = [...params.carcassLots].sort((a, b) => a.order - b.order).map(l => ({ ...l, remaining: l.qty }))
    const capRate    = params.carcassRate
    const capYield   = masYieldRaw as { carcass_weight: number; product_group: string; yield_pct: number }[]
    const capUniqWts = [...new Set(capYield.map(r => r.carcass_weight))].sort((a, b) => a - b)

    let capPoolIdx = 0
    const groupYieldCap: Record<string, number> = {}

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
          const kg = (my.yield_pct / 100) * u.avg * u.qty
          groupYieldCap[my.product_group] = (groupYieldCap[my.product_group] ?? 0) + kg
        }
      }
    }

    // Deduct per item in priority order; items exceeding the remaining cap are trimmed
    const groupRemaining = { ...groupYieldCap }
    for (const item of assignList) {
      const normSku = item.sku.replace(/^0+/, '')
      const prod    = skuMap.get(normSku) ?? skuMap.get(item.sku)
      if (!prod?.product_group) continue
      const grp       = prod.product_group
      const remaining = groupRemaining[grp] ?? 0
      if (remaining <= 0) { item.targetQty = 0; continue }
      if (item.targetQty > remaining) item.targetQty = roundDownToBag(normSku, remaining)
      groupRemaining[grp] = Math.max(0, remaining - item.targetQty)
    }
    assignList = assignList.filter(item => item.targetQty > 0)
  }

  // Assign workers per channel pass
  const assignments: Record<string, unknown>[] = []

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
          let qty = roundDownToBag(item.sku, item.targetQty)
          if (isPhase3) {
            const planItem = planMap.get(normSku)
            if (planItem) {
              const remaining = Math.max(0, planItem.qty - (phase1Assigned.get(normSku) ?? 0))
              if (qty > remaining) qty = remaining
            }
          }
          return qty
        })()
        if (targetQty <= 0) continue

        const prod = skuMap.get(normSku) ?? skuMap.get(item.sku)
        if (!prod) continue
        const station = toBasicStation(prod.station)
        targetsByStation[station] ??= []
        targetsByStation[station].push({ ...item, targetQty })

        // Batch same SKU from subsequent channels
        for (let nextIdx = chIdx + 1; nextIdx < chsInPass.length; nextIdx++) {
          const nextCh = chsInPass[nextIdx]
          const nextKey = `${nextCh}|||${normSku}`
          if (handled.has(nextKey)) continue
          const nextItem = passList.find(i => i.channel === nextCh && i.sku.replace(/^0+/, '') === normSku)
          if (!nextItem) continue
          handled.add(nextKey)
          const nextQty = roundDownToBag(nextItem.sku, nextItem.targetQty)
          if (nextQty <= 0) continue
          targetsByStation[station].push({ ...nextItem, targetQty: nextQty })
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
  for (const a of assignments) {
    const name = a.worker_name as string
    byWorkerPost[name] ??= []
    byWorkerPost[name].push({ ...a, is_deficit: !!(a as any).is_deficit })
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

    const busySegs: { start: number; end: number }[] = []
    let curMins = phaseCfg.startH * 60
    const keptTasks: typeof workerTasks = []

    for (const task of workerTasks) {
      const cleanSku = (task.sku as string).replace(/^0+/, '')
      const prod = skuMap.get(cleanSku) ?? skuMap.get(task.sku as string)
      const rate = prod?.rate ?? 27.0
      const duration = rate > 0 ? Math.round((Number(task.target_quantity) / rate) * 60) : 0

      if (task.isKept) {
        const [h, m] = (task.deadline_time as string).split(':').map(Number)
        const startMins = h * 60 + m
        const endMins = wallClockFinish(startMins, duration)
        busySegs.push({ start: startMins, end: endMins })
        curMins = Math.max(curMins, endMins)
        delete task.isKept
        keptTasks.push(task)
      } else {
        if (curMins < checkpointMins) curMins = checkpointMins

        const specialStart = specialTimeMap.get(cleanSku)?.startMins ?? specialTimeMap.get(task.sku as string)?.startMins ?? null

        if (specialStart !== null) {
          const startMins = Math.max(curMins, specialStart)
          if (!isPhase3 && startMins >= phaseEndMins) continue
          const endMins = wallClockFinish(startMins, duration)
          task.deadline_time = minsToTimeStr(startMins)
          busySegs.push({ start: startMins, end: endMins })
          keptTasks.push(task)
        } else {
          let startMins = curMins
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

          task.deadline_time = minsToTimeStr(startMins)
          let endMins = wallClockFinish(startMins, duration)

          if (!isPhase3 && endMins > phaseEndMins) {
            const availMins = availableWorkMins(startMins, phaseEndMins)
            const truncQty = (availMins / 60) * rate
            const skuForWpb = cleanSku || (task.sku as string)
            const wpb = wpbMap.get(skuForWpb) ?? wpbMap.get(task.sku as string) ?? 1
            let finalQty: number
            if (wpb > 1 && (task.channel as string) !== 'Makro') {
              finalQty = Math.floor(truncQty / wpb) * wpb
            } else {
              finalQty = Math.round(truncQty)
            }
            if (finalQty <= 0) continue
            task.target_quantity = Math.round(finalQty * 100) / 100
            endMins = wallClockFinish(startMins, (finalQty / rate) * 60)
          }

          busySegs.push({ start: startMins, end: endMins })
          curMins = endMins
          keptTasks.push(task)
        }
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

  // Add Raw remainder assignments from carcass yield (if lot data supplied by client)
  if (params.carcassLots?.length && params.carcassRate && (masYieldRaw ?? []).length > 0) {
    const sortedLots = [...params.carcassLots].sort((a, b) => a.order - b.order).map(l => ({ ...l, remaining: l.qty }))
    const cRate = params.carcassRate
    const masYield  = masYieldRaw  as { carcass_weight: number; product_group: string; yield_pct: number }[]
    const masSay    = (masSayapanRaw ?? []) as { product_group: string; station: string }[]
    const uniqueWts = [...new Set(masYield.map(r => r.carcass_weight))].sort((a, b) => a - b)

    let lotPoolIdx = 0
    const phaseGroupKg: Record<string, number> = {}

    for (const seg of CARCASS_ACTIVE_SEGS) {
      const pigs = Math.floor((seg.mins * 60) / cRate)
      let need = pigs
      const usages: { qty: number; avg: number }[] = []

      while (need > 0 && lotPoolIdx < sortedLots.length) {
        const lot = sortedLots[lotPoolIdx]
        const take = Math.min(need, lot.remaining)
        if (take > 0) {
          usages.push({ qty: take, avg: lot.avg_weight })
          lot.remaining -= take
          need -= take
        }
        if (lot.remaining === 0) lotPoolIdx++
      }

      if (seg.phase !== selectedPhase) continue

      for (const u of usages) {
        const wt = uniqueWts.reduce((best, w) => Math.abs(w - u.avg) < Math.abs(best - u.avg) ? w : best, uniqueWts[0] ?? 0)
        for (const my of masYield) {
          if (my.carcass_weight !== wt) continue
          const kg = (my.yield_pct / 100) * u.avg * u.qty
          phaseGroupKg[my.product_group] = (phaseGroupKg[my.product_group] ?? 0) + kg
        }
      }
    }

    // Append Raw remainder assignments — station level (avoids product_group naming mismatch)
    let rawSeq = resequenced.length
    for (const station of BASIC_TABLE_NAMES) {
      const stationGroups = masSay.filter(r => r.station === station).map(r => r.product_group)
      if (!stationGroups.length) continue

      // Total expected yield at this station (sum all sayapan groups)
      const totalExpectedKg = stationGroups.reduce((s, grp) => s + (phaseGroupKg[grp] ?? 0), 0)
      if (totalExpectedKg <= 0) continue

      // Total already assigned at this station (all order-based assignments)
      const totalAssignedKg = resequenced
        .filter(a => String(a['table_name'] ?? '') === station)
        .reduce((s, a) => s + Number(a['target_quantity'] ?? 0), 0)

      const remainKg = Math.round((totalExpectedKg - totalAssignedKg) * 10) / 10
      if (remainKg <= 0) continue

      // Find Raw SKU at this station by sku_name suffix (no product_group constraint)
      const rawProd = productivity.find(p =>
        toBasicStation(p.station) === station &&
        p.sku_name.trim().toLowerCase().endsWith('-raw')
      )
      if (!rawProd) continue

      resequenced.push({
        production_date: productionDate,
        table_name:      station,
        worker_code:     'RAW',
        worker_name:     'สต๊อก Raw',
        sku:             rawProd.sku,
        sku_name:        rawProd.sku_name,
        target_quantity: remainKg,
        unit:            'RAW',
        period:          phaseCfg.period,
        deadline_time:   minsToTimeStr(phaseCfg.endH * 60),
        status:          'รอผลิต',
        seq:             rawSeq++,
        channel:         'RAW',
        note:            'raw_remainder',
        is_deficit:      false,
        effective_from:  effectiveFromISO,
      })
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
