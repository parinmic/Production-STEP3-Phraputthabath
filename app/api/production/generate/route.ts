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

// ========== Phase config ==========

const PHASE_CONFIG = [
  { phase: 1, period: 'เช้า',  deadline: '14:00:00', hours: 6 },
  { phase: 2, period: 'บ่าย',  deadline: '16:00:00', hours: 2 },
  { phase: 3, period: 'ค่ำ',   deadline: null,        hours: 2 },
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

/** Water-fill: ทุกคนที่ทำได้ทำ SKU เดียวกันพร้อมกัน แบ่งปริมาณเท่าๆ กัน
 *  SKU ถูกเรียงจากมากไปน้อย → SKU ใหญ่สุดเสร็จก่อนเสมอ
 *  ใครรับได้น้อยกว่า (capacity น้อย) จะได้น้อยกว่า แล้ว load ส่วนที่เหลือกระจายให้คนอื่น */
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
    period: string
    deadline: string | null
  }
): Record<string, unknown>[] {
  const { productionDate, tableName, sku, skuName, targetQty, eligibleWorkers, rate, workerHours, period, deadline } = params

  const entries = eligibleWorkers
    .map(w => ({ worker: w, cap: (workerHours.get(w.emp_id) ?? 0) * rate, qty: 0 }))
    .filter(e => e.cap > 0)

  if (!entries.length) return []

  // Water-fill: แบ่งเท่ากันทุกรอบ คนที่เต็มแล้วหลุดออก load ที่เหลือกระจายให้คนอื่น
  let toGive = targetQty
  let active = [...entries]

  while (toGive > 0.5 && active.length > 0) {
    const share = toGive / active.length
    const nextActive: typeof active = []
    for (const e of active) {
      const give = Math.min(share, e.cap, toGive)
      e.qty  += give
      e.cap  -= give
      toGive -= give
      if (e.cap > 0.5) nextActive.push(e)
    }
    if (nextActive.length === active.length) break
    active = nextActive
  }

  // Commit
  const result: Record<string, unknown>[] = []
  for (const e of entries) {
    if (e.qty < 0.5) continue
    workerHours.set(e.worker.emp_id, (workerHours.get(e.worker.emp_id) ?? 0) - e.qty / rate)
    result.push({
      production_date: productionDate,
      table_name:      tableName,
      worker_code:     e.worker.emp_id,
      worker_name:     e.worker.name,
      sku,
      sku_name:        skuName,
      target_quantity: Math.round(e.qty),
      unit:            'กก.',
      period,
      deadline_time:   deadline,
      status:          'รอดำเนินการ',
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

    // Phase 2 reads orders from 1300 round; Phase 1 from 0800
    const orderRound = isPhase2 ? '1300' : '0800'

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
            .select('sku, target_quantity')
            .eq('production_date', productionDate)
            .in('period', isPhase3 ? ['เช้า', 'บ่าย'] : ['เช้า'])
        : Promise.resolve({ data: [] as { sku: string; target_quantity: number }[], error: null }),
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
      const hasOrders = wmToday.length || lotusToday.length || makroToday.length
      if (!hasOrders)
        return NextResponse.json({
          success: false,
          message: `ไม่พบ Order รอบ ${orderRound} วันนี้ (Wet Market / LOTUS / Makro) — กรุณาอัพโหลดก่อน`,
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

    // Capacity: each worker starts with phaseCfg.hours
    const workerHours = new Map<string, number>()
    for (const w of workforce) workerHours.set(w.emp_id, phaseCfg.hours)

    // ------ Historical averages ------
    const avgWM    = buildAvgMap(wmHist)
    const avgLotus = buildAvgMap(lotusHist)
    const avgMakro = buildAvgMap(makroHist)

    // ------ Phase 1 produced qty per SKU (Phase 2 only) ------
    const phase1Assigned = new Map<string, number>()
    for (const a of (prevAssignedRaw ?? []) as { sku: string; target_quantity: number }[]) {
      phase1Assigned.set(a.sku, (phase1Assigned.get(a.sku) ?? 0) + Number(a.target_quantity))
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

    interface SkuTarget { sku: string; skuName: string | null; targetQty: number }

    const buildWetMarketTargets = (): SkuTarget[] => {
      if (isPhase2) {
        // Phase 2: Min(1300 order, avg BL3) − Phase 1 assigned
        return Object.entries(wmMap).map(([sku, { qty: orderQty, name }]) => {
          const avg = avgWM.get(sku) ?? 0
          const base = avg > 0 ? Math.min(orderQty, avg) : orderQty
          const targetQty = Math.max(0, base - (phase1Assigned.get(sku) ?? 0))
          return { sku, skuName: name, targetQty }
        }).filter(s => s.targetQty > 0)
      }
      // Phase 1: quota × variance
      return Object.entries(wmMap).map(([sku, { qty: quotaToday, name }]) => {
        const avg = avgWM.get(sku) ?? 0
        const isShared = lotusTodaySkus.has(sku)
        const lotusBL3 = avgLotus.get(sku) ?? 0
        const variance = getWetMarketVariance(isShared, quotaToday, avg, lotusBL3)
        const effectiveAvg = avg > 0 ? avg : quotaToday
        const targetQty = Math.min(quotaToday, effectiveAvg * variance)
        return { sku, skuName: name, targetQty }
      }).filter(s => s.targetQty > 0)
    }

    const buildMakroTargets = (): SkuTarget[] => {
      if (isPhase2) {
        // Phase 2: 1300 order − Phase 1 assigned (no variance)
        return Object.entries(makroMap).map(([sku, { qty: orderQty, name }]) => {
          const targetQty = Math.max(0, orderQty - (phase1Assigned.get(sku) ?? 0))
          return { sku, skuName: name, targetQty }
        }).filter(s => s.targetQty > 0)
      }
      // Phase 1: order × variance
      const makroTotal = Object.values(makroMap).reduce((s, v) => s + v.qty, 0)
      return Object.entries(makroMap).map(([sku, { qty: orderQty, name }]) => {
        const avg = avgMakro.get(sku) ?? 0
        const proportion = makroTotal > 0 ? orderQty / makroTotal : 0
        const variance = getMakroVariance(proportion > 0.1, orderQty, avg)
        return { sku, skuName: name, targetQty: orderQty * variance }
      }).filter(s => s.targetQty > 0)
    }

    const buildLotusTargets = (): SkuTarget[] => {
      if (isPhase2) {
        // Phase 2: Min(1300 order, avg BL3) − Phase 1 assigned
        return Object.entries(lotusMap).map(([sku, { qty: orderQty, name }]) => {
          const avg = avgLotus.get(sku) ?? 0
          const base = avg > 0 ? Math.min(orderQty, avg) : orderQty
          const targetQty = Math.max(0, base - (phase1Assigned.get(sku) ?? 0))
          return { sku, skuName: name, targetQty }
        }).filter(s => s.targetQty > 0)
      }
      // Phase 1: avg BL3 only
      return Object.entries(lotusMap).map(([sku, { name }]) => ({
        sku, skuName: name, targetQty: avgLotus.get(sku) ?? 0
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
          targetQty: Math.max(0, qty - (phase1Assigned.get(sku) ?? 0)),
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

    for (const { sku, skuName, targetQty } of assignList) {
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

      const newAssignments = assignWorkers({
        productionDate,
        tableName,
        sku: String(sku),
        skuName: prod.sku_name || skuName || null,
        targetQty,
        eligibleWorkers,
        rate: prod.rate,
        workerHours,
        period: phaseCfg.period,
        deadline: phaseCfg.deadline,
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
