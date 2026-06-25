import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const BREAKS: [number, number][] = [
  [720, 780],
  [1020, 1080],
]

function wallClockFinish(fromMins: number, workMins: number): number {
  if (workMins <= 0) return fromMins
  let pos = fromMins
  let remaining = workMins
  for (const [bs, be] of BREAKS) {
    if (pos >= bs && pos < be) pos = be
    if (pos >= be) continue
    if (remaining <= 0) break
    const avail = bs - pos
    if (remaining <= avail) return pos + remaining
    remaining -= avail
    pos = be
  }
  return pos + remaining
}

function timeStrToMins(t: string): number {
  const parts = String(t ?? '').split(':')
  return parseInt(parts[0] ?? '0') * 60 + parseInt(parts[1] ?? '0')
}

function minsToTimeStr(mins: number): string {
  const wrapped = ((mins % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = Math.floor(wrapped % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

function normalizeSt(s: string): string {
  return s.replace(/พิเศษ$/, '').trim()
}

const PERIOD: Record<string, string> = { '1': 'เช้า', '2': 'บ่าย', '3': 'ค่ำ' }
const PHASE_START: Record<string, number> = { '1': 510, '2': 870, '3': 990 }

export interface OptimizeChange {
  id: string
  sku: string
  sku_name: string | null
  worker_name: string
  old_deadline: string
  new_deadline: string
  reason: string
  direction: 'right' | 'left'
}

export interface SawScheduleEntry {
  station: string
  production_end: string
  saw_start: string
  saw_end: string
  gap_mins: number
}

export async function POST(req: NextRequest) {
  try {
    const { date, phase, dryRun = true } = await req.json()
    const phaseStr = String(phase)
    const period = PERIOD[phaseStr]
    if (!date || !period) return NextResponse.json({ error: 'missing params' }, { status: 400 })
    const phaseStartMins = PHASE_START[phaseStr] ?? 510

    // ── 1. Saw machine master ────────────────────────────────────────────────
    const { data: sawSkuRows } = await supabase.from('mas_saw_machine_sku').select('*')
    const sawSkus = sawSkuRows ?? []

    const sawStationRate = new Map<string, number>()   // normStation → kg/hr
    const sawNormSkuSet  = new Set<string>()            // normSku keys
    for (const s of sawSkus) {
      const norm = normalizeSt(String(s.station ?? ''))
      if (!sawStationRate.has(norm) && Number(s.rate) > 0) sawStationRate.set(norm, Number(s.rate))
      const normSku = String(s.sku ?? '').replace(/^0+/, '')
      sawNormSkuSet.add(normSku)
      sawNormSkuSet.add(String(s.sku ?? ''))
    }
    if (!sawStationRate.size) return NextResponse.json({ changes: [], sawSchedule: [], message: 'ไม่มีข้อมูล mas_saw_machine_sku' })

    // ── 2. Worker production rates (Mas Productivity) ────────────────────────
    const { data: prodRows } = await supabase
      .from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas Productivity').order('uploaded_at', { ascending: false }).limit(5000)

    const workerRateMap = new Map<string, number>()
    for (const row of prodRows ?? []) {
      const r = row.row_data as Record<string, unknown>
      const rawSku  = String(r['SAP'] ?? '').trim()
      const normSku = rawSku.replace(/^0+/, '')
      const rate    = Number(r['กำลังการผลิต (กก./ชม./คน)'] ?? 0)
      if (normSku && rate > 0) {
        if (!workerRateMap.has(normSku)) workerRateMap.set(normSku, rate)
        if (!workerRateMap.has(rawSku))  workerRateMap.set(rawSku, rate)
      }
    }

    // ── 3. Production assignments ─────────────────────────────────────────────
    const stationList = Array.from(sawStationRate.keys())
    const { data: assignRows } = await supabase
      .from('production_assignments')
      .select('id, worker_name, sku, sku_name, target_quantity, deadline_time, seq, table_name')
      .eq('production_date', date)
      .eq('period', period)
      .in('table_name', stationList)

    const assignments = assignRows ?? []
    if (!assignments.length) return NextResponse.json({ changes: [], sawSchedule: [], message: 'ไม่มีข้อมูลคำสั่งผลิต' })

    // Group by station
    const byStation = new Map<string, typeof assignments>()
    for (const a of assignments) {
      const st = String(a.table_name ?? '')
      if (!byStation.has(st)) byStation.set(st, [])
      byStation.get(st)!.push(a)
    }

    // ── 4. Per-station analysis ───────────────────────────────────────────────
    interface StationDraft {
      station:            string
      sawQty:             number
      productionEnd:      number
      earliestStart:      number
      sawIds:             string[]
      gapFillIds:         string[]
    }

    const drafts: StationDraft[] = []

    for (const [station, sas] of Array.from(byStation.entries())) {
      const sawRate = sawStationRate.get(station) ?? 0

      const sawAssigns = sas.filter(a => {
        const ns = String(a.sku ?? '').replace(/^0+/, '')
        return sawNormSkuSet.has(ns) || sawNormSkuSet.has(String(a.sku ?? ''))
      })
      if (!sawAssigns.length) continue

      let productionEnd  = phaseStartMins
      let earliestStart  = Infinity
      let sawQty         = 0

      for (const a of sawAssigns) {
        const normSku   = String(a.sku ?? '').replace(/^0+/, '')
        const rate      = workerRateMap.get(normSku) ?? workerRateMap.get(String(a.sku ?? '')) ?? 0
        const qty       = Number(a.target_quantity ?? 0)
        const startMins = timeStrToMins(String(a.deadline_time ?? ''))
        const durMins   = rate > 0 ? Math.round((qty / rate) * 60) : 0
        const endMins   = wallClockFinish(startMins, durMins)

        if (endMins   > productionEnd)  productionEnd  = endMins
        if (startMins < earliestStart)  earliestStart  = startMins
        sawQty += qty
      }
      if (earliestStart === Infinity) earliestStart = phaseStartMins

      const sawIds = sawAssigns.map(a => a.id)

      // Non-saw SKUs at this station that can fill the freed gap (sorted by seq)
      const gapFillAssigns = sas
        .filter(a => !sawIds.includes(a.id))
        .sort((a, b) => (a.seq ?? 9999) - (b.seq ?? 9999))
      const gapFillIds = gapFillAssigns.map(a => a.id)

      drafts.push({ station, sawQty, productionEnd, earliestStart, sawIds, gapFillIds })
    }

    // Sort by earliest production start = order from production plan
    drafts.sort((a, b) => a.earliestStart - b.earliestStart)

    // ── 5. Build saw queue → compute gaps → collect changes ───────────────────
    const changes:     OptimizeChange[]   = []
    const sawSchedule: SawScheduleEntry[] = []
    let sawCursor = phaseStartMins

    for (const draft of drafts) {
      const sawRate  = sawStationRate.get(draft.station) ?? 0
      const sawDur   = sawRate > 0 ? Math.round((draft.sawQty / sawRate) * 60) : 0
      const sawStart = Math.max(sawCursor, draft.productionEnd)
      const sawEnd   = wallClockFinish(sawStart, sawDur)
      sawCursor      = sawEnd

      const gapMins = sawStart - draft.productionEnd

      sawSchedule.push({
        station:        draft.station,
        production_end: minsToTimeStr(draft.productionEnd).slice(0, 5),
        saw_start:      minsToTimeStr(sawStart).slice(0, 5),
        saw_end:        minsToTimeStr(sawEnd).slice(0, 5),
        gap_mins:       gapMins,
      })

      if (gapMins <= 0) continue

      // Shift saw-requiring assignments right by gapMins
      for (const id of draft.sawIds) {
        const a = assignments.find(x => x.id === id)
        if (!a) continue
        const oldMins = timeStrToMins(String(a.deadline_time ?? ''))
        changes.push({
          id,
          sku:          String(a.sku ?? ''),
          sku_name:     a.sku_name,
          worker_name:  String(a.worker_name ?? ''),
          old_deadline: String(a.deadline_time ?? '').slice(0, 5),
          new_deadline: minsToTimeStr(oldMins + gapMins).slice(0, 5),
          reason:       `เลื่อนขวา ${gapMins} นาที รอเครื่องเลื่อยว่าง`,
          direction:    'right',
        })
      }

      // Shift non-saw SKUs left to fill the freed slot
      for (const id of draft.gapFillIds) {
        const a = assignments.find(x => x.id === id)
        if (!a) continue
        const oldMins = timeStrToMins(String(a.deadline_time ?? ''))
        const newMins = draft.earliestStart
        if (newMins >= oldMins) continue
        changes.push({
          id,
          sku:          String(a.sku ?? ''),
          sku_name:     a.sku_name,
          worker_name:  String(a.worker_name ?? ''),
          old_deadline: String(a.deadline_time ?? '').slice(0, 5),
          new_deadline: minsToTimeStr(newMins).slice(0, 5),
          reason:       `ดึงขึ้นเติมช่องว่าง ${gapMins} นาที`,
          direction:    'left',
        })
      }
    }

    // ── 6. Apply to DB ────────────────────────────────────────────────────────
    if (!dryRun && changes.length > 0) {
      for (const c of changes) {
        await supabase
          .from('production_assignments')
          .update({ deadline_time: c.new_deadline + ':00' })
          .eq('id', c.id)
      }
    }

    return NextResponse.json({ changes, sawSchedule, applied: !dryRun })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
