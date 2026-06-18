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

// ── Helpers ───────────────────────────────────────────────────────────────────
function getPhaseStart(period: string) {
  if (period === 'เช้า') return 8 * 60 + 30
  if (period === 'บ่าย') return 14 * 60
  if (period === 'ค่ำ') return 16 * 60
  return 8 * 60
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

interface SkuBlock {
  sku: string
  sku_name: string | null
  station: string
  timing: string
  saw_rate: number
  prod_minStart: number
  prod_maxEnd: number
  totalQty: number
  saw_start: number
  saw_end: number
  saw_dur: number
}

// ── Computation ───────────────────────────────────────────────────────────────
function computeBlocks(
  sawSkus: SawMachineSku[],
  assignments: RawAssignment[],
  rateMap: Record<string, number>,
): SkuBlock[] {
  if (!sawSkus.length || !assignments.length) return []

  const sawSkuMap = new Map(sawSkus.map(s => [s.sku.replace(/^0+/, ''), s]))
  const periodOrder: Record<string, number> = { 'เช้า': 1, 'บ่าย': 2, 'ค่ำ': 3 }

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
      const durMins = rate && rate > 0 ? Math.round((Number(task.target_quantity) / rate) * 60) : 0
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
      const endMin = wallClockFinish(startMin, durMins)
      cur = Math.max(cur, endMin)

      const existing = skuStats.get(task.sku)
      if (!existing) {
        skuStats.set(task.sku, { minStart: startMin, maxEnd: endMin, totalQty: Number(task.target_quantity) })
      } else {
        existing.minStart = Math.min(existing.minStart, startMin)
        existing.maxEnd = Math.max(existing.maxEnd, endMin)
        existing.totalQty += Number(task.target_quantity)
      }
    }
  }

  const result: SkuBlock[] = []
  for (const [sku, sawInfo] of sawSkuMap) {
    const stats = skuStats.get(sku)
    if (!stats) continue
    const timing = sawInfo.timing ?? 'หลัง'
    const saw_start = timing === 'ก่อน' ? stats.minStart : stats.maxEnd
    const saw_dur = Math.round((stats.totalQty / sawInfo.rate) * 60)
    const saw_end = wallClockFinish(saw_start, saw_dur)
    result.push({
      sku,
      sku_name: sawInfo.sku_name,
      station: sawInfo.station,
      timing,
      saw_rate: sawInfo.rate,
      prod_minStart: stats.minStart,
      prod_maxEnd: stats.maxEnd,
      totalQty: stats.totalQty,
      saw_start,
      saw_end,
      saw_dur,
    })
  }

  return result.sort((a, b) => a.saw_start - b.saw_start)
}

