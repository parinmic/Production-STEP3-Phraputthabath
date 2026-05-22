import { NextRequest, NextResponse } from 'next/server'
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
  rate: number  // กก./ชม./คน
}

interface SkuTarget { sku: string; skuName: string | null; targetQty: number; channel: string }

function minsToTimeStr(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.floor(mins % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

// ========== Break config ==========

const BREAKS: [number, number][] = [
  [720,  780],  // 12:00–13:00
  [1020, 1080], // 17:00–18:00
]

/** Work minutes available between fromMins and toMins, excluding all breaks */
function availableWorkMins(fromMins: number, toMins: number): number {
  const total = Math.max(0, toMins - fromMins)
  const overlap = BREAKS.reduce((sum, [bs, be]) =>
    sum + Math.max(0, Math.min(be, toMins) - Math.max(bs, fromMins)), 0)
  return Math.max(0, total - overlap)
}

/** Wall-clock finish time when starting at fromMins and doing workMins of actual work */
function wallClockFinish(fromMins: number, workMins: number): number {
  if (workMins <= 0) return fromMins
  let pos = fromMins
  let remaining = workMins
  for (const [bs, be] of BREAKS) {
    if (pos >= bs && pos < be) pos = be  // jump past break if starting inside
    if (pos >= be) continue              // break already passed
    if (remaining <= 0) break
    const beforeBreak = bs - pos
    if (remaining <= beforeBreak) return pos + remaining
    remaining -= beforeBreak
    pos = be
  }
  return pos + remaining
}

// ========== Phase config ==========

const PHASE_CONFIG = [
  { phase: 1, period: 'เช้า',  deadline: '14:00:00', hours: 5.5, startH: 8.5,  endH: 14 },
  { phase: 2, period: 'บ่าย',  deadline: '16:00:00', hours: 2, startH: 14, endH: 16 },
  { phase: 3, period: 'ค่ำ',   deadline: null,        hours: 24, startH: 16, endH: 24 },
]

// round boundaries per phase (minutes from midnight)
const PHASE_ROUND_MINS: Record<number, number[]> = {
  1: [510, 600, 780],   // 08:30, 10:00, 13:00
  2: [840],             // 14:00
  3: [960, 1080, 1200], // 16:00, 18:00, 20:00
}

function getRoundMins(t: number, roundMins: number[]): number {
  let round = roundMins[0]
  for (const r of roundMins) {
    if (t >= r) round = r
    else break
  }
  return round
}

// ========== Station mapping ==========

const normalizeStation = (s: string) => s.replace(/[()]/g, '').trim()

const STATION_TABLE: Record<string, string> = {
  'สามชั้นพิเศษ': 'สามชั้น',
  'ไหล่พิเศษ':    'ไหล่',
  'สะโพกพิเศษ':   'สะโพก',
}

// ========== Helpers ==========

const normName = (s: string) => {
  if (!s) return ''
  return s.replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}

async function fetchWeeklyWorkforce(productionDate: string): Promise<WorkforceRow[]> {
  const types = ['sa-phok-special', 'lai-special', 'sam-chan-special']
  const workforce: WorkforceRow[] = []

  const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
  const DAY_ALIASES: Record<string, string[]> = {
    'อาทิตย์': ['อาทิตย์', 'อา.'],
    'จันทร์': ['จันทร์', 'จ.'],
    'อังคาร': ['อังคาร', 'อ.'],
    'พุธ': ['พุธ', 'พ.'],
    'พฤหัสบดี': ['พฤหัสบดี', 'พฤหัส', 'พฤ.'],
    'ศุกร์': ['ศุกร์', 'ศ.'],
    'เสาร์': ['เสาร์', 'ส.']
  }

  const checkIsDayOff = (dayOffVal: string, dateStr: string) => {
    if (!dayOffVal || !dateStr) return false
    const parts = dateStr.split('-')
    if (parts.length !== 3) return false
    const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    const dayIndex = dateObj.getDay()
    const dayName = THAI_DAYS[dayIndex]
    
    const normalizedVal = dayOffVal.trim().toLowerCase()
    const aliases = DAY_ALIASES[dayName] || [dayName]
    
    return aliases.some(alias => normalizedVal.includes(alias.toLowerCase()))
  }

  const getFieldValue = (rowData: Record<string, any>, prefixes: string[]): string => {
    if (!rowData) return ''
    for (const prefix of prefixes) {
      if (rowData[prefix] !== undefined && rowData[prefix] !== null) {
        return String(rowData[prefix]).trim()
      }
    }
    const keys = Object.keys(rowData)
    for (const prefix of prefixes) {
      const foundKey = keys.find(k => k.toLowerCase().includes(prefix.toLowerCase()))
      if (foundKey && rowData[foundKey] !== undefined && rowData[foundKey] !== null) {
        return String(rowData[foundKey]).trim()
      }
    }
    return ''
  }

  const stationMap: Record<string, string> = {
    'sa-phok-special': 'สะโพกพิเศษ',
    'sam-chan-special': 'สามชั้นพิเศษ',
    'lai-special': 'ไหล่พิเศษ'
  }

  // Fetch status overrides for the production date
  const { data: statusOverrides } = await supabase
    .from('workforce_daily_status')
    .select('weekly_type, worker_name, status')
    .eq('work_date', productionDate)

  const overrideMap = new Map<string, string>()
  if (statusOverrides) {
    for (const item of statusOverrides) {
      overrideMap.set(`${item.weekly_type}_${item.worker_name}`, item.status)
    }
  }

  for (const type of types) {
    const logTableName = `workforce_weekly_${type.replace(/-/g, '_')}`
    
    const { data: latestLog } = await supabase
      .from('upload_log')
      .select('source_file')
      .eq('table_name', logTableName)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latestLog) continue

    const { data: weeklyData } = await supabase
      .from('workforce_weekly')
      .select('row_data')
      .eq('weekly_type', type)
      .eq('source_file', latestLog.source_file)

    if (!weeklyData) continue

    for (const row of weeklyData) {
      const rowData = (row.row_data ?? {}) as Record<string, any>
      const name = getFieldValue(rowData, ['รายชื่อพนักงาน', 'ชื่อจริง', 'ชื่อพนักงาน', 'ชื่อ', 'name', 'full_name'])
      if (!name) continue
      
      // Determine work status: check override first, then fall back to default day off
      const overrideStatus = overrideMap.get(`${type}_${name}`)
      let isWorking = true

      if (overrideStatus) {
        isWorking = overrideStatus === 'ทำงาน'
      } else {
        const dayOffStr = getFieldValue(rowData, ['วันหยุดประจำสัปดาห์', 'วันหยุดประจำ', 'วันหยุด', 'หยุด', 'dayoff', 'day_off', 'day off'])
        isWorking = !checkIsDayOff(dayOffStr, productionDate)
      }

      if (!isWorking) {
        continue
      }

      const shiftStr = getFieldValue(rowData, ['กะทำงาน', 'กะ', 'กะงาน', 'shift'])
      let shift = 'กะ 1'
      const normalizedShift = shiftStr.trim()
      if (normalizedShift === '2' || normalizedShift.includes('2')) {
        shift = 'กะ 2'
      }

      workforce.push({
        emp_id: name,
        name: name,
        work_station: stationMap[type] ?? type,
        shift: shift
      })
    }
  }

  return workforce
}

function parseProductivity(rows: Record<string, unknown>[]): ProductivityRow[] {
  return rows
    .map(r => ({
      station:       String(r['จุดงาน'] ?? '').trim(),
      product_group: String(r['กลุ่มสินค้า'] ?? '').trim(),
      sku:           String(r['SAP'] ?? '').trim(),
      sku_name:      String(r['ชื่อสินค้า'] ?? '').trim(),
      rate:          Number(r['กำลังการผลิต (กก./ชม./คน)'] ?? 0),
    }))
    .filter(r => r.station && r.sku && r.rate > 0)
}

/** Build map: normalized worker name → { isWeigher, groups: Map<groupName, skillLevel> }
 *  skillLevel: 1 = ดีเยี่ยม, 2 = รองลงมา */
function buildJobAssignMap(rows: { row_data: Record<string, unknown> }[]) {
  const map = new Map<string, { isWeigher: boolean; groups: Map<string, number> }>()
  for (const row of rows) {
    const r        = row.row_data
    const fullName = normName(String(r['รายชื่อพนักงาน'] ?? ''))
    if (!fullName) continue
    const isWeigher = Number(r['ชั่งน้ำหนัก'] ?? 0) === 1
    const groups    = new Map<string, number>()
    for (const [key, val] of Object.entries(r)) {
      if (!key.startsWith('กลุ่ม')) continue
      if (val === null || val === undefined) continue
      const level    = Number(val)
      const cleanKey = key.replace(/_\d+$/, '')
      if (!groups.has(cleanKey) || level < (groups.get(cleanKey) ?? 99))
        groups.set(cleanKey, level)
    }
    map.set(fullName, { isWeigher, groups })
  }
  return map
}

/** Average quantity per SKU across up to 3 historical days */
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

/** Lookup %Variance for Wet Market */
function getWetMarketVariance(
  isShared: boolean,
  quotaToday: number,
  avgBL3: number,
  lotusBL3: number,
): number {
  if (!isShared) {
    return Math.min(quotaToday, avgBL3) > 100 ? 0.5 : 0.3
  }
  const ratio = lotusBL3 > 0 ? Math.min(quotaToday, avgBL3) / lotusBL3 : 999
  return ratio > 0.5 ? 0.5 : 0.7
}

/** Lookup %Variance for Makro (6-cell matrix) */
function getMakroVariance(proportionAbove10pct: boolean, orderQty: number, avgBL3: number): number {
  const trend = avgBL3 > 0 ? orderQty / avgBL3 : 2
  if (trend > 1.0) return 1.0
  if (trend > 0.8) return 0.8
  return proportionAbove10pct ? 0.6 : 0.4
}

/** Cap number of workers based on target quantity */
function maxWorkersForQty(qty: number): number {
  if (qty <= 15) return 1
  if (qty <= 30) return 2
  if (qty <= 45) return 3
  return Infinity
}

/**
 * Dynamic work queue with per-phase time cap.
 *
 * Workers join the shared SKU pool as they become free (earliest first).
 * Each worker is capped at phaseEndMins and their own remainingHours.
 * When a worker exhausts their capacity mid-SKU, remaining work flows to others.
 *
 * Example: pool=90 kg, rate=60 kg/hr, A@08:00, B@09:00, C@10:00, phase ends 14:00
 *   Segment [08:00–09:00]: A alone → 60 kg consumed, 30 left
 *   Segment [09:00–...]:   A+B split 30 → done at 09:15
 *   C never joins (pool exhausted)
 */
function getWorkerFreeAt(
  nameKey: string,
  workerFreeAtMins: Map<string, number>,
  workerBusySegments: Map<string, { start: number; end: number }[]>,
  phaseStartMins: number
): number {
  let freeAt = workerFreeAtMins.get(nameKey) ?? phaseStartMins
  const segments = workerBusySegments.get(nameKey) ?? []
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  let advanced = true
  while (advanced) {
    advanced = false
    for (const seg of sorted) {
      if (freeAt >= seg.start - 0.01 && freeAt < seg.end) {
        freeAt = seg.end
        advanced = true
      }
    }
  }
  return freeAt
}

function getNextBusyStart(
  nameKey: string,
  workerBusySegments: Map<string, { start: number; end: number }[]>,
  afterMins: number
): number {
  const segments = workerBusySegments.get(nameKey) ?? []
  let nextStart = Infinity
  for (const seg of segments) {
    if (seg.start >= afterMins - 0.01) {
      nextStart = Math.min(nextStart, seg.start)
    }
  }
  return nextStart
}

function assignWorkers(
  params: {
    productionDate: string
    tableName: string
    sku: string
    skuName: string | null
    targetQty: number
    eligibleWorkers: WorkforceRow[]
    rate: number
    workerHours: Map<string, number>
    workerFreeAtMins: Map<string, number>
    workerBusySegments?: Map<string, { start: number; end: number }[]>
    phaseEndMins: number
    period: string
    deadline: string | null
    channel: string
    phaseRoundMins: number[]
    wpb?: number
    specialStartMins?: number | null
    specialStopMins?: number | null
  }
): Record<string, unknown>[] {
  const {
    productionDate, tableName, sku, skuName, targetQty,
    eligibleWorkers, rate, workerHours, workerFreeAtMins, workerBusySegments, phaseEndMins, period, channel, phaseRoundMins, wpb,
    specialStartMins, specialStopMins,
  } = params

  let entries = eligibleWorkers
    .map(w => {
      const nameKey = normName(w.name)
      const phaseStartMins = phaseRoundMins[0] ?? 510
      const currentFree = (workerBusySegments && workerFreeAtMins)
        ? getWorkerFreeAt(nameKey, workerFreeAtMins, workerBusySegments, phaseStartMins)
        : (workerFreeAtMins.get(nameKey) ?? 0)

      const freeAt = specialStartMins !== null && specialStartMins !== undefined
        ? Math.max(currentFree, specialStartMins)
        : currentFree

      const limitEnd = (workerBusySegments)
        ? Math.min(phaseEndMins, getNextBusyStart(nameKey, workerBusySegments, freeAt))
        : phaseEndMins

      const remainingHours  = workerHours.get(nameKey) ?? 0
      const targetEndMins = specialStopMins !== null && specialStopMins !== undefined
        ? Math.min(limitEnd, specialStopMins)
        : limitEnd

      const availWorkMins   = Math.min(remainingHours * 60, Math.max(0, availableWorkMins(freeAt, targetEndMins)))
      const exhaustAt       = wallClockFinish(freeAt, availWorkMins)
      const capacity        = (availWorkMins * rate) / 60
      return { worker: w, nameKey, freeAt, exhaustAt, remainingHours, capacity }
    })
    .filter(e => e.exhaustAt > e.freeAt + 0.1)
    .sort((a, b) => a.freeAt - b.freeAt)

  if (!entries.length) return []

  // Approach 3: Greedy Job-Contiguity
  // Only keep workers whose freeAt is within a 90 minutes window of the earliest worker,
  // but only if their combined capacity is enough to cover the targetQty.
  const minFreeAt = entries[0].freeAt
  const windowEntries = entries.filter(e => e.freeAt <= minFreeAt + 90)
  const totalWindowCapacity = windowEntries.reduce((sum, e) => sum + e.capacity, 0)
  if (totalWindowCapacity >= targetQty) {
    entries = windowEntries
  }

  // Include round boundaries so segments never straddle a round
  const eventTimes = Array.from(
    new Set([...entries.flatMap(e => [e.freeAt, e.exhaustAt]), ...BREAKS.flat(), ...phaseRoundMins])
  ).sort((a, b) => a - b)

  let pool = targetQty
  const workerQty      = new Map<string, number>()
  const workerFinishAt = new Map<string, number>()
  // per-worker per-round qty: workerRoundQty[nameKey][roundMins] = qty
  const workerRoundQty = new Map<string, Map<number, number>>()

  for (let i = 0; i < eventTimes.length - 1 && pool > 0.01; i++) {
    const t0 = eventTimes[i]
    const t1 = eventTimes[i + 1]

    if (BREAKS.some(([bs, be]) => t0 >= bs && t1 <= be)) continue

    const active = entries.filter(e => e.freeAt <= t0 && e.exhaustAt > t0)
    if (!active.length) continue

    const totalRate  = active.length * rate
    const maxConsume = totalRate * (t1 - t0) / 60
    const segRound   = getRoundMins(t0, phaseRoundMins)

    if (maxConsume >= pool) {
      const perWorkerQty = pool / active.length
      const finishAt     = t0 + (pool / totalRate) * 60
      for (const a of active) {
        workerQty.set(a.nameKey, (workerQty.get(a.nameKey) ?? 0) + perWorkerQty)
        workerFinishAt.set(a.nameKey, finishAt)
        const rq = workerRoundQty.get(a.nameKey) ?? new Map<number, number>()
        rq.set(segRound, (rq.get(segRound) ?? 0) + perWorkerQty)
        workerRoundQty.set(a.nameKey, rq)
      }
      pool = 0
    } else {
      const perWorkerQty = rate * (t1 - t0) / 60
      for (const a of active) {
        workerQty.set(a.nameKey, (workerQty.get(a.nameKey) ?? 0) + perWorkerQty)
        workerFinishAt.set(a.nameKey, t1)
        const rq = workerRoundQty.get(a.nameKey) ?? new Map<number, number>()
        rq.set(segRound, (rq.get(segRound) ?? 0) + perWorkerQty)
        workerRoundQty.set(a.nameKey, rq)
      }
      pool -= maxConsume
    }
  }

  // Get all active entries
  const activeEntries = entries.filter(e => (workerQty.get(e.nameKey) ?? 0) >= 0.5)
  if (!activeEntries.length) return []

  const totalAssignedFloat = targetQty - pool
  let workerDiffs: { nameKey: string; entry: typeof entries[0]; rawVal: number; rounded: number; error: number }[]

  if (wpb && wpb > 0) {
    const totalAssignedBagsFloat = totalAssignedFloat / wpb
    const totalAssignedBagsTarget = Math.round(totalAssignedBagsFloat)

    const bagDiffs = activeEntries.map(e => {
      const rawVal = workerQty.get(e.nameKey) ?? 0
      const rawBags = rawVal / wpb
      const roundedBags = Math.round(rawBags)
      const error = rawBags - roundedBags
      return {
        nameKey: e.nameKey,
        entry: e,
        rawVal,
        roundedBags,
        error
      }
    })

    let roundedBagsSum = bagDiffs.reduce((sum, item) => sum + item.roundedBags, 0)
    let diffBags = totalAssignedBagsTarget - roundedBagsSum

    if (diffBags > 0) {
      bagDiffs.sort((a, b) => b.error - a.error)
      for (let i = 0; i < diffBags && i < bagDiffs.length; i++) {
        bagDiffs[i].roundedBags += 1
      }
    } else if (diffBags < 0) {
      bagDiffs.sort((a, b) => a.error - b.error)
      const absDiff = Math.abs(diffBags)
      for (let i = 0; i < absDiff && i < bagDiffs.length; i++) {
        bagDiffs[i].roundedBags = Math.max(0, bagDiffs[i].roundedBags - 1)
      }
    }

    workerDiffs = bagDiffs.map(b => ({
      nameKey: b.nameKey,
      entry: b.entry,
      rawVal: b.rawVal,
      rounded: b.roundedBags * wpb,
      error: b.error
    }))
  } else {
    const totalAssignedTarget = Math.round(totalAssignedFloat)

    workerDiffs = activeEntries.map(e => {
      const rawVal = workerQty.get(e.nameKey) ?? 0
      const rounded = Math.round(rawVal)
      const error = rawVal - rounded
      return {
        nameKey: e.nameKey,
        entry: e,
        rawVal,
        rounded,
        error
      }
    })

    let roundedSum = workerDiffs.reduce((sum, item) => sum + item.rounded, 0)
    let diff = totalAssignedTarget - roundedSum

    if (diff > 0) {
      workerDiffs.sort((a, b) => b.error - a.error)
      for (let i = 0; i < diff && i < workerDiffs.length; i++) {
        workerDiffs[i].rounded += 1
      }
    } else if (diff < 0) {
      workerDiffs.sort((a, b) => a.error - b.error)
      const absDiff = Math.abs(diff)
      for (let i = 0; i < absDiff && i < workerDiffs.length; i++) {
        workerDiffs[i].rounded = Math.max(0, workerDiffs[i].rounded - 1)
      }
    }
  }

  const result: Record<string, unknown>[] = []
  for (const item of workerDiffs) {
    const e = item.entry
    const qty = item.rounded
    if (qty < 0.5) continue
    const finishAt = workerFinishAt.get(e.nameKey) ?? e.freeAt
    workerHours.set(e.nameKey, e.remainingHours - qty / rate)

    if (workerBusySegments && workerFreeAtMins) {
      const start = e.freeAt
      const end = finishAt
      const segs = workerBusySegments.get(e.nameKey) ?? []
      segs.push({ start, end })
      workerBusySegments.set(e.nameKey, segs)

      const currentFree = workerFreeAtMins.get(e.nameKey) ?? (phaseRoundMins[0] ?? 510)
      if (start <= currentFree + 0.01) {
        workerFreeAtMins.set(e.nameKey, end)
      }
      const phaseStartMins = phaseRoundMins[0] ?? 510
      const resolvedFree = getWorkerFreeAt(e.nameKey, workerFreeAtMins, workerBusySegments, phaseStartMins)
      workerFreeAtMins.set(e.nameKey, resolvedFree)
    } else {
      workerFreeAtMins.set(e.nameKey, finishAt)
    }

    const rq = workerRoundQty.get(e.nameKey) ?? new Map<number, number>()
    const roundsNote = 'rounds:' + Array.from(rq.entries())
      .map(([rm, q]) => `${rm}=${Math.round(q * 100) / 100}`)
      .join(';')

    result.push({
      production_date: productionDate,
      table_name:      tableName,
      worker_code:     e.worker.emp_id,
      worker_name:     e.worker.name,
      sku,
      sku_name:        skuName,
      target_quantity: qty,
      unit:            'กก.',
      period,
      deadline_time:   minsToTimeStr(e.freeAt),
      note:            roundsNote,
      status:          'รอดำเนินการ',
      channel,
    })
  }

  return result
}

/**
 * Merge same-SKU entries in the regular assign list (Pass 2) by summing their quantities.
 * Preserves the first occurrence's channel and metadata.
 * Special-timed SKUs retain their order relative to normal SKUs.
 * NOTE: Supplementary-order entries (Pass 1) are NOT included here — they run first
 * with their own deadline cap and must never be merged into regular quantities.
 */
function mergeAssignList(list: SkuTarget[]): SkuTarget[] {
  const merged = new Map<string, SkuTarget>()
  const order: string[] = []
  for (const item of list) {
    const key = item.sku.replace(/^0+/, '')
    if (merged.has(key)) {
      merged.get(key)!.targetQty += item.targetQty
    } else {
      merged.set(key, { ...item })
      order.push(key)
    }
  }
  return order.map(k => merged.get(k)!)
}

// ========== Main ==========

// Paginate Supabase queries to bypass the 1000-row hard limit
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

// ========== Checkpoint Scheduling ==========

/**
 * Returns the next 30-min checkpoint boundary from a given time.
 * :00–:19 → XX:30   (same hour)
 * :20–:49 → (XX+1):00
 * :50–:59 → (XX+1):30
 */
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

// ========== Auto-generate Withdrawal Request ==========

async function autoGenerateWithdrawal(productionDate: string, selectedPhase: number) {
  const phaseStr = String(selectedPhase)
  const periodMap: Record<string, string> = { '1': 'เช้า', '2': 'บ่าย', '3': 'ค่ำ' }
  const period = periodMap[phaseStr]
  if (!productionDate || !period) return

  const roundMinsConfig: Record<string, number[]> = {
    '1': [480, 600, 780],
    '2': [840],
    '3': [960, 1080, 1200],
  }
  const defaultStartMinsConfig: Record<string, number> = {
    '1': 480, '2': 840, '3': 960,
  }

  const roundMins = roundMinsConfig[phaseStr] ?? roundMinsConfig['1']

  function minsToTime(mins: number): string {
    const h = Math.floor(mins / 60)
    const m = Math.floor(mins % 60)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const normMatName = (s: string) => s.trim().toLowerCase().replace(/\s*-\s*/g, '-')

  function timeStrToMins(t: string): number {
    const parts = String(t ?? '').split(':')
    return parseInt(parts[0] ?? '0') * 60 + parseInt(parts[1] ?? '0')
  }

  function getRoundMins(startMins: number, roundMinsArray: number[]): number {
    let round = roundMinsArray[0]
    for (const r of roundMinsArray) {
      if (startMins >= r) round = r
      else break
    }
    return round
  }

  function parseRoundNoteLocal(note: string | null): Map<number, number> {
    const result = new Map<number, number>()
    if (!note?.startsWith('rounds:')) return result
    for (const part of note.replace('rounds:', '').split(';')) {
      const [rStr, qStr] = part.split('=')
      if (rStr && qStr) result.set(parseInt(rStr), parseFloat(qStr))
    }
    return result
  }

  interface LotInfo {
    spec_code: string
    factory: string
    prod_date: string
    available: number
    to_withdraw: number
    insufficient?: boolean
  }

  function parseSpecCodeLocal(s: string): { factory: string; prod_date: string; sortKey: string } | null {
    const m1 = s.match(/[A-Z]+(\d{2})(\d{2})(\d{2})/)
    if (m1) return {
      factory:   m1[1],
      prod_date: `${m1[2]}/${m1[3]}`,
      sortKey:   `${m1[3]}${m1[2]}`,
    }
    const m2 = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})[A-Z]/)
    if (m2) return {
      factory:   m2[1],
      prod_date: `${m2[3]}/${m2[2]}`,
      sortKey:   `${m2[2]}${m2[3]}${m2[4]}`,
    }
    return null
  }

  function allocateFIFOLocal(
    lots: { spec_code: string; weight: number; factory: string; prod_date: string }[],
    needed: number,
  ): LotInfo[] {
    const result: LotInfo[] = []
    let remaining = needed
    for (const lot of lots) {
      if (remaining <= 0.005) break
      if (lot.weight <= 0.005) continue
      const take = Math.min(remaining, lot.weight)
      result.push({
        spec_code:   lot.spec_code,
        factory:     lot.factory,
        prod_date:   lot.prod_date,
        available:   Math.round(lot.weight * 100) / 100,
        to_withdraw: Math.round(take  * 100) / 100,
      })
      lot.weight -= take
      remaining  -= take
    }
    if (remaining > 0.005) {
      result.push({
        spec_code:   '— ไม่เพียงพอ —',
        factory:     '-',
        prod_date:   '-',
        available:   0,
        to_withdraw: Math.round(remaining * 100) / 100,
        insufficient: true,
      })
    }
    return result
  }

  // 1. Fetch production assignments
  const { data: assignments, error: e1 } = await supabase
    .from('production_assignments')
    .select('table_name, sku, sku_name, target_quantity, deadline_time, note')
    .eq('production_date', productionDate)
    .eq('period', period)
    .in('table_name', ['สามชั้น', 'สะโพก', 'ไหล่'])

  if (e1) throw new Error(`Fetch assignments error: ${e1.message}`)
  if (!assignments?.length) return

  // 2. Build finRoundMap: (station|||sku) → Map<roundMins, qty>
  const finRoundMap = new Map<string, Map<number, number>>()
  const finNameMap  = new Map<string, string | null>()
  const skuSet      = new Set<string>()

  for (const a of assignments) {
    const key = `${a.table_name}|||${a.sku}`
    if (!finRoundMap.has(key)) finRoundMap.set(key, new Map())
    finNameMap.set(key, a.sku_name ?? null)
    skuSet.add(a.sku)

    const roundQtys = finRoundMap.get(key)!
    const noteRounds = parseRoundNoteLocal(a.note)

    if (noteRounds.size > 0) {
      for (const [rm, q] of Array.from(noteRounds.entries())) {
        const mappedRm = getRoundMins(rm, roundMins)
        roundQtys.set(mappedRm, (roundQtys.get(mappedRm) ?? 0) + q)
      }
    } else {
      const startMins = a.deadline_time
        ? timeStrToMins(String(a.deadline_time))
        : (defaultStartMinsConfig[phaseStr] ?? 480)
      const rm = getRoundMins(startMins, roundMins)
      roundQtys.set(rm, (roundQtys.get(rm) ?? 0) + Number(a.target_quantity))
    }
  }

  // 3. Fetch BOM
  const skus = Array.from(skuSet)
  const { data: bomRows, error: e2 } = await supabase
    .from('bom_items')
    .select('product_sap, raw_sap, raw_name, yield_pct')
    .in('product_sap', skus)
  if (e2) throw new Error(`Fetch BOM error: ${e2.message}`)

  const bomMap = new Map<string, { raw_sap: string; raw_name: string | null; yield_pct: number }[]>()
  for (const b of bomRows ?? []) {
    if (!b.raw_sap) continue
    const list = bomMap.get(b.product_sap) ?? []
    list.push({ raw_sap: b.raw_sap, raw_name: b.raw_name ?? null, yield_pct: b.yield_pct ?? 0 })
    bomMap.set(b.product_sap, list)
  }

  // 4. Calculate raw material requirements
  interface RawEntry { station: string; raw_sap: string; raw_name: string | null; qty: number; roundMins: number }
  const rawMap = new Map<string, RawEntry>()
  const rawToProducts = new Map<string, { sku: string; sku_name: string | null; qty: number }[]>()
  const noBom: { station: string; sku: string; sku_name: string | null; qty: number; roundMins: number }[] = []

  for (const [finKey, roundQtys] of Array.from(finRoundMap.entries())) {
    const [station, sku] = finKey.split('|||')
    const sku_name = finNameMap.get(finKey) ?? null
    const boms = bomMap.get(sku)

    for (const [rm, finQty] of Array.from(roundQtys.entries())) {
      if (!boms?.length) {
        noBom.push({ station, sku, sku_name, qty: finQty, roundMins: rm })
        continue
      }
      for (const b of boms) {
        const rawQty = b.yield_pct > 0 ? finQty / b.yield_pct : finQty
        const rawKey = `${station}|||${b.raw_sap}|||${rm}`
        const cur = rawMap.get(rawKey)
        if (cur) { cur.qty += rawQty }
        else { rawMap.set(rawKey, { station, raw_sap: b.raw_sap, raw_name: b.raw_name, qty: rawQty, roundMins: rm }) }
        const prodList = rawToProducts.get(rawKey) ?? []
        prodList.push({ sku, sku_name, qty: finQty })
        rawToProducts.set(rawKey, prodList)
      }
    }
  }

  // 5. Fetch stock
  const rawSaps  = Array.from(new Set(Array.from(rawMap.values()).map(v => v.raw_sap)))
  type StockRow = { material_code: string; material_name: string | null; spec_code: string; weight_total: number }
  const stockRows: StockRow[] = []

  if (rawSaps.length > 0) {
    const [res0010, res20] = await Promise.all([
      supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
    ])
    stockRows.push(...(res0010.data ?? []) as StockRow[], ...(res20.data ?? []) as StockRow[])
  }

  // Name-based fallback
  const foundCodes = new Set(stockRows.map(r => r.material_code))
  const missingNames = Array.from(new Set(
    Array.from(rawMap.values())
      .filter(v => !foundCodes.has(v.raw_sap))
      .map(v => v.raw_name)
      .filter(Boolean) as string[]
  ))
  if (missingNames.length > 0) {
    const expandedNames = Array.from(new Set(missingNames.flatMap(n => [
      n,
      n.replace(/\s*-\s*/g, '-'),
      n.replace(/\s*-\s*/g, ' - '),
    ])))
    const [res0010n, res20n] = await Promise.all([
      supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
    ])
    stockRows.push(...(res0010n.data ?? []) as StockRow[], ...(res20n.data ?? []) as StockRow[])
  }

  type LotEntry = { spec_code: string; weight: number; factory: string; prod_date: string; sortKey: string }
  const lotAggCode = new Map<string, number>()
  const matCodeToName = new Map<string, string>()
  for (const row of stockRows) {
    if (!row.material_code || !row.spec_code) continue
    const k = `${row.material_code}|||${row.spec_code}`
    lotAggCode.set(k, (lotAggCode.get(k) ?? 0) + Number(row.weight_total))
    if (row.material_name) matCodeToName.set(row.material_code, row.material_name)
  }

  const stockByMat  = new Map<string, LotEntry[]>()
  const stockByName = new Map<string, LotEntry[]>()
  for (const [k, weight] of Array.from(lotAggCode.entries())) {
    const [matCode, spec_code] = k.split('|||')
    const parsed = parseSpecCodeLocal(spec_code)
    const lot: LotEntry = { spec_code, weight, factory: parsed?.factory ?? '-', prod_date: parsed?.prod_date ?? '-', sortKey: parsed?.sortKey ?? spec_code }

    const codeList = stockByMat.get(matCode) ?? []
    codeList.push(lot)
    stockByMat.set(matCode, codeList)

    const matName = matCodeToName.get(matCode)
    if (matName) {
      const nameKey = normMatName(matName)
      const nameList = stockByName.get(nameKey) ?? []
      nameList.push(lot)
      stockByName.set(nameKey, nameList)
    }
  }
  for (const list of Array.from(stockByMat.values())) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  for (const list of Array.from(stockByName.values())) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  // 6. Generate preview items
  const rawItems = Array.from(rawMap.values())
    .sort((a, b) => a.roundMins - b.roundMins)
    .map(({ station, raw_sap, raw_name, qty, roundMins }) => {
      const needed  = Math.round(qty * 100) / 100
      const nameKey = normMatName(raw_name ?? '')
      const lots    = stockByMat.get(raw_sap) ?? stockByName.get(nameKey)
      const rawKey  = `${station}|||${raw_sap}|||${roundMins}`
      return {
        sku:              raw_sap,
        sku_name:         raw_name,
        quantity:         needed,
        unit:             'กก.',
        work_station:     station,
        note:             'คำนวณจาก BOM',
        lots:             lots ? allocateFIFOLocal(lots, needed) : [],
        for_products:     rawToProducts.get(rawKey) ?? [],
        withdrawal_round: minsToTime(roundMins),
      }
    })

  const noBomItems = noBom.map(({ station, sku, sku_name, qty, roundMins }) => ({
    sku,
    sku_name,
    quantity:         Math.round(qty * 100) / 100,
    unit:             'กก.',
    work_station:     station,
    note:             'ไม่พบ BOM — ใช้ปริมาณผลิตโดยตรง',
    lots:             [] as LotInfo[],
    for_products:     [] as { sku: string; sku_name: string | null; qty: number }[],
    withdrawal_round: minsToTime(roundMins),
  }))

  const items = [...rawItems, ...noBomItems].sort((a, b) =>
    a.withdrawal_round.localeCompare(b.withdrawal_round) ||
    (a.work_station ?? '').localeCompare(b.work_station ?? '') ||
    (a.sku ?? '').localeCompare(b.sku ?? '')
  )

  // 7. Flatten to final records to insert
  const encodeFPTag = (products: { sku: string; sku_name: string | null; qty: number }[]) => {
    if (!products.length) return ''
    const s = products
      .map(p => `${p.sku}~${(p.sku_name ?? '').replace(/[|~[\]]/g, ' ')}~${p.qty}`)
      .join('|')
    return `[FP:${s}] `
  }

  const flatItems = items.flatMap(item => {
    const fpTag = encodeFPTag(item.for_products ?? [])
    const roundPrefix = item.withdrawal_round ? `[Round: ${item.withdrawal_round}] ` : ''
    if (!item.lots?.length) return [
      {
        sku:          item.sku,
        sku_name:     item.sku_name,
        quantity:     item.quantity,
        unit:         item.unit,
        work_station: item.work_station,
        note:         `${roundPrefix}${fpTag}${item.note ?? ''}`,
      }
    ]
    return item.lots.map(lot => ({
      sku:          item.sku,
      sku_name:     item.sku_name,
      quantity:     lot.to_withdraw,
      unit:         item.unit,
      work_station: item.work_station,
      note: lot.insufficient
        ? `${roundPrefix}${fpTag}ไม่เพียงพอในสต็อก (ขาด ${lot.to_withdraw} กก.)`
        : `${roundPrefix}${fpTag}Lot: ${lot.spec_code} | รร.${lot.factory} | ผลิต ${lot.prod_date}`,
    }))
  })

  if (!flatItems.length) return

  // 8. Delete and insert to Supabase
  await supabase
    .from('withdrawal_requests')
    .delete()
    .eq('request_date', productionDate)
    .eq('phase', selectedPhase)

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
  if (insertErr) {
    throw new Error(`Insert withdrawal requests error: ${insertErr.message}`)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { date, phase: phaseParam, deductMode: rawDeductMode } = await req.json()
    const defaultDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    const productionDate: string = date ?? defaultDate
    const selectedPhase: number = phaseParam ? Number(phaseParam) : 1
    const deductMode: 'plan' | 'actual' | 'yield' =
      rawDeductMode === 'actual' || rawDeductMode === 'yield' ? rawDeductMode : 'plan'
    const isPhase2 = selectedPhase === 2
    const isPhase3 = selectedPhase === 3

    const phaseCfg = PHASE_CONFIG.find(p => p.phase === selectedPhase)
    if (!phaseCfg) return NextResponse.json({ success: false, message: 'Phase ไม่ถูกต้อง' }, { status: 400 })

    // ── Checkpoint scheduling: ถ้ามีแผนเดิมอยู่ แผนใหม่จะมีผลตั้งแต่ checkpoint ถัดไป ──
    const now = new Date()
    const { data: latestAssign } = await supabase
      .from('production_assignments')
      .select('effective_from')
      .eq('production_date', productionDate)
      .eq('period', phaseCfg.period)
      .lte('effective_from', now.toISOString())
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    // effective_from: ถ้ามีแผนเดิม และเป็น Phase 1 → แผนใหม่เริ่มมีผลที่ checkpoint ถัดไป | ถ้าไม่ใช่ → มีผลทันที
    const useRegen = !!latestAssign?.effective_from && selectedPhase === 1
    const effectiveFrom: Date = useRegen
      ? getNextCheckpoint(now)
      : now
    const effectiveFromISO = effectiveFrom.toISOString()
    
    // Resolve hours and minutes in Asia/Bangkok timezone to prevent server timezone mismatch
    const bangkokTime = new Date(effectiveFrom.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
    const bangkokHours = bangkokTime.getHours()
    const bangkokMinutes = bangkokTime.getMinutes()

    const effectiveTimeStr = `${String(bangkokHours).padStart(2, '0')}:${String(bangkokMinutes).padStart(2, '0')}`
    const isScheduled = effectiveFrom > now

    const checkpointMins = useRegen
      ? (bangkokHours * 60 + bangkokMinutes)
      : (phaseCfg.startH * 60)

    const d = new Date(productionDate)
    const histDates = [1, 2, 3].map(n => {
      const h = new Date(d); h.setDate(d.getDate() - n)
      return h.toISOString().split('T')[0]
    })

    // Phase 2 reads orders from 1400 round; Phase 1 from 0800
    const orderRound = isPhase2 ? '1400' : '0800'

    // ------ Load all data in parallel ------
    const [
      { data: workforceRaw0800 },
      { data: workforceRaw1300 },
      wmTodayRaw,
      wmHistRaw,
      lotusTodayRaw,
      lotusHistRaw,
      makroTodayRaw,
      makroHistRaw,
      { data: masterProdRaw },
      { data: masterChannelRaw },
      { data: jobAssignRaw },
      prevAssignedRaw,
      yieldBagsRaw,
      { data: plan100Raw },
      { data: pickingUnitRaw },
      { data: masterSpecialRaw },
      { data: masterVarLotusRaw },
      { data: oldAssignmentsRaw },
    ] = await Promise.all([
      supabase.from('daily_workforce')
        .select('emp_id, name, work_station, shift')
        .eq('work_date', productionDate)
        .eq('upload_round', '0800'),
      (isPhase2 || isPhase3)
        ? supabase.from('daily_workforce')
            .select('emp_id, name, work_station, shift')
            .eq('work_date', productionDate)
            .eq('upload_round', '1300')
        : Promise.resolve({ data: [] as WorkforceRow[], error: null }),
      // WM/LOTUS upload today's orders at '1400' only (no '0800' round)
      fetchAll<OrderRow>('wet_market_orders', 'sku, sku_name, quantity, delivery_date', [
        { col: 'delivery_date', op: 'eq', val: productionDate },
        { col: 'upload_round', op: 'eq', val: '1400' },
      ]),
      fetchAll<OrderRow>('wet_market_orders', 'sku, sku_name, quantity, delivery_date', [
        { col: 'delivery_date', op: 'in', val: histDates },
        { col: 'upload_round', op: 'eq', val: '1600' },
      ]),
      fetchAll<OrderRow>('lotus_orders', 'sku, sku_name, quantity, delivery_date', [
        { col: 'delivery_date', op: 'eq', val: productionDate },
        { col: 'upload_round', op: 'eq', val: '1400' },
      ]),
      fetchAll<OrderRow>('lotus_orders', 'sku, sku_name, quantity, delivery_date', [
        { col: 'delivery_date', op: 'in', val: histDates },
        { col: 'upload_round', op: 'eq', val: '1600' },
      ]),
      fetchAll<OrderRow>('makro_orders', 'sku, sku_name, quantity, delivery_date', [
        { col: 'delivery_date', op: 'eq', val: productionDate },
        { col: 'upload_round', op: 'eq', val: orderRound },
      ]),
      fetchAll<OrderRow>('makro_orders', 'sku, sku_name, quantity, delivery_date', [
        { col: 'delivery_date', op: 'in', val: histDates },
        { col: 'upload_round', op: 'eq', val: '1400' },
      ]),
      supabase.from('master_logic_calculation')
        .select('row_data')
        .eq('calculation_type', 'Mas Productivity')
        .order('uploaded_at', { ascending: false }),
      supabase.from('master_logic_calculation')
        .select('row_data')
        .eq('calculation_type', 'Mas Channel')
        .order('uploaded_at', { ascending: false }),
      supabase.from('master_logic_manpower')
        .select('row_data'),
      // Phase 2/3: load previously-assigned quantities (plan / actual mode)
      (isPhase2 || isPhase3) && deductMode !== 'yield'
        ? fetchAll<{ sku: string; target_quantity: number; channel: string | null }>(
            'production_assignments', 'sku, target_quantity, channel', [
              { col: 'production_date', op: 'eq', val: productionDate },
              { col: 'period', op: 'in', val: isPhase3 ? ['เช้า', 'บ่าย'] : ['เช้า'] },
              ...(deductMode === 'actual' ? [{ col: 'status', op: 'eq' as const, val: 'เสร็จแล้ว' }] : []),
            ])
        : Promise.resolve([] as { sku: string; target_quantity: number; channel: string | null }[]),
      // Phase 2/3: load yield bags (yield mode)
      (isPhase2 || isPhase3) && deductMode === 'yield'
        ? fetchAll<{ sap_code: string; bags: number }>(
            'yield_bags', 'sap_code, bags', [
              { col: 'work_date', op: 'eq', val: productionDate },
            ])
        : Promise.resolve([] as { sap_code: string; bags: number }[]),
      // Phase 3: load 100% production plan
      isPhase3
        ? supabase.from('production_plan_100')
            .select('sap, product_name, weight_total')
            .eq('plan_date', productionDate)
        : Promise.resolve({ data: [] as { sap: string; product_name: string | null; weight_total: number }[], error: null }),
      supabase.from('picking_unit_master').select('sap, weight_per_bag'),
      supabase.from('master_logic_calculation')
        .select('row_data')
        .eq('calculation_type', 'Mas Special')
        .order('uploaded_at', { ascending: false }),
      supabase.from('master_logic_calculation')
        .select('row_data')
        .eq('calculation_type', 'Mas %Variance LOTUS')
        .order('uploaded_at', { ascending: false }),
      useRegen
        ? supabase.from('production_assignments')
            .select('*')
            .eq('production_date', productionDate)
            .eq('period', phaseCfg.period)
            .eq('effective_from', latestAssign.effective_from)
        : Promise.resolve({ data: [] as any[], error: null }),
    ])

    // Merge workforce: Phase 2/3 = 1300 overrides 0800
    const seenNames = new Set<string>()
    let workforce: WorkforceRow[] = []
    for (const w of [...(workforceRaw1300 ?? []), ...(workforceRaw0800 ?? [])] as WorkforceRow[]) {
      const nameKey = normName(w.name)
      if (seenNames.has(nameKey)) continue
      seenNames.add(nameKey)
      workforce.push(w)
    }

    if (workforce.length === 0) {
      workforce = await fetchWeeklyWorkforce(productionDate)
    }

    if (!workforce.length)
      return NextResponse.json({
        success: false,
        message: (isPhase2 || isPhase3)
          ? 'ไม่พบกำลังคนรอบ 8:00 หรือ 13:00 วันนี้ — กรุณาอัพโหลดก่อน'
          : 'ไม่พบกำลังคนรอบ 8:00 วันนี้ — กรุณาอัพโหลดก่อน',
      }, { status: 400 })

    const wmToday    = (wmTodayRaw    ?? []) as OrderRow[]
    const wmHist     = (wmHistRaw     ?? []) as OrderRow[]
    const lotusToday = (lotusTodayRaw ?? []) as OrderRow[]
    const lotusHist  = (lotusHistRaw  ?? []) as OrderRow[]
    const makroToday = (makroTodayRaw ?? []) as OrderRow[]
    const makroHist  = (makroHistRaw  ?? []) as OrderRow[]

    if (isPhase3) {
      if (!(plan100Raw ?? []).length)
        return NextResponse.json({ success: false, message: 'ไม่พบแผนผลิต 100% วันนี้ — กรุณาอัพโหลดก่อน' }, { status: 400 })
    } else {
      // Phase 1 WM+LOTUS ใช้ BL3 ไม่ต้องมี Order วันนี้
      const hasOrders = isPhase2
        ? (wmToday.length    || lotusToday.length    || makroToday.length)
        : (wmHist.length     || lotusHist.length     || makroToday.length)
      if (!hasOrders)
        return NextResponse.json({
          success: false,
          message: `ไม่พบข้อมูล${isPhase2 ? `Order รอบ ${orderRound}` : 'BL3 Wet Market หรือ Order'} วันนี้ (Wet Market / LOTUS / Makro) — กรุณาอัพโหลดก่อน`,
        }, { status: 400 })
    }

    // ------ Bag size map ------
    const bagSizeMap = new Map<string, number>()
    for (const r of (pickingUnitRaw ?? []) as { sap: string; weight_per_bag: number }[]) {
      const sap = String(r.sap ?? '').trim()
      const wpb = Number(r.weight_per_bag ?? 0)
      if (sap && wpb > 0) {
        bagSizeMap.set(sap, wpb)
        bagSizeMap.set(sap.replace(/^0+/, ''), wpb)
      }
    }

    // Round qty up to the nearest whole bag; returns qty unchanged if no bag size defined
    const roundUpToBag = (sku: string, qty: number): number => {
      const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, ''))
      if (!wpb || wpb <= 0) return qty
      return Math.ceil(qty / wpb) * wpb
    }

    // Helper to parse Excel time decimal fraction to minutes
    const parseExcelTime = (val: unknown): number | null => {
      if (val === null || val === undefined || val === '') return null
      
      if (typeof val === 'string') {
        const str = val.trim()
        if (str.includes('T')) {
          const d = new Date(str)
          if (!isNaN(d.getTime())) {
            // Adjust to Bangkok LMT (UTC +06:42:04) in 1899
            const localMs = d.getTime() + (6 * 3600 + 42 * 60 + 4) * 1000
            const dayMs = 24 * 3600 * 1000
            const timeOfDayMs = ((localMs % dayMs) + dayMs) % dayMs
            return Math.round(timeOfDayMs / 1000 / 60)
          }
        }
        if (str.includes(':')) {
          const parts = str.split(':').map(Number)
          if (parts.length >= 2 && !parts.some(isNaN)) {
            return parts[0] * 60 + parts[1]
          }
        }
      }
      
      const num = Number(val)
      if (isNaN(num)) return null
      return Math.round(num * 24 * 60)
    }

    // Map: SKU -> { startMins: number | null, stopMins: number | null }
    const specialTimeMap = new Map<string, { startMins: number | null; stopMins: number | null }>()
    if (masterSpecialRaw?.length) {
      for (const row of masterSpecialRaw) {
        const r = row.row_data as Record<string, unknown>
        const sap = String(r['SAP'] ?? '').trim()
        if (!sap) continue
        const startVal = r['ช่วงเวลาเริ่มผลิต']
        const stopVal = r['ช่วงเวลาหยุดผลิต']
        const startMins = parseExcelTime(startVal)
        const stopMins = parseExcelTime(stopVal)
        if (startMins !== null || stopMins !== null) {
          const entry = { startMins, stopMins }
          specialTimeMap.set(sap, entry)
          specialTimeMap.set(sap.replace(/^0+/, ''), entry)
        }
      }
    }

    // ------ Parse master data ------
    const productivity: ProductivityRow[] = masterProdRaw?.length
      ? parseProductivity(masterProdRaw.map(r => r.row_data as Record<string, unknown>))
      : []

    const skuMap = new Map<string, ProductivityRow>()
    for (const p of productivity) {
      if (!skuMap.has(p.sku))                    skuMap.set(p.sku, p)
      if (!skuMap.has(p.sku.replace(/^0+/, ''))) skuMap.set(p.sku.replace(/^0+/, ''), p)
    }

    // Map: station → variance factor (0–1) from Mas %Variance LOTUS
    const lotusVarianceMap = new Map<string, number>()
    for (const row of (masterVarLotusRaw ?? [])) {
      const r = row.row_data as Record<string, unknown>
      const rawStation = normalizeStation(String(r['Station'] ?? '').trim())
      const station = STATION_TABLE[rawStation] ?? rawStation
      const pct = Number(r['%Variance'] ?? 0)
      if (station && pct > 0) lotusVarianceMap.set(station, pct / 100)
    }

    const jobAssignMap = buildJobAssignMap(
      (jobAssignRaw ?? []) as { row_data: Record<string, unknown> }[]
    )

    // Channel priority for this phase (newest upload wins — skip if already set)
    const channelPriority: Record<string, number> = {}
    for (const row of (masterChannelRaw ?? [])) {
      const r = row.row_data as Record<string, unknown>
      if (Number(r['Phase']) === selectedPhase) {
        const ch = String(r['Channel'])
        if (!(ch in channelPriority)) {
          channelPriority[ch] = Number(r['Priority'])
        }
      }
    }
    const channelOrder = Object.entries(channelPriority)
      .sort((a, b) => a[1] - b[1])
      .map(([ch]) => ch)
    const activeChannels = channelOrder.length ? channelOrder : ['Makro', 'Wet Market', 'LOTUS']

    // ------ Workers grouped by station ------
    const workersByStation: Record<string, WorkforceRow[]> = {}
    for (const w of workforce) {
      const rawStation = normalizeStation(w.work_station ?? '')
      const station = STATION_TABLE[rawStation] ?? rawStation
      if (!station) continue
      workersByStation[station] ??= []
      workersByStation[station].push(w)
    }

    // Each worker starts with available phase hours, capped by their shift end
    const phaseStartMins = phaseCfg.startH * 60
    const phaseEndMins   = phaseCfg.endH   * 60

    // Intersect daily uploaded workforce and weekly workforce plan
    const dailyUploadedNames = new Set([
      ...(workforceRaw0800 ?? []).map(w => normName(w.name)),
      ...(workforceRaw1300 ?? []).map(w => normName(w.name))
    ])
    const weeklyWorkforce = await fetchWeeklyWorkforce(productionDate)
    const weeklyWorkforceNames = new Set(weeklyWorkforce.map(w => normName(w.name)))
    const effectiveDailyUploadedNames = dailyUploadedNames.size > 0
      ? dailyUploadedNames
      : weeklyWorkforceNames

    const keptAssignments: any[] = []
    const keptChannelQtyMap = new Map<string, number>()
    const workerKeptMaxEndMins = new Map<string, number>()

    if (useRegen && oldAssignmentsRaw) {
      for (const a of oldAssignmentsRaw) {
        const wName = normName(a.worker_name || '')
        if (effectiveDailyUploadedNames.has(wName) && weeklyWorkforceNames.has(wName)) {
          const deadlineStr = a.deadline_time as string | null
          if (deadlineStr && deadlineStr.includes(':')) {
            const [h, m] = deadlineStr.split(':').map(Number)
            const startMins = h * 60 + m
            if (startMins < checkpointMins) {
              const cleanSku = (a.sku as string).replace(/^0+/, '')
              const prod = skuMap.get(cleanSku) ?? skuMap.get(a.sku as string)
              const rate = prod?.rate ?? 27.0
              const duration = rate > 0 ? Math.round((Number(a.target_quantity) / rate) * 60) : 0
              const endMins = wallClockFinish(startMins, duration)

              const currentMax = workerKeptMaxEndMins.get(wName) ?? 0
              workerKeptMaxEndMins.set(wName, Math.max(currentMax, endMins))

              const { id, created_at, updated_at, ...rest } = a
              keptAssignments.push({
                ...rest,
                isKept: true
              })

              const sku = (a.sku as string).replace(/^0+/, '')
              const ch = a.channel || ''
              const key = `${ch}_${sku}`
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
      let shiftEndMins = phaseEndMins
      if (w.shift === 'กะ 1') {
        shiftEndMins = isPhase3 ? phaseEndMins : 17 * 60
      } else if (w.shift === 'กะ 2') {
        shiftEndMins = 24 * 60
      }
      const actualEndMins = Math.min(phaseEndMins, shiftEndMins)
      const nameKey = normName(w.name)
      
      const keptMaxEnd = workerKeptMaxEndMins.get(nameKey) ?? 0
      const startFreeMins = Math.max(checkpointMins, keptMaxEnd)
      
      const actualHours   = Math.max(0, actualEndMins - startFreeMins) / 60
      workerHours.set(nameKey, actualHours)
      workerFreeAtMins.set(nameKey, startFreeMins)
      workerBusySegments.set(nameKey, [])
    }

    // ------ Historical averages ------
    const avgWM    = buildAvgMap(wmHist)
    const avgLotus = buildAvgMap(lotusHist)
    const avgMakro = buildAvgMap(makroHist)

    // ------ Deduction qty per SKU (based on deductMode) ------
    // phase1Assigned: total across channels — used by Phase 3
    // phase1ByChannel: per channel — used by Phase 2 (plan/actual modes only)
    // useChannelDeduct: false for yield mode (no channel breakdown in yield_bags)
    const phase1Assigned  = new Map<string, number>()
    const phase1ByChannel = new Map<string, Map<string, number>>()
    const useChannelDeduct = deductMode !== 'yield'

    const wpbMap = new Map<string, number>()
    for (const r of (pickingUnitRaw ?? [])) {
      wpbMap.set(r.sap.replace(/^0+/, ''), r.weight_per_bag ?? 0)
    }

    if (deductMode === 'yield') {
      for (const y of (yieldBagsRaw as { sap_code: string; bags: number }[])) {
        const sku = y.sap_code.replace(/^0+/, '')
        const kg  = y.bags * (wpbMap.get(sku) ?? 0)
        phase1Assigned.set(sku, (phase1Assigned.get(sku) ?? 0) + kg)
      }
    } else {
      for (const a of (prevAssignedRaw as { sku: string; target_quantity: number; channel: string | null }[])) {
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

    // Aggregate today's orders per SKU
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

    // ------ Build SKU targets per channel ------



    const buildWetMarketTargets = (): SkuTarget[] => {
      const ch = 'Wet Market'
      if (isPhase2) {
        // Phase 2: order_1400 − phase1 deduction (ใช้ order จริงไม่ cap ด้วย BL3)
        const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
        return Object.entries(wmMap).map(([sku, { qty: orderQty, name }]) => {
          const targetQty = Math.max(0, orderQty - (p1.get(sku) ?? 0))
          return { sku, skuName: name, targetQty, channel: ch }
        }).filter(s => s.targetQty > 0)
      }
      // Phase 1: Avg BL3 × %Variance
      const wmHistNames = new Map(wmHist.map(r => [r.sku.replace(/^0+/, ''), r.sku_name]))
      const lotusHistSkus = new Set(avgLotus.keys())
      return Array.from(avgWM.entries())
        .map(([sku, avg]) => {
          const isShared = lotusHistSkus.has(sku)
          const lotusBL3 = avgLotus.get(sku) ?? 0
          const variance = getWetMarketVariance(isShared, avg, avg, lotusBL3)
          return { sku, skuName: wmHistNames.get(sku) ?? null, targetQty: avg * variance, channel: ch }
        }).filter(s => s.targetQty > 0)
    }

    const buildMakroTargets = (): SkuTarget[] => {
      const ch = 'Makro'
      if (isPhase2) {
        // Phase 2: 1300 order − deduction (per channel or total depending on mode)
        const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
        return Object.entries(makroMap).map(([sku, { qty: orderQty, name }]) => {
          const targetQty = Math.max(0, orderQty - (p1.get(sku) ?? 0))
          return { sku, skuName: name, targetQty, channel: ch }
        }).filter(s => s.targetQty > 0)
      }
      // Phase 1: order × variance
      const makroTotal = Object.values(makroMap).reduce((s, v) => s + v.qty, 0)
      return Object.entries(makroMap).map(([sku, { qty: orderQty, name }]) => {
        const avg = avgMakro.get(sku) ?? 0
        const proportion = makroTotal > 0 ? orderQty / makroTotal : 0
        const variance = getMakroVariance(proportion > 0.1, orderQty, avg)
        return { sku, skuName: name, targetQty: orderQty * variance, channel: ch }
      }).filter(s => s.targetQty > 0)
    }

    const buildLotusTargets = (): SkuTarget[] => {
      const ch = 'LOTUS'
      if (isPhase2) {
        // Phase 2: order_1400 − phase1 deduction (ใช้ order จริงไม่ cap ด้วย BL3)
        const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
        return Object.entries(lotusMap).map(([sku, { qty: orderQty, name }]) => {
          const targetQty = Math.max(0, orderQty - (p1.get(sku) ?? 0))
          return { sku, skuName: name, targetQty, channel: ch }
        }).filter(s => s.targetQty > 0)
      }
      // Phase 1: BL3 avg × %Variance
      const lotusHistNames = new Map(lotusHist.map(r => [r.sku.replace(/^0+/, ''), r.sku_name]))
      return Array.from(avgLotus.entries())
        .map(([sku, avg]) => {
          const prod = skuMap.get(sku)
          const rawStation = prod ? normalizeStation(prod.station) : ''
          const station = STATION_TABLE[rawStation] ?? rawStation
          const variance = lotusVarianceMap.size > 0 ? (lotusVarianceMap.get(station) ?? 1.0) : 1.0
          return { sku, skuName: lotusHistNames.get(sku) ?? null, targetQty: avg * variance, channel: ch }
        }).filter(s => s.targetQty > 0)
    }

    const channelTargets: Record<string, SkuTarget[]> = {
      'Wet Market': buildWetMarketTargets(),
      'Makro':      buildMakroTargets(),
      'LOTUS':      buildLotusTargets(),
    }

    // ------ Build assignment list ------
    let assignList: SkuTarget[]
    const planMap = new Map<string, { name: string | null; qty: number }>()
    if (isPhase3) {
      // Phase 3: weight_total จาก plan_100 − Ph1+Ph2 (กก.)
      const plan100 = (plan100Raw ?? []) as { sap: string; product_name: string | null; weight_total: number }[]
      for (const r of plan100) {
        const sap = r.sap.replace(/^0+/, '')
        const cur = planMap.get(sap) ?? { name: r.product_name ?? null, qty: 0 }
        cur.qty += Number(r.weight_total)
        planMap.set(sap, cur)
      }

      const allPhase3Targets = Array.from(planMap.entries())
        .map(([sku, { name, qty }]) => {
          let channel = 'plan100'
          for (const [ch, m] of Array.from(phase1ByChannel.entries())) {
            if (m.has(sku)) { channel = ch; break; }
          }
          return {
            sku, skuName: name,
            targetQty: Math.max(0, qty - (phase1Assigned.get(sku) ?? 0)),
            channel,
          }
        })
        .filter(t => t.targetQty > 0)

      // Group by channel
      const p3ChannelTargets: Record<string, SkuTarget[]> = {}
      for (const t of allPhase3Targets) {
        p3ChannelTargets[t.channel] ??= []
        p3ChannelTargets[t.channel].push(t)
      }
      
      // Sort by active channels first, then by quantity desc
      const channelsToProcess = [...activeChannels]
      // Add any remaining channels (like 'plan100' for SKUs not in Ph1) to the end
      for (const ch of Object.keys(p3ChannelTargets)) {
        if (!channelsToProcess.includes(ch)) channelsToProcess.push(ch)
      }

      assignList = channelsToProcess.flatMap(ch =>
        (p3ChannelTargets[ch] ?? []).sort((a, b) => b.targetQty - a.targetQty)
      )
    } else {
      // Phase 1 & 2: Mas Channel priority order, sorted by qty desc within each channel
      assignList = activeChannels.flatMap(ch =>
        (channelTargets[ch] ?? []).sort((a, b) => b.targetQty - a.targetQty)
      )
    }

    // Deduct kept assignments from assignList
    const updatedAssignList: SkuTarget[] = []
    for (const item of assignList) {
      const sku = item.sku.replace(/^0+/, '')
      const ch = item.channel || ''
      const key = `${ch}_${sku}`
      const keptQty = keptChannelQtyMap.get(key) ?? 0
      const newQty = Math.max(0, item.targetQty - keptQty)
      if (newQty > 0) {
        updatedAssignList.push({
          ...item,
          targetQty: newQty
        })
      }
    }
    assignList = updatedAssignList

    // Split and prioritize Special SKUs with start or stop times
    const hasSpecialTimes = (sku: string): boolean => {
      const cleanSku = sku.replace(/^0+/, '')
      const timeInfo = specialTimeMap.get(cleanSku)
      return !!(timeInfo && (timeInfo.startMins !== null || timeInfo.stopMins !== null))
    }

    const specialList = assignList.filter(item => hasSpecialTimes(item.sku))
    const normalList = assignList.filter(item => !hasSpecialTimes(item.sku))

    specialList.sort((a, b) => {
      const cleanA = a.sku.replace(/^0+/, '')
      const cleanB = b.sku.replace(/^0+/, '')
      const startA = specialTimeMap.get(cleanA)?.startMins ?? 0
      const startB = specialTimeMap.get(cleanB)?.startMins ?? 0
      if (startA !== startB) {
        return startA - startB
      }
      return b.targetQty - a.targetQty
    })

    assignList = [...specialList, ...normalList]

    // Pre-merge same-SKU quantities so each worker is assigned one contiguous block per SKU.
    // This runs ONLY on the regular assignList (Pass 2); supplementary orders (Pass 1) handle
    // their own deadline-capped assignment separately and are never merged here.
    assignList = mergeAssignList(assignList)

    // ------ Fetch supplementary plan (must finish before deadline) ------
    interface SuppSlot { deadlineMins: number; skus: { sku: string; name: string | null; qty: number }[] }
    const suppSlotResults = await Promise.all([1, 2, 3].map(async slot => {
      const { data: log } = await supabase
        .from('upload_log').select('source_file')
        .eq('table_name', `production_plan_supplementary_${slot}`)
        .order('uploaded_at', { ascending: false }).limit(1).maybeSingle()
      if (!log) return null
      const { data } = await supabase
        .from('production_plan_supplementary')
        .select('sku, sku_name, quantity, deadline_time')
        .eq('source_file', log.source_file).eq('slot', String(slot))
      if (!data?.length) return null
      const deadlineStr = data[0].deadline_time as string | null
      if (!deadlineStr) return null
      const [dh, dm] = deadlineStr.split(':').map(Number)
      const deadlineMins = dh * 60 + dm
      if (deadlineMins <= phaseStartMins || deadlineMins > phaseEndMins) return null
      return {
        deadlineMins,
        skus: data
          .map(r => ({ sku: String(r.sku ?? '').replace(/^0+/, ''), name: r.sku_name as string | null, qty: Number(r.quantity) }))
          .filter(s => s.qty > 0),
      } as SuppSlot
    }))
    // Sort slots by deadline (earliest first → must finish sooner gets workers first)
    const activeSuppSlots = (suppSlotResults.filter(Boolean) as SuppSlot[])
      .sort((a, b) => a.deadlineMins - b.deadlineMins)

    // ------ Assign workers ------
    const assignments: Record<string, unknown>[] = []

    // Pass 1 — supplementary SKUs (phaseEndMins capped at each slot's deadline)
    for (const suppSlot of activeSuppSlots) {
      for (const { sku, name: skuName, qty: rawQty } of suppSlot.skus.sort((a, b) => b.qty - a.qty)) {
        const targetQty = roundUpToBag(sku, rawQty)
        const prod = skuMap.get(sku) ?? skuMap.get(String(Number(sku) || sku))
        if (!prod) continue
        const rawStation = normalizeStation(prod.station)
        const station = STATION_TABLE[rawStation] ?? rawStation
        const tableName = STATION_TABLE[station] ?? station
        const skuGroup  = prod.product_group
        const allAtStation = workersByStation[station] ?? []
        const eligibleWorkers = allAtStation
          .filter(w => {
            if (jobAssignMap.size === 0) return true
            const jobInfo = jobAssignMap.get(normName(w.name))
            if (jobInfo?.isWeigher && (!skuGroup || !jobInfo.groups.has(skuGroup))) return false
            if (!jobInfo) return false
            return skuGroup ? jobInfo.groups.has(skuGroup) : true
          })
          .sort((a, b) => {
            const lvA = jobAssignMap.get(normName(a.name))?.groups.get(skuGroup) ?? 99
            const lvB = jobAssignMap.get(normName(b.name))?.groups.get(skuGroup) ?? 99
            if (lvA !== lvB) return lvA - lvB
            return (workerHours.get(normName(b.name)) ?? 0) - (workerHours.get(normName(a.name)) ?? 0)
          })
        if (!eligibleWorkers.length) continue
        assignments.push(...assignWorkers({
          productionDate, tableName, sku: String(sku),
          skuName: prod.sku_name || skuName || null,
          targetQty, eligibleWorkers: eligibleWorkers.slice(0, maxWorkersForQty(targetQty)),
          rate: prod.rate, workerHours, workerFreeAtMins, workerBusySegments,
          phaseEndMins: suppSlot.deadlineMins,   // ← finish before loading deadline
          period: phaseCfg.period, deadline: phaseCfg.deadline,
          channel: 'เสริม',
          phaseRoundMins: PHASE_ROUND_MINS[selectedPhase] ?? [phaseCfg.startH * 60],
          wpb: wpbMap.get(String(sku).replace(/^0+/, '')) ?? 0,
          specialStartMins: specialTimeMap.get(String(sku))?.startMins ?? specialTimeMap.get(String(sku).replace(/^0+/, ''))?.startMins ?? null,
          specialStopMins: specialTimeMap.get(String(sku))?.stopMins ?? specialTimeMap.get(String(sku).replace(/^0+/, ''))?.stopMins ?? null,
        }))
      }
    }

    // Pass 2 — normal assignList (workers continue from wherever they left off)
    for (const { sku, skuName, targetQty: rawQty, channel } of assignList) {
      // Makro uses exact order quantities — do not round up to bag size (would over-produce)
      let targetQty = channel === 'Makro' ? Math.round(rawQty) : roundUpToBag(sku, rawQty)

      // Cap targetQty at remaining plan 100% quantity if in Phase 3 to prevent overproduction
      if (isPhase3) {
        const planSku = sku.replace(/^0+/, '')
        const planItem = planMap.get(planSku)
        if (planItem) {
          const prevAssigned = phase1Assigned.get(planSku) ?? 0
          const remaining = Math.max(0, planItem.qty - prevAssigned)
          if (targetQty > remaining) {
            targetQty = remaining
          }
        }
      }
      if (targetQty <= 0) continue

      const prod = skuMap.get(String(sku)) ?? skuMap.get(String(Number(sku) || sku))
      if (!prod) continue

      const rawStation = normalizeStation(prod.station)
      const station = STATION_TABLE[rawStation] ?? rawStation
      const tableName = STATION_TABLE[station] ?? station
      const skuGroup  = prod.product_group

      const allAtStation = workersByStation[station] ?? []
      const eligibleWorkers = allAtStation
        .filter(w => {
          if (jobAssignMap.size === 0) return true
          const jobInfo = jobAssignMap.get(normName(w.name))
          if (jobInfo?.isWeigher && (!skuGroup || !jobInfo.groups.has(skuGroup))) return false
          if (!jobInfo) return false
          return skuGroup ? jobInfo.groups.has(skuGroup) : true
        })
        .sort((a, b) => {
          const lvA = jobAssignMap.get(normName(a.name))?.groups.get(skuGroup) ?? 99
          const lvB = jobAssignMap.get(normName(b.name))?.groups.get(skuGroup) ?? 99
          if (lvA !== lvB) return lvA - lvB
          return (workerHours.get(normName(b.name)) ?? 0) - (workerHours.get(normName(a.name)) ?? 0)
        })
      if (!eligibleWorkers.length) continue

      const cappedWorkers = eligibleWorkers.slice(0, maxWorkersForQty(targetQty))

      assignments.push(...assignWorkers({
        productionDate, tableName, sku: String(sku),
        skuName: prod.sku_name || skuName || null,
        targetQty, eligibleWorkers: cappedWorkers, rate: prod.rate,
        workerHours, workerFreeAtMins, workerBusySegments, phaseEndMins,
        period: phaseCfg.period, deadline: phaseCfg.deadline, channel,
        phaseRoundMins: PHASE_ROUND_MINS[selectedPhase] ?? [phaseCfg.startH * 60],
        wpb: wpbMap.get(String(sku).replace(/^0+/, '')) ?? 0,
        specialStartMins: specialTimeMap.get(String(sku))?.startMins ?? specialTimeMap.get(String(sku).replace(/^0+/, ''))?.startMins ?? null,
        specialStopMins: specialTimeMap.get(String(sku))?.stopMins ?? specialTimeMap.get(String(sku).replace(/^0+/, ''))?.stopMins ?? null,
      }))
    }

    assignments.push(...keptAssignments)

    if (!assignments.length) {
      const prodMatchCount = assignList.filter(t => skuMap.has(t.sku) || skuMap.has(t.sku.replace(/^0+/, ''))).length
      const totalWorkerHours = Array.from(workerHours.values()).reduce((s, h) => s + h, 0)
      return NextResponse.json({
        success: false,
        message: `ไม่สามารถสร้างคำสั่ง — targets: WM ${channelTargets['Wet Market']?.length ?? 0} / Makro ${channelTargets['Makro']?.length ?? 0} / LOTUS ${channelTargets['LOTUS']?.length ?? 0} | prodMatch: ${prodMatchCount}/${assignList.length} | workerHrs: ${totalWorkerHours.toFixed(1)}`,
      }, { status: 400 })
    }

    // ── Delete only the old batch being superseded (same effective_from as the current active plan) ──
    // ถ้ามีแผนเดิมที่ยัง effective อยู่ ให้ลบเฉพาะชุดนั้น (batch เดิมที่ถูก supersede)
    if (useRegen) {
      await supabase
        .from('production_assignments')
        .delete()
        .eq('production_date', productionDate)
        .eq('period', phaseCfg.period)
        .eq('effective_from', latestAssign.effective_from)
    } else {
      // ไม่มีแผนเดิม หรือ Phase 2/3 → ลบทั้งหมด (safety)
      await supabase
        .from('production_assignments')
        .delete()
        .eq('production_date', productionDate)
        .eq('period', phaseCfg.period)
    }

    // Recalculate deadline_time and seq sequentially per worker.
    // Because assignList was pre-merged (same SKU = one contiguous block), each worker's
    // tasks are already contiguous by SKU. We only need to recompute wall-clock start times.
    // Supplementary tasks (from Pass 1) land first in the timeline because workers were
    // already advanced past their finish time before Pass 2 ran.
    const byWorkerPost: Record<string, any[]> = {}
    for (const a of assignments) {
      const name = a.worker_name as string
      byWorkerPost[name] ??= []
      byWorkerPost[name].push(a)
    }

    const resequenced: any[] = []
    const startMinsPhase = phaseCfg.startH * 60

    for (const workerTasks of Object.values(byWorkerPost)) {
      // Sort by the deadline_time that assignWorkers() recorded (= wall-clock start the
      // worker became free for that task). This preserves supp-before-regular order.
      workerTasks.sort((a, b) =>
        ((a.deadline_time as string) || '').localeCompare((b.deadline_time as string) || '')
      )

      // Recalculate wall-clock start times so they chain exactly with no gaps.
      let curMins = startMinsPhase
      for (const task of workerTasks) {
        if (task.isKept) {
          const cleanSku = (task.sku as string).replace(/^0+/, '')
          const prod = skuMap.get(cleanSku) ?? skuMap.get(task.sku as string)
          const rate = prod?.rate ?? 27.0
          const duration = rate > 0 ? Math.round((Number(task.target_quantity) / rate) * 60) : 0

          const [h, m] = (task.deadline_time as string).split(':').map(Number)
          const startMins = h * 60 + m
          curMins = wallClockFinish(startMins, duration)

          delete task.isKept
        } else {
          if (curMins < checkpointMins) {
            curMins = checkpointMins
          }
          const cleanSku = (task.sku as string).replace(/^0+/, '')
          const prod = skuMap.get(cleanSku) ?? skuMap.get(task.sku as string)
          const rate = prod?.rate ?? 27.0
          const duration = rate > 0 ? Math.round((Number(task.target_quantity) / rate) * 60) : 0

          let startMins = curMins
          const specialStart =
            specialTimeMap.get(cleanSku)?.startMins ??
            specialTimeMap.get(task.sku as string)?.startMins ??
            null
          if (specialStart !== null) startMins = Math.max(startMins, specialStart)

          task.deadline_time = minsToTimeStr(startMins)
          curMins = wallClockFinish(startMins, duration)
        }
      }

      resequenced.push(...workerTasks)
    }

    resequenced.forEach((a, i) => { a['seq'] = i; a['effective_from'] = effectiveFromISO })
    assignments.length = 0
    assignments.push(...resequenced)

    const { error } = await supabase.from('production_assignments').insert(assignments)
    if (error) throw error

    // Auto-generate corresponding withdrawal plan
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
          })
          .filter(Boolean)
          .join(', ')

    // --- diagnostic: channel breakdown per SKU before merge ---
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

    return NextResponse.json({
      success: true,
      isScheduled,
      effectiveFrom: effectiveTimeStr,
      message: isScheduled
        ? `Phase ${selectedPhase} (${phaseCfg.period}) สร้างสำเร็จ ${assignments.length} รายการ — มีผลตั้งแต่ ${effectiveTimeStr} น. (${channelSummary})`
        : `Phase ${selectedPhase} (${phaseCfg.period}) สร้างสำเร็จ ${assignments.length} รายการ — ${channelSummary}`,
      count: assignments.length,
      debug_targets: Object.entries(debugChannelTargets)
        .map(([sku, v]) => ({ sku, ...v }))
        .sort((a, b) => b.merged - a.merged)
        .slice(0, 30),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error
      ? e.message
      : (typeof e === 'object' && e !== null)
        ? ((e as any).message ?? (e as any).details ?? JSON.stringify(e))
        : String(e)
    return NextResponse.json(
      { success: false, message: msg },
      { status: 500 }
    )
  }
}
