'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Scissors, Calendar, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ── Constants ─────────────────────────────────────────────────────────────────
const BREAKS: [number, number][] = [
  [720, 780],
  [1020, 1080],
]

const STATION_COLORS: Record<string, string> = {
  'เผาขา':       '#f97316',
  'เลาะขา':      '#14b8a6',
  'สามชั้นพิเศษ': '#8b5cf6',
}

const STATION_ORDER = ['เผาขา', 'เลาะขา', 'สามชั้นพิเศษ']

const PHASE_END: Record<string, number> = {
  'เช้า': 870,   // 14:30
  'บ่าย': 990,   // 16:30
  'ค่ำ':  1800,  // 06:00 next day (+1440)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getPhaseStart(period: string) {
  if (period === 'เช้า') return 8 * 60 + 30
  if (period === 'บ่าย') return 14 * 60
  if (period === 'ค่ำ') return 16 * 60
  return 8 * 60
}

function workMinutesBetween(from: number, to: number): number {
  if (from >= to) return 0
  let work = 0
  let pos = from
  for (const [bs, be] of BREAKS) {
    if (pos >= to) break
    if (pos >= be) continue
    if (pos < bs) {
      const stop = Math.min(bs, to)
      work += stop - pos
      pos = stop
    }
    if (pos >= bs && pos < be) pos = Math.min(be, to)
  }
  if (pos < to) work += to - pos
  return work
}

function wallClockFinish(from: number, work: number): number {
  if (work <= 0) return from
  let pos = from
  let rem = work
  for (const [bs, be] of BREAKS) {
    if (pos >= bs && pos < be) pos = be
    if (pos >= be) continue
    if (rem <= 0) break
    const avail = bs - pos
    if (rem <= avail) return pos + rem
    rem -= avail
    pos = be
  }
  return pos + rem
}