// ── Station Gantt ─────────────────────────────────────────────────────────────
function StationGantt({
  station, blocks, chartStart, chartEnd,
}: {
  station: string
  blocks: SkuBlock[]
  chartStart: number
  chartEnd: number
}) {
  const color = STATION_COLORS[station] ?? '#6b7280'
  const totalRange = chartEnd - chartStart
  const pct = (m: number) => ((m - chartStart) / totalRange) * 100

  const ticks: number[] = []
  for (let m = chartStart; m <= chartEnd; m += 60) ticks.push(m)

  const sorted = [...blocks].sort((a, b) => a.saw_start - b.saw_start)

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        <h2 className="text-sm font-bold text-gray-800">{station}</h2>
        <span className="text-xs text-gray-400">{blocks.length} SKU</span>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        {/* Time axis */}
        <div className="flex border-b border-gray-100 bg-gray-50/50 h-8">
          <div className="w-36 sm:w-44 shrink-0 border-r border-gray-100" />
          <div className="flex-1 relative">
            {ticks.map(t => (
              <div key={t} className="absolute top-0 h-full flex items-end pb-1.5"
                style={{ left: `${pct(t)}%` }}>
                <span className="text-[10px] font-mono text-gray-400 -translate-x-1/2 select-none">
                  {Math.floor(t / 60) % 24}
                </span>
              </div>
            ))}
          </div>
          <div className="w-24 sm:w-32 shrink-0 border-l border-gray-100" />
        </div>

        {/* SKU rows */}
        <div className="divide-y divide-gray-50">
          {sorted.map(block => {
            const durH = Math.floor(block.saw_dur / 60)
            const durM = block.saw_dur % 60
            const durLabel = durH > 0 ? `${durH}ชม. ${durM}น.` : `${durM}น.`
            const barWidth = Math.max(pct(block.saw_end) - pct(block.saw_start), 0.5)

            return (
              <div key={block.sku} className="flex items-center min-h-[52px]">
                {/* SKU label */}
                <div className="w-36 sm:w-44 shrink-0 px-3 py-2 border-r border-gray-100">
                  <p className="text-[11px] sm:text-xs font-semibold text-gray-800 leading-tight line-clamp-2">
                    {block.sku_name ?? block.sku}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {block.timing === 'ก่อน' ? '▶ เริ่มพร้อมผลิต' : '◀ หลังผลิตเสร็จ'}
                  </p>
                </div>

                {/* Bar */}
                <div className="flex-1 relative h-14">
                  {/* Production window guide (ghost) */}
                  <div
                    className="absolute top-3 bottom-3 rounded opacity-10 pointer-events-none"
                    style={{
                      left: `${pct(block.prod_minStart)}%`,
                      width: `${Math.max(pct(block.prod_maxEnd) - pct(block.prod_minStart), 0.3)}%`,
                      backgroundColor: color,
                    }}
                  />
                  {/* Saw machine bar */}
                  <div
                    className="absolute top-2 bottom-2 rounded-lg flex items-center px-2 overflow-hidden"
                    style={{
                      left: `${pct(block.saw_start)}%`,
                      width: `${barWidth}%`,
                      backgroundColor: color,
                    }}
                  >
                    <span className="text-[10px] font-mono font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis">
                      {minsToHHMM(block.saw_start)} → {minsToHHMM(block.saw_end)}
                    </span>
                  </div>
                </div>

                {/* Quantity + duration */}
                <div className="w-24 sm:w-32 shrink-0 px-3 py-2 border-l border-gray-100 text-right">
                  <p className="text-sm font-bold text-gray-800">{block.totalQty.toLocaleString()}</p>
                  <p className="text-[10px] text-gray-400">กก. · {durLabel}</p>
                </div>
              </div>
            )
          })}
        </div>
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

  const byStation = useMemo(() => {
    const map: Record<string, SkuBlock[]> = {}
    for (const b of blocks) {
      map[b.station] ??= []
      map[b.station].push(b)
    }
    return map
  }, [blocks])

  const stations = STATION_ORDER.filter(s => byStation[s]?.length)

  const { chartStart, chartEnd } = useMemo(() => {
    if (!blocks.length) return { chartStart: 8 * 60, chartEnd: 17 * 60 }
    const cs = Math.floor(Math.min(...blocks.map(b => b.saw_start)) / 60) * 60
    const ce = Math.ceil(Math.max(...blocks.map(b => b.saw_end)) / 60) * 60
    return { chartStart: cs, chartEnd: ce }
  }, [blocks])

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Scissors size={22} className="text-gray-600 shrink-0" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">แผนการใช้เครื่องเลื่อย</h1>
            <p className="text-sm text-gray-500 mt-0.5">เวลาเริ่ม–จบ และปริมาณที่ต้องตัดสำหรับแต่ละ SKU</p>
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

      {/* Legend */}
      {!loading && blocks.length > 0 && (
        <div className="flex items-center gap-4 mb-4 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded opacity-15 bg-gray-400 inline-block" />
            พื้นที่ผลิตสินค้า (อ้างอิง)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-gray-400 inline-block" />
            เวลาใช้เครื่องเลื่อย
          </span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-sm">กำลังโหลด...</span>
        </div>
      )}

      {/* Empty */}
      {!loading && blocks.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 flex flex-col items-center gap-3 text-gray-400">
          <Scissors size={40} strokeWidth={1.5} />
          <p className="text-sm">ไม่มีข้อมูลการผลิตสำหรับวันที่นี้</p>
        </div>
      )}

      {/* Gantt per station */}
      {!loading && stations.map(station => (
        <StationGantt
          key={station}
          station={station}
          blocks={byStation[station]}
          chartStart={chartStart}
          chartEnd={chartEnd}
        />
      ))}
    </div>
  )
}
