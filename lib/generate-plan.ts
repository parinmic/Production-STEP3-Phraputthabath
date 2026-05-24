import { supabase } from '@/lib/supabase'
import { allocateFIFOWithRules, RawMaterialRule, getLotType, LotEntry } from '@/lib/withdrawal-rules'

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

interface SkuTarget { sku: string; skuName: string | null; targetQty: number; channel: string; isDeficit?: boolean }

export interface GeneratePlanParams {
  date?: string
  phase?: number
  deductMode?: 'plan' | 'actual' | 'yield'
  disableMidRecal?: boolean
}

export interface GeneratePlanResult {
  success: boolean
  isScheduled?: boolean
  effectiveFrom?: string
  message: string
  count?: number
  debug_targets?: { sku: string; wm: number; makro: number; lotus: number; merged: number }[]
}

// ========== Utilities ==========

function minsToTimeStr(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.floor(mins % 60)
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
  { phase: 3, period: 'ค่ำ',   deadline: null,        hours: 7.5, startH: 16.5, endH: 30 }, // 06:00 next day — no fixed cutoff
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

// ========== Station Mapping ==========

const normalizeStation = (s: string) => s.replace(/[()]/g, '').trim()

const STATION_TABLE: Record<string, string> = {
  'สามชั้นพิเศษ': 'สามชั้น',
  'ไหล่พิเศษ':    'ไหล่',
  'สะโพกพิเศษ':   'สะโพก',
}

const normName = (s: string) => {
  if (!s) return ''
  return s.replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}

// ========== Workforce ==========

async function fetchWeeklyWorkforce(productionDate: string): Promise<WorkforceRow[]> {
  const types = ['sa-phok-special', 'lai-special', 'sam-chan-special']
  const workforce: WorkforceRow[] = []

  const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
  const DAY_ALIASES: Record<string, string[]> = {
    'อาทิตย์': ['อาทิตย์', 'อา.'],
    'จันทร์':  ['จันทร์', 'จ.'],
    'อังคาร':  ['อังคาร', 'อ.'],
    'พุธ':     ['พุธ', 'พ.'],
    'พฤหัสบดี':['พฤหัสบดี', 'พฤหัส', 'พฤ.'],
    'ศุกร์':   ['ศุกร์', 'ศ.'],
    'เสาร์':   ['เสาร์', 'ส.'],
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
    'sa-phok-special': 'สะโพกพิเศษ',
    'sam-chan-special': 'สามชั้นพิเศษ',
    'lai-special':     'ไหล่พิเศษ',
  }

  const { data: statusOverrides } = await supabase
    .from('workforce_daily_status')
    .select('weekly_type, worker_name, status')
    .eq('work_date', productionDate)

  const overrideMap = new Map<string, string>()
  for (const item of statusOverrides ?? [])
    overrideMap.set(`${item.weekly_type}_${item.worker_name}`, item.status)

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

// ========== Master Data Parsers ==========

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

function buildJobAssignMap(rows: { row_data: Record<string, unknown> }[]) {
  const map = new Map<string, { isWeigher: boolean; groups: Map<string, number> }>()
  for (const row of rows) {
    const r = row.row_data
    const fullName = normName(String(r['รายชื่อพนักงาน'] ?? ''))
    if (!fullName) continue
    const isWeigher = Number(r['ชั่งน้ำหนัก'] ?? 0) === 1
    const groups = new Map<string, number>()
    for (const [key, val] of Object.entries(r)) {
      if (!key.startsWith('กลุ่ม')) continue
      if (val === null || val === undefined) continue
      const level = Number(val)
      const cleanKey = key.replace(/_\d+$/, '')
      if (!groups.has(cleanKey) || level < (groups.get(cleanKey) ?? 99))
        groups.set(cleanKey, level)
    }
    map.set(fullName, { isWeigher, groups })
  }
  return map
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
  isShared: boolean, quotaToday: number, avgBL3: number, lotusBL3: number,
  params: [number, number, number, number] = [0.5, 0.3, 0.5, 0.7],
): number {
  const [nsHigh, nsLow, sHigh, sLow] = params
  if (!isShared) return Math.min(quotaToday, avgBL3) > 100 ? nsHigh : nsLow
  const ratio = lotusBL3 > 0 ? Math.min(quotaToday, avgBL3) / lotusBL3 : 999
  return ratio > 0.5 ? sHigh : sLow
}

// params order matches master columns: [propHigh_trendLow, propHigh_trendMid, propHigh_trendHigh, propLow_trendLow, propLow_trendMid, propLow_trendHigh]
// proportion = SKU order / total Makro order; trend = order / avgBL3
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

// ========== Worker Assignment ==========

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
}): Record<string, unknown>[] {
  const {
    productionDate, tableName, targets, workers, skuMap, jobAssignMap,
    workerHours, workerFreeAtMins, workerBusySegments, phaseEndMins,
    period, phaseRoundMins, wpbMap, specialTimeMap
  } = params

  if (!targets.length || !workers.length) return []

  // ── Helpers ──────────────────────────────────────────────────────────────

  const isWorkerEligible = (worker: WorkforceRow, skuGroup: string): boolean => {
    if (jobAssignMap.size === 0) return true
    const jobInfo = jobAssignMap.get(normName(worker.name))
    if (!jobInfo) return false
    if (jobInfo.isWeigher && (!skuGroup || !jobInfo.groups.has(skuGroup))) return false
    return skuGroup ? jobInfo.groups.has(skuGroup) : true
  }

  const getWorkerSkillLevel = (worker: WorkforceRow, skuGroup: string): number => {
    if (jobAssignMap.size === 0) return 1
    const jobInfo = jobAssignMap.get(normName(worker.name))
    return jobInfo?.groups.get(skuGroup) ?? 99
  }

  const phaseStartMins = phaseRoundMins[0] ?? 510

  // ── Rounds note for a continuous block ───────────────────────────────────
  // Distributes qty across phase checkpoints proportionally to available work time.
  const computeRoundsNote = (startMins: number, qty: number, rate: number): string => {
    const roundMap = new Map<number, number>()
    let remaining = qty
    let pos = startMins
    let guard = 0
    while (remaining > 0.05 && pos < phaseEndMins && guard++ < 60) {
      let round = phaseRoundMins[0]
      for (const r of phaseRoundMins) { if (pos >= r) round = r; else break }
      const ri = phaseRoundMins.lastIndexOf(round)
      const windowEnd = ri + 1 < phaseRoundMins.length ? phaseRoundMins[ri + 1] : phaseEndMins
      const avail = availableWorkMins(pos, windowEnd)
      if (avail <= 0) { pos = windowEnd; continue }
      const here = Math.min(remaining, (avail / 60) * rate)
      roundMap.set(round, (roundMap.get(round) ?? 0) + here)
      remaining -= here
      pos = wallClockFinish(pos, (here / rate) * 60)
      if (pos < windowEnd) pos = windowEnd
    }
    return 'rounds:' + Array.from(roundMap.entries())
      .map(([r, q]) => `${r}=${Math.round(q * 100) / 100}`).join(';')
  }

  // ── SKU-Level Balanced Assignment ────────────────────────────────────────
  // Algorithm:
  //   1. Sort SKUs by total work time descending (LPT at SKU level).
  //   2. For each SKU, assign the entire block to the eligible worker(s) with
  //      the least committed load (min-load-first).  If one worker cannot absorb
  //      the whole quantity, spill the remainder to the next least-loaded worker.
  //   3. Result: each worker does one continuous block per SKU → no mid-SKU
  //      switching, finish times are naturally balanced.

  interface SkuEntry {
    target: typeof targets[0]
    prod: ProductivityRow
    rate: number
    wpb: number
    totalWorkMins: number
    specialStart: number | null
    specialStop:  number | null
  }

  const skuEntries: SkuEntry[] = []
  for (const t of targets) {
    const clean = t.sku.replace(/^0+/, '')
    const prod  = skuMap.get(clean) ?? skuMap.get(t.sku)
    if (!prod || prod.rate <= 0) continue
    const wpb = t.channel === 'Makro' ? 1 : (wpbMap.get(clean) ?? wpbMap.get(t.sku) ?? 1)
    const info = specialTimeMap.get(clean) ?? specialTimeMap.get(t.sku)
    skuEntries.push({
      target: t,
      prod,
      rate: prod.rate,
      wpb: wpb > 0 ? wpb : 1,
      totalWorkMins: (t.targetQty / prod.rate) * 60,
      specialStart: info?.startMins ?? null,
      specialStop:  info?.stopMins  ?? null,
    })
  }
  skuEntries.sort((a, b) => b.totalWorkMins - a.totalWorkMins)

  // committed work minutes per worker (local to this call, for load-balancing sort)
  const workerLoad = new Map<string, number>()

  const result: Record<string, unknown>[] = []

  for (const entry of skuEntries) {
    const { target, prod, rate, wpb, specialStart, specialStop } = entry
    const effectiveEnd = specialStop !== null && specialStop < phaseEndMins
      ? specialStop : phaseEndMins

    let remaining = target.targetQty

    // Eligible workers sorted by ascending committed load (then skill level as tiebreak)
    const sorted = workers
      .filter(w => {
        if (!isWorkerEligible(w, prod.product_group)) return false
        const nk = normName(w.name)
        if ((workerHours.get(nk) ?? 0) <= 0) return false
        const free = workerFreeAtMins.get(nk) ?? phaseStartMins
        const start = specialStart !== null ? Math.max(free, specialStart) : free
        return start < effectiveEnd
      })
      .sort((a, b) => {
        const la = workerLoad.get(normName(a.name)) ?? 0
        const lb = workerLoad.get(normName(b.name)) ?? 0
        if (Math.abs(la - lb) > 1) return la - lb
        return getWorkerSkillLevel(a, prod.product_group) -
               getWorkerSkillLevel(b, prod.product_group)
      })

    // Cap workers per SKU based on quantity tiers; also cap per-worker qty at 15 kg
    // so that large SKUs are always shared across multiple people.
    const qty = target.targetQty
    const maxWorkers    = qty <= 15 ? 1 : qty <= 30 ? 2 : qty <= 45 ? 3 : Infinity
    const maxQtyPerWorker = qty > 15 ? 15 : Infinity
    const candidates = maxWorkers === Infinity ? sorted : sorted.slice(0, maxWorkers)

    for (const w of candidates) {
      if (remaining < 0.1) break

      const nk        = normName(w.name)
      const freeMins  = workerFreeAtMins.get(nk) ?? phaseStartMins
      const startMins = specialStart !== null ? Math.max(freeMins, specialStart) : freeMins
      if (startMins >= effectiveEnd) continue

      const availMins    = availableWorkMins(startMins, effectiveEnd)
      if (availMins <= 0) continue
      const maxByTime    = (availMins / 60) * rate
      const maxByHours   = (workerHours.get(nk) ?? 0) * rate

      let assignQty = Math.min(remaining, maxByTime, maxByHours, maxQtyPerWorker)
      if (wpb > 1) {
        const bags = Math.floor(assignQty / wpb)
        if (bags === 0) continue
        assignQty = bags * wpb
      } else {
        assignQty = Math.round(assignQty)
        if (assignQty === 0) continue
      }

      const workMins = (assignQty / rate) * 60
      const endMins  = wallClockFinish(startMins, workMins)

      result.push({
        production_date: productionDate,
        table_name:      tableName,
        worker_code:     w.emp_id,
        worker_name:     w.name,
        sku:             target.sku,
        sku_name:        prod.sku_name || target.skuName || null,
        target_quantity: Math.round(assignQty * 100) / 100,
        unit:            'กก.',
        period,
        deadline_time:   minsToTimeStr(startMins),
        note:            computeRoundsNote(startMins, assignQty, rate),
        status:          'รอดำเนินการ',
        channel:         target.channel,
        is_deficit:      target.isDeficit || false,
      })

      // Update shared state
      workerFreeAtMins.set(nk, endMins)
      workerHours.set(nk, Math.max(0, (workerHours.get(nk) ?? 0) - workMins / 60))
      const segs = workerBusySegments.get(nk) ?? []
      segs.push({ start: startMins, end: endMins })
      workerBusySegments.set(nk, segs)
      workerLoad.set(nk, (workerLoad.get(nk) ?? 0) + workMins)

      remaining -= assignQty
    }
  }

  return result
}

