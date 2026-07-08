import { supabase, fetchLatestPlan100, fetchLatestOrders } from '@/lib/supabase'
import { allocateFIFOWithRules, RawMaterialRule } from '@/lib/withdrawal-rules'
import { fetchWorkforceAndSkills, WorkforceRow, normName } from '@/lib/workforce'

// ========== Types ==========

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

interface SkuTarget { sku: string; skuName: string | null; targetQty: number; channel: string; isDeficit?: boolean }

export interface GeneratePlanParams {
  date?: string
  phase?: number
  deductMode?: 'plan' | 'actual' | 'yield'
  disableMidRecal?: boolean
  // Emergency override: generate even if today's employee_skills roster
  // hasn't synced yet, using the most recent prior day's roster instead.
  useFallbackWorkforce?: boolean
}

export interface GeneratePlanResult {
  success: boolean
  isScheduled?: boolean
  effectiveFrom?: string
  message: string
  count?: number
  debug_targets?: { sku: string; wm: number; makro: number; lotus: number; merged: number }[]
  debug_concurrent_pairs?: { source: string; byProduct: string }[]
  debug_skips?: Record<string, unknown>[]
}

// ========== Utilities ==========

// Kill-switch: disable all WIP (กลุ่ม WIP) raw-material reservation and
// worker-assignment logic during plan generation, as if wip_plan didn't exist.
const ENABLE_WIP = true

