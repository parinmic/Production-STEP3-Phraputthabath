import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// ── Shared helpers (mirrors generate/route.ts) ──────────────────────────────

interface WorkforceRow { emp_id: string; name: string; work_station: string; shift: string }
interface ProductivityRow { station: string; product_group: string; sku: string; sku_name: string; rate: number }

const BREAKS: [number, number][] = [[720, 780], [1020, 1080]]
const STATION_TABLE: Record<string, string> = {
  'สามชั้นพิเศษ': 'สามชั้น', 'ไหล่พิเศษ': 'ไหล่', 'สะโพกพิเศษ': 'สะโพก',
}

const normName       = (s: string) => {
  if (!s) return ''
  return s.replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}
const normalizeStation = (s: string) => s.replace(/[()]/g, '').trim()

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

function minsToTimeStr(mins: number): string {
  const h = Math.floor(mins / 60); const m = Math.floor(mins % 60)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`
}

function availableWorkMins(from: number, to: number): number {
  const total = Math.max(0, to - from)
  const overlap = BREAKS.reduce((s, [bs, be]) => s + Math.max(0, Math.min(be, to) - Math.max(bs, from)), 0)
  return Math.max(0, total - overlap)
}

function wallClockFinish(from: number, workMins: number): number {
  if (workMins <= 0) return from
  let pos = from; let rem = workMins
  for (const [bs, be] of BREAKS) {
    if (pos >= bs && pos < be) pos = be
    if (pos >= be) continue
    if (rem <= 0) break
    const before = bs - pos
    if (rem <= before) return pos + rem
    rem -= before; pos = be
  }
  return pos + rem
}

function parseProductivity(rows: Record<string, unknown>[]): ProductivityRow[] {
  return rows.map(r => ({
    station:       String(r['จุดงาน'] ?? '').trim(),
    product_group: String(r['กลุ่มสินค้า'] ?? '').trim(),
    sku:           String(r['SAP'] ?? '').trim(),
    sku_name:      String(r['ชื่อสินค้า'] ?? '').trim(),
    rate:          Number(r['กำลังการผลิต (กก./ชม./คน)'] ?? 0),
  })).filter(r => r.station && r.sku && r.rate > 0)
}

function buildJobAssignMap(rows: { row_data: Record<string, unknown> }[]) {
  const map = new Map<string, { isWeigher: boolean; groups: Map<string, number> }>()
  for (const { row_data: r } of rows) {
    const fullName = normName(String(r['รายชื่อพนักงาน'] ?? ''))
    if (!fullName) continue
    const groups = new Map<string, number>()
    for (const [key, val] of Object.entries(r)) {
      if (!key.startsWith('กลุ่ม') || val == null) continue
      const level = Number(val); const cleanKey = key.replace(/_\d+$/, '')
      if (!groups.has(cleanKey) || level < (groups.get(cleanKey) ?? 99)) groups.set(cleanKey, level)
    }
    map.set(fullName, { isWeigher: Number(r['ชั่งน้ำหนัก'] ?? 0) === 1, groups })
  }
  return map
}

function maxWorkersForQty(qty: number): number {
  if (qty <= 15) return 1; if (qty <= 30) return 2; if (qty <= 45) return 3; return Infinity
}

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

function assignWorkers(params: {
  productionDate: string; tableName: string; sku: string; skuName: string | null
  targetQty: number; eligibleWorkers: WorkforceRow[]; rate: number
  workerHours: Map<string, number>; workerFreeAtMins: Map<string, number>
  workerBusySegments?: Map<string, { start: number; end: number }[]>
  phaseEndMins: number; period: string; channel: string
  specialStartMins?: number | null
  specialStopMins?: number | null
}): Record<string, unknown>[] {
  const { productionDate, tableName, sku, skuName, targetQty, eligibleWorkers, rate,
          workerHours, workerFreeAtMins, workerBusySegments, phaseEndMins, period, channel,
          specialStartMins, specialStopMins } = params

  let entries = eligibleWorkers.map(w => {
    const nameKey = normName(w.name)
    const phaseStartMins = 510
    const currentFree = (workerBusySegments && workerFreeAtMins)
      ? getWorkerFreeAt(nameKey, workerFreeAtMins, workerBusySegments, phaseStartMins)
      : (workerFreeAtMins.get(nameKey) ?? 0)

    const freeAt = specialStartMins !== null && specialStartMins !== undefined
      ? Math.max(currentFree, specialStartMins)
      : currentFree

    const limitEnd = (workerBusySegments)
      ? Math.min(phaseEndMins, getNextBusyStart(nameKey, workerBusySegments, freeAt))
      : phaseEndMins

    const remH   = workerHours.get(nameKey) ?? 0
    const targetEndMins = specialStopMins !== null && specialStopMins !== undefined
      ? Math.min(limitEnd, specialStopMins)
      : limitEnd

    const avail  = Math.min(remH * 60, Math.max(0, availableWorkMins(freeAt, targetEndMins)))
    const capacity = (avail * rate) / 60
    return { worker: w, nameKey, freeAt, exhaustAt: wallClockFinish(freeAt, avail), remainingHours: remH, capacity }
  }).filter(e => e.exhaustAt > e.freeAt + 0.1).sort((a, b) => a.freeAt - b.freeAt)

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

  const eventTimes = Array.from(new Set([
    ...entries.flatMap(e => [e.freeAt, e.exhaustAt]),
    ...BREAKS.flat(),
  ])).sort((a, b) => a - b)

  let pool = targetQty
  const workerQty      = new Map<string, number>()
  const workerFinishAt = new Map<string, number>()

  for (let i = 0; i < eventTimes.length - 1 && pool > 0.01; i++) {
    const t0 = eventTimes[i]; const t1 = eventTimes[i + 1]
    if (BREAKS.some(([bs, be]) => t0 >= bs && t1 <= be)) continue
    const active = entries.filter(e => e.freeAt <= t0 && e.exhaustAt > t0)
    if (!active.length) continue
    const totalRate = active.length * rate
    const maxCons   = totalRate * (t1 - t0) / 60
    if (maxCons >= pool) {
      const perW = pool / active.length; const finAt = t0 + (pool / totalRate) * 60
      for (const a of active) { workerQty.set(a.nameKey, (workerQty.get(a.nameKey) ?? 0) + perW); workerFinishAt.set(a.nameKey, finAt) }
      pool = 0
    } else {
      const perW = rate * (t1 - t0) / 60
      for (const a of active) { workerQty.set(a.nameKey, (workerQty.get(a.nameKey) ?? 0) + perW); workerFinishAt.set(a.nameKey, t1) }
      pool -= maxCons
    }
  }

  const result: Record<string, unknown>[] = []
  for (const e of entries) {
    const qty = workerQty.get(e.nameKey) ?? 0
    if (qty < 0.5) continue
    const finishAt = workerFinishAt.get(e.nameKey) ?? e.freeAt
    workerHours.set(e.nameKey, e.remainingHours - qty / rate)

    if (workerBusySegments && workerFreeAtMins) {
      const start = e.freeAt
      const end = finishAt
      const segs = workerBusySegments.get(e.nameKey) ?? []
      segs.push({ start, end })
      workerBusySegments.set(e.nameKey, segs)

      const currentFree = workerFreeAtMins.get(e.nameKey) ?? 510
      if (start <= currentFree + 0.01) {
        workerFreeAtMins.set(e.nameKey, end)
      }
      const phaseStartMins = 510
      const resolvedFree = getWorkerFreeAt(e.nameKey, workerFreeAtMins, workerBusySegments, phaseStartMins)
      workerFreeAtMins.set(e.nameKey, resolvedFree)
    } else {
      workerFreeAtMins.set(e.nameKey, finishAt)
    }

    result.push({
      production_date: productionDate, table_name: tableName,
      worker_code: e.worker.emp_id, worker_name: e.worker.name,
      sku, sku_name: skuName, target_quantity: Math.round(qty), unit: 'กก.',
      period, deadline_time: minsToTimeStr(e.freeAt), status: 'รอดำเนินการ', channel,
    })
  }
  return result
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { date, slot } = await req.json()
    const productionDate: string = date ?? new Date().toISOString().split('T')[0]
    const slotStr = String(slot ?? '1')
    const period  = `เสริม${slotStr}`

    // Get latest upload for this slot
    const { data: latestLog } = await supabase
      .from('upload_log')
      .select('source_file')
      .eq('table_name', `production_plan_supplementary_${slotStr}`)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latestLog)
      return NextResponse.json({ success: false, message: `ไม่พบข้อมูลแผนเสริม ${slotStr} — กรุณาอัพโหลดก่อน` }, { status: 400 })

    const { data: planData } = await supabase
      .from('production_plan_supplementary')
      .select('sku, sku_name, quantity, loading_time, deadline_time')
      .eq('source_file', latestLog.source_file)
      .eq('slot', slotStr)

    if (!planData?.length)
      return NextResponse.json({ success: false, message: 'ไม่พบรายการในแผนเสริม' }, { status: 400 })

    // deadline_time = finish before this time (e.g. "13:00")
    const deadlineStr = planData[0].deadline_time as string | null
    const loadingStr  = planData[0].loading_time  as string | null
    const phaseEndMins = deadlineStr
      ? (() => { const [h, m] = deadlineStr.split(':').map(Number); return h * 60 + m })()
      : 24 * 60

    // phaseStartMins = now (server time, Thailand = UTC+7)
    const nowUTC = new Date()
    const nowTH  = new Date(nowUTC.getTime() + 7 * 3600 * 1000)
    const phaseStartMins = nowTH.getUTCHours() * 60 + nowTH.getUTCMinutes()

    if (phaseStartMins >= phaseEndMins)
      return NextResponse.json({ success: false, message: `เลยเวลา deadline (${deadlineStr}) แล้ว` }, { status: 400 })

    // Load workforce + master data in parallel
    const [
      { data: wf0800 }, { data: wf1300 },
      { data: masterProdRaw }, { data: jobAssignRaw },
      { data: pickingUnitRaw }, { data: masterSpecialRaw },
    ] = await Promise.all([
      supabase.from('daily_workforce').select('emp_id, name, work_station, shift').eq('work_date', productionDate).eq('upload_round', '0800'),
      supabase.from('daily_workforce').select('emp_id, name, work_station, shift').eq('work_date', productionDate).eq('upload_round', '1300'),
      supabase.from('master_logic_calculation').select('row_data').eq('calculation_type', 'Mas Productivity').order('uploaded_at', { ascending: false }),
      supabase.from('master_logic_manpower').select('row_data'),
      supabase.from('picking_unit_master').select('sap, weight_per_bag'),
      supabase.from('master_logic_calculation').select('row_data').eq('calculation_type', 'Mas Special').order('uploaded_at', { ascending: false }),
    ])

    // Merge workforce (1300 overrides 0800)
    const seenNames = new Set<string>()
    let workforce: WorkforceRow[] = []
    for (const w of [...(wf1300 ?? []), ...(wf0800 ?? [])] as WorkforceRow[]) {
      const k = normName(w.name)
      if (seenNames.has(k)) continue
      seenNames.add(k); workforce.push(w)
    }
    if (workforce.length === 0) {
      workforce = await fetchWeeklyWorkforce(productionDate)
    }
    if (!workforce.length)
      return NextResponse.json({ success: false, message: 'ไม่พบกำลังคนวันนี้ — กรุณาอัพโหลดก่อน' }, { status: 400 })

    // Bag size map
    const bagSizeMap = new Map<string, number>()
    for (const r of (pickingUnitRaw ?? []) as { sap: string; weight_per_bag: number }[]) {
      const sap = String(r.sap ?? '').trim(); const wpb = Number(r.weight_per_bag ?? 0)
      if (sap && wpb > 0) { bagSizeMap.set(sap, wpb); bagSizeMap.set(sap.replace(/^0+/, ''), wpb) }
    }
    const roundUpToBag = (sku: string, qty: number) => {
      const wpb = bagSizeMap.get(sku) ?? bagSizeMap.get(sku.replace(/^0+/, ''))
      return wpb && wpb > 0 ? Math.ceil(qty / wpb) * wpb : qty
    }

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

    // Productivity map
    const productivity = masterProdRaw?.length
      ? parseProductivity(masterProdRaw.map(r => r.row_data as Record<string, unknown>))
      : []
    const skuMap = new Map<string, ProductivityRow>()
    for (const p of productivity) {
      if (!skuMap.has(p.sku)) skuMap.set(p.sku, p)
      if (!skuMap.has(p.sku.replace(/^0+/, ''))) skuMap.set(p.sku.replace(/^0+/, ''), p)
    }

    const jobAssignMap = buildJobAssignMap((jobAssignRaw ?? []) as { row_data: Record<string, unknown> }[])

    // Workers by station
    const workersByStation: Record<string, WorkforceRow[]> = {}
    for (const w of workforce) {
      const rawStation = normalizeStation(w.work_station ?? '')
      const station = STATION_TABLE[rawStation] ?? rawStation
      if (!station) continue
      workersByStation[station] ??= []; workersByStation[station].push(w)
    }

    // Worker time: all workers start at phaseStartMins, available until phaseEndMins
    const workerHours      = new Map<string, number>()
    const workerFreeAtMins = new Map<string, number>()
    const workerBusySegments = new Map<string, { start: number; end: number }[]>()
    for (const w of workforce) {
      const nameKey = normName(w.name)
      const avail   = availableWorkMins(phaseStartMins, phaseEndMins) / 60
      workerHours.set(nameKey, avail)
      workerFreeAtMins.set(nameKey, phaseStartMins)
      workerBusySegments.set(nameKey, [])
    }

    // Build assignment list — use quantity directly
    let assignList = planData
      .map(r => ({
        sku:       String(r.sku ?? '').replace(/^0+/, '') || String(r.sku ?? ''),
        skuName:   r.sku_name as string | null,
        targetQty: Number(r.quantity),
      }))
      .filter(t => t.targetQty > 0)
      .sort((a, b) => b.targetQty - a.targetQty)

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

    const assignments: Record<string, unknown>[] = []
    for (const { sku, skuName, targetQty: rawQty } of assignList) {
      const targetQty = roundUpToBag(sku, rawQty)
      const prod = skuMap.get(sku) ?? skuMap.get(String(Number(sku) || sku))
      if (!prod) continue
      const rawStation = normalizeStation(prod.station)
      const station = STATION_TABLE[rawStation] ?? rawStation
      const tableName = STATION_TABLE[station] ?? station
      const skuGroup  = prod.product_group
      const allAtStation = workersByStation[station] ?? []
      const eligible = allAtStation
        .filter(w => {
          if (jobAssignMap.size === 0) return true
          const j = jobAssignMap.get(normName(w.name))
          if (j?.isWeigher && (!skuGroup || !j.groups.has(skuGroup))) return false
          if (!j) return false
          return skuGroup ? j.groups.has(skuGroup) : true
        })
        .sort((a, b) => {
          const lvA = jobAssignMap.get(normName(a.name))?.groups.get(skuGroup) ?? 99
          const lvB = jobAssignMap.get(normName(b.name))?.groups.get(skuGroup) ?? 99
          if (lvA !== lvB) return lvA - lvB
          return (workerHours.get(normName(b.name)) ?? 0) - (workerHours.get(normName(a.name)) ?? 0)
        })
      if (!eligible.length) continue
      const capped = eligible.slice(0, maxWorkersForQty(targetQty))
      assignments.push(...assignWorkers({
        productionDate, tableName, sku: String(sku),
        skuName: prod.sku_name || skuName || null,
        targetQty, eligibleWorkers: capped, rate: prod.rate,
        workerHours, workerFreeAtMins, workerBusySegments, phaseEndMins, period, channel: 'เสริม',
        specialStartMins: specialTimeMap.get(String(sku))?.startMins ?? specialTimeMap.get(String(sku).replace(/^0+/, ''))?.startMins ?? null,
        specialStopMins: specialTimeMap.get(String(sku))?.stopMins ?? specialTimeMap.get(String(sku).replace(/^0+/, ''))?.stopMins ?? null,
      }))
    }

    assignments.forEach((a, i) => { a['seq'] = i })

    if (!assignments.length)
      return NextResponse.json({ success: false, message: 'ไม่สามารถสร้างคำสั่ง — SKU ใน Order ไม่ตรงกับ SAP ใน Mas Productivity' }, { status: 400 })

    await supabase.from('production_assignments').delete().eq('production_date', productionDate).eq('period', period)
    const { error } = await supabase.from('production_assignments').insert(assignments)
    if (error) throw error

    return NextResponse.json({
      success: true,
      message: `แผนเสริม ${slotStr} สร้างสำเร็จ ${assignments.length} รายการ${loadingStr ? ` — โหลดจ่าย ${loadingStr} น.` : ''}`,
      count: assignments.length,
    })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
