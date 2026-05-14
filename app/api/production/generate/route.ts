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

// ========== Break config ==========

const BREAK_START_MINS = 720  // 12:00
const BREAK_END_MINS   = 780  // 13:00

/** Work minutes available between fromMins and toMins, excluding break */
function availableWorkMins(fromMins: number, toMins: number): number {
  const total = Math.max(0, toMins - fromMins)
  const breakOverlap = Math.max(0,
    Math.min(BREAK_END_MINS, toMins) - Math.max(BREAK_START_MINS, fromMins)
  )
  return Math.max(0, total - breakOverlap)
}

/** Wall-clock finish time when starting at fromMins and doing workMins of actual work */
function wallClockFinish(fromMins: number, workMins: number): number {
  if (workMins <= 0) return fromMins
  // If start falls inside break, jump to break end
  const start = (fromMins >= BREAK_START_MINS && fromMins < BREAK_END_MINS)
    ? BREAK_END_MINS : fromMins
  if (start < BREAK_START_MINS) {
    const beforeBreak = BREAK_START_MINS - start
    if (workMins <= beforeBreak) return start + workMins
    return BREAK_END_MINS + (workMins - beforeBreak)
  }
  return start + workMins
}

// ========== Phase config ==========

const PHASE_CONFIG = [
  { phase: 1, period: 'เช้า',  deadline: '14:00:00', hours: 6, startH: 8,  endH: 14 },
  { phase: 2, period: 'บ่าย',  deadline: '16:00:00', hours: 2, startH: 14, endH: 16 },
  { phase: 3, period: 'ค่ำ',   deadline: null,        hours: 2, startH: 17, endH: 19 },
]

// ========== Station mapping ==========

const normalizeStation = (s: string) => s.replace(/[()]/g, '').trim()

const STATION_TABLE: Record<string, string> = {
  'สามชั้นพิเศษ': 'สามชั้น',
  'ไหล่พิเศษ':    'ไหล่',
  'สะโพกพิเศษ':   'สะโพก',
}

// ========== Helpers ==========

const normName = (s: string) => s.replace(/\s+/g, ' ').trim()

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
    if (!bySkuDate[r.sku]) bySkuDate[r.sku] = {}
    bySkuDate[r.sku][r.delivery_date] = (bySkuDate[r.sku][r.delivery_date] ?? 0) + r.quantity
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
    phaseEndMins: number
    period: string
    deadline: string | null
    channel?: string
  }
): Record<string, unknown>[] {
  const {
    productionDate, tableName, sku, skuName, targetQty,
    eligibleWorkers, rate, workerHours, workerFreeAtMins, phaseEndMins, period, deadline, channel,
  } = params

  const entries = eligibleWorkers
    .map(w => {
      const freeAt          = workerFreeAtMins.get(w.emp_id) ?? 0
      const remainingHours  = workerHours.get(w.emp_id) ?? 0
      // cap to actual work time remaining in phase (excluding break)
      const availWorkMins   = Math.min(remainingHours * 60, Math.max(0, availableWorkMins(freeAt, phaseEndMins)))
      const exhaustAt       = wallClockFinish(freeAt, availWorkMins)
      return { worker: w, freeAt, exhaustAt, remainingHours }
    })
    .filter(e => e.exhaustAt > e.freeAt + 0.1)  // must have usable capacity
    .sort((a, b) => a.freeAt - b.freeAt)

  if (!entries.length) return []

  // Build sorted event timeline: join/exhaust times + break boundaries
  const eventTimes = Array.from(
    new Set([...entries.flatMap(e => [e.freeAt, e.exhaustAt]), BREAK_START_MINS, BREAK_END_MINS])
  ).sort((a, b) => a - b)

  let pool = targetQty
  const workerQty      = new Map<string, number>()
  const workerFinishAt = new Map<string, number>()

  for (let i = 0; i < eventTimes.length - 1 && pool > 0.01; i++) {
    const t0 = eventTimes[i]
    const t1 = eventTimes[i + 1]

    // Skip lunch break 12:00–13:00
    if (t0 >= BREAK_START_MINS && t1 <= BREAK_END_MINS) continue

    // Active in this segment: joined (freeAt ≤ t0) and not yet exhausted (exhaustAt > t0)
    const active = entries.filter(e => e.freeAt <= t0 && e.exhaustAt > t0)
    if (!active.length) continue

    const totalRate  = active.length * rate
    const maxConsume = totalRate * (t1 - t0) / 60

    if (maxConsume >= pool) {
      // Pool exhausted within this segment — each active worker gets equal share
      const perWorkerQty = pool / active.length
      const finishAt     = t0 + (pool / totalRate) * 60
      for (const a of active) {
        workerQty.set(a.worker.emp_id, (workerQty.get(a.worker.emp_id) ?? 0) + perWorkerQty)
        workerFinishAt.set(a.worker.emp_id, finishAt)
      }
      pool = 0
    } else {
      // Full segment: each active worker contributes equally
      const perWorkerQty = rate * (t1 - t0) / 60
      for (const a of active) {
        workerQty.set(a.worker.emp_id, (workerQty.get(a.worker.emp_id) ?? 0) + perWorkerQty)
        workerFinishAt.set(a.worker.emp_id, t1)
      }
      pool -= maxConsume
    }
  }

  const result: Record<string, unknown>[] = []
  for (const e of entries) {
    const qty = workerQty.get(e.worker.emp_id) ?? 0
    if (qty < 0.5) continue
    const finishAt = workerFinishAt.get(e.worker.emp_id) ?? e.freeAt
    workerHours.set(e.worker.emp_id, e.remainingHours - qty / rate)
    workerFreeAtMins.set(e.worker.emp_id, finishAt)
    result.push({
      production_date: productionDate,
      table_name:      tableName,
      worker_code:     e.worker.emp_id,
      worker_name:     e.worker.name,
      sku,
      sku_name:        skuName,
      target_quantity: Math.round(qty),
      unit:            'กก.',
      period,
      deadline_time:   deadline,
      status:          'รอดำเนินการ',
      channel:         channel ?? null,
    })
  }

  return result
}