function mergeAssignList(list: SkuTarget[]): SkuTarget[] {
  const merged = new Map<string, SkuTarget>()
  const order: string[] = []
  for (const item of list) {
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

  const rules: RawMaterialRule[] = (rawMaterialRules ?? []).map(r => {
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
    if (!note?.startsWith('rounds:')) return result
    for (const part of note.replace('rounds:', '').split(';')) {
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
    .in('table_name', ['สามชั้น', 'สะโพก', 'ไหล่'])
  if (e1) throw new Error(`Fetch assignments error: ${e1.message}`)
  if (!assignments?.length) return

  const { data: noWithdrawalRows } = await supabase.from('no_withdrawal_skus').select('sap')
  const noWithdrawalSaps = new Set((noWithdrawalRows ?? []).map(r => String(r.sap ?? '').trim()))
  const activeAssignments = assignments.filter(a => !noWithdrawalSaps.has(String(a.sku ?? '').trim()))
  if (!activeAssignments.length) return

  const finRoundMap = new Map<string, Map<number, number>>()
  const finNameMap  = new Map<string, string | null>()
  const skuSet      = new Set<string>()

  for (const a of activeAssignments) {
    const key = `${a.table_name}|||${a.sku}`
    if (!finRoundMap.has(key)) finRoundMap.set(key, new Map())
    finNameMap.set(key, a.sku_name ?? null)
    skuSet.add(a.sku)
    const roundQtys = finRoundMap.get(key)!
    const noteRounds = parseRoundNote(a.note)
    if (noteRounds.size > 0) {
      for (const [rm, q] of Array.from(noteRounds.entries())) {
        const mappedRm = getRoundMins(rm, roundMins)
        roundQtys.set(mappedRm, (roundQtys.get(mappedRm) ?? 0) + q)
      }
    } else {
      const startMins = a.deadline_time ? timeStrToMins(String(a.deadline_time)) : (defaultStartMinsConfig[phaseStr] ?? 480)
      const rm = getRoundMins(startMins, roundMins)
      roundQtys.set(rm, (roundQtys.get(rm) ?? 0) + Number(a.target_quantity))
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
        const rawQty = b.yield_pct > 0 ? finQty / b.yield_pct : finQty
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

  const rawSaps = Array.from(new Set(Array.from(rawMap.values()).map(v => v.raw_sap)))
  type StockRow = { material_code: string; material_name: string | null; spec_code: string; weight_total: number }
  const stockRows: StockRow[] = []

  if (rawSaps.length > 0) {
    const [res0010, res20] = await Promise.all([
      supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
    ])
    stockRows.push(...(res0010.data ?? []) as StockRow[], ...(res20.data ?? []) as StockRow[])

    const foundCodes = new Set(stockRows.map(r => r.material_code))
    const missingNames = Array.from(new Set(
      Array.from(rawMap.values()).filter(v => !foundCodes.has(v.raw_sap)).map(v => v.raw_name).filter(Boolean) as string[]
    ))
    if (missingNames.length > 0) {
      const expandedNames = Array.from(new Set(missingNames.flatMap(n => [n, n.replace(/\s*-\s*/g, '-'), n.replace(/\s*-\s*/g, ' - ')])))
      const [res0010n, res20n] = await Promise.all([
        supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
        supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
      ])
      stockRows.push(...(res0010n.data ?? []) as StockRow[], ...(res20n.data ?? []) as StockRow[])
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

  const rawItems = Array.from(rawMap.values())
    .sort((a, b) => a.roundMins - b.roundMins)
    .map(({ station, raw_sap, raw_name, qty, roundMins }) => {
      const needed  = Math.round(qty * 100) / 100
      const nameKey = normMatName(raw_name ?? '')
      const lots    = stockByMat.get(raw_sap) ?? stockByName.get(nameKey)
      const rawKey  = `${station}|||${raw_sap}|||${roundMins}`
      return {
        sku: raw_sap, sku_name: raw_name, quantity: needed, unit: 'กก.', work_station: station,
        note: lots ? 'คำนวณจาก BOM' : 'ไม่มี Stock',
        lots: lots ? allocateFIFOWithRules(raw_name ?? '', lots, rawToProducts.get(rawKey) ?? [], rules) : [],
        for_products: rawToProducts.get(rawKey) ?? [],
        withdrawal_round: minsToTime(roundMins),
      }
    })

  const noBomItems = noBom.map(({ station, sku, sku_name, qty, roundMins }) => ({
    sku, sku_name, quantity: Math.round(qty * 100) / 100, unit: 'กก.', work_station: station,
    note: 'ไม่พบ BOM — ใช้ปริมาณผลิตโดยตรง',
    lots: [] as LotInfo[], for_products: [] as { sku: string; sku_name: string | null; qty: number }[],
    withdrawal_round: minsToTime(roundMins),
  }))

  const items = [...rawItems, ...noBomItems].sort((a, b) =>
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

  const phaseCfg = PHASE_CONFIG.find(p => p.phase === selectedPhase)
  if (!phaseCfg) return { success: false, message: 'Phase ไม่ถูกต้อง' }

  // Checkpoint scheduling
  const now = new Date()
  const { data: latestAssign } = await supabase
    .from('production_assignments').select('effective_from')
    .eq('production_date', productionDate).eq('period', phaseCfg.period)
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
  const histDates = [1, 2, 3].map(n => {
    const h = new Date(d); h.setDate(d.getDate() - n)
    return h.toISOString().split('T')[0]
  })

  const orderRound = isPhase2 ? '1400' : '0800'

  const [
    { data: workforceRaw0800 },
    { data: workforceRaw1300 },
    wmTodayRaw, wmHistRaw,
    lotusTodayRaw, lotusHistRaw,
    makroTodayRaw, makroHistRaw,
    { data: masterProdRaw },
    { data: masterChannelRaw },
    { data: jobAssignRaw },
    prevAssignedRaw, yieldBagsRaw,
    { data: plan100Raw },
    { data: pickingUnitRaw },
    { data: masterSpecialRaw },
    { data: masterVarLotusRaw },
    { data: masterVarWMRaw },
    { data: masterVarMakroRaw },
    { data: oldAssignmentsRaw },
    { data: quotasRaw },
  ] = await Promise.all([
    supabase.from('daily_workforce').select('emp_id, name, work_station, shift')
      .eq('work_date', productionDate).eq('upload_round', '0800'),
    (isPhase2 || isPhase3)
      ? supabase.from('daily_workforce').select('emp_id, name, work_station, shift')
          .eq('work_date', productionDate).eq('upload_round', '1300')
      : Promise.resolve({ data: [] as WorkforceRow[], error: null }),
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
      .eq('calculation_type', 'Mas Productivity').order('uploaded_at', { ascending: false }),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas Channel').order('uploaded_at', { ascending: false }),
    supabase.from('master_logic_manpower').select('row_data'),
    (isPhase2 || isPhase3) && deductMode !== 'yield'
      ? fetchAll<{ sku: string; target_quantity: number; channel: string | null }>(
          'production_assignments', 'sku, target_quantity, channel', [
            { col: 'production_date', op: 'eq', val: productionDate },
            { col: 'period', op: 'in', val: isPhase3 ? ['เช้า', 'บ่าย'] : ['เช้า'] },
            ...(deductMode === 'actual' ? [{ col: 'status', op: 'eq' as const, val: 'เสร็จแล้ว' }] : []),
          ])
      : Promise.resolve([] as { sku: string; target_quantity: number; channel: string | null }[]),
    (isPhase2 || isPhase3) && deductMode === 'yield'
      ? fetchAll<{ sap_code: string; bags: number }>('yield_bags', 'sap_code, bags',
          [{ col: 'work_date', op: 'eq', val: productionDate }])
      : Promise.resolve([] as { sap_code: string; bags: number }[]),
    isPhase3
      ? supabase.from('production_plan_100').select('sap, product_name, weight_total').eq('plan_date', productionDate)
      : Promise.resolve({ data: [] as { sap: string; product_name: string | null; weight_total: number }[], error: null }),
    supabase.from('picking_unit_master').select('sap, weight_per_bag'),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas Special').order('uploaded_at', { ascending: false }),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas %Variance LOTUS').order('uploaded_at', { ascending: false }),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas %Variance Wet Market').order('uploaded_at', { ascending: false }),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas %Variance Makro').order('uploaded_at', { ascending: false }),
    useRegen
      ? supabase.from('production_assignments').select('*')
          .eq('production_date', productionDate).eq('period', phaseCfg.period)
          .eq('effective_from', latestAssign.effective_from)
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase.from('channel_quotas').select('sku, quantity')
      .eq('quota_date', productionDate).eq('channel', 'Wet Market'),
  ])

  // Merge workforce
  const seenNames = new Set<string>()
  let workforce: WorkforceRow[] = []
  for (const w of [...(workforceRaw1300 ?? []), ...(workforceRaw0800 ?? [])] as WorkforceRow[]) {
    const nameKey = normName(w.name)
    if (seenNames.has(nameKey)) continue
    seenNames.add(nameKey)
    workforce.push(w)
  }
  if (workforce.length === 0) workforce = await fetchWeeklyWorkforce(productionDate)
  if (!workforce.length) return {
    success: false,
    message: (isPhase2 || isPhase3)
      ? 'ไม่พบกำลังคนรอบ 8:00 หรือ 13:00 วันนี้ — กรุณาอัพโหลดก่อน'
      : 'ไม่พบกำลังคนรอบ 8:00 วันนี้ — กรุณาอัพโหลดก่อน',
  }

  const wmToday    = (wmTodayRaw    ?? []) as OrderRow[]
  const wmHist     = (wmHistRaw     ?? []) as OrderRow[]
  const lotusToday = (lotusTodayRaw ?? []) as OrderRow[]
  const lotusHist  = (lotusHistRaw  ?? []) as OrderRow[]
  const makroToday = (makroTodayRaw ?? []) as OrderRow[]
  const makroHist  = (makroHistRaw  ?? []) as OrderRow[]

  const quotaMap = new Map<string, number>()
  for (const q of (quotasRaw ?? []) as { sku: string; quantity: number }[]) {
    const sku = String(q.sku).replace(/^0+/, '')
    quotaMap.set(sku, Number(q.quantity))
  }

  if (isPhase3) {
    if (!(plan100Raw ?? []).length)
      return { success: false, message: 'ไม่พบแผนผลิต 100% วันนี้ — กรุณาอัพโหลดก่อน' }
  } else {
    const hasOrders = isPhase2
      ? (wmToday.length || lotusToday.length || makroToday.length)
      : (wmHist.length  || lotusHist.length  || makroToday.length)
    if (!hasOrders) return {
      success: false,
      message: `ไม่พบข้อมูล${isPhase2 ? `Order รอบ ${orderRound}` : 'BL3 Wet Market หรือ Order'} วันนี้ (Wet Market / LOTUS / Makro) — กรุณาอัพโหลดก่อน`,
    }
  }

  // Bag size map
  const bagSizeMap = new Map<string, number>()
  for (const r of (pickingUnitRaw ?? []) as { sap: string; weight_per_bag: number }[]) {
    const sap = String(r.sap ?? '').trim()
    const wpb = Number(r.weight_per_bag ?? 0)
    if (sap && wpb > 0) { bagSizeMap.set(sap, wpb); bagSizeMap.set(sap.replace(/^0+/, ''), wpb) }
  }
  const roundUpToBag = (sku: string, qty: number): number => {
    const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, ''))
    if (!wpb || wpb <= 0) return qty
    return Math.ceil(qty / wpb) * wpb
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
    const r = row.row_data as Record<string, unknown>
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

  // Parse master data
  const productivity: ProductivityRow[] = masterProdRaw?.length
    ? parseProductivity(masterProdRaw.map(r => r.row_data as Record<string, unknown>)) : []

  const skuMap = new Map<string, ProductivityRow>()
  for (const p of productivity) {
    if (!skuMap.has(p.sku))                    skuMap.set(p.sku, p)
    if (!skuMap.has(p.sku.replace(/^0+/, ''))) skuMap.set(p.sku.replace(/^0+/, ''), p)
  }

  const lotusVarianceMap = new Map<string, number>()
  for (const row of masterVarLotusRaw ?? []) {
    const r = row.row_data as Record<string, unknown>
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

  const jobAssignMap = buildJobAssignMap((jobAssignRaw ?? []) as { row_data: Record<string, unknown> }[])

  const channelPriority: Record<string, number> = {}
  for (const row of masterChannelRaw ?? []) {
    const r = row.row_data as Record<string, unknown>
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

  const dailyUploadedNames = new Set([
    ...(workforceRaw0800 ?? []).map(w => normName(w.name)),
    ...(workforceRaw1300 ?? []).map(w => normName(w.name)),
  ])
  const weeklyWorkforce = await fetchWeeklyWorkforce(productionDate)
  const weeklyWorkforceNames = new Set(weeklyWorkforce.map(w => normName(w.name)))
  const effectiveDailyUploadedNames = dailyUploadedNames.size > 0 ? dailyUploadedNames : weeklyWorkforceNames

  const keptAssignments: any[] = []
  const keptChannelQtyMap = new Map<string, number>()
  const workerKeptMaxEndMins = new Map<string, number>()

  if (useRegen && oldAssignmentsRaw) {
    for (const a of oldAssignmentsRaw) {
      const wName = normName(a.worker_name || '')
      if (effectiveDailyUploadedNames.has(wName) && weeklyWorkforceNames.has(wName)) {
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
      return Object.entries(wmMap).map(([sku, { qty: orderQty, name }]) => ({
        sku, skuName: name, targetQty: Math.max(0, orderQty - (p1.get(sku) ?? 0)), channel: ch,
      })).filter(s => s.targetQty > 0)
    }
    const wmHistNames = new Map(wmHist.map(r => [r.sku.replace(/^0+/, ''), r.sku_name]))
    const lotusHistSkus = new Set(avgLotus.keys())
    return Array.from(avgWM.entries()).map(([sku, avg]) => {
      const isShared = lotusHistSkus.has(sku)
      const quotaToday = quotaMap.get(sku) ?? avg
      const variance = getWetMarketVariance(isShared, quotaToday, avg, avgLotus.get(sku) ?? 0, wmVarParams)
      return { sku, skuName: wmHistNames.get(sku) ?? null, targetQty: avg * variance, channel: ch }
    }).filter(s => s.targetQty > 0)
  }

  const buildMakroTargets = (): SkuTarget[] => {
    const ch = 'Makro'
    if (isPhase2) {
      const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
      return Object.entries(makroMap).map(([sku, { qty: orderQty, name }]) => ({
        sku, skuName: name, targetQty: Math.max(0, orderQty - (p1.get(sku) ?? 0)), channel: ch,
      })).filter(s => s.targetQty > 0)
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
      const variance = getMakroVariance(proportion > 0.1, orderQty, avgBL3, makroVarParams)
      return { sku, skuName: name, targetQty: orderQty * variance, channel: ch }
    }).filter(s => s.targetQty > 0)
  }

  const buildLotusTargets = (): SkuTarget[] => {
    const ch = 'LOTUS'
    if (isPhase2) {
      const p1 = useChannelDeduct ? (phase1ByChannel.get(ch) ?? new Map()) : phase1Assigned
      return Object.entries(lotusMap).map(([sku, { qty: orderQty, name }]) => ({
        sku, skuName: name, targetQty: Math.max(0, orderQty - (p1.get(sku) ?? 0)), channel: ch,
      })).filter(s => s.targetQty > 0)
    }
    const lotusHistNames = new Map(lotusHist.map(r => [r.sku.replace(/^0+/, ''), r.sku_name]))
    return Array.from(avgLotus.entries()).map(([sku, avg]) => {
      const prod = skuMap.get(sku) ?? skuMap.get(sku.replace(/^0+/, ''))
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
      return { sku, skuName: name, targetQty: Math.max(0, qty - (phase1Assigned.get(sku) ?? 0)), channel }
    }).filter(t => t.targetQty > 0)

    const p3ChannelTargets: Record<string, SkuTarget[]> = {}
    for (const t of allPhase3Targets) { p3ChannelTargets[t.channel] ??= []; p3ChannelTargets[t.channel].push(t) }

    const channelsToProcess = [...activeChannels]
    for (const ch of Object.keys(p3ChannelTargets)) { if (!channelsToProcess.includes(ch)) channelsToProcess.push(ch) }
    assignList = channelsToProcess.flatMap(ch => (p3ChannelTargets[ch] ?? []).sort((a, b) => b.targetQty - a.targetQty))
  } else {
    assignList = activeChannels.flatMap(ch => (channelTargets[ch] ?? []).sort((a, b) => b.targetQty - a.targetQty))
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

  // Phase 1: stock-based splitting
  if (selectedPhase === 1) {
    const { data: noWithdrawalRows } = await supabase.from('no_withdrawal_skus').select('sap')
    const noWithdrawalSaps = new Set((noWithdrawalRows ?? []).map(r => String(r.sap ?? '').trim()))

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
      const [res0010, res20] = await Promise.all([
        supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps2).gt('weight_total', 0),
        supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps2).gt('weight_total', 0),
      ])
      stockRows.push(...(res0010.data ?? []) as StockRow2[], ...(res20.data ?? []) as StockRow2[])

      const foundCodes = new Set(stockRows.map(r => r.material_code))
      const missingNames = Array.from(new Set(
        assignList.flatMap(item => (bomMap.get(item.sku.replace(/^0+/, '')) ?? []).map(b => b.raw_name).filter(Boolean) as string[])
          .filter(n => !foundCodes.has(n))
      ))
      if (missingNames.length > 0) {
        const expanded = Array.from(new Set(missingNames.flatMap(n => [n, n.replace(/\s*-\s*/g, '-'), n.replace(/\s*-\s*/g, ' - ')])))
        const [res0010n, res20n] = await Promise.all([
          supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_name', expanded).gt('weight_total', 0),
          supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_name', expanded).gt('weight_total', 0),
        ])
        stockRows.push(...(res0010n.data ?? []) as StockRow2[], ...(res20n.data ?? []) as StockRow2[])
      }
    }

    const { data: rawMaterialRules } = await supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas Raw Material').order('uploaded_at', { ascending: false })
    const rules: RawMaterialRule[] = (rawMaterialRules ?? []).map(r => {
      const data = (r.row_data ?? {}) as Record<string, any>
      return { productGroup: String(data['กลุ่มสินค้า'] ?? '').trim(), type: String(data['ประเภท'] ?? '').trim(), d16: String(data['D16'] ?? '').trim(), d17: String(data['D17'] ?? '').trim() }
    })

    const lotAggCode = new Map<string, number>()
    const matCodeToName = new Map<string, string>()
    for (const row of stockRows) {
      if (!row.material_code || !row.spec_code) continue
      const k = `${row.material_code}|||${row.spec_code}`
      lotAggCode.set(k, (lotAggCode.get(k) ?? 0) + Number(row.weight_total))
      if (row.material_name) matCodeToName.set(row.material_code, row.material_name)
    }

    const parseSpecCodeLocal = (s: string) => {
      const m1 = s.match(/[A-Z]+(\d{2})(\d{2})(\d{2})/)
      if (m1) return { factory: m1[1], prod_date: `${m1[2]}/${m1[3]}`, sortKey: `${m1[3]}${m1[2]}` }
      const m2 = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})[A-Z]/)
      if (m2) return { factory: m2[1], prod_date: `${m2[3]}/${m2[2]}`, sortKey: `${m2[2]}${m2[3]}${m2[4]}` }
      return null
    }
    const normMatNameLocal = (s: string) => s.trim().toLowerCase().replace(/\s*-\s*/g, '-')

    const stockByMat2  = new Map<string, LotEntry[]>()
    const stockByName2 = new Map<string, LotEntry[]>()
    for (const [k, weight] of Array.from(lotAggCode.entries())) {
      const [matCode, spec_code] = k.split('|||')
      const parsed = parseSpecCodeLocal(spec_code)
      const lot: LotEntry = { spec_code, weight, factory: parsed?.factory ?? '-', prod_date: parsed?.prod_date ?? '-', sortKey: parsed?.sortKey ?? spec_code }
      const codeList = stockByMat2.get(matCode) ?? []; codeList.push(lot); stockByMat2.set(matCode, codeList)
      const matName = matCodeToName.get(matCode)
      if (matName) { const nameKey = normMatNameLocal(matName); const nameList = stockByName2.get(nameKey) ?? []; nameList.push(lot); stockByName2.set(nameKey, nameList) }
    }
    for (const list of Array.from(stockByMat2.values())) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    for (const list of Array.from(stockByName2.values())) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

    const splitAssignList: SkuTarget[] = []
    for (const item of assignList) {
      const cleanSku = item.sku.replace(/^0+/, '')
      if (noWithdrawalSaps.has(item.sku) || noWithdrawalSaps.has(cleanSku)) { splitAssignList.push(item); continue }
      const boms = bomMap.get(cleanSku)
      if (!boms?.length) { splitAssignList.push(item); continue }

      let Q_max = item.targetQty
      for (const b of boms) {
        const yield_pct = b.yield_pct > 0 ? b.yield_pct : 1.0
        const lots = stockByMat2.get(b.raw_sap) ?? stockByName2.get(normMatNameLocal(b.raw_name ?? '')) ?? []
        let availWeight = 0
        for (const lot of lots) {
          if (lot.weight <= 0.005) continue
          const lotType = getLotType(b.raw_name ?? '', lot.spec_code, rules)
          if (lotType === 'RAW' || (item.skuName && item.skuName.toUpperCase().includes(lotType.toUpperCase())))
            availWeight += lot.weight
        }
        const maxProduceable = availWeight * yield_pct
        if (maxProduceable < Q_max) Q_max = maxProduceable
      }
      if (Q_max < 0) Q_max = 0

      if (Q_max > 0.01) {
        for (const b of boms) {
          const yield_pct = b.yield_pct > 0 ? b.yield_pct : 1.0
          let rawDeduct = Q_max / yield_pct
          const lots = stockByMat2.get(b.raw_sap) ?? stockByName2.get(normMatNameLocal(b.raw_name ?? '')) ?? []
          for (const lot of lots) {
            if (rawDeduct <= 0.005 || lot.weight <= 0.005) break
            const lotType = getLotType(b.raw_name ?? '', lot.spec_code, rules)
            if (lotType !== 'RAW' && item.skuName && item.skuName.toUpperCase().includes(lotType.toUpperCase())) {
              const take = Math.min(lot.weight, rawDeduct); lot.weight -= take; rawDeduct -= take
            }
          }
          for (const lot of lots) {
            if (rawDeduct <= 0.005 || lot.weight <= 0.005) break
            if (getLotType(b.raw_name ?? '', lot.spec_code, rules) === 'RAW') {
              const take = Math.min(lot.weight, rawDeduct); lot.weight -= take; rawDeduct -= take
            }
          }
        }
      }

      if (Q_max > 0.01) splitAssignList.push({ ...item, targetQty: Q_max, isDeficit: false })
      const deficitQty = item.targetQty - Q_max
      if (deficitQty > 0.01) splitAssignList.push({ ...item, targetQty: deficitQty, isDeficit: true })
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

  // Supplementary plan
  interface SuppSlot { deadlineMins: number; skus: { sku: string; name: string | null; qty: number }[] }
  const suppSlotResults = await Promise.all([1, 2, 3].map(async slot => {
    const { data: log } = await supabase.from('upload_log').select('source_file')
      .eq('table_name', `production_plan_supplementary_${slot}`)
      .order('uploaded_at', { ascending: false }).limit(1).maybeSingle()
    if (!log) return null
    const { data } = await supabase.from('production_plan_supplementary')
      .select('sku, sku_name, quantity, deadline_time').eq('source_file', log.source_file).eq('slot', String(slot))
    if (!data?.length) return null
    const deadlineStr = data[0].deadline_time as string | null
    if (!deadlineStr) return null
    const [dh, dm] = deadlineStr.split(':').map(Number)
    const deadlineMins = dh * 60 + dm
    if (deadlineMins <= phaseStartMins || deadlineMins > phaseEndMins) return null
    return {
      deadlineMins,
      skus: data.map(r => ({ sku: String(r.sku ?? '').replace(/^0+/, ''), name: r.sku_name as string | null, qty: Number(r.quantity) })).filter(s => s.qty > 0),
    } as SuppSlot
  }))
  const activeSuppSlots = (suppSlotResults.filter(Boolean) as SuppSlot[]).sort((a, b) => a.deadlineMins - b.deadlineMins)

  // Assign workers
  const assignments: Record<string, unknown>[] = []

  // Pass 1 — supplementary
  for (const suppSlot of activeSuppSlots) {
    if (!suppSlot) continue
    const suppByStation: Record<string, { sku: string; skuName: string | null; targetQty: number; channel: string }[]> = {}
    for (const { sku, name: skuName, qty: rawQty } of suppSlot.skus) {
      const targetQty = roundUpToBag(sku, rawQty)
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
      }))
    }
  }

  // Pass 2 — sequential channel-by-channel; same SKU across consecutive channels is batched
  // together into the first channel's allocateBalanced call so workers produce it back-to-back.
  const channelsInAssignList = activeChannels.filter(ch => assignList.some(item => item.channel === ch))
  for (const item of assignList) {
    if (!channelsInAssignList.includes(item.channel)) channelsInAssignList.push(item.channel)
  }

  const handledKeys = new Set<string>() // "channel|||normSku" already scheduled

  const resolveTargetQty = (item: SkuTarget): number => {
    let qty = item.channel === 'Makro' ? Math.round(item.targetQty) : roundUpToBag(item.sku, item.targetQty)
    if (isPhase3) {
      const planItem = planMap.get(item.sku.replace(/^0+/, ''))
      if (planItem) {
        const remaining = Math.max(0, planItem.qty - (phase1Assigned.get(item.sku.replace(/^0+/, '')) ?? 0))
        if (qty > remaining) qty = remaining
      }
    }
    return qty
  }

  for (let chIdx = 0; chIdx < channelsInAssignList.length; chIdx++) {
    const ch = channelsInAssignList[chIdx]
    const chItems = assignList.filter(item => {
      const key = `${item.channel}|||${item.sku.replace(/^0+/, '')}`
      return item.channel === ch && !handledKeys.has(key)
    })
    if (!chItems.length) continue

    const targetsByStation: Record<string, typeof assignList> = {}

    for (const item of chItems) {
      const normSku = item.sku.replace(/^0+/, '')
      handledKeys.add(`${item.channel}|||${normSku}`)

      const targetQty = resolveTargetQty(item)
      if (targetQty <= 0) continue

      const prod = skuMap.get(String(item.sku)) ?? skuMap.get(String(Number(item.sku) || item.sku))
      if (!prod) continue
      const station = STATION_TABLE[normalizeStation(prod.station)] ?? normalizeStation(prod.station)
      targetsByStation[station] ??= []
      targetsByStation[station].push({ ...item, targetQty })

      // If this same SKU exists in a subsequent channel, append it here so workers
      // produce it back-to-back without switching to another SKU in between.
      for (let nextIdx = chIdx + 1; nextIdx < channelsInAssignList.length; nextIdx++) {
        const nextCh = channelsInAssignList[nextIdx]
        const nextKey = `${nextCh}|||${normSku}`
        if (handledKeys.has(nextKey)) continue
        const nextItem = assignList.find(i => i.channel === nextCh && i.sku.replace(/^0+/, '') === normSku)
        if (!nextItem) continue
        handledKeys.add(nextKey)
        const nextQty = resolveTargetQty(nextItem)
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
      }))
    }
  }

  assignments.push(...keptAssignments)

  if (!assignments.length) {
    const prodMatchCount = assignList.filter(t => skuMap.has(t.sku) || skuMap.has(t.sku.replace(/^0+/, ''))).length
    const totalWorkerHours = Array.from(workerHours.values()).reduce((s, h) => s + h, 0)
    return {
      success: false,
      message: `ไม่สามารถสร้างคำสั่ง — targets: WM ${channelTargets['Wet Market']?.length ?? 0} / Makro ${channelTargets['Makro']?.length ?? 0} / LOTUS ${channelTargets['LOTUS']?.length ?? 0} | prodMatch: ${prodMatchCount}/${assignList.length} | workerHrs: ${totalWorkerHours.toFixed(1)}`,
    }
  }

  // Delete superseded batch
  if (useRegen) {
    await supabase.from('production_assignments').delete()
      .eq('production_date', productionDate).eq('period', phaseCfg.period)
      .eq('effective_from', latestAssign.effective_from)
  } else {
    await supabase.from('production_assignments').delete()
      .eq('production_date', productionDate).eq('period', phaseCfg.period)
  }

  // Resequence wall-clock start times per worker
  const byWorkerPost: Record<string, any[]> = {}
  for (const a of assignments) {
    const name = a.worker_name as string
    byWorkerPost[name] ??= []
    byWorkerPost[name].push(a)
  }

  const resequenced: any[] = []
  for (const workerTasks of Object.values(byWorkerPost)) {
    workerTasks.sort((a, b) => {
      if (a.isKept && !b.isKept) return -1
      if (!a.isKept && b.isKept) return 1
      if (a.isKept && b.isKept) return 0
      
      const getPriority = (ch: string) => {
        if (ch === 'เสริม') return 0
        return channelPriority[ch] ?? 99
      }
      const priorityA = getPriority(a.channel)
      const priorityB = getPriority(b.channel)
      if (priorityA !== priorityB) return priorityA - priorityB
      
      return ((a.deadline_time as string) || '').localeCompare((b.deadline_time as string) || '')
    })

    const busySegs: { start: number; end: number }[] = []
    let curMins = phaseCfg.startH * 60

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
      } else {
        if (curMins < checkpointMins) curMins = checkpointMins
        
        const specialStart = specialTimeMap.get(cleanSku)?.startMins ?? specialTimeMap.get(task.sku as string)?.startMins ?? null
        
        if (specialStart !== null) {
          // It's a special task!
          const startMins = Math.max(curMins, specialStart)
          const endMins = wallClockFinish(startMins, duration)
          task.deadline_time = minsToTimeStr(startMins)
          busySegs.push({ start: startMins, end: endMins })
          // We do NOT update curMins to endMins, so it doesn't block regular tasks!
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
          
          task.deadline_time = minsToTimeStr(startMins)
          const endMins = wallClockFinish(startMins, duration)
          busySegs.push({ start: startMins, end: endMins })
          curMins = endMins
        }
      }
    }
    resequenced.push(...workerTasks)
  }

  resequenced.forEach((a, i) => { a['seq'] = i; a['effective_from'] = effectiveFromISO; delete a.is_deficit })
  assignments.length = 0
  assignments.push(...resequenced)

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
    message: isScheduled
      ? `Phase ${selectedPhase} (${phaseCfg.period}) สร้างสำเร็จ ${assignments.length} รายการ — มีผลตั้งแต่ ${effectiveTimeStr} น. (${channelSummary})`
      : `Phase ${selectedPhase} (${phaseCfg.period}) สร้างสำเร็จ ${assignments.length} รายการ — ${channelSummary}`,
    count: assignments.length,
    debug_targets: Object.entries(debugChannelTargets)
      .map(([sku, v]) => ({ sku, ...v }))
      .sort((a, b) => b.merged - a.merged)
      .slice(0, 30),
  }
}