function minsToHHMM(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function todayISO(): string {
  return new Date().toLocaleDateString('sv-SE')
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface SawMachineSku {
  sku: string
  sku_name: string | null
  station: string
  product_group: string
  rate: number
  timing: string | null
}

interface RawAssignment {
  worker_name: string
  sku: string
  sku_name: string | null
  target_quantity: number
  period: string
  deadline_time: string | null
  note: string | null
  seq: number | null
}

interface IndividualSkuBlock {
  sku: string
  sku_name: string | null
  totalQty: number
  saw_start: number
  saw_end: number
  saw_dur: number
  timing: string
}

interface StationBlock {
  station: string
  saw_start: number
  saw_end: number
  saw_dur: number
  totalQty: number
  skus: IndividualSkuBlock[]
}

// ── Computation ───────────────────────────────────────────────────────────────
function computeBlocks(
  sawSkus: SawMachineSku[],
  assignments: RawAssignment[],
  rateMap: Record<string, number>,
): StationBlock[] {
  if (!sawSkus.length || !assignments.length) return []

  const sawSkuMap = new Map(sawSkus.map(s => [s.sku.replace(/^0+/, ''), s]))
  const periodOrder: Record<string, number> = { 'เช้า': 1, 'บ่าย': 2, 'ค่ำ': 3 }

  // Build per-worker timelines to get production minStart / maxEnd per SKU
  const byWorker: Record<string, RawAssignment[]> = {}
  for (const a of assignments) {
    byWorker[a.worker_name] ??= []
    byWorker[a.worker_name].push(a)
  }

  const skuStats = new Map<string, { minStart: number; maxEnd: number; totalQty: number }>()

  for (const tasks of Object.values(byWorker)) {
    const sorted = [...tasks].sort((a, b) => {
      const pA = periodOrder[a.period] ?? 99, pB = periodOrder[b.period] ?? 99
      if (pA !== pB) return pA - pB
      const tA = a.deadline_time ?? '', tB = b.deadline_time ?? ''
      if (tA !== tB) return tA.localeCompare(tB)
      return (a.seq ?? 999999) - (b.seq ?? 999999)
    })

    let cur = 0, lastPeriod = ''
    for (const task of sorted) {
      if (task.period !== lastPeriod) {
        cur = Math.max(cur, getPhaseStart(task.period))
        lastPeriod = task.period
      }
      const rate = rateMap[task.sku] ?? rateMap[task.sku.replace(/^0+/, '')]
      const isConcurrent = String(task.note ?? '').includes('concurrent')
      let startMin = cur
      if (task.deadline_time) {
        const [dh, dm] = task.deadline_time.split(':').map(Number)
        if (!isNaN(dh) && !isNaN(dm)) {
          const raw = dh * 60 + dm
          const dl = (task.period === 'ค่ำ' && raw < 16 * 60) ? raw + 1440 : raw
          startMin = isConcurrent ? dl : Math.max(startMin, dl)
        }
      }
      const shiftEnd = PHASE_END[task.period] ?? 1200
      const targetQty = Number(task.target_quantity)
      const effectiveQty = rate && rate > 0
        ? Math.min(targetQty, (workMinutesBetween(startMin, shiftEnd) / 60) * rate)
        : targetQty
      const effectiveDur = rate && rate > 0 ? Math.round((effectiveQty / rate) * 60) : 0
      const endMin = wallClockFinish(startMin, effectiveDur)
      cur = Math.max(cur, endMin)

      const existing = skuStats.get(task.sku)
      if (!existing) {
        skuStats.set(task.sku, { minStart: startMin, maxEnd: endMin, totalQty: effectiveQty })
      } else {
        existing.minStart = Math.min(existing.minStart, startMin)
        existing.maxEnd = Math.max(existing.maxEnd, endMin)
        existing.totalQty += effectiveQty
      }
    }
  }

  // Collect per-SKU saw entries with their raw anchor time
  interface SkuEntry {
    sku: string
    sku_name: string | null
    station: string
    timing: string
    totalQty: number
    rawSawStart: number  // prod minStart (ก่อน) or prod maxEnd (หลัง)
    saw_dur: number
  }

  const entries: SkuEntry[] = []
  for (const [sku, sawInfo] of sawSkuMap) {
    const stats = skuStats.get(sku)
    if (!stats || stats.totalQty <= 0) continue
    const timing = sawInfo.timing ?? 'หลัง'
    const saw_dur = sawInfo.rate > 0 ? Math.round((stats.totalQty / sawInfo.rate) * 60) : 0
    entries.push({
      sku,
      sku_name: sawInfo.sku_name,
      station: sawInfo.station,
      timing,
      totalQty: stats.totalQty,
      rawSawStart: timing === 'ก่อน' ? stats.minStart : stats.maxEnd,
      saw_dur,
    })
  }

  // Group entries by station
  const byStation = new Map<string, SkuEntry[]>()
  for (const e of entries) {
    if (!byStation.has(e.station)) byStation.set(e.station, [])
    byStation.get(e.station)!.push(e)
  }

  // Build StationBlock: group start = earliest rawSawStart, SKUs run sequentially
  const result: StationBlock[] = []
  for (const [station, stationEntries] of byStation) {
    stationEntries.sort((a, b) => a.rawSawStart - b.rawSawStart)

    const groupStart = stationEntries[0].rawSawStart
    let cur = groupStart
    const skus: IndividualSkuBlock[] = stationEntries.map(e => {
      const saw_start = cur
      const saw_end = wallClockFinish(cur, e.saw_dur)
      cur = saw_end
      return {
        sku: e.sku,
        sku_name: e.sku_name,
        totalQty: e.totalQty,
        saw_start,
        saw_end,
        saw_dur: e.saw_dur,
        timing: e.timing,
      }
    })

    result.push({
      station,
      saw_start: groupStart,
      saw_end: cur,
      saw_dur: stationEntries.reduce((s, e) => s + e.saw_dur, 0),
      totalQty: stationEntries.reduce((s, e) => s + e.totalQty, 0),
      skus,
    })
  }

  return result
}

// ── Station Card ──────────────────────────────────────────────────────────────
function StationCard({ block }: { block: StationBlock }) {
  const color = STATION_COLORS[block.station] ?? '#6b7280'

  const chartStart = Math.floor(block.saw_start / 60) * 60
  const chartEnd   = Math.ceil(block.saw_end / 60) * 60
  const totalRange = chartEnd - chartStart || 1
  const pct = (m: number) => ((m - chartStart) / totalRange) * 100

  const ticks: number[] = []
  for (let m = chartStart; m <= chartEnd; m += 60) ticks.push(m)

  const durH = Math.floor(block.saw_dur / 60)
  const durM = block.saw_dur % 60
  const durLabel = durH > 0 ? `${durH}ชม.${durM > 0 ? ` ${durM}น.` : ''}` : `${durM}น.`

  return (
    <div className="mb-6 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Station header */}
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100"
        style={{ borderTopWidth: 4, borderTopColor: color, borderTopStyle: 'solid' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <h2 className="text-base font-bold text-gray-900">{block.station}</h2>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-500 flex-wrap">
          <span className="font-medium text-gray-700">
            {minsToHHMM(block.saw_start)} → {minsToHHMM(block.saw_end)}
          </span>
          <span>{block.skus.length} SKU</span>
          <span>{block.totalQty.toLocaleString()} กก.</span>
          <span>{durLabel}</span>
        </div>
      </div>

      {/* Gantt — single combined bar */}
      <div className="px-4 pt-3 pb-2">
        {/* Time axis */}
        <div className="flex h-6 relative mb-1">
          <div className="flex-1 relative">
            {ticks.map(t => (
              <div key={t} className="absolute top-0 flex flex-col items-center"
                style={{ left: `${pct(t)}%` }}>
                <span className="text-[10px] font-mono text-gray-400 -translate-x-1/2 select-none leading-tight">
                  {Math.floor(t / 60) % 24}:00
                </span>
                <div className="w-px h-2 bg-gray-200 mt-0.5" />
              </div>
            ))}
          </div>
        </div>

        {/* Single bar */}
        <div className="relative w-full" style={{ height: 34 }}>
          {ticks.map(t => (
            <div key={t} className="absolute top-0 bottom-0 w-px bg-gray-100 pointer-events-none"
              style={{ left: `${pct(t)}%` }} />
          ))}
          <div
            className="absolute top-1 rounded flex items-center px-2 overflow-hidden"
            style={{
              left:   `${pct(block.saw_start)}%`,
              width:  `${Math.max(pct(block.saw_end) - pct(block.saw_start), 0.5)}%`,
              height: 26,
              backgroundColor: color,
              opacity: 0.9,
            }}
            title={`${block.station}\n${minsToHHMM(block.saw_start)} → ${minsToHHMM(block.saw_end)}\n${block.totalQty.toLocaleString()} กก.`}
          >
            <span className="text-[11px] font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis leading-none">
              {minsToHHMM(block.saw_start)} → {minsToHHMM(block.saw_end)}
            </span>
          </div>
        </div>
      </div>

      {/* SKU list with sequential saw times */}
      <div className="border-t border-gray-100 divide-y divide-gray-50">
        {block.skus.map((sku, i) => {
          const skuDurH = Math.floor(sku.saw_dur / 60)
          const skuDurM = sku.saw_dur % 60
          const skuDurLabel = skuDurH > 0 ? `${skuDurH}ชม.${skuDurM > 0 ? ` ${skuDurM}น.` : ''}` : `${skuDurM}น.`
          return (
            <div key={sku.sku} className="flex items-center gap-3 px-4 py-2">
              <span className="text-[10px] text-gray-400 w-4 shrink-0 text-right">{i + 1}.</span>
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="text-xs font-medium text-gray-800 flex-1 min-w-0 truncate">
                {sku.sku_name ?? sku.sku}
              </span>
              <span className="text-[11px] font-mono text-gray-600 shrink-0">
                {minsToHHMM(sku.saw_start)} → {minsToHHMM(sku.saw_end)}
              </span>
              <span className="text-[11px] text-gray-400 shrink-0 w-20 text-right">
                {sku.totalQty.toLocaleString()} กก.
              </span>
              <span className="text-[11px] text-gray-400 shrink-0 w-14 text-right">
                {skuDurLabel}
              </span>
              <span className="text-[10px] shrink-0 w-16 text-right" style={{ color }}>
                {sku.timing === 'ก่อน' ? '▶ ก่อน' : '◀ หลัง'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SawMachinePlanPage() {
  const [date, setDate] = useState(todayISO())
  const [loading, setLoading] = useState(false)
  const [sawSkus, setSawSkus] = useState<SawMachineSku[]>([])
  const [assignments, setAssignments] = useState<RawAssignment[]>([])
  const [rateMap, setRateMap] = useState<Record<string, number>>({})

  const load = useCallback(async (d: string) => {
    setLoading(true)
    try {
      const [sawRes, prodRes, rateRes] = await Promise.all([
        supabase.from('mas_saw_machine_sku').select('*'),
        fetch(`/api/production?date=${d}`).then(r => r.json()),
        fetch('/api/master/productivity').then(r => r.json()),
      ])
      setSawSkus(sawRes.data ?? [])
      const raw: RawAssignment[] = (prodRes.assignments ?? []).map((a: RawAssignment) => ({
        ...a,
        sku: a.sku.replace(/^0+/, ''),
      }))
      setAssignments(raw)
      setRateMap(rateRes.rateMap ?? {})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(date) }, [date, load])

  const blocks = useMemo(
    () => computeBlocks(sawSkus, assignments, rateMap),
    [sawSkus, assignments, rateMap],
  )

  // Sort by STATION_ORDER, append any extra stations at the end
  const orderedBlocks = useMemo(() => {
    const inOrder = STATION_ORDER.map(s => blocks.find(b => b.station === s)).filter(Boolean) as StationBlock[]
    const extra   = blocks.filter(b => !STATION_ORDER.includes(b.station))
    return [...inOrder, ...extra]
  }, [blocks])

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Scissors size={22} className="text-gray-600 shrink-0" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">แผนการใช้เครื่องเลื่อย</h1>
            <p className="text-sm text-gray-500 mt-0.5">เวลาที่ต้องเริ่มและสิ้นสุดการตัดแต่ละ SKU</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2 bg-white shadow-sm">
            <Calendar size={13} className="text-gray-400 shrink-0" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="text-sm font-medium text-gray-700 bg-transparent outline-none"
            />
          </div>
          <button
            onClick={() => load(date)}
            disabled={loading}
            className="p-2 rounded-xl border border-gray-200 bg-white shadow-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={`text-gray-400 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-sm">กำลังโหลด...</span>
        </div>
      )}

      {!loading && orderedBlocks.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 flex flex-col items-center gap-3 text-gray-400">
          <Scissors size={40} strokeWidth={1.5} />
          <p className="text-sm">ไม่มีข้อมูลการผลิตสำหรับวันที่นี้</p>
        </div>
      )}

      {!loading && orderedBlocks.map(block => (
        <StationCard key={block.station} block={block} />
      ))}
    </div>
  )
}