// ========== Main ==========

export async function POST(req: NextRequest) {
  try {
    const { date, phase: phaseParam } = await req.json()
    const productionDate: string = date ?? new Date().toISOString().split('T')[0]
    const selectedPhase: number = phaseParam ? Number(phaseParam) : 1
    const isPhase2 = selectedPhase === 2
    const isPhase3 = selectedPhase === 3

    const phaseCfg = PHASE_CONFIG.find(p => p.phase === selectedPhase)
    if (!phaseCfg) return NextResponse.json({ success: false, message: 'Phase ไม่ถูกต้อง' }, { status: 400 })

    // 3 historical days before productionDate
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
      { data: wmTodayRaw },
      { data: wmHistRaw },
      { data: lotusTodayRaw },
      { data: lotusHistRaw },
      { data: makroTodayRaw },
      { data: makroHistRaw },
      { data: masterProdRaw },
      { data: masterChannelRaw },
      { data: jobAssignRaw },
      { data: prevAssignedRaw },
      { data: plan100Raw },
    ] = await Promise.all([
      supabase.from('daily_workforce')
        .select('emp_id, name, work_station, shift')
        .eq('work_date', productionDate)
        .eq('upload_round', '0800'),
      isPhase2
        ? supabase.from('daily_workforce')
            .select('emp_id, name, work_station, shift')
            .eq('work_date', productionDate)
            .eq('upload_round', '1300')
        : Promise.resolve({ data: [] as WorkforceRow[], error: null }),
      supabase.from('wet_market_orders')
        .select('sku, sku_name, quantity, delivery_date')
        .eq('delivery_date', productionDate)
        .eq('upload_round', orderRound),
      supabase.from('wet_market_orders')
        .select('sku, sku_name, quantity, delivery_date')
        .in('delivery_date', histDates)
        .eq('upload_round', '1600'),
      supabase.from('lotus_orders')
        .select('sku, sku_name, quantity, delivery_date')
        .eq('delivery_date', productionDate)
        .eq('upload_round', orderRound),
      supabase.from('lotus_orders')
        .select('sku, sku_name, quantity, delivery_date')
        .in('delivery_date', histDates)
        .eq('upload_round', '1600'),
      supabase.from('makro_orders')
        .select('sku, sku_name, quantity, delivery_date')
        .eq('delivery_date', productionDate)
        .eq('upload_round', orderRound),
      supabase.from('makro_orders')
        .select('sku, sku_name, quantity, delivery_date')
        .in('delivery_date', histDates),
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
      // Phase 2/3: load previously-assigned quantities to deduct
      (isPhase2 || isPhase3)
        ? supabase.from('production_assignments')
            .select('sku, target_quantity, channel')
            .eq('production_date', productionDate)
            .in('period', isPhase3 ? ['เช้า', 'บ่าย'] : ['เช้า'])
        : Promise.resolve({ data: [] as { sku: string; target_quantity: number; channel: string | null }[], error: null }),
      // Phase 3: load 100% production plan
      isPhase3
        ? supabase.from('production_plan_100')
            .select('sap, product_name, weight_total')
            .eq('plan_date', productionDate)
        : Promise.resolve({ data: [] as { sap: string; product_name: string | null; weight_total: number }[], error: null }),
    ])

    // Merge workforce: Phase 2 = 0800 + 1300 (deduplicated)
    const seenEmpIds = new Set<string>()
    const workforce: WorkforceRow[] = []
    for (const w of [...(workforceRaw0800 ?? []), ...(workforceRaw1300 ?? [])] as WorkforceRow[]) {
      if (seenEmpIds.has(w.emp_id)) continue
      seenEmpIds.add(w.emp_id)
      workforce.push(w)
    }

    if (!workforce.length)
      return NextResponse.json({
        success: false,
        message: isPhase2
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

    // ------ Parse master data ------
    const productivity: ProductivityRow[] = masterProdRaw?.length
      ? parseProductivity(masterProdRaw.map(r => r.row_data as Record<string, unknown>))
      : []

    const skuMap = new Map<string, ProductivityRow>()
    for (const p of productivity) {
      skuMap.set(p.sku, p)
      skuMap.set(p.sku.replace(/^0+/, ''), p)
    }

    const jobAssignMap = buildJobAssignMap(
      (jobAssignRaw ?? []) as { row_data: Record<string, unknown> }[]
    )

    // Channel priority for this phase
    const channelPriority: Record<string, number> = {}
    for (const row of (masterChannelRaw ?? [])) {
      const r = row.row_data as Record<string, unknown>
      if (Number(r['Phase']) === selectedPhase) {
        channelPriority[String(r['Channel'])] = Number(r['Priority'])
      }
    }
    const channelOrder = Object.entries(channelPriority)
      .sort((a, b) => a[1] - b[1])
      .map(([ch]) => ch)
    const activeChannels = channelOrder.length ? channelOrder : ['Wet Market', 'Makro', 'LOTUS']

    // ------ Workers grouped by station ------
    const workersByStation: Record<string, WorkforceRow[]> = {}
    for (const w of workforce) {
      const station = normalizeStation(w.work_station ?? '')
      if (!station) continue
      workersByStation[station] ??= []
      workersByStation[station].push(w)
    }

    // Each worker starts with full phase hours and becomes free at phase start
    const phaseStartMins = phaseCfg.startH * 60
    const phaseEndMins   = phaseCfg.endH   * 60
    const workerHours = new Map<string, number>()
    const workerFreeAtMins = new Map<string, number>()
    for (const w of workforce) {
      workerHours.set(w.emp_id, phaseCfg.hours)
      workerFreeAtMins.set(w.emp_id, phaseStartMins)
    }

    // ------ Historical averages ------
    const avgWM    = buildAvgMap(wmHist)
    const avgLotus = buildAvgMap(lotusHist)
    const avgMakro = buildAvgMap(makroHist)

    // ------ Phase 1/2 produced qty per SKU — split by channel ------
    type PrevRow = { sku: string; target_quantity: number; channel: string | null }
    const phase1WM    = new Map<string, number>()
    const phase1Lotus = new Map<string, number>()
    const phase1Makro = new Map<string, number>()
    const phase1All   = new Map<string, number>()   // for Phase 3
    for (const a of (prevAssignedRaw ?? []) as PrevRow[]) {
      const qty = Number(a.target_quantity)
      phase1All.set(a.sku, (phase1All.get(a.sku) ?? 0) + qty)
      if (a.channel === 'Wet Market') phase1WM.set(a.sku, (phase1WM.get(a.sku) ?? 0) + qty)
      else if (a.channel === 'LOTUS') phase1Lotus.set(a.sku, (phase1Lotus.get(a.sku) ?? 0) + qty)
      else if (a.channel === 'Makro') phase1Makro.set(a.sku, (phase1Makro.get(a.sku) ?? 0) + qty)
    }

    // Shared SKU set: appears in both WM and LOTUS today (Phase 1 only)
    const lotusTodaySkus = new Set(lotusToday.map(r => r.sku))

    // Aggregate today's orders per SKU
    const aggregateToday = (rows: OrderRow[]): Record<string, { qty: number; name: string | null }> => {
      const m: Record<string, { qty: number; name: string | null }> = {}
      for (const r of rows) {
        m[r.sku] = { qty: (m[r.sku]?.qty ?? 0) + r.quantity, name: m[r.sku]?.name ?? r.sku_name }
      }
      return m
    }

    const wmMap    = aggregateToday(wmToday)
    const lotusMap = aggregateToday(lotusToday)
    const makroMap = aggregateToday(makroToday)

    // ------ Build SKU targets per channel ------

    interface SkuTarget { sku: string; skuName: string | null; targetQty: number; channel?: string }

    const buildWetMarketTargets = (): SkuTarget[] => {
      if (isPhase2) {
        // Phase 2: Min(1400 order, BL3) − WM Phase1 only
        return Object.entries(wmMap).map(([sku, { qty: orderQty, name }]) => {
          const avg = avgWM.get(sku) ?? 0
          const base = avg > 0 ? Math.min(orderQty, avg) : orderQty
          const targetQty = Math.max(0, base - (phase1WM.get(sku) ?? 0))
          return { sku, skuName: name, targetQty, channel: 'Wet Market' }
        }).filter(s => s.targetQty > 0)
      }
      // Phase 1: Avg BL3 × %Variance
      const wmHistNames = new Map(wmHist.map(r => [r.sku, r.sku_name]))
      const lotusHistSkus = new Set(avgLotus.keys())
      return Array.from(avgWM.entries()).map(([sku, avg]) => {
        const isShared = lotusHistSkus.has(sku)
        const lotusBL3 = avgLotus.get(sku) ?? 0
        const variance = getWetMarketVariance(isShared, avg, avg, lotusBL3)
        return { sku, skuName: wmHistNames.get(sku) ?? null, targetQty: avg * variance, channel: 'Wet Market' }
      }).filter(s => s.targetQty > 0)
    }

    const buildMakroTargets = (): SkuTarget[] => {
      if (isPhase2) {
        // Phase 2: 1400 order − Makro Phase1 only (no variance)
        return Object.entries(makroMap).map(([sku, { qty: orderQty, name }]) => {
          const targetQty = Math.max(0, orderQty - (phase1Makro.get(sku) ?? 0))
          return { sku, skuName: name, targetQty, channel: 'Makro' }
        }).filter(s => s.targetQty > 0)
      }
      // Phase 1: order × variance
      const makroTotal = Object.values(makroMap).reduce((s, v) => s + v.qty, 0)
      return Object.entries(makroMap).map(([sku, { qty: orderQty, name }]) => {
        const avg = avgMakro.get(sku) ?? 0
        const proportion = makroTotal > 0 ? orderQty / makroTotal : 0
        const variance = getMakroVariance(proportion > 0.1, orderQty, avg)
        return { sku, skuName: name, targetQty: orderQty * variance, channel: 'Makro' }
      }).filter(s => s.targetQty > 0)
    }

    const buildLotusTargets = (): SkuTarget[] => {
      if (isPhase2) {
        // Phase 2: Min(1400 order, BL3) − LOTUS Phase1 only
        return Object.entries(lotusMap).map(([sku, { qty: orderQty, name }]) => {
          const avg = avgLotus.get(sku) ?? 0
          const base = avg > 0 ? Math.min(orderQty, avg) : orderQty
          const targetQty = Math.max(0, base - (phase1Lotus.get(sku) ?? 0))
          return { sku, skuName: name, targetQty, channel: 'LOTUS' }
        }).filter(s => s.targetQty > 0)
      }
      // Phase 1: Avg BL3
      const lotusHistNames = new Map(lotusHist.map(r => [r.sku, r.sku_name]))
      return Array.from(avgLotus.entries()).map(([sku, avg]) => ({
        sku, skuName: lotusHistNames.get(sku) ?? null, targetQty: avg, channel: 'LOTUS',
      })).filter(s => s.targetQty > 0)
    }

    const channelTargets: Record<string, SkuTarget[]> = {
      'Wet Market': buildWetMarketTargets(),
      'Makro':      buildMakroTargets(),
      'LOTUS':      buildLotusTargets(),
    }

    // ------ Build assignment list ------
    let assignList: SkuTarget[]
    if (isPhase3) {
      // Phase 3: plan_100 − Ph1 − Ph2
      const plan100 = (plan100Raw ?? []) as { sap: string; product_name: string | null; weight_total: number }[]
      const planMap = new Map<string, { name: string | null; qty: number }>()
      for (const r of plan100) {
        const cur = planMap.get(r.sap) ?? { name: r.product_name ?? null, qty: 0 }
        cur.qty += Number(r.weight_total)
        planMap.set(r.sap, cur)
      }
      assignList = Array.from(planMap.entries())
        .map(([sku, { name, qty }]) => ({
          sku, skuName: name,
          targetQty: Math.max(0, qty - (phase1All.get(sku) ?? 0)),
        }))
        .filter(t => t.targetQty > 0)
        .sort((a, b) => b.targetQty - a.targetQty)
    } else {
      // Phase 1/2: channel priority order, sorted by qty desc within each channel
      assignList = activeChannels.flatMap(ch =>
        (channelTargets[ch] ?? []).sort((a, b) => b.targetQty - a.targetQty)
      )
    }

    // ------ Assign workers ------
    const assignments: Record<string, unknown>[] = []

    for (const { sku, skuName, targetQty, channel } of assignList) {
      const prod = skuMap.get(String(sku)) ?? skuMap.get(String(Number(sku) || sku))
      if (!prod) continue

      const station   = normalizeStation(prod.station)
      const tableName = STATION_TABLE[station] ?? station
      const skuGroup  = prod.product_group

      const allAtStation = workersByStation[station] ?? []
      const eligibleWorkers = allAtStation
        .filter(w => {
          const jobInfo = jobAssignMap.get(normName(w.name))
          if (!jobInfo || jobInfo.groups.size === 0) return true
          return skuGroup ? jobInfo.groups.has(skuGroup) : true
        })
        .sort((a, b) => {
          const lvA = jobAssignMap.get(normName(a.name))?.groups.get(skuGroup) ?? 99
          const lvB = jobAssignMap.get(normName(b.name))?.groups.get(skuGroup) ?? 99
          if (lvA !== lvB) return lvA - lvB
          return (workerHours.get(b.emp_id) ?? 0) - (workerHours.get(a.emp_id) ?? 0)
        })
      if (!eligibleWorkers.length) continue

      const cappedWorkers = eligibleWorkers.slice(0, maxWorkersForQty(targetQty))

      const newAssignments = assignWorkers({
        productionDate,
        tableName,
        sku: String(sku),
        skuName: prod.sku_name || skuName || null,
        targetQty,
        eligibleWorkers: cappedWorkers,
        rate: prod.rate,
        workerHours,
        workerFreeAtMins,
        phaseEndMins,
        period: phaseCfg.period,
        deadline: phaseCfg.deadline,
        channel,
      })

      assignments.push(...newAssignments)
    }

    // Tag each assignment with its position so the frontend can sort tasks per worker in generation order
    assignments.forEach((a, i) => { a['seq'] = i })

    if (!assignments.length)
      return NextResponse.json({
        success: false,
        message: 'ไม่สามารถสร้างคำสั่ง — SKU ใน Order ไม่ตรงกับ SAP ใน Mas Productivity หรือ work_station ไม่ตรงกับ จุดงาน',
      }, { status: 400 })

    // Replace existing assignments for this period only
    await supabase
      .from('production_assignments')
      .delete()
      .eq('production_date', productionDate)
      .eq('period', phaseCfg.period)

    const { error } = await supabase.from('production_assignments').insert(assignments)
    if (error) throw error

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

    return NextResponse.json({
      success: true,
      message: `Phase ${selectedPhase} (${phaseCfg.period}) สร้างสำเร็จ ${assignments.length} รายการ — ${channelSummary}`,
      count: assignments.length,
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' },
      { status: 500 }
    )
  }
}