function minsToTimeStr(mins: number): string {
  const wrapped = ((mins % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = Math.floor(wrapped % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

const BREAKS: [number, number][] = [
  [720,  780],  // 12:00–13:00
  [1020, 1080], // 17:00–18:00
]

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

// ========== Phase & Round Config ==========

const PHASE_CONFIG = [
  { phase: 1, period: 'เช้า',  deadline: '14:30:00', hours: 6.0, startH: 8.5,  endH: 14.5 },
  { phase: 2, period: 'บ่าย',  deadline: '16:30:00', hours: 2.0, startH: 14.5, endH: 16.5 },
  { phase: 3, period: 'ค่ำ',   deadline: null,        hours: 7.5, startH: 16.5, endH: 32 }, // 08:00 next day — no fixed cutoff
]

const PHASE_ROUND_MINS: Record<number, number[]> = {
  1: [510, 600, 780],
  2: [870],
  3: [990, 1080, 1200],
}

function getRoundMins(t: number, roundMins: number[]): number {
  let round = roundMins[0]
  for (const r of roundMins) {
    if (t >= r) round = r
    else break
  }
  return round
}

// ========== Row key normalizer ==========
// Trims whitespace from every key in a row_data object so exact-key lookups
// are resilient to accidental leading/trailing spaces in Excel column headers.
function normalizeRow(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(r)) out[k.trim()] = v
  return out
}

// ========== Station Mapping ==========

const normalizeStation = (s: string) => s.replace(/[()]/g, '').trim()

const STATION_TABLE: Record<string, string> = {
  'สามชั้นพิเศษ': 'สามชั้น',
  'ไหล่พิเศษ':    'ไหล่',
  'สะโพกพิเศษ':   'สะโพก',
  'หมูบดพิเศษ':   'หมูบด',
  'สไลด์พิเศษ':   'สไลด์',
  'เผาขาพิเศษ':   'เผาขา',
  'เลาะขาพิเศษ':  'เลาะขา',
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

// ========== Variance Calculators ==========

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

// params: [nonSharedHigh, nonSharedLow, sharedHigh, sharedLow]
function getWetMarketVariance(
  isShared: boolean, quotaToday: number, avg7d: number, lotus7d: number,
  params: [number, number, number, number] = [0.5, 0.3, 0.5, 0.7],
): number {
  const [nsHigh, nsLow, sHigh, sLow] = params
  if (!isShared) return Math.min(quotaToday, avg7d) > 100 ? nsHigh : nsLow
  const ratio = lotus7d > 0 ? Math.min(quotaToday, avg7d) / lotus7d : 999
  return ratio > 0.5 ? sHigh : sLow
}

// params order matches master columns: [propHigh_trendLow, propHigh_trendMid, propHigh_trendHigh, propLow_trendLow, propLow_trendMid, propLow_trendHigh]
// proportion = SKU order / total Makro order; trend = order / avg7d
function getMakroVariance(
  proportionAbove10pct: boolean, orderQty: number, avg7d: number,
  params: [number, number, number, number, number, number] = [0.9, 0.8, 0.6, 0.8, 0.6, 0.4],
): number {
  const [phTL, phTM, phTH, plTL, plTM, plTH] = params
  const trend = avg7d > 0 ? orderQty / avg7d : 2
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

// ========== Worker Assignment ==========

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

// Consumes as much available time as it can before limitEnd (accounting for busy
// segments/breaks) and reports how much of durationMins was actually used
// (usedMins <= durationMins) instead of failing outright when it doesn't all fit.
function consumeAvailableTime(
  freeAt: number,
  durationMins: number,
  busySegments: { start: number; end: number }[],
  limitEnd: number,
): { finish: number; usedMins: number } {
  let pos = freeAt
  let remaining = durationMins
  let used = 0
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

    if (pos >= limitEnd) break // no more room before the limit

    let nextEvent = limitEnd
    for (const seg of sortedSegs) {
      if (seg.start > pos) nextEvent = Math.min(nextEvent, seg.start)
    }
    for (const [bs, be] of BREAKS) {
      if (bs > pos) nextEvent = Math.min(nextEvent, bs)
    }

    const chunk = nextEvent - pos
    if (remaining <= chunk) {
      pos += remaining
      used += remaining
      remaining = 0
    } else {
      used += chunk
      remaining -= chunk
      pos = nextEvent
    }
  }
  return { finish: pos, usedMins: used }
}

// Distributes as many whole bags as fit into the worker's remaining time before limitEnd,
// instead of an all-or-nothing fit. Returns { bags: 0, finish: startAt } if nothing fits.
function fitMaxBags(
  startAt: number,
  bags: number,
  wpb: number,
  rate: number,
  busySegments: { start: number; end: number }[],
  limitEnd: number,
): { bags: number; finish: number } {
  if (bags < 1 || rate <= 0) return { bags: 0, finish: startAt }
  const durationMins = (bags * wpb / rate) * 60
  const { finish, usedMins } = consumeAvailableTime(startAt, durationMins, busySegments, limitEnd)
  if (usedMins >= durationMins - 0.01) return { bags, finish }

  const fitBags = Math.floor((usedMins * rate / 60) / wpb)
  if (fitBags < 1) return { bags: 0, finish: startAt }
  const fitDuration = (fitBags * wpb / rate) * 60
  const { finish: fitFinish } = consumeAvailableTime(startAt, fitDuration, busySegments, limitEnd)
  return { bags: fitBags, finish: fitFinish }
}

function allocateBalanced(params: {
  productionDate: string
  tableName: string
  targets: { sku: string; skuName: string | null; targetQty: number; channel: string; isDeficit?: boolean }[]
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
  lastSkuSet?: Set<string>
  debugSkips?: Record<string, unknown>[]
}): Record<string, unknown>[] {
  const {
    productionDate, tableName, targets, workers, skuMap, jobAssignMap,
    workerHours, workerFreeAtMins, workerBusySegments, phaseEndMins,
    period, phaseRoundMins, wpbMap, specialTimeMap, skuTotalQtyOverride, lastSkuSet, debugSkips
  } = params

  if (!targets.length || !workers.length) return []

  // 1. Merge all channels of the same normSku into one block (sorted LPT)
  //    → one continuous time block per SKU, worker doesn't split across channels
  interface ChEntry { channel: string; qty: number; isDeficit: boolean }
  interface SkuBlock {
    normSku: string
    rawSku: string
    skuName: string | null
    totalQty: number
    isDeficit: boolean
    productGroup: string
    station: string
    rate: number
    wpb: number
    channels: ChEntry[]
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
        productGroup: prod.product_group, station: prod.station, rate: prod.rate, wpb,
        channels: [{ channel: t.channel, qty: t.targetQty, isDeficit: t.isDeficit || false }],
      })
    }
  }
  const skuBlocks = Array.from(skuBlockMap.values())
  skuBlocks.sort((a, b) => {
    // SKUs in lastSkuSet are produced last within the phase (e.g. หมูบด 50% fat)
    if (lastSkuSet) {
      const aLast = lastSkuSet.has(a.normSku) || lastSkuSet.has(a.rawSku)
      const bLast = lastSkuSet.has(b.normSku) || lastSkuSet.has(b.rawSku)
      if (aLast !== bLast) return aLast ? 1 : -1
    }
    // Own-station SKUs first; cross-station SKUs (e.g. ซี่โครง in สะโพก) run after
    const aOwn = (STATION_TABLE[a.station] ?? a.station) === tableName ? 0 : 1
    const bOwn = (STATION_TABLE[b.station] ?? b.station) === tableName ? 0 : 1
    if (aOwn !== bOwn) return aOwn - bOwn
    // Sort by the leading channel's qty (not totalQty) so cross-channel-inflated blocks
    // (e.g. WM/90 + LOTUS/1205 merged as 1295) don't unfairly displace higher-priority
    // same-channel SKUs (e.g. WM/670). channels[0] is always the primary channel.
    return (b.channels[0].qty / b.rate) - (a.channels[0].qty / a.rate)
  })

  // 2. Helper to check if a worker is eligible for a product group
  const isWorkerEligible = (worker: WorkforceRow, skuGroup: string): boolean => {
    if (jobAssignMap.size === 0) return true
    const jobInfo = jobAssignMap.get(normName(worker.name))
    if (!jobInfo) return true // name not in job assign → treat as eligible for all groups (lowest priority)
    if (jobInfo.isWeigher && (!skuGroup || !jobInfo.groups.has(skuGroup))) return false
    return skuGroup ? jobInfo.groups.has(skuGroup) : true
  }

  // 3. Helper to get worker's skill level for a product group (lower is better, 99 if none)
  const getWorkerSkillLevel = (worker: WorkforceRow, skuGroup: string): number => {
    if (jobAssignMap.size === 0) return 1
    const jobInfo = jobAssignMap.get(normName(worker.name))
    return jobInfo?.groups.get(skuGroup) ?? 99
  }

  // Track worker round quantities: workerName -> Map<sku, Map<roundMins, qty>>
  const workerSkuRoundQty = new Map<string, Map<string, Map<number, number>>>()
  // Track total quantity assigned to worker per SKU: workerName -> Map<sku, number>
  const workerSkuQty = new Map<string, Map<string, number>>()
  // Track if SKU is deficit for worker: workerName -> Map<sku, boolean>
  const workerSkuDeficit = new Map<string, Map<string, boolean>>()
  // Track earliest start time per SKU: workerName -> Map<sku, number>
  const workerSkuEarliestStart = new Map<string, Map<string, number>>()

  const getRoundMins = (t: number, roundMinsList: number[]): number => {
    let round = roundMinsList[0]
    for (const r of roundMinsList) {
      if (t >= r) round = r
      else break
    }
    return round
  }

  const phaseStartMins = phaseRoundMins[0] ?? 510

  // Pre-compute total qty per normSku for worker-count cap.
  // Use override when provided (passes the full stock+deficit total so the cap isn't
  // artificially tightened when only a small deficit slice is being allocated).
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
  // Track which workers have been assigned to each normSku
  const skuAssignedWorkers = new Map<string, Set<string>>()

  // สไลด์: pre-split workers into groups
  //   - Group C (WIP): workers whose job assignment has ONLY กลุ่ม WIP → WIP blocks only
  //   - Group A + B: remaining workers split evenly → non-WIP blocks only
  //   Non-WIP: sticky product-group routing — once group A takes e.g. สะโพก, all สะโพก blocks go to A
  const SLIDE_WIP_GROUP = 'กลุ่ม WIP'
  const slideGroups: WorkforceRow[][] | null = tableName === 'สไลด์' && workers.length >= 2
    ? (() => {
        const wipOnly = workers.filter(w => {
          const jobInfo = jobAssignMap.get(normName(w.name))
          if (!jobInfo || jobInfo.groups.size === 0) return false
          return Array.from(jobInfo.groups.keys()).every(k => k === SLIDE_WIP_GROUP)
        })
        const nonWip = workers.filter(w => !wipOnly.includes(w))
        const sorted = [...nonWip].sort((a, b) => normName(a.name).localeCompare(normName(b.name)))
        const half = Math.ceil(sorted.length / 2)
        const groups: WorkforceRow[][] = [sorted.slice(0, half), sorted.slice(half)]
        if (wipOnly.length > 0) groups.push(wipOnly)  // group index 2 = WIP group
        return groups
      })()
    : null
  // product group → slide group index (0 or 1); set on first block of each product group
  const slideGroupProductMap = new Map<string, number>()

  const pushSkip = (block: SkuBlock, reason: string, extra?: Record<string, unknown>) => {
    if (!debugSkips) return
    debugSkips.push({
      tableName, sku: block.rawSku, skuName: block.skuName, productGroup: block.productGroup,
      totalQty: block.totalQty, rate: block.rate, isDeficit: block.isDeficit, reason,
      workersInTable: workers.length,
      workerFreeAt: workers.map(w => ({ name: w.name, freeAt: workerFreeAtMins.get(normName(w.name)) ?? null })),
      ...extra,
    })
  }

  // 4. Allocate per SKU block.
  // Own-station blocks use a synchronized start (all selected workers start at the same time).
  // Cross-station blocks (e.g. ซี่โครง processed by สามชั้น workers) each worker starts
  // independently at their own freeAt — no global barrier — so early-finishing workers don't
  // sit idle waiting for slower colleagues before picking up cross-station work.
  for (const block of skuBlocks) {
    const isOwnBlock = (STATION_TABLE[block.station] ?? block.station) === tableName

    const normSku  = block.normSku
    const numBags  = Math.floor(block.totalQty / block.wpb)
    if (numBags < 1) { pushSkip(block, 'numBags<1'); continue }

    const maxW         = tableName === 'หมูบด' ? Infinity : getMaxWorkers(normSku)
    const specialTime  = specialTimeMap.get(block.rawSku) ?? specialTimeMap.get(normSku)
    const specialStart = specialTime?.startMins ?? null
    const specialStop  = specialTime?.stopMins  ?? null
    const limitEnd     = specialStop !== null ? Math.min(phaseEndMins, specialStop) : phaseEndMins

    let eligible: WorkforceRow[]
    let selected: WorkforceRow[]

    if (slideGroups) {
      // Route WIP blocks to WIP group (index 2); non-WIP blocks to groups 0 & 1
      const hasWipGroup = slideGroups.length >= 3
      const isWipBlock  = block.productGroup === SLIDE_WIP_GROUP
      const groupSubset = hasWipGroup && isWipBlock
        ? [slideGroups[2]]
        : slideGroups.slice(0, 2)

      let chosenGroupIdx: number
      if (!isWipBlock && groupSubset.length >= 2) {
        // Sticky product-group routing: group 1 & 2 each get exclusive product groups
        const existingIdx = slideGroupProductMap.get(block.productGroup)
        if (existingIdx !== undefined && existingIdx < groupSubset.length) {
          chosenGroupIdx = existingIdx
        } else {
          const groupFreeAt = groupSubset.map(g =>
            g.length > 0 ? Math.max(...g.map(w => workerFreeAtMins.get(normName(w.name)) ?? phaseStartMins)) : Infinity
          )
          chosenGroupIdx = groupFreeAt.indexOf(Math.min(...groupFreeAt))
          slideGroupProductMap.set(block.productGroup, chosenGroupIdx)
        }
      } else {
        // WIP block or single group: pick free soonest
        const groupFreeAt = groupSubset.map(g =>
          g.length > 0 ? Math.max(...g.map(w => workerFreeAtMins.get(normName(w.name)) ?? phaseStartMins)) : Infinity
        )
        chosenGroupIdx = groupFreeAt.indexOf(Math.min(...groupFreeAt))
      }

      eligible = groupSubset[chosenGroupIdx] ?? groupSubset[0]
      selected = eligible.filter(w => (workerFreeAtMins.get(normName(w.name)) ?? phaseStartMins) < limitEnd)
      if (!selected.length) { pushSkip(block, 'slideGroup_no_selected', { limitEnd }); continue }
    } else {
      // Eligible workers sorted: skill ASC → freeAt ASC
      // Exclude workers whose shift starts at or after limitEnd (e.g. กะ 2 in Phase 1)
      eligible = workers.filter(w => {
        const freeAt = workerFreeAtMins.get(normName(w.name)) ?? phaseStartMins
        return freeAt < limitEnd && isWorkerEligible(w, block.productGroup)
      })
      if (!eligible.length) eligible = workers.filter(w => (workerFreeAtMins.get(normName(w.name)) ?? phaseStartMins) < limitEnd)
      if (!eligible.length) {
        pushSkip(block, 'no_eligible_worker', {
          limitEnd,
          eligibleByGroup: workers.filter(w => isWorkerEligible(w, block.productGroup)).map(w => w.name),
        })
        continue
      }

      eligible.sort((a, b) => {
        const la = getWorkerSkillLevel(a, block.productGroup)
        const lb = getWorkerSkillLevel(b, block.productGroup)
        if (la !== lb) return la - lb
        const fa = workerFreeAtMins.get(normName(a.name)) ?? phaseStartMins
        const fb = workerFreeAtMins.get(normName(b.name)) ?? phaseStartMins
        return fa - fb
      })

      // Only include workers who can start before this phase ends (exclude e.g. กะ 2 in Phase 1)
      const canWork    = eligible.filter(w => (workerFreeAtMins.get(normName(w.name)) ?? phaseStartMins) < limitEnd)
      const selectPool = canWork.length > 0 ? canWork : eligible
      const numSelect  = Math.min(maxW === Infinity ? numBags : maxW, selectPool.length, numBags)
      selected         = selectPool.slice(0, numSelect)
    }

    // Own-station: synchronized start = latest freeAt among selected workers.
    // Cross-station: no global barrier; blockStart is the earliest freeAt (used only for
    // the feasibility skip check and overflow fallback reference).
    let blockStart = phaseStartMins
    if (isOwnBlock) {
      for (const w of selected)
        blockStart = Math.max(blockStart, workerFreeAtMins.get(normName(w.name)) ?? phaseStartMins)
      if (specialStart !== null) blockStart = Math.max(blockStart, specialStart)
      if (blockStart >= limitEnd) { pushSkip(block, 'blockStart>=limitEnd', { blockStart, limitEnd, specialStart, specialStop }); continue }
    } else {
      blockStart = selected.reduce(
        (min, w) => Math.min(min, workerFreeAtMins.get(normName(w.name)) ?? phaseStartMins),
        phaseEndMins,
      )
      if (specialStart !== null) blockStart = Math.max(blockStart, specialStart)
      // selected is already filtered to freeAt < limitEnd, so feasibility is guaranteed above
    }

    // Distribute bags equally; remainder goes to last worker
    // key = normSku (channels merged → one continuous block per worker)
    const base   = Math.floor(numBags / selected.length)
    const extra  = numBags - base * selected.length
    let overflow = 0

    for (let i = 0; i < selected.length; i++) {
      const w       = selected[i]
      const nameKey = normName(w.name)
      const bags    = base + (i < extra ? 1 : 0) + (i === selected.length - 1 ? overflow : 0)
      overflow = 0
      if (bags < 1) continue

      // Cross-station: each worker starts at their own freeAt (not synchronized with others)
      const effectiveStart = isOwnBlock
        ? blockStart
        : Math.max(workerFreeAtMins.get(nameKey) ?? phaseStartMins, specialStart ?? phaseStartMins)
      if (!isOwnBlock && effectiveStart >= limitEnd) { overflow += bags; continue }

      const segs = workerBusySegments.get(nameKey) ?? []
      const fit  = fitMaxBags(effectiveStart, bags, block.wpb, block.rate, segs, limitEnd)
      if (fit.bags < 1) { overflow += bags; continue }
      if (fit.bags < bags) overflow += bags - fit.bags

      const qty = fit.bags * block.wpb
      segs.push({ start: effectiveStart, end: fit.finish })
      workerBusySegments.set(nameKey, segs)
      workerFreeAtMins.set(nameKey, getWorkerFreeAt(nameKey, workerFreeAtMins, workerBusySegments, phaseStartMins))
      workerHours.set(nameKey, Math.max(0, (workerHours.get(nameKey) ?? 0) - qty / block.rate))

      const sqMap = workerSkuQty.get(nameKey) ?? new Map<string, number>()
      sqMap.set(normSku, (sqMap.get(normSku) ?? 0) + qty)
      workerSkuQty.set(nameKey, sqMap)

      const sdMap = workerSkuDeficit.get(nameKey) ?? new Map<string, boolean>()
      if (block.isDeficit) sdMap.set(normSku, true)
      workerSkuDeficit.set(nameKey, sdMap)

      const segRound = getRoundMins(effectiveStart, phaseRoundMins)
      const srMap = workerSkuRoundQty.get(nameKey) ?? new Map<string, Map<number, number>>()
      const rMap  = srMap.get(normSku) ?? new Map<number, number>()
      rMap.set(segRound, (rMap.get(segRound) ?? 0) + qty)
      srMap.set(normSku, rMap)
      workerSkuRoundQty.set(nameKey, srMap)

      const seMap = workerSkuEarliestStart.get(nameKey) ?? new Map<string, number>()
      if (!seMap.has(normSku) || effectiveStart < (seMap.get(normSku) ?? Infinity))
        seMap.set(normSku, effectiveStart)
      workerSkuEarliestStart.set(nameKey, seMap)

      if (!skuAssignedWorkers.has(normSku)) skuAssignedWorkers.set(normSku, new Set())
      skuAssignedWorkers.get(normSku)!.add(nameKey)
    }

    // Fallback: spread remaining overflow across eligible workers, taking whatever
    // partial amount fits in each one's remaining time rather than requiring the
    // whole overflow to fit on a single worker.
    if (overflow > 0) {
      const overflowStart = overflow
      for (const w of eligible) {
        if (overflow < 1) break
        const nameKey = normName(w.name)
        const segs    = workerBusySegments.get(nameKey) ?? []
        const startAt = isOwnBlock
        ? Math.max(blockStart, workerFreeAtMins.get(nameKey) ?? phaseStartMins)
        : Math.max(workerFreeAtMins.get(nameKey) ?? phaseStartMins, specialStart ?? phaseStartMins)
        const fit     = fitMaxBags(startAt, overflow, block.wpb, block.rate, segs, phaseEndMins)
        if (fit.bags < 1) continue

        const qty = fit.bags * block.wpb
        overflow -= fit.bags
        segs.push({ start: startAt, end: fit.finish })
        workerBusySegments.set(nameKey, segs)
        workerFreeAtMins.set(nameKey, getWorkerFreeAt(nameKey, workerFreeAtMins, workerBusySegments, phaseStartMins))
        workerHours.set(nameKey, Math.max(0, (workerHours.get(nameKey) ?? 0) - qty / block.rate))

        const sqMap = workerSkuQty.get(nameKey) ?? new Map<string, number>()
        sqMap.set(normSku, (sqMap.get(normSku) ?? 0) + qty)
        workerSkuQty.set(nameKey, sqMap)

        const srMap = workerSkuRoundQty.get(nameKey) ?? new Map<string, Map<number, number>>()
        const rMap  = srMap.get(normSku) ?? new Map<number, number>()
        rMap.set(getRoundMins(startAt, phaseRoundMins), (rMap.get(getRoundMins(startAt, phaseRoundMins)) ?? 0) + qty)
        srMap.set(normSku, rMap)
        workerSkuRoundQty.set(nameKey, srMap)

        const seMap = workerSkuEarliestStart.get(nameKey) ?? new Map<string, number>()
        if (!seMap.has(normSku) || startAt < (seMap.get(normSku) ?? Infinity))
          seMap.set(normSku, startAt)
        workerSkuEarliestStart.set(nameKey, seMap)

        if (!skuAssignedWorkers.has(normSku)) skuAssignedWorkers.set(normSku, new Set())
        skuAssignedWorkers.get(normSku)!.add(nameKey)
      }
      if (overflow > 0) {
        pushSkip(block, 'overflow_unassigned', { overflowBags: overflow, overflowStart, numBags, selectedCount: selected.length, eligibleCount: eligible.length })
      }
    }

    // สไลด์: sync all group members to the slowest finish time so no one starts
    // the next SKU before the whole group is done (handles 0-bag workers who were skipped)
    if (slideGroups) {
      const groupMaxFreeAt = Math.max(...eligible.map(w => workerFreeAtMins.get(normName(w.name)) ?? phaseStartMins))
      for (const w of eligible) {
        const nameKey = normName(w.name)
        const currentFreeAt = workerFreeAtMins.get(nameKey) ?? phaseStartMins
        if (currentFreeAt < groupMaxFreeAt) {
          const segs = workerBusySegments.get(nameKey) ?? []
          segs.push({ start: currentFreeAt, end: groupMaxFreeAt })
          workerBusySegments.set(nameKey, segs)
          workerFreeAtMins.set(nameKey, groupMaxFreeAt)
        }
      }
    }
  }

  // 4b. Any block (deficit or not) whose remainder never got bound to a real worker within
  // available time — e.g. all eligible workers were already booked by the time an LPT-sorted
  // block this small got its turn (section 4 sorts longest-processing-time first, so a
  // low-qty/short-duration block can reach the front of the queue only after every eligible
  // worker's time is already spoken for) — still queue it onto a real eligible worker instead
  // of silently dropping the row, so the shortfall stays visible in the Raw รอผลิต shortage
  // report. Doesn't touch workerFreeAtMins/workerBusySegments — this is backlog, not a real
  // timeslot.
  for (const block of skuBlocks) {
    const normSku = block.normSku
    let scheduledQty = 0
    for (const w of workers) {
      scheduledQty += workerSkuQty.get(normName(w.name))?.get(normSku) ?? 0
    }
    const remainder = block.totalQty - scheduledQty
    if (remainder <= 0.5 * block.wpb) continue
    const bags = Math.floor(remainder / block.wpb)
    if (bags < 1) continue
    const qty = bags * block.wpb

    let candidates = workers.filter(w => isWorkerEligible(w, block.productGroup))
    if (!candidates.length) candidates = workers
    if (!candidates.length) continue
    // Prefer a worker who doesn't already have a row for this SKU, to avoid merging
    // backlog qty into an existing real-time row and mislabeling it as deficit.
    const fresh = candidates.filter(w => !workerSkuQty.get(normName(w.name))?.has(normSku))
    const pool  = fresh.length ? fresh : candidates
    pool.sort((a, b) => {
      const la = getWorkerSkillLevel(a, block.productGroup)
      const lb = getWorkerSkillLevel(b, block.productGroup)
      if (la !== lb) return la - lb
      return (workerFreeAtMins.get(normName(a.name)) ?? phaseStartMins) - (workerFreeAtMins.get(normName(b.name)) ?? phaseStartMins)
    })
    const w = pool[0]
    const nameKey = normName(w.name)

    const sqMap = workerSkuQty.get(nameKey) ?? new Map<string, number>()
    sqMap.set(normSku, (sqMap.get(normSku) ?? 0) + qty)
    workerSkuQty.set(nameKey, sqMap)

    const sdMap = workerSkuDeficit.get(nameKey) ?? new Map<string, boolean>()
    sdMap.set(normSku, true)
    workerSkuDeficit.set(nameKey, sdMap)

    const srMap = workerSkuRoundQty.get(nameKey) ?? new Map<string, Map<number, number>>()
    const rMap  = srMap.get(normSku) ?? new Map<number, number>()
    rMap.set(phaseEndMins, (rMap.get(phaseEndMins) ?? 0) + qty)
    srMap.set(normSku, rMap)
    workerSkuRoundQty.set(nameKey, srMap)

    const seMap = workerSkuEarliestStart.get(nameKey) ?? new Map<string, number>()
    if (!seMap.has(normSku)) seMap.set(normSku, phaseEndMins)
    workerSkuEarliestStart.set(nameKey, seMap)

    if (!skuAssignedWorkers.has(normSku)) skuAssignedWorkers.set(normSku, new Set())
    skuAssignedWorkers.get(normSku)!.add(nameKey)
  }

  // 5. Build assignment records — one record per (worker, normSku), primary channel = largest qty
  const result: Record<string, unknown>[] = []
  for (const w of workers) {
    const nameKey = normName(w.name)
    const sqMap = workerSkuQty.get(nameKey)
    if (!sqMap) continue

    for (const [key, qty] of Array.from(sqMap.entries())) {
      if (qty < 0.1) continue
      const normSkuKey = key
      const block = skuBlockMap.get(normSkuKey)
      const sku       = block?.rawSku ?? normSkuKey
      const channel   = (block?.channels ?? []).reduce(
        (best, c) => c.qty > best.qty ? c : best,
        { channel: '', qty: -1, isDeficit: false }
      ).channel
      const isDeficit = workerSkuDeficit.get(nameKey)?.get(normSkuKey) ?? false
      const srMap = workerSkuRoundQty.get(nameKey)
      const rMap = srMap?.get(normSkuKey)

      const roundsNote = 'rounds:' + (rMap
        ? Array.from(rMap.entries())
            .map(([rm, q]) => `${rm}=${Math.round(q * 100) / 100}`).join(';')
        : '')

      const skuName = block?.skuName ?? targets.find(t => t.sku === sku)?.skuName ?? null

      const earliestStart = workerSkuEarliestStart.get(nameKey)?.get(normSkuKey) ?? phaseStartMins

      result.push({
        production_date: productionDate,
        table_name:      tableName,
        worker_code:     w.emp_id,
        worker_name:     w.name,
        sku,
        sku_name:        skuName,
        target_quantity: (() => {
          const normSku = String(sku).replace(/^0+/, '')
          const wpb = wpbMap.get(normSku) ?? wpbMap.get(String(sku)) ?? 0
          return wpb > 0 ? Math.floor(qty / wpb) * wpb : Math.round(qty * 100) / 100
        })(),
        unit:            'กก.',
        period,
        deadline_time:   minsToTimeStr(earliestStart),
        note:            roundsNote + '|concurrent',
        status:          'รอดำเนินการ',
        channel,
        is_deficit:      isDeficit,
      })
    }
  }

  return result
}

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

// ========== Supabase Paginated Fetch ==========

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

// Fetch all currently-live assignments for the given period(s), to deduct from Phase 2/3 targets.
// Mid Recal (partial regen) leaves multiple effective_from batches coexisting on purpose — the
// "already-started, kept" batch plus the newly-regenerated one are BOTH still live at once — so
// this must sum every batch for the period, not just the most recent effective_from (that used to
// silently drop whichever batch wasn't "latest", under-deducting Phase 1's true output).
// Scoped to this Special-line's own stations (STATION_TABLE) so a Basic-line generation (which
// writes its own table_name into the same production_assignments table) can't get summed in here.
const SPECIAL_STATIONS = Object.values(STATION_TABLE)

async function fetchLatestBatchAssignments(
  productionDate: string,
  periods: string[],
  deductMode: 'plan' | 'actual' | 'yield',
): Promise<{ sku: string; target_quantity: number; channel: string | null }[]> {
  const all: { sku: string; target_quantity: number; channel: string | null }[] = []
  for (const period of periods) {
    const filters: { col: string; op: 'eq' | 'in'; val: unknown }[] = [
      { col: 'production_date', op: 'eq', val: productionDate },
      { col: 'period',          op: 'eq', val: period },
      { col: 'table_name',      op: 'in', val: SPECIAL_STATIONS },
    ]
    if (deductMode === 'actual') filters.push({ col: 'status', op: 'eq', val: 'เสร็จแล้ว' })
    const rows = await fetchAll<{ sku: string; target_quantity: number; channel: string | null }>(
      'production_assignments', 'sku, target_quantity, channel', filters,
    )
    all.push(...rows)
  }
  return all
}

// ========== Checkpoint Scheduling ==========

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

// ========== Auto Withdrawal ==========

async function autoGenerateWithdrawal(productionDate: string, selectedPhase: number) {
  const periodMap: Record<string, string> = { '1': 'เช้า', '2': 'บ่าย', '3': 'ค่ำ' }
  const period = periodMap[String(selectedPhase)]
  if (!productionDate || !period) return

  const { data: rawMaterialRules } = await supabase
    .from('master_logic_calculation').select('row_data')
    .eq('calculation_type', 'Mas Raw Material').order('uploaded_at', { ascending: false })

  const rules: RawMaterialRule[] = (rawMaterialRules ?? [] as { row_data: Record<string, unknown> }[]).map((r: { row_data: Record<string, unknown> }) => {
    const data = (r.row_data ?? {}) as Record<string, any>
    return {
      productGroup: String(data['กลุ่มสินค้า'] ?? '').trim(),
      type:         String(data['ประเภท'] ?? '').trim(),
      d16:          String(data['D16'] ?? '').trim(),
      d17:          String(data['D17'] ?? '').trim(),
    }
  })

  const phaseStr = String(selectedPhase)
  const roundMinsConfig: Record<string, number[]> = { '1': [510, 600, 780], '2': [870], '3': [990, 1080, 1200] }
  const defaultStartMinsConfig: Record<string, number> = { '1': 510, '2': 870, '3': 990 }
  const roundMins = roundMinsConfig[phaseStr] ?? roundMinsConfig['1']

  const minsToTime = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`

  const normMatName = (s: string) => s.trim().toLowerCase().replace(/\s*-\s*/g, '-')

  const timeStrToMins = (t: string) => {
    const parts = String(t ?? '').split(':')
    return parseInt(parts[0] ?? '0') * 60 + parseInt(parts[1] ?? '0')
  }

  const parseRoundNote = (note: string | null): Map<number, number> => {
    const result = new Map<number, number>()
    if (!note) return result
    const cleanNote = note.split('|')[0]
    if (!cleanNote.startsWith('rounds:')) return result
    for (const part of cleanNote.replace('rounds:', '').split(';')) {
      const [rStr, qStr] = part.split('=')
      if (rStr && qStr) result.set(parseInt(rStr), parseFloat(qStr))
    }
    return result
  }

  interface LotInfo {
    spec_code: string; factory: string; prod_date: string
    available: number; to_withdraw: number; insufficient?: boolean
  }

  const parseSpecCode = (s: string): { factory: string; prod_date: string; sortKey: string } | null => {
    const m1 = s.match(/[A-Z]+(\d{2})(\d{2})(\d{2})/)
    if (m1) return { factory: m1[1], prod_date: `${m1[2]}/${m1[3]}`, sortKey: `${m1[3]}${m1[2]}` }
    const m2 = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})[A-Z]/)
    if (m2) return { factory: m2[1], prod_date: `${m2[3]}/${m2[2]}`, sortKey: `${m2[2]}${m2[3]}${m2[4]}` }
    return null
  }

  const allocateFIFOLocal = (
    lots: { spec_code: string; weight: number; factory: string; prod_date: string }[],
    needed: number,
  ): LotInfo[] => {
    const result: LotInfo[] = []
    let remaining = needed
    for (const lot of lots) {
      if (remaining <= 0.005) break
      if (lot.weight <= 0.005) continue
      const take = Math.min(remaining, lot.weight)
      result.push({ spec_code: lot.spec_code, factory: lot.factory, prod_date: lot.prod_date, available: Math.round(lot.weight * 100) / 100, to_withdraw: Math.round(take * 100) / 100 })
      lot.weight -= take
      remaining -= take
    }
    if (remaining > 0.005)
      result.push({ spec_code: '— ไม่เพียงพอ —', factory: '-', prod_date: '-', available: 0, to_withdraw: Math.round(remaining * 100) / 100, insufficient: true })
    return result
  }

  const { data: assignments, error: e1 } = await supabase
    .from('production_assignments')
    .select('table_name, sku, sku_name, target_quantity, deadline_time, note')
    .eq('production_date', productionDate).eq('period', period)
    .in('table_name', ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์', 'เผาขา', 'เลาะขา'])
  if (e1) throw new Error(`Fetch assignments error: ${e1.message}`)
  if (!assignments?.length) return

  const [noWithdrawalRes, mooMasterRes, mooWithdrawalRes, pickingUnitMooRes, philitTorKanRes, bomSpecialRes] = await Promise.all([
    supabase.from('no_withdrawal_skus').select('sap'),
    supabase.from('moo_chod_master').select('sap_code, fat_percent'),
    supabase.from('moo_chod_withdrawal_master')
      .select('ingredient_type, priority, sap_code, product_name, fat_percent')
      .order('ingredient_type').order('priority').order('id'),
    supabase.from('picking_unit_master').select('sap, weight_per_bag').limit(5000),
    supabase.from('mas_phlit_tor_kan').select('sap, source_station, dest_station'),
    supabase.from('bom_special').select('product_sap, raw_sap, yield_pct'),
  ])

  const wpbMapLocal = new Map<string, number>()
  for (const r of (pickingUnitMooRes.data ?? []) as { sap: string; weight_per_bag: number }[]) {
    const sap = String(r.sap ?? '').trim()
    const wpb = Number(r.weight_per_bag ?? 0)
    if (sap && wpb > 0) { wpbMapLocal.set(sap, wpb); wpbMapLocal.set(sap.replace(/^0+/, ''), wpb) }
  }

  const noWithdrawalSaps = new Set((noWithdrawalRes.data ?? [] as { sap: string | null }[]).map((r: { sap: string | null }) => String(r.sap ?? '').trim()))
  const philitTorKanMap = new Map<string, { source_station: string; dest_station: string }>()
  for (const r of (philitTorKanRes.data ?? []) as { sap: string | null; source_station: string | null; dest_station: string | null }[]) {
    const src = String(r.source_station ?? '').trim()
    const dst = String(r.dest_station   ?? '').trim()
    if (!src || !dst) continue
    const sapNorm = String(r.sap ?? '').replace(/^0+/, '').trim()
    const sapRaw  = String(r.sap ?? '').trim()
    if (sapNorm) philitTorKanMap.set(sapNorm, { source_station: src, dest_station: dst })
    if (sapRaw && sapRaw !== sapNorm) philitTorKanMap.set(sapRaw, { source_station: src, dest_station: dst })
  }
  const activeAssignments = (assignments as { sku: unknown; table_name: unknown; [k: string]: unknown }[]).filter(a => !noWithdrawalSaps.has(String(a.sku ?? '').trim()))
  if (!activeAssignments.length) return

  interface MooIng { ingredient_type: string; priority: number; sap_code: string | null; product_name: string; fat_percent: number }
  const normSku = (s: string) => String(s ?? '').trim().replace(/^0+/, '') || String(s ?? '').trim()
  const mooFatMap = new Map<string, number>()
  for (const r of mooMasterRes.data ?? []) {
    if (!r.sap_code) continue
    for (const c of [r.sap_code.trim(), normSku(r.sap_code)].filter(Boolean))
      mooFatMap.set(c, Number(r.fat_percent ?? 0))
  }
  const mooWithdrawalIngs = (mooWithdrawalRes.data ?? []) as MooIng[]
  const mooMeatIngs = mooWithdrawalIngs.filter(i => i.ingredient_type === 'เนื้อ')
  const mooFatIngs  = mooWithdrawalIngs.filter(i => i.ingredient_type === 'มัน')

  const isMooChōdSku = (a: { table_name: unknown; sku: unknown; [k: string]: unknown }) =>
    a.table_name === 'หมูบด' && mooFatMap.size > 0 &&
    (mooFatMap.has(normSku(String(a.sku ?? ''))) || mooFatMap.has(String(a.sku ?? '').trim()))

  const mooChōdAssignments = activeAssignments.filter(isMooChōdSku)
  const regularAssignments  = activeAssignments.filter(a => !isMooChōdSku(a))

  const finRoundMap = new Map<string, Map<number, number>>()
  const finNameMap  = new Map<string, string | null>()
  const skuSet      = new Set<string>()

  for (const a of regularAssignments) {
    const key = `${a.table_name}|||${a.sku}`
    if (!finRoundMap.has(key)) finRoundMap.set(key, new Map())
    finNameMap.set(key, (a.sku_name as string | null) ?? null)
    skuSet.add(a.sku as string)
    const roundQtys = finRoundMap.get(key)!
    const noteRounds = parseRoundNote(a.note as string | null)
    const tgtQty = Number(a.target_quantity)
    if (noteRounds.size > 0) {
      const totalNoteQty = Array.from(noteRounds.values()).reduce((s, v) => s + v, 0)
      for (const [rm, q] of Array.from(noteRounds.entries())) {
        const mappedRm = getRoundMins(rm, roundMins)
        const share = totalNoteQty > 0 ? (q / totalNoteQty) * tgtQty : tgtQty / noteRounds.size
        roundQtys.set(mappedRm, (roundQtys.get(mappedRm) ?? 0) + share)
      }
    } else {
      const startMins = a.deadline_time ? timeStrToMins(String(a.deadline_time)) : (defaultStartMinsConfig[phaseStr] ?? 480)
      const rm = getRoundMins(startMins, roundMins)
      roundQtys.set(rm, (roundQtys.get(rm) ?? 0) + tgtQty)
    }
  }

  const skus = Array.from(skuSet)
  const { data: bomRows, error: e2 } = await supabase
    .from('bom_items').select('product_sap, raw_sap, raw_name, yield_pct').in('product_sap', skus)
  if (e2) throw new Error(`Fetch BOM error: ${e2.message}`)

  const bomMap = new Map<string, { raw_sap: string; raw_name: string | null; yield_pct: number }[]>()
  for (const b of bomRows ?? []) {
    if (!b.raw_sap) continue
    const list = bomMap.get(b.product_sap) ?? []
    list.push({ raw_sap: b.raw_sap, raw_name: b.raw_name ?? null, yield_pct: b.yield_pct ?? 0 })
    bomMap.set(b.product_sap, list)
  }

  // bomSpecialMap for ผลิตต่อกัน min-yield calc: product_sap → { raw_sap, yield_pct }[]
  const bomSpecialMinMap = new Map<string, { raw_sap: string; yield_pct: number }[]>()
  for (const r of (bomSpecialRes.data ?? []) as { product_sap: string; raw_sap: string; yield_pct: number }[]) {
    const list = bomSpecialMinMap.get(r.product_sap) ?? []
    list.push({ raw_sap: r.raw_sap, yield_pct: r.yield_pct })
    bomSpecialMinMap.set(r.product_sap, list)
  }

  interface RawEntry { station: string; raw_sap: string; raw_name: string | null; qty: number; roundMins: number }
  const rawMap = new Map<string, RawEntry>()
  const rawToProducts = new Map<string, { sku: string; sku_name: string | null; qty: number; rawQty: number }[]>()
  const noBom: { station: string; sku: string; sku_name: string | null; qty: number; roundMins: number }[] = []

  for (const [finKey, roundQtys] of Array.from(finRoundMap.entries())) {
    const [station, sku] = finKey.split('|||')
    const sku_name = finNameMap.get(finKey) ?? null
    const boms = bomMap.get(sku)
    for (const [rm, finQty] of Array.from(roundQtys.entries())) {
      if (!boms?.length) { noBom.push({ station, sku, sku_name, qty: finQty, roundMins: rm }); continue }
      for (const b of boms) {
        const normBomRaw = b.raw_sap.replace(/^0+/, '')
        const isPhilitTorKanRaw = philitTorKanMap.has(normBomRaw) || philitTorKanMap.has(b.raw_sap)
        let effectiveYield = b.yield_pct
        if (isPhilitTorKanRaw && bomSpecialMinMap.size > 0) {
          const specialEntries = (bomSpecialMinMap.get(sku) ?? []).filter(e => e.raw_sap === b.raw_sap || e.raw_sap === normBomRaw)
          if (specialEntries.length > 0) {
            const yields = specialEntries.map(e => e.yield_pct).filter(y => y > 0)
            if (yields.length > 0) effectiveYield = Math.min(...yields)
          }
        }
        const rawQty = effectiveYield > 0 ? finQty / effectiveYield : finQty
        const rawKey = `${station}|||${b.raw_sap}|||${rm}`
        const cur = rawMap.get(rawKey)
        if (cur) { cur.qty += rawQty }
        else { rawMap.set(rawKey, { station, raw_sap: b.raw_sap, raw_name: b.raw_name, qty: rawQty, roundMins: rm }) }
        const prodList = rawToProducts.get(rawKey) ?? []
        prodList.push({ sku, sku_name, qty: finQty, rawQty })
        rawToProducts.set(rawKey, prodList)
      }
    }
  }

  const mooAllSaps = mooWithdrawalIngs.map(i => i.sap_code).filter(Boolean) as string[]
  const rawSaps = Array.from(new Set([...Array.from(rawMap.values()).map(v => v.raw_sap), ...mooAllSaps]))
  type StockRow = { material_code: string; material_name: string | null; spec_code: string; weight_total: number }
  const stockRows: StockRow[] = []

  const { data: stockUploadLog } = await supabase
    .from('upload_log').select('uploaded_at')
    .in('table_name', ['stock_0010', 'stock_20', 'stock_100'])
    .order('uploaded_at', { ascending: false }).limit(1).maybeSingle()
  const stockUploaded = !!stockUploadLog

  if (rawSaps.length > 0) {
    const [res0010, res20, res100] = await Promise.all([
      supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
      supabase.from('stock_100').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
    ])
    stockRows.push(...(res0010.data ?? []) as StockRow[], ...(res20.data ?? []) as StockRow[], ...(res100.data ?? []) as StockRow[])

    const foundCodes = new Set(stockRows.map(r => r.material_code))
    const missingNames = Array.from(new Set([
      ...Array.from(rawMap.values()).filter(v => !foundCodes.has(v.raw_sap)).map(v => v.raw_name).filter(Boolean) as string[],
      ...mooWithdrawalIngs.filter(i => !foundCodes.has(i.sap_code?.trim() ?? '')).map(i => i.product_name).filter(Boolean),
    ]))
    if (missingNames.length > 0) {
      const expandedNames = Array.from(new Set(missingNames.flatMap(n => [n, n.replace(/\s*-\s*/g, '-'), n.replace(/\s*-\s*/g, ' - ')])))
      const [res0010n, res20n, res100n] = await Promise.all([
        supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
        supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
        supabase.from('stock_100').select('material_code, material_name, spec_code, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
      ])
      stockRows.push(...(res0010n.data ?? []) as StockRow[], ...(res20n.data ?? []) as StockRow[], ...(res100n.data ?? []) as StockRow[])
    }
  }

  type LocalLotEntry = { spec_code: string; weight: number; factory: string; prod_date: string; sortKey: string }
  const lotAggCode = new Map<string, number>()
  const matCodeToName = new Map<string, string>()
  for (const row of stockRows) {
    if (!row.material_code || !row.spec_code) continue
    const k = `${row.material_code}|||${row.spec_code}`
    lotAggCode.set(k, (lotAggCode.get(k) ?? 0) + Number(row.weight_total))
    if (row.material_name) matCodeToName.set(row.material_code, row.material_name)
  }

  const stockByMat  = new Map<string, LocalLotEntry[]>()
  const stockByName = new Map<string, LocalLotEntry[]>()
  for (const [k, weight] of Array.from(lotAggCode.entries())) {
    const [matCode, spec_code] = k.split('|||')
    const parsed = parseSpecCode(spec_code)
    const lot: LocalLotEntry = { spec_code, weight, factory: parsed?.factory ?? '-', prod_date: parsed?.prod_date ?? '-', sortKey: parsed?.sortKey ?? spec_code }
    const codeList = stockByMat.get(matCode) ?? []; codeList.push(lot); stockByMat.set(matCode, codeList)
    const matName = matCodeToName.get(matCode)
    if (matName) { const nameKey = normMatName(matName); const nameList = stockByName.get(nameKey) ?? []; nameList.push(lot); stockByName.set(nameKey, nameList) }
  }
  for (const list of Array.from(stockByMat.values())) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  for (const list of Array.from(stockByName.values())) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  const allocateMooPriority = (
    demandKg: number,
    ings: MooIng[],
  ): { ing: MooIng; qty: number; lots: LotInfo[] }[] => {
    const result: { ing: MooIng; qty: number; lots: LotInfo[] }[] = []
    let remaining = demandKg
    const byPriority = new Map<number, MooIng[]>()
    for (const ing of ings) { const list = byPriority.get(ing.priority) ?? []; list.push(ing); byPriority.set(ing.priority, list) }
    for (const priority of Array.from(byPriority.keys()).sort((a, b) => a - b)) {
      if (remaining <= 0.005) break
      for (const ing of byPriority.get(priority)!) {
        if (remaining <= 0.005) break
        const sap = ing.sap_code?.trim() ?? ''
        const lots = sap
          ? (stockByMat.get(sap) ?? stockByMat.get(sap.replace(/^0+/, '')) ?? stockByName.get(normMatName(ing.product_name)) ?? [])
          : (stockByName.get(normMatName(ing.product_name)) ?? [])
        const avail = lots.reduce((s, l) => s + l.weight, 0)
        if (avail <= 0.005) continue
        const take = Math.min(remaining, avail)
        result.push({ ing, qty: take, lots: allocateFIFOLocal(lots, take) })
        remaining -= take
      }
    }
    if (remaining > 0.005) {
      const p3ing = (byPriority.get(3) ?? [])[0] ?? ings[ings.length - 1] ?? { ingredient_type: '?', priority: 3, sap_code: null, product_name: '— ไม่เพียงพอ —', fat_percent: 0 }
      result.push({ ing: p3ing, qty: remaining, lots: [{ spec_code: '— ไม่เพียงพอ —', factory: '-', prod_date: '-', available: 0, to_withdraw: Math.round(remaining * 100) / 100, insufficient: true }] })
    }
    return result
  }

  const rawItems = Array.from(rawMap.values())
    .sort((a, b) => a.roundMins - b.roundMins)
    .flatMap(({ station, raw_sap, raw_name, qty, roundMins }) => {
      const needed  = Math.round(qty * 100) / 100
      const nameKey = normMatName(raw_name ?? '')
      const lots    = stockByMat.get(raw_sap) ?? stockByName.get(nameKey)
      const rawKey  = `${station}|||${raw_sap}|||${roundMins}`

      if (!lots) {
        // WIP produced in-house: check mas ผลิตต่อกัน for source/dest station mapping
        const normSapRaw = raw_sap.replace(/^0+/, '')
        const philitTorKanEntry = philitTorKanMap.get(normSapRaw) ?? philitTorKanMap.get(raw_sap)
        const isPhilitTorKan    = !!philitTorKanEntry && station === philitTorKanEntry.dest_station
        if (isPhilitTorKan && needed > 0) {
          const sourceRound = Math.max(roundMins - 30, 510)
          const forProds    = rawToProducts.get(rawKey) ?? []
          return [
            { sku: raw_sap, sku_name: raw_name, quantity: needed, unit: 'กก.', work_station: philitTorKanEntry.dest_station,   note: `WIP จาก${philitTorKanEntry.source_station}`,         lots: [] as LotInfo[], for_products: forProds, withdrawal_round: minsToTime(roundMins) },
            { sku: raw_sap, sku_name: raw_name, quantity: needed, unit: 'กก.', work_station: philitTorKanEntry.source_station, note: `แผนผลิต WIP สำหรับ${philitTorKanEntry.dest_station}`, lots: [] as LotInfo[], for_products: forProds, withdrawal_round: minsToTime(sourceRound) },
          ]
        }

        // If stock was uploaded today but this material has no data → treat as zero stock (insufficient)
        const resolvedLots: LotInfo[] = stockUploaded
          ? [{ spec_code: '— ไม่เพียงพอ —', factory: '-', prod_date: '-', available: 0, to_withdraw: needed, insufficient: true }]
          : []
        const hasRealWithdrawal = resolvedLots.some(l => !l.insufficient && l.to_withdraw > 0.005)
        if (!hasRealWithdrawal) return []
        return [{
          sku: raw_sap, sku_name: raw_name, quantity: needed, unit: 'กก.', work_station: station,
          note: 'คำนวณจาก BOM',
          lots: resolvedLots,
          for_products: rawToProducts.get(rawKey) ?? [],
          withdrawal_round: minsToTime(roundMins),
        }]
      }

      // Has stock — normal FIFO allocation
      const resolvedLots = allocateFIFOWithRules(raw_name ?? '', lots, rawToProducts.get(rawKey) ?? [], rules)
      const hasRealWithdrawal = resolvedLots.some(l => !l.insufficient && l.to_withdraw > 0.005)
      if (!hasRealWithdrawal) return []

      return [{
        sku: raw_sap, sku_name: raw_name, quantity: needed, unit: 'กก.', work_station: station,
        note: 'คำนวณจาก BOM',
        lots: resolvedLots,
        for_products: rawToProducts.get(rawKey) ?? [],
        withdrawal_round: minsToTime(roundMins),
      }]
    })

  const noBomItems = noBom.map(({ station, sku, sku_name, qty, roundMins }) => ({
    sku, sku_name, quantity: Math.round(qty * 100) / 100, unit: 'กก.', work_station: station,
    note: 'ไม่พบ BOM — ใช้ปริมาณผลิตโดยตรง',
    lots: [] as LotInfo[], for_products: [] as { sku: string; sku_name: string | null; qty: number }[],
    withdrawal_round: minsToTime(roundMins),
  }))

  // ── หมูบด priority path ───────────────────────────────────────
  const mooItems: (typeof rawItems[0])[] = []

  if (mooChōdAssignments.length > 0 && mooWithdrawalIngs.length > 0) {
    // Stock for หมูบด ingredients is now loaded into the shared stockByMat/stockByName maps
    // (ingredient SAPs were added to rawSaps before the stock query above)

    // Group assignments by SKU — multiple worker rows must be combined into one demand
    const mooChōdBySku = new Map<string, typeof mooChōdAssignments>()
    for (const a of mooChōdAssignments) {
      const k = String(a.sku ?? '')
      const list = mooChōdBySku.get(k) ?? []
      list.push(a)
      mooChōdBySku.set(k, list)
    }

    // Collect ALL (sku, round) demand entries across every SKU first,
    // then sort globally by round time so 8am of all SKUs is processed before 10am of any SKU.
    // This ensures stock depletion is correctly sequential across rounds regardless of SKU order.
    type MooDemandEntry = {
      skuStr: string; sku_name: string | null; totalKg: number
      rm: number; fatKg: number; meatKg: number
    }
    const allMooDemands: MooDemandEntry[] = []

    for (const [skuStr, skuAssignments] of Array.from(mooChōdBySku.entries())) {
      const fatPct = mooFatMap.get(normSku(skuStr)) ?? mooFatMap.get(skuStr.trim()) ?? 0

      const skuRoundDemand = new Map<number, { fatKg: number; meatKg: number }>()
      for (const a of skuAssignments) {
        const kgThis    = Number(a.target_quantity)   // already in กก.
        const noteRounds = parseRoundNote(a.note as string | null)
        if (noteRounds.size > 0) {
          for (const [rm, q] of Array.from(noteRounds.entries())) {
            const mappedRm = getRoundMins(rm, roundMins)
            const cur = skuRoundDemand.get(mappedRm) ?? { fatKg: 0, meatKg: 0 }
            cur.fatKg  += q * fatPct / 100
            cur.meatKg += q * (1 - fatPct / 100)
            skuRoundDemand.set(mappedRm, cur)
          }
        } else {
          const startMins = a.deadline_time ? timeStrToMins(String(a.deadline_time)) : (defaultStartMinsConfig[phaseStr] ?? 480)
          const mappedRm = getRoundMins(startMins, roundMins)
          const cur = skuRoundDemand.get(mappedRm) ?? { fatKg: 0, meatKg: 0 }
          cur.fatKg  += kgThis * fatPct / 100
          cur.meatKg += kgThis * (1 - fatPct / 100)
          skuRoundDemand.set(mappedRm, cur)
        }
      }

      const totalKg  = skuAssignments.reduce((s, a) => s + Number(a.target_quantity), 0)
      const sku_name = (skuAssignments[0].sku_name as string | null) ?? null
      for (const [rm, demand] of Array.from(skuRoundDemand.entries())) {
        allMooDemands.push({ skuStr, sku_name, totalKg, rm, fatKg: demand.fatKg, meatKg: demand.meatKg })
      }
    }

    // Sort by round time → stock depletion is chronological across all SKUs
    allMooDemands.sort((a, b) => a.rm - b.rm)

    for (const { skuStr, sku_name, totalKg, rm, fatKg, meatKg } of allMooDemands) {
      const forProduct = [{ sku: skuStr, sku_name, qty: totalKg, rawQty: totalKg }]
      const fatAllocs  = fatKg  > 0.005 ? allocateMooPriority(fatKg,  mooFatIngs)  : []
      const meatAllocs = meatKg > 0.005 ? allocateMooPriority(meatKg, mooMeatIngs) : []
      for (const { ing, lots } of [...fatAllocs, ...meatAllocs]) {
        if (!lots.some(l => !l.insufficient && l.to_withdraw > 0.005)) continue
        const qty = lots.reduce((s, l) => s + l.to_withdraw, 0)
        mooItems.push({
          sku:              ing.sap_code ?? ing.product_name,
          sku_name:         ing.product_name,
          quantity:         Math.round(qty * 100) / 100,
          unit:             'กก.',
          work_station:     'หมูบด',
          note:             `หมูบด — กลุ่ม${ing.ingredient_type} P${ing.priority}`,
          lots,
          for_products:     forProduct,
          withdrawal_round: minsToTime(rm),
        })
      }
    }
  }

  const items = [...rawItems, ...noBomItems, ...mooItems].sort((a, b) =>
    a.withdrawal_round.localeCompare(b.withdrawal_round) ||
    (a.work_station ?? '').localeCompare(b.work_station ?? '') ||
    (a.sku ?? '').localeCompare(b.sku ?? '')
  )

  const encodeFPTag = (products: { sku: string; sku_name: string | null; qty: number }[]) => {
    if (!products.length) return ''
    return `[FP:${products.map(p => `${p.sku}~${(p.sku_name ?? '').replace(/[|~[\]]/g, ' ')}~${p.qty}`).join('|')}] `
  }

  const flatItems = items.flatMap(item => {
    const fpTag = encodeFPTag(item.for_products ?? [])
    const roundPrefix = item.withdrawal_round ? `[Round: ${item.withdrawal_round}] ` : ''
    if (!item.lots?.length) return [{ sku: item.sku, sku_name: item.sku_name, quantity: item.quantity, unit: item.unit, work_station: item.work_station, note: `${roundPrefix}${fpTag}${item.note ?? ''}` }]
    return item.lots.map(lot => ({
      sku: item.sku, sku_name: item.sku_name, quantity: lot.to_withdraw, unit: item.unit, work_station: item.work_station,
      note: lot.insufficient
        ? `${roundPrefix}${fpTag}ไม่เพียงพอในสต็อก (ขาด ${lot.to_withdraw} กก.)`
        : `${roundPrefix}${fpTag}Lot: ${lot.spec_code} | รร.${lot.factory} | ผลิต ${lot.prod_date}`,
    }))
  })

  if (!flatItems.length) return

  await supabase.from('withdrawal_requests').delete()
    .eq('request_date', productionDate).eq('phase', selectedPhase)

  const records = flatItems.map(r => ({
    request_date: productionDate,
    phase:        selectedPhase,
    sku:          String(r.sku ?? '').trim(),
    sku_name:     String(r.sku_name ?? '').trim() || null,
    quantity:     Number(r.quantity ?? 0),
    unit:         String(r.unit ?? 'ชิ้น').trim(),
    work_station: String(r.work_station ?? '').trim() || null,
    note:         String(r.note ?? '').trim() || null,
  })).filter(r => r.sku)

  const { error: insertErr } = await supabase.from('withdrawal_requests').insert(records)
  if (insertErr) throw new Error(`Insert withdrawal requests error: ${insertErr.message}`)
}

// ========== Main Entry Point ==========

export async function generatePlan(params: GeneratePlanParams): Promise<GeneratePlanResult> {
  const defaultDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const productionDate: string = params.date ?? defaultDate
  const selectedPhase: number = params.phase ? Number(params.phase) : 1
  const deductMode: 'plan' | 'actual' | 'yield' =
    params.deductMode === 'actual' || params.deductMode === 'yield' ? params.deductMode : 'plan'
  const disableMidRecal = params.disableMidRecal ?? false

  const isPhase2 = selectedPhase === 2
  const isPhase3 = selectedPhase === 3

  // Temporary debug capture: records why a non-deficit SKU block in allocateBalanced
  // ended up with zero (or partial) worker time, surfaced via debug_skips in the API response.
  const debugSkips: Record<string, unknown>[] = []

  const phaseCfg = PHASE_CONFIG.find(p => p.phase === selectedPhase)
  if (!phaseCfg) return { success: false, message: 'Phase ไม่ถูกต้อง' }

  // Checkpoint scheduling
  const now = new Date()
  const { data: latestAssign } = await supabase
    .from('production_assignments').select('effective_from')
    .eq('production_date', productionDate).eq('period', phaseCfg.period)
    .in('table_name', SPECIAL_STATIONS)
    .lte('effective_from', now.toISOString())
    .order('effective_from', { ascending: false }).limit(1).maybeSingle()

  const useRegen = !disableMidRecal && !!latestAssign?.effective_from && selectedPhase === 1
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

  const [
    wmTodayRaw, wmHistRaw,
    lotusTodayRaw, lotusHistRaw,
    makroTodayRaw, makroHistRaw,
    fsTodayRaw,
    { data: masterProdRaw },
    { data: masterChannelRaw },
    prevAssignedRaw, yieldBagsRaw,
    plan100Raw,
    { data: pickingUnitRaw },
    { data: masterSpecialRaw },
    { data: masterVarLotusRaw },
    { data: masterVarWMRaw },
    { data: masterVarMakroRaw },
    { data: oldAssignmentsRaw },
    { data: quotasRaw },
    { data: concurrentSkuRaw },
    bkpOrdersRaw,
  { data: mooChōdMasterRaw },
  ] = await Promise.all([
    fetchLatestOrders('wet_market_orders', [productionDate], ['1400']),
    fetchLatestOrders('wet_market_orders', histDates, ['1600']),
    fetchLatestOrders('lotus_orders', [productionDate], ['1400']),
    fetchLatestOrders('lotus_orders', histDates, ['1600']),
    fetchLatestOrders('makro_orders', [productionDate], [orderRound]),
    fetchLatestOrders('makro_orders', histDates, ['1400']),
    fetchLatestOrders('fs_orders', [productionDate], ['0800'])
      .catch(() => [] as OrderRow[]),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas Productivity').order('uploaded_at', { ascending: false }).limit(5000),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas Channel').order('uploaded_at', { ascending: false }).limit(5000),
    (isPhase2 || isPhase3) && deductMode !== 'yield'
      ? fetchLatestBatchAssignments(productionDate, isPhase3 ? ['เช้า', 'บ่าย'] : ['เช้า'], deductMode)
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
      .eq('calculation_type', 'Mas Special').order('uploaded_at', { ascending: false }).limit(5000),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas %Variance LOTUS').order('uploaded_at', { ascending: false }).limit(5000),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas %Variance Wet Market').order('uploaded_at', { ascending: false }).limit(5000),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas %Variance Makro').order('uploaded_at', { ascending: false }).limit(5000),
    useRegen
      ? supabase.from('production_assignments').select('*')
          .eq('production_date', productionDate).eq('period', phaseCfg.period)
          .in('table_name', SPECIAL_STATIONS)
          .eq('effective_from', latestAssign.effective_from)
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase.from('channel_quotas').select('sku, quantity')
      .eq('quota_date', productionDate).eq('channel', 'Wet Market'),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas Sku ผลิตพร้อมกัน').order('uploaded_at', { ascending: false }).limit(5000),
    fetchAll<{ sku: string; sku_name: string | null; quantity: number }>(
      'bkp_orders', 'sku, sku_name, quantity',
      [{ col: 'production_date', op: 'eq', val: productionDate }])
      .catch(() => [] as { sku: string; sku_name: string | null; quantity: number }[]),
    supabase.from('moo_chod_master').select('sap_code, fat_percent').limit(5000),
  ])

  const { workforce, jobAssignMap, workDateUsed } = await fetchWorkforceAndSkills(productionDate, {
    fallbackToPreviousDay: params.useFallbackWorkforce,
  })
  if (!workforce.length) return {
    success: false,
    message: 'ไม่พบข้อมูลพนักงานวันนี้ — กรุณาตรวจสอบ Sync ข้อมูลพนักงาน 8:05',
  }
  const workforceFallbackNote = workDateUsed !== productionDate
    ? ` (ใช้ข้อมูลกำลังคนของวันที่ ${workDateUsed} แทน เนื่องจากยังไม่มีข้อมูลวันนี้)`
    : ''

  const wmToday    = (wmTodayRaw    ?? []) as OrderRow[]
  const wmHist     = (wmHistRaw     ?? []) as OrderRow[]
  const lotusToday = (lotusTodayRaw ?? []) as OrderRow[]
  const lotusHist  = (lotusHistRaw  ?? []) as OrderRow[]
  const makroToday = (makroTodayRaw ?? []) as OrderRow[]
  const makroHist  = (makroHistRaw  ?? []) as OrderRow[]
  const fsToday    = (fsTodayRaw    ?? []) as OrderRow[]

  const quotaMap = new Map<string, number>()
  for (const q of (quotasRaw ?? []) as { sku: string; quantity: number }[]) {
    const sku = String(q.sku).replace(/^0+/, '')
    quotaMap.set(sku, Number(q.quantity))
  }

  if (isPhase3) {
    if (!(plan100Raw ?? []).length)
      return { success: false, message: 'ไม่พบแผนผลิต 100% วันนี้ — กรุณาอัพโหลดก่อน' }
  } else {
    const hasBkpOrders = (bkpOrdersRaw ?? []).length > 0
    const hasOrders = isPhase2
      ? (wmToday.length || lotusToday.length || makroToday.length || hasBkpOrders || fsToday.length)
      : (wmHist.length  || lotusHist.length  || makroToday.length || hasBkpOrders || fsToday.length)
    if (!hasOrders) return {
      success: false,
      message: `ไม่พบข้อมูล${isPhase2 ? `Order รอบ ${orderRound}` : 'ย้อนหลัง 7 วันของ Wet Market หรือ Order'} วันนี้ (Wet Market / LOTUS / Makro / BKP / FS) — กรุณาอัพโหลดก่อน`,
    }
  }

  // mooChōd SKU set — skip BOM deficit check for these (withdrawal uses priority logic instead)
  const mooChōdSapSet     = new Set<string>()
  const mooChōd50PctSapSet = new Set<string>() // fat_percent = 50 → produce last in phase
  for (const r of (mooChōdMasterRaw ?? []) as { sap_code: string | null; fat_percent?: number | null }[]) {
    const s = String(r.sap_code ?? '').trim()
    if (!s) continue
    mooChōdSapSet.add(s); mooChōdSapSet.add(s.replace(/^0+/, ''))
    if (Number(r.fat_percent ?? 0) === 50) {
      mooChōd50PctSapSet.add(s); mooChōd50PctSapSet.add(s.replace(/^0+/, ''))
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

  // Parse Excel time
  const parseExcelTime = (val: unknown): number | null => {
    if (val === null || val === undefined || val === '') return null
    if (typeof val === 'string') {
      const str = val.trim()
      if (str.includes('T')) {
        const d = new Date(str)
        if (!isNaN(d.getTime())) {
          const localMs = d.getTime() + (6 * 3600 + 42 * 60 + 4) * 1000
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

  // Concurrent SKU pairs: Sap ที่ 1 (primary) runs simultaneously with Sap ที่ 2 (secondary).
  // primaryMap: primary_sku → Set<secondary_sku>
  const primaryMap = new Map<string, Set<string>>()
  const primarySkuSet = new Set<string>()
  const secondarySkuSet = new Set<string>()
  const getConcCol = (r: Record<string, unknown>, name: string): string => {
    if (r[name] !== undefined) return String(r[name] ?? '').trim()
    const key = Object.keys(r).find(k => k.trim() === name || k.replace(/\s+/g, ' ').trim() === name)
    return key ? String(r[key] ?? '').trim() : ''
  }
  for (const row of concurrentSkuRaw ?? []) {
    const r = row.row_data as Record<string, unknown>
    // Column names: "Sap ตั้งต้น" (primary) / "Sap ผลพลอยได้" (secondary)
    // Fallback to legacy names "Sap ที่ 1" / "Sap ที่ 2" for backwards compatibility
    const sap1 = (getConcCol(r, 'Sap ตั้งต้น') || getConcCol(r, 'Sap ที่ 1')).replace(/^0+/, '')
    const sap2 = (getConcCol(r, 'Sap ผลพลอยได้') || getConcCol(r, 'Sap ที่ 2')).replace(/^0+/, '')
    if (!sap1 || !sap2) continue
    if (!primaryMap.has(sap1)) primaryMap.set(sap1, new Set())
    primaryMap.get(sap1)!.add(sap2)
    primarySkuSet.add(sap1)
    secondarySkuSet.add(sap2)
  }
  // Reverse map: secondary → Set<primary> (for lookup)
  const secondaryToPrimaries = new Map<string, Set<string>>()
  for (const [pSku, sSkus] of Array.from(primaryMap.entries())) {
    for (const sSku of sSkus) {
      if (!secondaryToPrimaries.has(sSku)) secondaryToPrimaries.set(sSku, new Set())
      secondaryToPrimaries.get(sSku)!.add(pSku)
    }
  }

  // Parse master data
  const productivity: ProductivityRow[] = masterProdRaw?.length
    ? parseProductivity((masterProdRaw as { row_data: Record<string, unknown> }[]).map(r => r.row_data)) : []

  const skuMap = new Map<string, ProductivityRow>()
  for (const p of productivity) {
    if (!skuMap.has(p.sku))                    skuMap.set(p.sku, p)
    if (!skuMap.has(p.sku.replace(/^0+/, ''))) skuMap.set(p.sku.replace(/^0+/, ''), p)
  }

  // Build BKP order map and inject station/group overrides into skuMap
  const bkpOrderMap = new Map<string, { qty: number; name: string | null }>()
  for (const r of (bkpOrdersRaw ?? []) as { sku: string; sku_name: string | null; quantity: number }[]) {
    const sku = String(r.sku ?? '').replace(/^0+/, '')
    if (!sku) continue
    const cur = bkpOrderMap.get(sku) ?? { qty: 0, name: r.sku_name ?? null }
    cur.qty += Number(r.quantity) || 0
    bkpOrderMap.set(sku, cur)
  }
  for (const [sku, order] of Array.from(bkpOrderMap.entries())) {
    const existing = skuMap.get(sku) ?? skuMap.get(sku.padStart(8, '0'))
    const override: ProductivityRow = {
      station:       'ไหล่พิเศษ',
      product_group: 'กลุ่ม BKP',
      sku,
      sku_name:      order.name ?? existing?.sku_name ?? '',
      rate:          existing?.rate ?? 27.0,
    }
    skuMap.set(sku, override)
    skuMap.set(sku.padStart(8, '0'), override)
  }

  const lotusVarianceMap = new Map<string, number>()
  for (const row of masterVarLotusRaw ?? []) {
    const r = normalizeRow(row.row_data as Record<string, unknown>)
    const rawStation = normalizeStation(String(r['จุดงาน'] ?? r['Station'] ?? '').trim())
    const station = STATION_TABLE[rawStation] ?? rawStation
    let pct = Number(r['%Variance'] ?? 0)
    if (pct > 1) pct = pct / 100
    if (station && pct > 0) lotusVarianceMap.set(station, pct)
  }

  // Parse WM variance params: [nonSharedHigh, nonSharedLow, sharedHigh, sharedLow]
  let wmVarParams: [number, number, number, number] | undefined
  for (const row of masterVarWMRaw ?? []) {
    const vals = Object.values(row.row_data as Record<string, unknown>)
    if (vals.some(v => String(v ?? '').trim() === '%Variance')) {
      const nums = vals.filter(v => typeof v === 'number').map(v => v > 1 ? v / 100 : v) as number[]
      if (nums.length >= 4) { wmVarParams = [nums[0], nums[1], nums[2], nums[3]]; break }
    }
  }

  // Parse Makro variance params: [phTL, phTM, phTH, plTL, plTM, plTH]
  // ph=proportion>10%, pl=proportion<=10%; TL=trend<=80%, TM=trend>80-100%, TH=trend>100%
  let makroVarParams: [number, number, number, number, number, number] | undefined
  for (const row of masterVarMakroRaw ?? []) {
    const vals = Object.values(row.row_data as Record<string, unknown>)
    if (vals.some(v => String(v ?? '').trim() === '%Variance')) {
      const nums = vals.filter(v => typeof v === 'number').map(v => v > 1 ? v / 100 : v) as number[]
      if (nums.length >= 6) { makroVarParams = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]]; break }
    }
  }

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

  // Workers by station
  const workersByStation: Record<string, WorkforceRow[]> = {}
  for (const w of workforce) {
    const rawStation = normalizeStation(w.work_station ?? '')
    const station = STATION_TABLE[rawStation] ?? rawStation
    if (!station) continue
    workersByStation[station] ??= []
    workersByStation[station].push(w)
  }

  const phaseStartMins = phaseCfg.startH * 60
  const phaseEndMins   = phaseCfg.endH   * 60

  const currentWorkforceNames = new Set(workforce.map((w: WorkforceRow) => normName(w.name)))

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

  // Historical averages
  const avgWM    = buildAvgMap(wmHist)
  const avgLotus = buildAvgMap(lotusHist)
  const avgMakro = buildAvgMap(makroHist)

  const phase1Assigned  = new Map<string, number>()
  const phase1ByChannel = new Map<string, Map<string, number>>()
  const useChannelDeduct = deductMode !== 'yield'

  const wpbMap = new Map<string, number>()
  for (const r of pickingUnitRaw ?? [])
    wpbMap.set(r.sap.replace(/^0+/, ''), r.weight_per_bag ?? 0)

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
  // If Phase 1 produced for channels with no Phase 2/3 order, that production is credited
  // against other channels so we don't over-produce in the aggregate.
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
  const fsMap    = aggregateToday(fsToday)

  // Build targets per channel
  const buildWetMarketTargets = (): SkuTarget[] => {
    const ch = 'Wet Market'
    if (isPhase2) {
      const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
      return Object.entries(wmMap).map(([sku, { qty: orderQty, name }]) => {
        const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, '')) ?? 0
        const p1Actual = p1.get(sku) ?? 0
        let targetQty: number
        if (wpb > 0) {
          targetQty = Math.floor(Math.max(0, orderQty - p1Actual) / wpb) * wpb
        } else {
          targetQty = Math.max(0, orderQty - p1Actual)
        }
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
        let targetQty: number
        if (wpb > 0) {
          targetQty = Math.floor(Math.max(0, orderQty - p1Actual) / wpb) * wpb
        } else {
          targetQty = Math.max(0, orderQty - p1Actual)
        }
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
      const avg7d = avgMakro.get(sku) ?? 0
      const baggedOrderQty = roundDownToBag(sku, orderQty)
      // Makro = ยอดล่วงหน้า: SKUs with no historical avg (e.g. new SKUs, by-products) use full order qty
      if (avg7d === 0) return { sku, skuName: name, targetQty: baggedOrderQty, channel: ch }
      const variance = getMakroVariance(proportion > 0.1, orderQty, avg7d, makroVarParams)
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
        let targetQty: number
        if (wpb > 0) {
          targetQty = Math.floor(Math.max(0, orderQty - p1Actual) / wpb) * wpb
        } else {
          targetQty = Math.max(0, orderQty - p1Actual)
        }
        return { sku, skuName: name, targetQty, channel: ch }
      }).filter(s => s.targetQty > 0)
    }
    const lotusHistNames = new Map(lotusHist.map(r => [r.sku.replace(/^0+/, ''), r.sku_name]))
    return Array.from(avgLotus.entries())
      .map(([sku, avg]) => {
        const prod = skuMap.get(sku) ?? skuMap.get(sku.replace(/^0+/, ''))
        const rawStation = prod ? normalizeStation(prod.station) : ''
        const station = STATION_TABLE[rawStation] ?? rawStation
        const variance = lotusVarianceMap.size > 0 ? (lotusVarianceMap.get(station) ?? 1.0) : 1.0
        return { sku, skuName: lotusHistNames.get(sku) ?? null, targetQty: roundDownToBag(sku, roundDownToBag(sku, avg) * variance), channel: ch }
      }).filter(s => s.targetQty > 0)
  }

  function buildBKPTargets(): SkuTarget[] {
    if (isPhase2) {
      const p1 = useChannelDeduct ? (phase1ByChannel.get('BKP') ?? new Map()) : phase1Assigned
      return Array.from(bkpOrderMap.entries()).map(([sku, { qty: orderQty, name }]) => {
        const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, '')) ?? 0
        const p1Actual = p1.get(sku) ?? 0
        let targetQty: number
        if (wpb > 0) {
          targetQty = Math.floor(Math.max(0, orderQty - p1Actual) / wpb) * wpb
        } else {
          targetQty = Math.max(0, orderQty - p1Actual)
        }
        return { sku, skuName: name, targetQty, channel: 'BKP' }
      }).filter(t => t.targetQty > 0)
    }
    return Array.from(bkpOrderMap.entries()).map(([sku, { qty, name }]) => {
      const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, '')) ?? 0
      const targetQty = wpb > 0 ? Math.ceil(qty / wpb) * wpb : qty
      return { sku, skuName: name, targetQty, channel: 'BKP' }
    }).filter(t => t.targetQty > 0)
  }

  function buildFsTargets(): SkuTarget[] {
    const ch = 'FS'
    if (isPhase2) {
      const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
      return Object.entries(fsMap).map(([sku, { qty: orderQty, name }]) => {
        const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, '')) ?? 0
        const p1Actual = p1.get(sku) ?? 0
        let targetQty: number
        if (wpb > 0) {
          targetQty = Math.floor(Math.max(0, orderQty - p1Actual) / wpb) * wpb
        } else {
          targetQty = Math.max(0, orderQty - p1Actual)
        }
        return { sku, skuName: name, targetQty, channel: ch }
      }).filter(s => s.targetQty > 0)
    }
    // Phase 1: ใช้ยอดจริงทั้งหมด ไม่คูณ %variance
    return Object.entries(fsMap).map(([sku, { qty: orderQty, name }]) => {
      return { sku, skuName: name, targetQty: roundDownToBag(sku, orderQty), channel: ch }
    }).filter(s => s.targetQty > 0)
  }

  const channelTargets: Record<string, SkuTarget[]> = {
    'Wet Market': buildWetMarketTargets(),
    'Makro':      buildMakroTargets(),
    'LOTUS':      buildLotusTargets(),
    'BKP':        buildBKPTargets(),
    'FS':         buildFsTargets(),
  }

  // Phase 2: cap each SKU's total target across all channels so it doesn't exceed
  // (total raw order - phase 1 total produced), preventing over-production when Phase 1
  // assigned a channel that has no Phase 2 order (e.g. LOTUS in P1 but no LOTUS P2 order).
  if (isPhase2) {
    const p2RawBySku = new Map<string, number>()
    for (const [sku, { qty }] of Object.entries(wmMap))    p2RawBySku.set(sku, (p2RawBySku.get(sku) ?? 0) + qty)
    for (const [sku, { qty }] of Object.entries(makroMap)) p2RawBySku.set(sku, (p2RawBySku.get(sku) ?? 0) + qty)
    for (const [sku, { qty }] of Object.entries(lotusMap)) p2RawBySku.set(sku, (p2RawBySku.get(sku) ?? 0) + qty)
    for (const [sku, { qty }] of bkpOrderMap)              p2RawBySku.set(sku, (p2RawBySku.get(sku) ?? 0) + qty)
    for (const [sku, { qty }] of Object.entries(fsMap))    p2RawBySku.set(sku, (p2RawBySku.get(sku) ?? 0) + qty)
    crossChannelCap(channelTargets, p2RawBySku, activeChannels)
  }

  // Build assignment list
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
      let targetQty: number
      if (wpb > 0) {
        targetQty = Math.floor(Math.max(0, qty - p12Actual) / wpb) * wpb
      } else {
        targetQty = Math.max(0, qty - p12Actual)
      }
      return { sku, skuName: name, targetQty, channel }
    }).filter(t => t.targetQty > 0)

    // Append remaining WM/LOTUS/Makro that Phase 1+2 didn't fully cover
    if (wmToday.length || lotusToday.length || makroToday.length || fsToday.length) {
      const phase3Plan100Skus = new Set(allPhase3Targets.map(t => t.sku.replace(/^0+/, '')))
      const appendRemaining = (orderMap: Record<string, { qty: number; name: string | null }>, ch: string) => {
        for (const [sku, { qty: orderQty, name }] of Object.entries(orderMap)) {
          if (phase3Plan100Skus.has(sku)) continue
          const p12 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
          const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, '')) ?? 0
          const p12Actual = p12.get(sku) ?? 0
          let targetQty: number
          if (wpb > 0) {
            targetQty = Math.floor(Math.max(0, orderQty - p12Actual) / wpb) * wpb
          } else {
            targetQty = Math.max(0, orderQty - p12Actual)
          }
          if (targetQty > 0) allPhase3Targets.push({ sku, skuName: name, targetQty, channel: ch })
        }
      }
      appendRemaining(wmMap, 'Wet Market')
      appendRemaining(lotusMap, 'LOTUS')
      appendRemaining(makroMap, 'Makro')
      appendRemaining(fsMap, 'FS')

      // Phase 3: same cross-channel cap for appended (non-plan100) SKUs
      const p3RawBySku = new Map<string, number>()
      for (const [sku, { qty }] of Object.entries(wmMap))    p3RawBySku.set(sku, (p3RawBySku.get(sku) ?? 0) + qty)
      for (const [sku, { qty }] of Object.entries(makroMap)) p3RawBySku.set(sku, (p3RawBySku.get(sku) ?? 0) + qty)
      for (const [sku, { qty }] of Object.entries(lotusMap)) p3RawBySku.set(sku, (p3RawBySku.get(sku) ?? 0) + qty)
      for (const [sku, { qty }] of Object.entries(fsMap))    p3RawBySku.set(sku, (p3RawBySku.get(sku) ?? 0) + qty)
      const appendMap: Record<string, SkuTarget[]> = {}
      for (const t of allPhase3Targets) {
        if (phase3Plan100Skus.has(t.sku)) continue
        appendMap[t.channel] ??= []
        appendMap[t.channel].push(t)
      }
      if (Object.keys(appendMap).length > 0) {
        crossChannelCap(appendMap, p3RawBySku, activeChannels)
        for (let i = allPhase3Targets.length - 1; i >= 0; i--) {
          if (!phase3Plan100Skus.has(allPhase3Targets[i].sku) && allPhase3Targets[i].targetQty <= 0)
            allPhase3Targets.splice(i, 1)
        }
      }
    }

    const p3ChannelTargets: Record<string, SkuTarget[]> = {}
    for (const t of allPhase3Targets) { p3ChannelTargets[t.channel] ??= []; p3ChannelTargets[t.channel].push(t) }

    const channelsToProcess = [...activeChannels]
    for (const ch of Object.keys(p3ChannelTargets)) { if (!channelsToProcess.includes(ch)) channelsToProcess.push(ch) }
    assignList = channelsToProcess.flatMap(ch => (p3ChannelTargets[ch] ?? [])
      .sort((a, b) => b.targetQty - a.targetQty))
  } else {
    assignList = activeChannels.flatMap(ch => (channelTargets[ch] ?? [])
      .sort((a, b) => b.targetQty - a.targetQty))
  }

  // Filter to produceable SKUs
  assignList = assignList.filter(item => {
    const prod = skuMap.get(item.sku) ?? skuMap.get(item.sku.replace(/^0+/, ''))
    if (!prod) return false
    const station = STATION_TABLE[normalizeStation(prod.station)] ?? normalizeStation(prod.station)
    return (workersByStation[station] ?? []).length > 0
  })


  // Deduct kept assignments
  assignList = assignList.map(item => {
    const key = `${item.channel || ''}_${item.sku.replace(/^0+/, '')}`
    const newQty = Math.max(0, item.targetQty - (keptChannelQtyMap.get(key) ?? 0))
    return { ...item, targetQty: newQty }
  }).filter(item => item.targetQty > 0)

  // WIP full-production cap: populated inside split block, consumed in WIP plan block
  const wipFullCapBySap = new Map<string, number>() // SAP (raw) → max producible kg given raw pool

  // Stock-based splitting: run for every phase when stock data is available
  {
    const { data: stockPlanLog } = await supabase
      .from('upload_log').select('uploaded_at')
      .in('table_name', ['stock_0010', 'stock_20', 'stock_100'])
      .order('uploaded_at', { ascending: false }).limit(1).maybeSingle()
    const stockWasUploaded = !!stockPlanLog

    const { data: noWithdrawalRows } = await supabase.from('no_withdrawal_skus').select('sap')
    const noWithdrawalSaps = new Set((noWithdrawalRows ?? [] as { sap: string | null }[]).map((r: { sap: string | null }) => String(r.sap ?? '').trim()))

    const skusPadded = Array.from(new Set([...assignList.map(i => i.sku), ...assignList.map(i => i.sku.replace(/^0+/, ''))]))
    const { data: bomRows } = await supabase.from('bom_items').select('product_sap, raw_sap, raw_name, yield_pct').in('product_sap', skusPadded)

    const bomMap = new Map<string, { raw_sap: string; raw_name: string | null; yield_pct: number }[]>()
    for (const b of bomRows ?? []) {
      if (!b.raw_sap) continue
      const rawSap = b.raw_sap.replace(/^0+/, '')
      const prodSap = b.product_sap.replace(/^0+/, '')
      const list = bomMap.get(prodSap) ?? []
      list.push({ raw_sap: rawSap, raw_name: b.raw_name ?? null, yield_pct: b.yield_pct ?? 0 })
      bomMap.set(prodSap, list)
      bomMap.set(b.product_sap, list)
    }

    const rawSapsSet = new Set<string>()
    for (const item of assignList) {
      for (const b of bomMap.get(item.sku.replace(/^0+/, '')) ?? []) {
        rawSapsSet.add(b.raw_sap); rawSapsSet.add(b.raw_sap.replace(/^0+/, ''))
      }
    }

    type StockRow2 = { material_code: string; material_name: string | null; spec_code: string; weight_total: number }
    const stockRows: StockRow2[] = []
    const rawSaps2 = Array.from(rawSapsSet)

    if (rawSaps2.length > 0) {
      const [res0010, res20, res100] = await Promise.all([
        supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps2).gt('weight_total', 0),
        supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps2).gt('weight_total', 0),
        supabase.from('stock_100').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps2).gt('weight_total', 0),
      ])
      stockRows.push(...(res0010.data ?? []) as StockRow2[], ...(res20.data ?? []) as StockRow2[], ...(res100.data ?? []) as StockRow2[])

      const foundCodes = new Set(stockRows.map(r => r.material_code))
      const missingNames = Array.from(new Set(
        assignList.flatMap(item => (bomMap.get(item.sku.replace(/^0+/, '')) ?? []).map(b => b.raw_name).filter(Boolean) as string[])
          .filter(n => !foundCodes.has(n))
      ))
      if (missingNames.length > 0) {
        const expanded = Array.from(new Set(missingNames.flatMap(n => [n, n.replace(/\s*-\s*/g, '-'), n.replace(/\s*-\s*/g, ' - ')])))
        const [res0010n, res20n, res100n] = await Promise.all([
          supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_name', expanded).gt('weight_total', 0),
          supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_name', expanded).gt('weight_total', 0),
          supabase.from('stock_100').select('material_code, material_name, spec_code, weight_total').in('material_name', expanded).gt('weight_total', 0),
        ])
        stockRows.push(...(res0010n.data ?? []) as StockRow2[], ...(res20n.data ?? []) as StockRow2[], ...(res100n.data ?? []) as StockRow2[])
      }
    }

    const normMatNameLocal = (s: string) => s.trim().toLowerCase().replace(/\s*-\s*/g, '-')

    // Aggregate stock: lotAggCode["matCode|||specCode"] → weight, matCodeToName → display name
    const lotAggCode = new Map<string, number>()
    const matCodeToName = new Map<string, string>()
    for (const row of stockRows) {
      if (!row.material_code || !row.spec_code) continue
      const k = `${row.material_code}|||${row.spec_code}`
      lotAggCode.set(k, (lotAggCode.get(k) ?? 0) + Number(row.weight_total))
      if (row.material_name) matCodeToName.set(row.material_code, row.material_name)
    }

    // Build raw material pool: normName → totalKg available (also by matCode as fallback)
    const pool    = new Map<string, number>() // normName → totalKg
    const poolSap = new Map<string, number>() // matCode  → totalKg
    for (const [k, weight] of lotAggCode.entries()) {
      const [matCode] = k.split('|||')
      poolSap.set(matCode, (poolSap.get(matCode) ?? 0) + weight)
      const matName = matCodeToName.get(matCode)
      if (matName) { const nk = normMatNameLocal(matName); pool.set(nk, (pool.get(nk) ?? 0) + weight) }
    }

    const takeFromPoolLocal = (rawName: string, rawSap: string, amount: number): number => {
      const normKey = normMatNameLocal(rawName)
      const normAvail = pool.get(normKey)
      const sapAvail  = poolSap.get(rawSap)
      // Prefer normName; fall back to SAP code when normName not found
      if (normAvail !== undefined && normAvail > 0) {
        const taken = Math.min(amount, normAvail)
        pool.set(normKey, normAvail - taken)
        return taken
      }
      if (sapAvail !== undefined && sapAvail > 0) {
        const taken = Math.min(amount, sapAvail)
        poolSap.set(rawSap, sapAvail - taken)
        return taken
      }
      return 0
    }

    // ── Priority 1: pre-allocate WIP สไลด์ raw needs before other stations ──
    // Variables hoisted so the full-production allocation below can reuse them
    type WipAllocRow = { sap_code: string; quantity: number; wip_initial: number | null }
    type WipBomRow   = { product_sap: string; raw_sap: string; raw_name: string | null; yield_pct: number }
    let wipPlanForAlloc: WipAllocRow[] = []
    const wipStockForAlloc = new Map<string, number>()
    let wipBomForAlloc: WipBomRow[] = []
    const wipCrisisQtyBySap = new Map<string, number>() // sap → crisis qty reserved in Phase 1
    if (ENABLE_WIP) {
      const { data: wipRows } = await supabase
        .from('wip_plan').select('sap_code, quantity, wip_initial')
        .eq('plan_date', productionDate).gt('quantity', 0)
      wipPlanForAlloc = (wipRows ?? []) as WipAllocRow[]

      if (wipPlanForAlloc.length) {
        const wipSapList = wipPlanForAlloc.map(r => String(r.sap_code).trim())

        const wipSkuNames = wipSapList
          .map(s => skuMap.get(s.replace(/^0+/, ''))?.sku_name).filter(Boolean) as string[]
        if (wipSkuNames.length) {
          const { data: ws } = await supabase.from('stock_20')
            .select('material_name, weight_total').in('material_name', wipSkuNames)
          for (const r of ws ?? []) {
            const name = String(r.material_name ?? '').trim()
            for (const sap of wipSapList) {
              const sapNorm = sap.replace(/^0+/, '')
              if (skuMap.get(sapNorm)?.sku_name === name)
                wipStockForAlloc.set(sapNorm, (wipStockForAlloc.get(sapNorm) ?? 0) + Number(r.weight_total))
            }
          }
        }

        const { data: bomRows } = await supabase
          .from('bom_items').select('product_sap, raw_sap, raw_name, yield_pct')
          .in('product_sap', wipSapList)
        wipBomForAlloc = (bomRows ?? []) as WipBomRow[]

        // Phase 1 only: reserve WIP Crisis amount (max(0, wip_initial/3 − stock), capped at 25%
        // of the Final Plan qty) before other stations claim the pool. Phase 2/3 get no priority
        // reservation — they only take whatever's left after order-driven stations (below).
        if (selectedPhase === 1) {
          for (const wip of wipPlanForAlloc) {
            const sap     = String(wip.sap_code).trim()
            const sapNorm = sap.replace(/^0+/, '')
            const qty     = Number(wip.quantity)
            const wipInit = Number(wip.wip_initial ?? 0)
            const stockKg = wipStockForAlloc.get(sapNorm) ?? 0
            const crisisQty    = wipInit > 0 ? Math.max(0, wipInit / 3 - stockKg) : qty
            const effectiveQty = Math.min(qty * 0.25, crisisQty)
            if (effectiveQty < 0.005) continue
            wipCrisisQtyBySap.set(sap, effectiveQty)
            for (const b of wipBomForAlloc.filter(b =>
              b.product_sap === sap || b.product_sap.replace(/^0+/, '') === sapNorm
            )) {
              if (!b.raw_name) continue
              takeFromPoolLocal(b.raw_name, b.raw_sap, b.yield_pct > 0 ? effectiveQty / b.yield_pct : effectiveQty)
            }
          }
        }
      }
    }

    // ── Sum raw needs per (station, rawNorm) from all SKU targets ──
    const stationRawTotalNeeded = new Map<string, number>() // "station|||rawNorm" → kg needed
    const stationRawSap         = new Map<string, string>() // "station|||rawNorm" → raw_sap
    for (const item of assignList) {
      const cleanSku = item.sku.replace(/^0+/, '')
      if (noWithdrawalSaps.has(item.sku) || noWithdrawalSaps.has(cleanSku)) continue
      if (!stockWasUploaded) continue
      if (mooChōdSapSet.has(item.sku) || mooChōdSapSet.has(cleanSku)) continue
      const boms = bomMap.get(cleanSku) ?? []
      if (!boms.length) continue
      const prod = skuMap.get(cleanSku) ?? skuMap.get(item.sku)
      if (!prod) continue
      const station = STATION_TABLE[normalizeStation(prod.station)] ?? normalizeStation(prod.station)
      for (const b of boms) {
        if (!b.raw_name) continue
        const rawNorm = normMatNameLocal(b.raw_name)
        const key = `${station}|||${rawNorm}`
        const rawNeeded = b.yield_pct > 0 ? item.targetQty / b.yield_pct : item.targetQty
        stationRawTotalNeeded.set(key, (stationRawTotalNeeded.get(key) ?? 0) + rawNeeded)
        if (!stationRawSap.has(key)) stationRawSap.set(key, b.raw_sap)
      }
    }

    // ── Mas Moo Chod: add shared ingredient demand for หมูบด to the pool allocation ──
    // Uses actual P1/P2 own-stock to compute residual demand that falls on shared P3 (e.g. เนื้อไหล่-Raw).
    let mooTotalKg = 0
    if (stockWasUploaded && mooChōdSapSet.size > 0) {
      const mooChōdItems = assignList.filter(item => {
        const c = item.sku.replace(/^0+/, '')
        return mooChōdSapSet.has(item.sku) || mooChōdSapSet.has(c)
      })
      if (mooChōdItems.length > 0) {
        interface MooIngLocal { ingredient_type: string; priority: number; sap_code: string | null; product_name: string }

        // Fetch masters (fat_percent + ingredients)
        const [mooMasterSplit, mooWithdrawalSplit] = await Promise.all([
          supabase.from('moo_chod_master').select('sap_code, fat_percent'),
          supabase.from('moo_chod_withdrawal_master')
            .select('ingredient_type, priority, sap_code, product_name')
            .order('ingredient_type').order('priority').order('id'),
        ])
        const mooFatMapSplit = new Map<string, number>()
        for (const r of mooMasterSplit.data ?? []) {
          if (!r.sap_code) continue
          const s = String(r.sap_code).trim()
          mooFatMapSplit.set(s, Number(r.fat_percent ?? 0))
          mooFatMapSplit.set(s.replace(/^0+/, ''), Number(r.fat_percent ?? 0))
        }
        const mooIngsSplit     = (mooWithdrawalSplit.data ?? []) as MooIngLocal[]
        const mooMeatIngsSplit = mooIngsSplit.filter(i => i.ingredient_type === 'เนื้อ')
        const mooFatIngsSplit  = mooIngsSplit.filter(i => i.ingredient_type === 'มัน')

        // Fetch stock for non-shared P1/P2 Mas Moo Chod ingredients (not in pool)
        const nonSharedIngsSplit  = mooIngsSplit.filter(ing => !pool.has(normMatNameLocal(ing.product_name)) && !(ing.sap_code && poolSap.has(ing.sap_code)))
        const nonSharedSapsSplit  = nonSharedIngsSplit.map(i => i.sap_code).filter(Boolean) as string[]
        const nonSharedNamesSplit = nonSharedIngsSplit.map(i => i.product_name).filter(Boolean)
        const nonSharedExpSplit   = Array.from(new Set(
          nonSharedNamesSplit.flatMap(n => [n, n.replace(/\s*-\s*/g, '-'), n.replace(/\s*-\s*/g, ' - ')])
        ))
        const mooOwnStockNorm = new Map<string, number>()
        const mooOwnStockSap  = new Map<string, number>()
        {
          type SR2 = { material_code: string; material_name: string | null; weight_total: number }
          const proms: Promise<{ data: SR2[] | null }>[] = []
          if (nonSharedSapsSplit.length)
            proms.push(
              supabase.from('stock_0010').select('material_code, material_name, weight_total').in('material_code', nonSharedSapsSplit).gt('weight_total', 0) as Promise<{ data: SR2[] | null }>,
              supabase.from('stock_20').select('material_code, material_name, weight_total').in('material_code', nonSharedSapsSplit).gt('weight_total', 0) as Promise<{ data: SR2[] | null }>,
              supabase.from('stock_100').select('material_code, material_name, weight_total').in('material_code', nonSharedSapsSplit).gt('weight_total', 0) as Promise<{ data: SR2[] | null }>,
            )
          if (nonSharedExpSplit.length)
            proms.push(
              supabase.from('stock_0010').select('material_code, material_name, weight_total').in('material_name', nonSharedExpSplit).gt('weight_total', 0) as Promise<{ data: SR2[] | null }>,
              supabase.from('stock_20').select('material_code, material_name, weight_total').in('material_name', nonSharedExpSplit).gt('weight_total', 0) as Promise<{ data: SR2[] | null }>,
              supabase.from('stock_100').select('material_code, material_name, weight_total').in('material_name', nonSharedExpSplit).gt('weight_total', 0) as Promise<{ data: SR2[] | null }>,
            )
          for (const r of await Promise.all(proms)) {
            for (const row of r.data ?? []) {
              if (row.material_name) {
                const k = normMatNameLocal(row.material_name)
                mooOwnStockNorm.set(k, (mooOwnStockNorm.get(k) ?? 0) + Number(row.weight_total))
              }
              if (row.material_code)
                mooOwnStockSap.set(row.material_code, (mooOwnStockSap.get(row.material_code) ?? 0) + Number(row.weight_total))
            }
          }
        }

        // Compute total fat/meat demand from หมูบด assignments
        let totalMooFatKg  = 0
        let totalMooMeatKg = 0
        for (const item of mooChōdItems) {
          const s = item.sku.replace(/^0+/, '')
          const fatPct = mooFatMapSplit.get(s) ?? mooFatMapSplit.get(item.sku) ?? 0
          totalMooFatKg  += item.targetQty * fatPct / 100
          totalMooMeatKg += item.targetQty * (1 - fatPct / 100)
        }
        mooTotalKg = totalMooFatKg + totalMooMeatKg

        // Simulate priority allocation: deplete P1/P2 own stock, then add residual to
        // stationRawTotalNeeded for shared P3 ingredients so they enter pool allocation.
        function addMooSharedNeeds(demandKg: number, ings: MooIngLocal[]) {
          let remaining = demandKg
          const priorities = Array.from(new Set(ings.map(i => i.priority))).sort((a, b) => a - b)
          for (const prio of priorities) {
            if (remaining < 0.005) break
            for (const ing of ings.filter(i => i.priority === prio)) {
              if (remaining < 0.005) break
              const normN = normMatNameLocal(ing.product_name)
              const inPool = pool.has(normN) || (ing.sap_code ? poolSap.has(ing.sap_code) : false)
              if (inPool) {
                // Shared ingredient: record demand so pool allocation handles it
                const key = `หมูบด|||${normN}`
                stationRawTotalNeeded.set(key, (stationRawTotalNeeded.get(key) ?? 0) + remaining)
                if (!stationRawSap.has(key) && ing.sap_code) stationRawSap.set(key, ing.sap_code)
                remaining = 0
              } else {
                // Non-shared: consume from own stock
                const sapKey = ing.sap_code ?? ''
                const sapAvail  = sapKey ? (mooOwnStockSap.get(sapKey) ?? 0) : 0
                const normAvail = mooOwnStockNorm.get(normN) ?? 0
                const avail = sapKey ? sapAvail : normAvail
                const take  = Math.min(remaining, avail)
                if (sapKey) mooOwnStockSap.set(sapKey, sapAvail - take)
                mooOwnStockNorm.set(normN, Math.max(0, normAvail - take))
                remaining -= take
              }
            }
          }
        }

        addMooSharedNeeds(totalMooFatKg,  mooFatIngsSplit)
        addMooSharedNeeds(totalMooMeatKg, mooMeatIngsSplit)
      }
    }

    // ── Allocate pool in station priority order ──
    const stationRawAllocated   = new Map<string, number>() // "station|||rawNorm" → allocatedKg
    const ALLOC_PRIORITY_STNS   = ['สไลด์', 'สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'เผาขา', 'เลาะขา']
    const allNeededStns = Array.from(new Set(
      Array.from(stationRawTotalNeeded.keys()).map(k => k.split('|||')[0])
    ))
    const orderedStnsForAlloc = [
      ...ALLOC_PRIORITY_STNS.filter(s => allNeededStns.includes(s)),
      ...allNeededStns.filter(s => !ALLOC_PRIORITY_STNS.includes(s)),
    ]
    for (const station of orderedStnsForAlloc) {
      for (const [key, needed] of stationRawTotalNeeded.entries()) {
        if (!key.startsWith(`${station}|||`)) continue
        const rawNorm = key.split('|||')[1]
        const rawSap  = stationRawSap.get(key) ?? ''
        stationRawAllocated.set(key, takeFromPoolLocal(rawNorm, rawSap, needed))
      }
    }

    // ── After station allocations: take remaining pool for WIP production ──
    // Phase 1: top up from the crisis reservation (above) to 25% of Final Plan qty.
    // Phase 2: no WIP raw allocation at all — wipFullCapBySap stays unset (= 0 producible).
    // Phase 3: no priority reservation taken — produce all remaining qty from whatever pool is left.
    if (ENABLE_WIP && selectedPhase !== 2) {
      for (const wip of wipPlanForAlloc) {
        const sap       = String(wip.sap_code).trim()
        const sapNorm   = sap.replace(/^0+/, '')
        const qty       = Number(wip.quantity)
        const targetQty = selectedPhase === 1 ? qty * 0.25 : qty
        const bufferQty = wipCrisisQtyBySap.get(sap) ?? 0

        const boms = wipBomForAlloc.filter(b =>
          (b.product_sap === sap || b.product_sap.replace(/^0+/, '') === sapNorm) && b.raw_name
        )
        if (!boms.length) { wipFullCapBySap.set(sap, targetQty); continue }

        let minScale = 1.0
        for (const b of boms) {
          const rawTotal  = b.yield_pct > 0 ? targetQty / b.yield_pct : targetQty
          const rawBuffer = b.yield_pct > 0 ? bufferQty / b.yield_pct : bufferQty
          const rawExtra  = Math.max(0, rawTotal - rawBuffer)
          if (rawExtra < 0.005) continue // buffer already covers target qty, no extra needed
          const extraTaken = takeFromPoolLocal(b.raw_name!, b.raw_sap, rawExtra)
          if (rawTotal > 0.005) minScale = Math.min(minScale, (rawBuffer + extraTaken) / rawTotal)
        }
        wipFullCapBySap.set(sap, targetQty * minScale)
      }
    }

    // หมูบด scale: (total - sharedDeficit) / total — accounts for P1/P2 own-stock coverage
    let mooChōdScale = 1.0
    if (mooTotalKg > 0.005) {
      let sharedDeficit = 0
      for (const [key, needed] of stationRawTotalNeeded.entries()) {
        if (!key.startsWith('หมูบด|||')) continue
        const allocated = stationRawAllocated.get(key) ?? needed
        sharedDeficit += Math.max(0, needed - allocated)
      }
      mooChōdScale = Math.max(0, 1 - sharedDeficit / mooTotalKg)
    }
    // ── Split each SKU target into stock-supported qty (based on allocation ratio) + deficit qty ──
    const splitAssignList: SkuTarget[] = []
    for (const item of assignList) {
      const cleanSku = item.sku.replace(/^0+/, '')
      if (noWithdrawalSaps.has(item.sku) || noWithdrawalSaps.has(cleanSku)) { splitAssignList.push(item); continue }
      if (!stockWasUploaded) { splitAssignList.push(item); continue }
      if (mooChōdSapSet.has(item.sku) || mooChōdSapSet.has(cleanSku)) {
        const wpbLocal = bagSizeMap.get(cleanSku) ?? bagSizeMap.get(item.sku) ?? 1
        const bagAlignedTotal = wpbLocal > 0 ? Math.floor(item.targetQty / wpbLocal) * wpbLocal : item.targetQty
        const stockBagQty = wpbLocal > 0 ? Math.floor(bagAlignedTotal * mooChōdScale / wpbLocal) * wpbLocal : bagAlignedTotal * mooChōdScale
        if (stockBagQty > 0.01) splitAssignList.push({ ...item, targetQty: stockBagQty, isDeficit: false })
        const deficitBagQty = bagAlignedTotal - stockBagQty
        if (deficitBagQty > 0.01) splitAssignList.push({ ...item, targetQty: deficitBagQty, isDeficit: true })
        continue
      }
      const boms = bomMap.get(cleanSku)
      if (!boms?.length) { splitAssignList.push(item); continue }
      const prod = skuMap.get(cleanSku) ?? skuMap.get(item.sku)
      if (!prod) { splitAssignList.push(item); continue }
      const station = STATION_TABLE[normalizeStation(prod.station)] ?? normalizeStation(prod.station)

      // Minimum allocation ratio across all BOM components (bottleneck raw material)
      let scale = 1.0
      for (const b of boms) {
        if (!b.raw_name) continue
        const key    = `${station}|||${normMatNameLocal(b.raw_name)}`
        const needed = stationRawTotalNeeded.get(key) ?? 0
        const alloc  = stationRawAllocated.get(key) ?? needed
        if (needed > 0.005) scale = Math.min(scale, alloc / needed)
      }

      const wpbLocal       = bagSizeMap.get(cleanSku) ?? bagSizeMap.get(item.sku) ?? 1
      const bagAlignedTotal = wpbLocal > 0 ? Math.floor(item.targetQty / wpbLocal) * wpbLocal : item.targetQty
      const stockBagQty    = wpbLocal > 0 ? Math.floor(bagAlignedTotal * scale / wpbLocal) * wpbLocal : bagAlignedTotal * scale

      if (stockBagQty > 0.01) splitAssignList.push({ ...item, targetQty: stockBagQty, isDeficit: false })
      const deficitBagQty = bagAlignedTotal - stockBagQty
      if (deficitBagQty > 0.01) splitAssignList.push({ ...item, targetQty: deficitBagQty, isDeficit: true })
    }
    assignList = splitAssignList
  }

  // Special time SKUs first
  const hasSpecialTimes = (sku: string) => {
    const t = specialTimeMap.get(sku.replace(/^0+/, ''))
    return !!(t && (t.startMins !== null || t.stopMins !== null))
  }
  const specialList = assignList.filter(i => hasSpecialTimes(i.sku))
    .sort((a, b) => {
      const priorityA = channelPriority[a.channel] ?? 99
      const priorityB = channelPriority[b.channel] ?? 99
      if (priorityA !== priorityB) return priorityA - priorityB

      const startA = specialTimeMap.get(a.sku.replace(/^0+/, ''))?.startMins ?? 0
      const startB = specialTimeMap.get(b.sku.replace(/^0+/, ''))?.startMins ?? 0
      return startA !== startB ? startA - startB : b.targetQty - a.targetQty
    })
  assignList = [...specialList, ...assignList.filter(i => !hasSpecialTimes(i.sku))]
  assignList = mergeAssignList(assignList)

  // Separate stock-supported and deficit items so they are scheduled in two distinct passes:
  // Pass 2a (stock) fills worker time with produceable quantities first;
  // Pass 2b (deficit) uses whatever time remains and gets flagged as insufficient in withdrawal.
  const stockAssignList   = assignList.filter(i => !i.isDeficit)
  const deficitAssignList = assignList.filter(i => !!i.isDeficit)

  // Supplementary plan
  interface SuppSlot { deadlineMins: number; skus: { sku: string; name: string | null; qty: number }[] }
  const suppSlotResults = await Promise.all([1, 2, 3].map(async slot => {
    const { data: log } = await supabase.from('upload_log').select('source_file')
      .eq('table_name', `production_plan_supplementary_${slot}`)
      .order('uploaded_at', { ascending: false }).limit(1).maybeSingle()
    if (!log) return null
    // เช็ค delivery_date ให้ตรงกับวันที่กำลัง generate จริง — กันไฟล์เสริมเก่า (อัพครั้งล่าสุดแต่คนละวัน)
    // ถูกดึงมาใช้ซ้ำในวันอื่นที่ยังไม่มีใครอัพไฟล์ใหม่
    const { data } = await supabase.from('production_plan_supplementary')
      .select('sku, sku_name, quantity, deadline_time')
      .eq('source_file', log.source_file).eq('slot', String(slot)).eq('delivery_date', productionDate)
    if (!data?.length) return null
    const deadlineStr = data[0].deadline_time as string | null
    if (!deadlineStr) return null
    const [dh, dm] = deadlineStr.split(':').map(Number)
    const deadlineMins = dh * 60 + dm
    const skus = (data as { sku: unknown; sku_name: unknown; quantity: unknown }[]).map(r => ({ sku: String(r.sku ?? '').replace(/^0+/, ''), name: r.sku_name as string | null, qty: Number(r.quantity) })).filter(s => s.qty > 0)
    return { deadlineMins, skus, withinPhase: deadlineMins > phaseStartMins && deadlineMins <= phaseEndMins } as SuppSlot & { withinPhase: boolean }
  }))
  const allSuppSlots = suppSlotResults.filter(Boolean) as (SuppSlot & { withinPhase: boolean })[]
  const activeSuppSlots = allSuppSlots.filter(s => s.withinPhase).sort((a, b) => a.deadlineMins - b.deadlineMins)


  // Assign workers
  const assignments: Record<string, unknown>[] = []

  // Pass 1 — supplementary
  for (const suppSlot of activeSuppSlots) {
    if (!suppSlot) continue
    const suppByStation: Record<string, { sku: string; skuName: string | null; targetQty: number; channel: string }[]> = {}
    for (const { sku, name: skuName, qty: rawQty } of suppSlot.skus) {
      const targetQty = roundDownToBag(sku, rawQty)
      const prod = skuMap.get(sku) ?? skuMap.get(String(Number(sku) || sku))
      if (!prod) continue
      const station = STATION_TABLE[normalizeStation(prod.station)] ?? normalizeStation(prod.station)
      suppByStation[station] ??= []
      suppByStation[station].push({ sku, skuName: prod.sku_name || skuName || null, targetQty, channel: 'เสริม' })
    }

    for (const [station, targets] of Object.entries(suppByStation)) {
      const stationWorkers = workersByStation[station] ?? []
      if (!stationWorkers.length) continue
      assignments.push(...allocateBalanced({
        productionDate,
        tableName: station,
        targets,
        workers: stationWorkers,
        skuMap,
        jobAssignMap,
        workerHours,
        workerFreeAtMins,
        workerBusySegments,
        phaseEndMins: suppSlot.deadlineMins,
        period: phaseCfg.period,
        phaseRoundMins: PHASE_ROUND_MINS[selectedPhase] ?? [phaseCfg.startH * 60],
        wpbMap,
        specialTimeMap,
        lastSkuSet: station === 'หมูบด' ? mooChōd50PctSapSet : undefined,
        debugSkips,
      }))
    }
  }

  // Pass 2 — run stock-supported items first (2a), then deficit items (2b).
  // Both passes share the same worker state so deficit work only fills remaining capacity.

  const resolveTargetQty = (item: SkuTarget): number => {
    let qty = roundDownToBag(item.sku, item.targetQty)
    if (isPhase3) {
      const planItem = planMap.get(item.sku.replace(/^0+/, ''))
      // Only cap against plan100's remaining when plan100 actually carries demand for this
      // SKU (qty > 0). A plan100 row with weight_total=0 is just a template stub — treating
      // it as "0 remaining" would zero out unrelated appendRemaining (Makro/LOTUS/WM/FS)
      // targets for SKUs plan100 has nothing to say about.
      if (planItem && planItem.qty > 0) {
        const remaining = Math.max(0, planItem.qty - (phase1Assigned.get(item.sku.replace(/^0+/, '')) ?? 0))
        if (qty > remaining) qty = remaining
      }
    }
    return qty
  }

  const runChannelPass = (passList: SkuTarget[], stationOverride?: Map<string, string>) => {
    // Use the full assignList (stock + deficit combined) so getMaxWorkers isn't capped by the
    // small deficit slice when only the deficit portion is being scheduled.
    const globalSkuTotalQty = new Map<string, number>()
    for (const item of assignList) {
      const k = item.sku.replace(/^0+/, '')
      globalSkuTotalQty.set(k, (globalSkuTotalQty.get(k) ?? 0) + item.targetQty)
    }
    // Secondary SKUs: ALL primary workers must participate — bypass qty-based worker cap
    for (const k of Array.from(globalSkuTotalQty.keys())) {
      if (secondarySkuSet.has(k)) globalSkuTotalQty.set(k, Number.MAX_SAFE_INTEGER)
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

        const targetQty = resolveTargetQty(item)
        if (targetQty <= 0) continue

        const prod = skuMap.get(String(item.sku)) ?? skuMap.get(String(Number(item.sku) || item.sku))
        if (!prod) continue
        const station = stationOverride?.get(normSku) ?? (STATION_TABLE[normalizeStation(prod.station)] ?? normalizeStation(prod.station))
        targetsByStation[station] ??= []
        targetsByStation[station].push({ ...item, targetQty })

        // Same SKU in a subsequent channel → batch back-to-back within the same pass
        for (let nextIdx = chIdx + 1; nextIdx < chsInPass.length; nextIdx++) {
          const nextCh = chsInPass[nextIdx]
          const nextKey = `${nextCh}|||${normSku}`
          if (handled.has(nextKey)) continue
          const nextItem = passList.find(i => i.channel === nextCh && i.sku.replace(/^0+/, '') === normSku)
          if (!nextItem) continue
          handled.add(nextKey)
          const nextQty = resolveTargetQty(nextItem)
          if (nextQty <= 0) continue
          targetsByStation[station].push({ ...nextItem, targetQty: nextQty })
        }
      }

      for (const [station, stationTargets] of Object.entries(targetsByStation)) {
        const stationWorkers = workersByStation[station] ?? []
        if (!stationWorkers.length) continue
        const _balResult = allocateBalanced({
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
          lastSkuSet: station === 'หมูบด' ? mooChōd50PctSapSet : undefined,
          debugSkips,
        })
        assignments.push(..._balResult)
      }
    }
  }

  // Build independent time budget for secondary SKUs.
  // Secondary SKUs run concurrently with primary — they start at the same time as primary.
  const secWorkerHours = new Map<string, number>()
  const secWorkerFreeAtMins = new Map<string, number>()
  const secWorkerBusySegments = new Map<string, { start: number; end: number }[]>()
  const secWorkerShiftEnd = new Map<string, number>() // nameKey → shift end (mins)
  for (const w of workforce) {
    let shiftStartMins = phaseCfg.startH * 60
    let shiftEndMins = phaseEndMins
    if (w.shift === 'กะ 1') { shiftStartMins = 8.5 * 60; shiftEndMins = isPhase3 ? phaseEndMins : 17.5 * 60 }
    else if (w.shift === 'กะ 2') { shiftStartMins = 14.5 * 60; shiftEndMins = isPhase3 ? phaseEndMins : 23.5 * 60 }
    const actualEndMins = Math.min(phaseEndMins, shiftEndMins)
    const nameKey = normName(w.name)
    const startFreeMins = Math.max(checkpointMins, shiftStartMins)
    secWorkerHours.set(nameKey, Math.max(0, actualEndMins - startFreeMins) / 60)
    secWorkerFreeAtMins.set(nameKey, startFreeMins)
    secWorkerBusySegments.set(nameKey, [])
    secWorkerShiftEnd.set(nameKey, actualEndMins)
  }

  const primaryStockList   = stockAssignList.filter(i => !secondarySkuSet.has(i.sku.replace(/^0+/, '')))
  const primaryDeficitList = deficitAssignList.filter(i => !secondarySkuSet.has(i.sku.replace(/^0+/, '')))
  const secStockList       = stockAssignList.filter(i => secondarySkuSet.has(i.sku.replace(/^0+/, '')))
  const secDeficitList     = deficitAssignList.filter(i => secondarySkuSet.has(i.sku.replace(/^0+/, '')))

  // Pass 2a: stock-supported items — fills workers with produceable quantities first
  runChannelPass(primaryStockList)
  assignments.push(...keptAssignments)
  // Pass 2b: deficit items — uses remaining worker capacity, assigned with is_deficit=true
  // Kept separate so runChannelPass's `handled` set doesn't drop deficit items that share
  // the same channel+SKU as stock items.
  runChannelPass(primaryDeficitList)

  // Secondary (ผลพลอยได้) SKUs must be produced at whichever table their linked primary
  // actually landed on (per Mas Sku ผลิตพร้อมกัน) — not wherever the secondary's own Mas
  // Productivity entry says, and not wherever cross-station happens to have free hands.
  // This constraint overrides both of those: build primary→dominant-table here, so the
  // secondary pass below is forced onto that table, and secondary SKUs are excluded from
  // the cross-station catch-all pass further down (they never get a third table).
  const secondaryStationOverride = new Map<string, string>()
  if (primarySkuSet.size > 0) {
    const primaryQtyByTable = new Map<string, Map<string, number>>()
    for (const a of assignments) {
      const ns = String(a.sku ?? '').replace(/^0+/, '')
      if (!primarySkuSet.has(ns)) continue
      const table = String(a.table_name ?? '')
      if (!table) continue
      if (!primaryQtyByTable.has(ns)) primaryQtyByTable.set(ns, new Map())
      const m = primaryQtyByTable.get(ns)!
      m.set(table, (m.get(table) ?? 0) + Number(a.target_quantity ?? 0))
    }
    const primaryDominantTable = new Map<string, string>()
    for (const [ns, tableQty] of primaryQtyByTable) {
      let bestTable = ''; let bestQty = -1
      for (const [t, q] of tableQty) if (q > bestQty) { bestQty = q; bestTable = t }
      if (bestTable) primaryDominantTable.set(ns, bestTable)
    }
    for (const [secSku, primaries] of Array.from(secondaryToPrimaries.entries())) {
      for (const pSku of Array.from(primaries)) {
        const table = primaryDominantTable.get(pSku)
        if (table) { secondaryStationOverride.set(secSku, table); break }
      }
    }
  }


  // WIP Plan production: allocate กลุ่ม WIP workers on their respective stations (from mas_productivity)
  // Phase 2 produces no WIP at all (no raw was allocated to WIP this phase — see above).
  if (ENABLE_WIP) {
    if (selectedPhase !== 2) {
      const { data: wipPlanRows } = await supabase
        .from('wip_plan')
        .select('sap_code, quantity, is_manual, wip_initial')
        .eq('plan_date', productionDate)
        .gt('quantity', 0)

      // If no saved wip_plan for this date, compute Final Plan on-the-fly
      // (same logic as wip-plan page: avgKg × 1.2 rounded up to nearest 100)
      let effectiveWipPlan: { sap_code: string; quantity: number; is_manual?: boolean; wip_initial?: number }[] = wipPlanRows ?? []

      if (!effectiveWipPlan.length) {
        const wipSapSet = new Set<string>()
        for (const [, p] of skuMap) {
          if (p.product_group === 'กลุ่ม WIP') wipSapSet.add(p.sku)
        }
        const wipSapListUniq = Array.from(wipSapSet)

        if (wipSapListUniq.length) {
          const { data: bomRevRows } = await supabase
            .from('bom_items').select('raw_sap, product_sap').in('raw_sap', wipSapListUniq)

          const finalSapToWip = new Map<string, string>()
          for (const b of bomRevRows ?? []) {
            const ps = String(b.product_sap ?? '').trim()
            if (!/^\d+$/.test(ps)) continue
            const norm = ps.replace(/^0+/, '')
            if (!finalSapToWip.has(norm)) finalSapToWip.set(norm, String(b.raw_sap))
          }

          const [
            wipHistP100,
            wipHistLotus,
            wipHistWm,
          ] = await Promise.all([
            fetchLatestPlan100(histDates),
            fetchLatestOrders('lotus_orders', histDates, ['1400']),
            fetchLatestOrders('wet_market_orders', histDates, ['1400']),
          ])

          const wipKgSum = new Map<string, number>()
          const wipDayCount = new Map<string, number>()

          for (const hDate of histDates) {
            const p100 = (wipHistP100 ?? []).filter((r: { plan_date: string }) => r.plan_date === hDate) as { sap: string; weight_total: number }[]
            const lot  = (wipHistLotus ?? []).filter((r: { delivery_date: string }) => r.delivery_date === hDate) as { sku: string; quantity: number }[]
            const wm   = (wipHistWm   ?? []).filter((r: { delivery_date: string }) => r.delivery_date === hDate) as { sku: string; quantity: number }[]
            const mak  = (makroHistRaw ?? []).filter(r => r.delivery_date === hDate)

            const dayKg = new Map<string, number>()
            const p100Skus = new Set<string>()

            for (const r of p100) {
              const norm = String(r.sap ?? '').replace(/^0+/, '')
              p100Skus.add(norm)
              const wipSap = finalSapToWip.get(norm)
              if (wipSap) dayKg.set(wipSap, (dayKg.get(wipSap) ?? 0) + Number(r.weight_total ?? 0))
            }
            // Makro hist (already filtered to round 1400) — quantity is in kg
            for (const r of mak) {
              const norm = String(r.sku ?? '').replace(/^0+/, '')
              const wipSap = finalSapToWip.get(norm)
              if (!wipSap) continue
              dayKg.set(wipSap, (dayKg.get(wipSap) ?? 0) + Number(r.quantity ?? 0))
            }
            // Lotus + WM 1400: skip SKUs already covered by plan100
            for (const r of [...lot, ...wm]) {
              const norm = String(r.sku ?? '').replace(/^0+/, '')
              if (p100Skus.has(norm)) continue
              const wipSap = finalSapToWip.get(norm)
              if (!wipSap) continue
              const wpb = wpbMap.get(norm) ?? 0
              dayKg.set(wipSap, (dayKg.get(wipSap) ?? 0) + Number(r.quantity ?? 0) * wpb)
            }

            for (const [wipSap, kg] of dayKg) {
              if (kg > 0) {
                wipKgSum.set(wipSap, (wipKgSum.get(wipSap) ?? 0) + kg)
                wipDayCount.set(wipSap, (wipDayCount.get(wipSap) ?? 0) + 1)
              }
            }
          }

          // Fetch current WIP stock to compute net quantity needed (same formula as wip-plan page)
          const wipAutoNames = Array.from(wipKgSum.keys())
            .map(sap => skuMap.get(sap.replace(/^0+/, ''))?.sku_name)
            .filter((n): n is string => Boolean(n))
          const wipAutoStockMap = new Map<string, number>()
          if (wipAutoNames.length) {
            const { data: autoStk } = await supabase
              .from('stock_20').select('material_name, weight_total').in('material_name', wipAutoNames)
            for (const r of autoStk ?? []) {
              const name = String(r.material_name ?? '').trim()
              wipAutoStockMap.set(name, (wipAutoStockMap.get(name) ?? 0) + Number(r.weight_total))
            }
          }

          for (const [wipSap, total] of wipKgSum) {
            const avgKg = total / (wipDayCount.get(wipSap) ?? 1)
            const safetyStock = Math.floor(avgKg * 3 * 1.2 / 100) * 100
            const prodName = skuMap.get(wipSap.replace(/^0+/, ''))?.sku_name ?? ''
            const stockKg = wipAutoStockMap.get(prodName) ?? 0
            const autoBase = Math.round(Math.max(0, safetyStock - stockKg))
            if (autoBase > 0) effectiveWipPlan.push({ sap_code: wipSap, quantity: autoBase, is_manual: false, wip_initial: safetyStock })
          }
        }
      }

      if (effectiveWipPlan.length) {
        const wipNames: string[] = []
        for (const row of effectiveWipPlan) {
          const sap = String(row.sap_code).trim().replace(/^0+/, '')
          const prod = skuMap.get(sap)
          if (prod?.product_group === 'กลุ่ม WIP' && prod.sku_name) wipNames.push(prod.sku_name)
        }

        const stockKgByName = new Map<string, number>()
        if (wipNames.length) {
          const { data: stockRows } = await supabase
            .from('stock_20')
            .select('material_name, weight_total')
            .in('material_name', wipNames)
          for (const r of stockRows ?? []) {
            const name = String(r.material_name ?? '').trim()
            stockKgByName.set(name, (stockKgByName.get(name) ?? 0) + Number(r.weight_total))
          }
        }

        // Determine station per WIP SAP (from mas_productivity จุดงาน) for per-station allocation
        const wipSapToStation = new Map<string, string>()
        for (const row of effectiveWipPlan) {
          const sapRaw = String(row.sap_code).trim()
          const sap    = sapRaw.replace(/^0+/, '')
          const prod   = skuMap.get(sap) ?? skuMap.get(sapRaw)
          if (!prod || prod.product_group !== 'กลุ่ม WIP') continue
          const st = STATION_TABLE[normalizeStation(prod.station)] ?? normalizeStation(prod.station)
          if (!st) continue
          wipSapToStation.set(sapRaw, st)
          wipSapToStation.set(sap, st)
        }
        const wipStationsList = Array.from(new Set(wipSapToStation.values()))
        const wipSapList = effectiveWipPlan.map(r => String(r.sap_code).trim())

        // Multi-phase: sum WIP already assigned in OTHER periods for this date
        const alreadyAssignedByWip = new Map<string, number>()
        if (wipSapList.length && wipStationsList.length) {
          const { data: prevAssn } = await supabase
            .from('production_assignments')
            .select('sku, target_quantity')
            .eq('production_date', productionDate)
            .in('table_name', wipStationsList)
            .in('sku', wipSapList)
            .neq('period', phaseCfg.period)
          for (const a of prevAssn ?? []) {
            const k = String(a.sku)
            alreadyAssignedByWip.set(k, (alreadyAssignedByWip.get(k) ?? 0) + Number(a.target_quantity))
          }
        }

        type WipPlanTarget = { sku: string; skuName: string | null; targetQty: number; channel: string; deficit: number; isDeficit?: boolean }

        // Group WIP targets by station (from mas_productivity จุดงาน)
        const wipTargetsByStation = new Map<string, WipPlanTarget[]>()
        for (const row of effectiveWipPlan) {
          const sapRaw = String(row.sap_code).trim()
          const sap    = sapRaw.replace(/^0+/, '')
          const qty    = Number(row.quantity)
          if (qty <= 0) continue
          const prod = skuMap.get(sap) ?? skuMap.get(sapRaw)
          if (!prod || prod.product_group !== 'กลุ่ม WIP') continue

          const isManual      = Boolean(row.is_manual)
          const wipInitialVal = Number(row.wip_initial ?? 0)
          const stockKg       = stockKgByName.get(prod.sku_name) ?? 0

          // Auto (no manual entry): skip if current stock already meets WIP target level
          if (!isManual) {
            const threshold = wipInitialVal > 0 ? wipInitialVal : qty
            if (stockKg >= threshold) continue
          }
          // Manual entry: always create assignment regardless of current stock

          // Multi-phase cap: subtract what's already assigned in previous periods
          const alreadyAssigned = alreadyAssignedByWip.get(sapRaw) ?? alreadyAssignedByWip.get(sap) ?? 0
          let remainingQty       = Math.max(0, qty - alreadyAssigned)
          // Phase 1: hard cap production at 25% of Final Plan qty (WIP Crisis only)
          if (selectedPhase === 1) remainingQty = Math.min(remainingQty, qty * 0.25)
          if (remainingQty < 1) continue

          // Split into stock-supported vs deficit based on raw material allocation
          const cap      = wipFullCapBySap.get(sapRaw) ?? wipFullCapBySap.get(sap) ?? remainingQty
          const wpbLocal = bagSizeMap.get(sap) ?? bagSizeMap.get(sapRaw) ?? 1
          const stockQty = wpbLocal > 0 ? Math.floor(Math.min(remainingQty, cap) / wpbLocal) * wpbLocal : Math.min(remainingQty, cap)
          const defQty   = remainingQty - stockQty

          const station = STATION_TABLE[normalizeStation(prod.station)] ?? normalizeStation(prod.station)
          if (!station) continue
          if (!wipTargetsByStation.has(station)) wipTargetsByStation.set(station, [])
          const stTargets = wipTargetsByStation.get(station)!
          if (stockQty >= 1) stTargets.push({ sku: sapRaw, skuName: prod.sku_name, targetQty: stockQty, channel: 'wip_plan', deficit: stockQty, isDeficit: false })
          if (defQty   >= 1) stTargets.push({ sku: sapRaw, skuName: prod.sku_name, targetQty: defQty,   channel: 'wip_plan', deficit: defQty,   isDeficit: true  })
        }

        const phaseWorkMins = availableWorkMins(phaseCfg.startH * 60, phaseEndMins)

        for (const [station, stWipTargets] of Array.from(wipTargetsByStation.entries())) {
          const stationWorkers = workersByStation[station] ?? []
          if (!stationWorkers.length) continue

          stWipTargets.sort((a, b) => b.deficit - a.deficit)

          const nWipWorkers = Math.max(1, stationWorkers.length)

          // Demand in work-minutes per target (proportional weight for capacity split)
          const demandWorkMins = stWipTargets.map(t => {
            const p = skuMap.get(t.sku.replace(/^0+/, '')) ?? skuMap.get(t.sku)
            return (p && p.rate > 0) ? (t.deficit / p.rate) * 60 : 0
          })
          const totalDemandWorkMins = demandWorkMins.reduce((s, v) => s + v, 0)

          for (let idx = 0; idx < stWipTargets.length; idx++) {
            const target  = stWipTargets[idx]
            const normSku = target.sku.replace(/^0+/, '')
            const prod    = skuMap.get(normSku) ?? skuMap.get(target.sku)
            if (!prod || prod.rate <= 0) continue

            const fraction = totalDemandWorkMins > 0
              ? demandWorkMins[idx] / totalDemandWorkMins
              : 1 / stWipTargets.length
            const perWorkerMins = phaseWorkMins * fraction
            const kgPerWorker   = Math.floor(prod.rate * perWorkerMins / 60)
            const cappedQty     = Math.min(target.targetQty, kgPerWorker * nWipWorkers)
            if (cappedQty < 1) continue

            assignments.push(...allocateBalanced({
              productionDate,
              tableName: station,
              targets: [{ sku: target.sku, skuName: target.skuName, targetQty: cappedQty, channel: target.channel, isDeficit: target.isDeficit }],
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
              debugSkips,
            }))
          }
        }
      }
    }
  }

  if (secStockList.length || secDeficitList.length) {
    // Concurrent mode: secondary runs alongside primary, starting at the SAME TIME.
    // Target quantity is order-driven (normal SKU logic), not capped by primary hours.
    // Only workers who received primary assignments participate in secondary.

    // Find earliest primary start time per worker
    const workerPrimaryStart = new Map<string, number>()
    for (const a of assignments) {
      const normSku = String(a['sku'] ?? '').replace(/^0+/, '')
      if (secondarySkuSet.has(normSku)) continue
      const nameKey = normName(String(a['worker_name'] ?? ''))
      const deadlineStr = String(a['deadline_time'] ?? '')
      if (!deadlineStr.includes(':')) continue
      const [h, m] = deadlineStr.split(':').map(Number)
      const startMins = h * 60 + m
      const cur = workerPrimaryStart.get(nameKey)
      if (cur === undefined || startMins < cur) workerPrimaryStart.set(nameKey, startMins)
    }

    // Update secondary budget: concurrent start, full remaining shift capacity;
    // workers without any primary assignment get 0 capacity.
    for (const [nameKey] of secWorkerHours) {
      const primaryStart = workerPrimaryStart.get(nameKey)
      if (primaryStart === undefined) {
        secWorkerHours.set(nameKey, 0)
      } else {
        secWorkerFreeAtMins.set(nameKey, primaryStart)
        const shiftEnd = secWorkerShiftEnd.get(nameKey) ?? phaseEndMins
        secWorkerHours.set(nameKey, Math.max(0, shiftEnd - primaryStart) / 60)
      }
    }

    // Capture primary-pass end times before overwriting with concurrent secondary start times.
    const preSecondaryFreeAtMins = new Map(workerFreeAtMins)
    for (const [k, v] of secWorkerHours) workerHours.set(k, v)
    for (const [k, v] of secWorkerFreeAtMins) workerFreeAtMins.set(k, v)
    for (const [k, v] of secWorkerBusySegments) workerBusySegments.set(k, v.slice())
    runChannelPass(secStockList, secondaryStationOverride)
    runChannelPass(secDeficitList, secondaryStationOverride)
    // Merge: each worker's true finish = max(primary end, secondary end).
    for (const [nameKey, preMins] of preSecondaryFreeAtMins) {
      const postMins = workerFreeAtMins.get(nameKey) ?? preMins
      if (preMins > postMins) workerFreeAtMins.set(nameKey, preMins)
    }
  }

  // Cross-station supplementary pass — runs AFTER all own-station work for every station is done.
  // Steps:
  //  1. Check how much time each station has left after its own work finishes.
  //  2. From job assignment, find workers eligible for groups that belong to OTHER stations
  //     (cross-reference with mas_productivity to map group → station).
  //  3. Determine which station those groups belong to (e.g. กลุ่มซี่โครง → สามชั้น).
  //  4. Pull the remaining unfinished quantity from that station and assign it to the cross
  //     workers, starting only after all own-station work is done, capped by remaining time.
  {
    // group → normalized station from productivity master
    const groupStationMap = new Map<string, string>()
    for (const p of productivity) {
      if (groupStationMap.has(p.product_group)) continue
      const st = STATION_TABLE[normalizeStation(p.station)] ?? normalizeStation(p.station)
      if (st) groupStationMap.set(p.product_group, st)
    }

    // Scheduled qty per (normalized station, normSku) across all assignments built so far
    const scheduledQtyMap = new Map<string, number>()
    for (const a of assignments) {
      const rawSt = normalizeStation(String(a.table_name ?? ''))
      const st = STATION_TABLE[rawSt] ?? rawSt
      const ns = String(a.sku ?? '').replace(/^0+/, '')
      const key = `${st}|||${ns}`
      scheduledQtyMap.set(key, (scheduledQtyMap.get(key) ?? 0) + Number(a.target_quantity))
    }

    // Total target qty per normSku merged across all channels (stock + deficit)
    const totalTargetMap = new Map<string, { qty: number; skuName: string | null; channel: string }>()
    for (const item of assignList) {
      const ns = item.sku.replace(/^0+/, '')
      const cur = totalTargetMap.get(ns)
      if (cur) { cur.qty += item.targetQty } else {
        totalTargetMap.set(ns, { qty: item.targetQty, skuName: item.skuName, channel: item.channel })
      }
    }

    for (const [stationName, stationWorkers] of Object.entries(workersByStation)) {
      if (!stationWorkers.length) continue
      if (stationName === 'สไลด์') continue // สไลด์ ไม่ cross-station

      // 1. When does all own-station work finish and how much time remains?
      const ownEnd = stationWorkers.reduce(
        (max, w) => Math.max(max, workerFreeAtMins.get(normName(w.name)) ?? phaseStartMins),
        phaseStartMins,
      )
      if (ownEnd >= phaseEndMins) continue

      // 2. Find workers with groups that map to OTHER stations, group by target station.
      //    Also track which product groups each set of workers is eligible for at that station.
      const targetStationData = new Map<string, { workers: WorkforceRow[], eligibleGroups: Set<string> }>()
      for (const w of stationWorkers) {
        const ji = jobAssignMap.get(normName(w.name))
        if (!ji) continue
        for (const [group] of ji.groups) {
          const groupStation = groupStationMap.get(group)
          if (!groupStation || groupStation === stationName) continue
          if (!targetStationData.has(groupStation))
            targetStationData.set(groupStation, { workers: [], eligibleGroups: new Set() })
          const entry = targetStationData.get(groupStation)!
          if (!entry.workers.includes(w)) entry.workers.push(w)
          entry.eligibleGroups.add(group)
        }
      }
      if (!targetStationData.size) continue

      for (const [targetStation, { workers: crossWorkers, eligibleGroups }] of targetStationData) {
        // 3 & 4. Remaining unfinished work at targetStation — only SKUs whose product_group
        //        matches the eligible groups of these cross workers.
        const crossTargets: SkuTarget[] = []
        for (const [ns, info] of totalTargetMap) {
          // Secondary (ผลพลอยได้) SKUs are pinned to their primary's table (see
          // secondaryStationOverride above) — they never spill to a further cross-station table.
          if (secondarySkuSet.has(ns)) continue
          const prod = skuMap.get(ns)
          if (!prod) continue
          if (!eligibleGroups.has(prod.product_group)) continue
          const skuSt = STATION_TABLE[normalizeStation(prod.station)] ?? normalizeStation(prod.station)
          if (skuSt !== targetStation) continue
          const key = `${targetStation}|||${ns}`
          const scheduled = scheduledQtyMap.get(key) ?? 0
          const remaining = Math.max(0, info.qty - scheduled)
          if (remaining < 1) continue
          crossTargets.push({ sku: ns, skuName: info.skuName, targetQty: remaining, channel: info.channel })
        }
        if (!crossTargets.length) continue

        // Start cross-station work only after ALL own-station work at this station finishes
        for (const w of crossWorkers) {
          const nameKey = normName(w.name)
          const cur = workerFreeAtMins.get(nameKey) ?? phaseStartMins
          if (cur < ownEnd) workerFreeAtMins.set(nameKey, ownEnd)
        }

        const crossResult = allocateBalanced({
          productionDate,
          tableName: stationName,
          targets: crossTargets,
          workers: crossWorkers,
          skuMap, jobAssignMap, workerHours, workerFreeAtMins, workerBusySegments,
          phaseEndMins,
          period: phaseCfg.period,
          phaseRoundMins: PHASE_ROUND_MINS[selectedPhase] ?? [phaseStartMins],
          wpbMap, specialTimeMap, debugSkips,
        })
        for (const a of crossResult) {
          a.note = a.note ? `${String(a.note)}|cross:${targetStation}` : `cross:${targetStation}`
          // Update scheduledQtyMap so subsequent stations see this cross-station qty as already
          // scheduled against targetStation — prevents the same remaining qty from being assigned
          // to multiple cross-station workers (double-assign bug).
          const ns = String(a.sku ?? '').replace(/^0+/, '')
          const key = `${targetStation}|||${ns}`
          scheduledQtyMap.set(key, (scheduledQtyMap.get(key) ?? 0) + Number(a.target_quantity))
        }
        assignments.push(...crossResult)
      }
    }
  }

  if (!assignments.length) {
    const prodMatchCount = assignList.filter(t => skuMap.has(t.sku) || skuMap.has(t.sku.replace(/^0+/, ''))).length
    const totalWorkerHours = Array.from(workerHours.values()).reduce((s, h) => s + h, 0)
    return {
      success: false,
      message: `ไม่สามารถสร้างคำสั่ง — targets: WM ${channelTargets['Wet Market']?.length ?? 0} / Makro ${channelTargets['Makro']?.length ?? 0} / LOTUS ${channelTargets['LOTUS']?.length ?? 0} | prodMatch: ${prodMatchCount}/${assignList.length} | workerHrs: ${totalWorkerHours.toFixed(1)}`,
    }
  }

  // Delete superseded batch — scoped to this Special-line's own stations so a Basic-line
  // batch sharing the same production_date/period isn't wiped out by this generation.
  if (useRegen) {
    await supabase.from('production_assignments').delete()
      .eq('production_date', productionDate).eq('period', phaseCfg.period)
      .in('table_name', SPECIAL_STATIONS)
      .eq('effective_from', latestAssign.effective_from)
  } else {
    await supabase.from('production_assignments').delete()
      .eq('production_date', productionDate).eq('period', phaseCfg.period)
      .in('table_name', SPECIAL_STATIONS)
  }

  // Resequence wall-clock start times per worker
  const byWorkerPost: Record<string, any[]> = {}
  for (const a of assignments) {
    const name = a.worker_name as string
    byWorkerPost[name] ??= []
    const isDeficit = (a as any).is_deficit || String((a as any).note ?? '').includes('|deficit') || false
    byWorkerPost[name].push({ ...a, is_deficit: isDeficit })
  }

  const resequenced: any[] = []
  for (const workerTasks of Object.values(byWorkerPost)) {
    const getPriority = (ch: string) => ch === 'เสริม' ? 0 : channelPriority[ch] ?? 99

    // Compute SKU group order: group same-SKU tasks together, ordered by the SKU's
    // earliest (channel priority, deadline_time) so overall channel ordering is preserved.
    const skuFirstKey = new Map<string, { minPrio: number; minDeadline: string }>()
    for (const task of workerTasks) {
      if (task.isKept) continue
      const normSku = (task.sku as string).replace(/^0+/, '')
      const p = getPriority(task.channel as string)
      const d = (task.deadline_time as string) || ''
      const cur = skuFirstKey.get(normSku)
      if (!cur || p < cur.minPrio || (p === cur.minPrio && d < cur.minDeadline))
        skuFirstKey.set(normSku, { minPrio: p, minDeadline: d })
    }
    const skuGroupOrder = new Map<string, number>()
    Array.from(skuFirstKey.entries())
      .sort(([, a], [, b]) => a.minPrio !== b.minPrio ? a.minPrio - b.minPrio : a.minDeadline.localeCompare(b.minDeadline))
      .forEach(([sku], i) => skuGroupOrder.set(sku, i))

    workerTasks.sort((a, b) => {
      if (a.isKept && !b.isKept) return -1
      if (!a.isKept && b.isKept) return 1
      if (a.isKept && b.isKept) return 0

      // Normal tasks (is_deficit = false) MUST run before deficit tasks (is_deficit = true)
      const defA = a.is_deficit ? 1 : 0
      const defB = b.is_deficit ? 1 : 0
      if (defA !== defB) return defA - defB

      // Cross-station tasks must always run after own-station tasks regardless of channel priority
      const crossA = String(a.note ?? '').includes('cross:') ? 1 : 0
      const crossB = String(b.note ?? '').includes('cross:') ? 1 : 0
      if (crossA !== crossB) return crossA - crossB

      const normSkuA = (a.sku as string).replace(/^0+/, '')
      const normSkuB = (b.sku as string).replace(/^0+/, '')
      const groupDiff = (skuGroupOrder.get(normSkuA) ?? 999) - (skuGroupOrder.get(normSkuB) ?? 999)
      if (groupDiff !== 0) return groupDiff

      // Same SKU: sort by channel priority, then deadline_time
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

        // Concurrent secondary SKUs: pass through without advancing the sequential queue.
        // The concurrent-timing block below sets the final deadline_time to primary's start.
        if (secondarySkuSet.has(cleanSku)) {
          keptTasks.push(task)
          continue
        }

        const specialStart = specialTimeMap.get(cleanSku)?.startMins ?? specialTimeMap.get(task.sku as string)?.startMins ?? null

        if (specialStart !== null) {
          // It's a special task!
          const startMins = Math.max(curMins, specialStart)
          // For non-phase3: drop special tasks past phase cutoff
          if (!isPhase3 && startMins >= phaseEndMins) continue
          const endMins = wallClockFinish(startMins, duration)
          task.deadline_time = minsToTimeStr(startMins)
          busySegs.push({ start: startMins, end: endMins })
          // We do NOT update curMins to endMins, so it doesn't block regular tasks!
          keptTasks.push(task)
        } else {
          // It's a regular task!
          let startMins = curMins
          let advanced = true
          while (advanced) {
            advanced = false
            for (const seg of busySegs) {
              if (startMins >= seg.start - 0.01 && startMins < seg.end) {
                startMins = seg.end
                advanced = true
              }
            }
            for (const [bs, be] of BREAKS) {
              if (startMins >= bs && startMins < be) {
                startMins = be
                advanced = true
              }
            }
          }

          // For non-phase3: drop tasks that start at or after phase cutoff
          if (!isPhase3 && startMins >= phaseEndMins) continue

          // Cross-station tasks must not start before their allocated start time (which was
          // computed after own-station work finishes in the cross-station supplementary pass).
          const taskNote = String(task['note'] ?? '')
          if (taskNote.includes('cross:')) {
            const _dtp = (String(task['deadline_time'] ?? '00:00')).split(':').map(Number)
            const allocatedStart = ((_dtp[0] ?? 0) * 60) + (_dtp[1] ?? 0)
            if (allocatedStart > startMins) {
              startMins = allocatedStart
              let readvanced = true
              while (readvanced) {
                readvanced = false
                for (const seg of busySegs) {
                  if (startMins >= seg.start - 0.01 && startMins < seg.end) { startMins = seg.end; readvanced = true }
                }
                for (const [bs, be] of BREAKS) {
                  if (startMins >= bs && startMins < be) { startMins = be; readvanced = true }
                }
              }
            }
          }

          task.deadline_time = minsToTimeStr(startMins)
          let endMins = wallClockFinish(startMins, duration)

          // For non-phase3: if task runs past cutoff, truncate qty to what fits before cutoff
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

  // Concurrent SKU timing: secondary SKUs start at the same time as the primary SKU.
  // If a worker has multiple secondaries for the same primary, they run sequentially
  // (B starts when primary starts, C starts when B ends — concurrent with primary throughout).
  if (primarySkuSet.size > 0) {
    const toMins = (s: string) => { const p = (s || '00:00').split(':').map(Number); return (p[0] ?? 0) * 60 + (p[1] ?? 0) }

    // Group tasks by worker (use worker_name — same key as resequencing; worker_code may be null for kept assignments)
    const tasksByWorker = new Map<string, Record<string, unknown>[]>()
    for (const task of resequenced) {
      const wCode = String(task['worker_name'] ?? '')
      if (!tasksByWorker.has(wCode)) tasksByWorker.set(wCode, [])
      tasksByWorker.get(wCode)!.push(task)
    }

    for (const [, tasks] of Array.from(tasksByWorker.entries())) {
      // Find primary SKUs this worker has, and their earliest start time
      const workerPrimaryStart = new Map<string, number>()
      for (const task of tasks) {
        const normSku = (task['sku'] as string).replace(/^0+/, '')
        if (!primarySkuSet.has(normSku)) continue
        const startMins = toMins(task['deadline_time'] as string)
        const cur = workerPrimaryStart.get(normSku)
        if (cur === undefined || startMins < cur) workerPrimaryStart.set(normSku, startMins)
      }
      if (workerPrimaryStart.size === 0) continue

      // For each secondary task, find which primary it pairs with (prefer earliest-starting primary)
      const primaryToSecTasks = new Map<string, Record<string, unknown>[]>()
      for (const task of tasks) {
        const normSku = (task['sku'] as string).replace(/^0+/, '')
        if (!secondarySkuSet.has(normSku)) continue
        const linkedPrimaries = secondaryToPrimaries.get(normSku)
        if (!linkedPrimaries) continue
        const matchedPrimary = Array.from(linkedPrimaries)
          .filter(p => workerPrimaryStart.has(p))
          .sort((a, b) => (workerPrimaryStart.get(a) ?? 0) - (workerPrimaryStart.get(b) ?? 0))[0]
        if (!matchedPrimary) continue
        if (!primaryToSecTasks.has(matchedPrimary)) primaryToSecTasks.set(matchedPrimary, [])
        primaryToSecTasks.get(matchedPrimary)!.push(task)
      }

      // Stagger secondary tasks sequentially, starting at the primary's start time
      for (const [primarySku, secTasks] of Array.from(primaryToSecTasks.entries())) {
        const primaryStart = workerPrimaryStart.get(primarySku)!

        // Sort secondaries by channel priority then current start time (preserves allocation order)
        secTasks.sort((a, b) => {
          const getPrio = (t: Record<string, unknown>) => {
            const ch = String(t['channel'] ?? '')
            return ch === 'เสริม' ? 0 : (channelPriority[ch] ?? 99)
          }
          const pDiff = getPrio(a) - getPrio(b)
          if (pDiff !== 0) return pDiff
          return toMins(a['deadline_time'] as string) - toMins(b['deadline_time'] as string)
        })

        let curTime = primaryStart
        for (const secTask of secTasks) {
          const qty = Number(secTask['target_quantity'] ?? 0)
          const normSku = (secTask['sku'] as string).replace(/^0+/, '')
          const prod = skuMap.get(normSku) ?? skuMap.get(secTask['sku'] as string)
          const rate = prod?.rate ?? 0
          const durationMins = rate > 0 ? (qty / rate) * 60 : 0

          const note = String(secTask['note'] ?? '')
          // Cross-station secondaries must not start before their allocated start (which
          // was set after own-station work finishes). Pulling them back to primaryStart
          // would violate the cross-station timing constraint.
          if (note.includes('cross:')) {
            const allocatedStart = toMins(secTask['deadline_time'] as string)
            if (allocatedStart > curTime) curTime = allocatedStart
          }

          secTask['deadline_time'] = minsToTimeStr(curTime)
          if (!note.includes('|concurrent')) secTask['note'] = note ? note + '|concurrent' : 'concurrent'

          curTime += durationMins
        }
      }
    }
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
    a['seq'] = i; 
    a['effective_from'] = effectiveFromISO; 
    if (a.is_deficit && !a.note?.includes('|deficit')) {
      a.note = (a.note ?? '') + '|deficit'
    }
    a['is_deficit'] = !!a.is_deficit
  })
  assignments.length = 0
  assignments.push(...resequenced)

  // =========== ผลิต Raw ล่วงหน้า (Phase 3, driven by mas_raw_production_advance) ===========
  if (isPhase3) {
    const { data: rawAdvanceMaster } = await supabase
      .from('mas_raw_production_advance')
      .select('station, start_time, fg_sap, fg_name, raw_sap, raw_name')

    if (rawAdvanceMaster?.length) {
      const allHistOrders: OrderRow[] = [
        ...(wmHistRaw ?? []),
        ...(lotusHistRaw ?? []),
        ...(makroHistRaw ?? []),
      ]

      // Group master rows by (station + raw_sap + start_time) so each unique raw material gets one block
      type RawGroup = { station: string; raw_sap: string; raw_name: string; start_time: string; fgSaps: string[] }
      const groupMap = new Map<string, RawGroup>()
      for (const row of rawAdvanceMaster) {
        const key = `${row.station}|||${row.raw_sap}|||${row.start_time}`
        if (!groupMap.has(key)) {
          groupMap.set(key, { station: row.station, raw_sap: row.raw_sap, raw_name: row.raw_name ?? row.raw_sap, start_time: row.start_time, fgSaps: [] })
        }
        groupMap.get(key)!.fgSaps.push(String(row.fg_sap).replace(/^0+/, ''))
      }

      for (const group of groupMap.values()) {
        // For each FG, avg daily order qty over 7 hist days then sum → total raw qty needed
        let totalAvgQty = 0
        for (const normFgSap of group.fgSaps) {
          const dailyQty = new Map<string, number>()
          for (const ord of allHistOrders) {
            if (String(ord.sku).replace(/^0+/, '') !== normFgSap) continue
            const prev = dailyQty.get(ord.delivery_date) ?? 0
            dailyQty.set(ord.delivery_date, prev + Number(ord.quantity))
          }
          const vals = Array.from(dailyQty.values()).filter(v => v > 0)
          if (vals.length > 0) {
            const avgFgQty = vals.reduce((s, v) => s + v, 0) / vals.length
            totalAvgQty += avgFgQty * 0.98 * 0.60
          }
        }

        if (totalAvgQty <= 0) continue

        const rawWorkers = (workersByStation[group.station] ?? []).filter(w =>
          jobAssignMap.get(normName(w.name))?.groups.has('กลุ่ม Raw') ?? false
        )
        if (rawWorkers.length === 0) continue

        const qtyPerWorker = Math.round((totalAvgQty / rawWorkers.length) * 100) / 100
        const baseSeq = assignments.length
        const [stH, stM] = group.start_time.split(':').map(Number)
        const startTime = minsToTimeStr((isNaN(stH) ? 0 : stH) * 60 + (isNaN(stM) ? 0 : stM))

        for (let i = 0; i < rawWorkers.length; i++) {
          const w = rawWorkers[i]
          assignments.push({
            production_date: productionDate,
            table_name:      group.station,
            worker_code:     w.emp_id,
            worker_name:     w.name,
            sku:             group.raw_sap,
            sku_name:        group.raw_name,
            target_quantity: qtyPerWorker,
            unit:            'กก.',
            period:          phaseCfg.period,
            deadline_time:   startTime,
            note:            'ผลิต Raw ล่วงหน้า',
            status:          'รอดำเนินการ',
            channel:         'Manual',
            is_deficit:      false,
            seq:             baseSeq + i,
            effective_from:  effectiveFromISO,
          })
        }
      }
    }
  }
  // =========== End ผลิต Raw ล่วงหน้า ===========

  const { error } = await supabase.from('production_assignments').insert(assignments)
  if (error) throw error

  try {
    await autoGenerateWithdrawal(productionDate, selectedPhase)
  } catch (wdErr: any) {
    console.error('Failed to auto-generate withdrawal plan:', wdErr.message || wdErr)
  }

  const channelSummary = isPhase3
    ? 'แผน 100% − Ph1 − Ph2'
    : activeChannels
        .map(ch => {
          const targets = channelTargets[ch] ?? []
          const count = assignments.filter(a => targets.find(t => t.sku === a['sku'])).length
          return count > 0 ? `${ch} ${count}` : null
        }).filter(Boolean).join(', ')

  const debugChannelTargets: Record<string, { wm: number; makro: number; lotus: number; merged: number }> = {}
  for (const [ch, targets] of Object.entries(channelTargets)) {
    for (const t of targets) {
      const k = t.sku.replace(/^0+/, '')
      debugChannelTargets[k] ??= { wm: 0, makro: 0, lotus: 0, merged: 0 }
      if (ch === 'Wet Market') debugChannelTargets[k].wm += t.targetQty
      if (ch === 'Makro')      debugChannelTargets[k].makro += t.targetQty
      if (ch === 'LOTUS')      debugChannelTargets[k].lotus += t.targetQty
    }
  }
  for (const t of assignList) {
    const k = t.sku.replace(/^0+/, '')
    if (debugChannelTargets[k]) debugChannelTargets[k].merged = t.targetQty
  }

  return {
    success: true,
    isScheduled,
    effectiveFrom: effectiveTimeStr,
    message: (isScheduled
      ? `Phase ${selectedPhase} (${phaseCfg.period}) สร้างสำเร็จ ${assignments.length} รายการ — มีผลตั้งแต่ ${effectiveTimeStr} น. (${channelSummary})`
      : `Phase ${selectedPhase} (${phaseCfg.period}) สร้างสำเร็จ ${assignments.length} รายการ — ${channelSummary}`) + workforceFallbackNote,
    count: assignments.length,
    debug_targets: Object.entries(debugChannelTargets)
      .map(([sku, v]) => ({ sku, ...v }))
      .sort((a, b) => b.merged - a.merged)
      .slice(0, 30),
    debug_skips: debugSkips.slice(0, 50),
  }
}
