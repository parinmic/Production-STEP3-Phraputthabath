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

const PHASE_BADGE: Record<string, string> = {
  'เช้า': 'bg-blue-50 text-blue-700 border-blue-200',
  'บ่าย': 'bg-amber-50 text-amber-700 border-amber-200',
  'ค่ำ':  'bg-indigo-50 text-indigo-700 border-indigo-200',
}

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

function durLabel(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `${h}ชม.${m > 0 ? ` ${m}น.` : ''}` : `${m}น.`
}

function todayISO(): string {
  return new Date().toLocaleDateString('sv-SE')
}

// Strip พิเศษ suffix so 'สามชั้นพิเศษ' matches withdrawal 'สามชั้น'
function normalizeStation(s: string): string {
  return s.replace(/พิเศษ$/, '').trim()
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

interface WithdrawalRawItem {
  sku: string
  sku_name: string | null
  quantity: number
  unit: string
  withdrawal_round: string | null
}

interface StationBlock {
  station: string     // display name (from mas_saw_machine_sku)
  saw_start: number   // earliest withdrawal_round → minutes
  saw_end: number     // wallClockFinish(saw_start, saw_dur)
  saw_dur: number     // totalRawQty / rate * 60
  totalQty: number    // sum of raw material quantities
  rawItems: WithdrawalRawItem[]
}

interface PhaseBlock {
  phase: string
  axisStart: number
  axisEnd: number
  stations: StationBlock[]
}

// ── Computation ───────────────────────────────────────────────────────────────
// Timing and quantities are both derived from raw material withdrawal data.
// rate (kg/hr) comes from mas_saw_machine_sku for the station.
function computeRawMatBlocks(
  sawSkus: SawMachineSku[],
  rawMatByPeriodStation: Map<string, Map<string, WithdrawalRawItem[]>>,
): PhaseBlock[] {
  if (!sawSkus.length) return []

  // Build: normalizedStation → { rate, displayName }
  const stationInfo = new Map<string, { rate: number; displayName: string }>()
  for (const s of sawSkus) {
    const norm = normalizeStation(s.station)
    const cur = stationInfo.get(norm)
    if (!cur) {
      stationInfo.set(norm, { rate: s.rate, displayName: s.station })
    } else if (s.rate > 0 && cur.rate <= 0) {
      cur.rate = s.rate
    }
  }

  const result: PhaseBlock[] = []

  for (const period of ['เช้า', 'บ่าย', 'ค่ำ']) {
    const stationMap = rawMatByPeriodStation.get(period)
    if (!stationMap?.size) continue

    const stations: StationBlock[] = []

    for (const [normSt, items] of stationMap) {
      if (!items.length) continue
      const totalQty = items.reduce((s, i) => s + i.quantity, 0)
      if (totalQty <= 0) continue

      const info = stationInfo.get(normSt)
      const rate = info?.rate ?? 0
      const displayName = info?.displayName ?? normSt
      // Duration computed from raw material quantity ÷ saw machine rate
      const saw_dur = rate > 0 ? Math.round((totalQty / rate) * 60) : 0

      // Saw starts at the earliest withdrawal_round for this station/period
      const roundMins = items
        .map(i => i.withdrawal_round)
        .filter(Boolean)
        .map(r => { const [h, m] = r!.split(':').map(Number); return h * 60 + m })
      const saw_start = roundMins.length > 0 ? Math.min(...roundMins) : getPhaseStart(period)
      const saw_end = wallClockFinish(saw_start, saw_dur)

      stations.push({ station: displayName, saw_start, saw_end, saw_dur, totalQty, rawItems: items })
    }

    if (!stations.length) continue
    stations.sort((a, b) => a.saw_start - b.saw_start)

    const minStart = stations.reduce((m, s) => Math.min(m, s.saw_start), Infinity)
    const maxEnd   = stations.reduce((m, s) => Math.max(m, s.saw_end),   0)
    const axisStart = Math.floor(minStart / 60) * 60
    const axisEnd   = Math.ceil(maxEnd   / 60) * 60

    result.push({ phase: period, axisStart, axisEnd, stations })
  }

  return result
}

// ── Phase Section ─────────────────────────────────────────────────────────────
const LABEL_W = 112  // px — station label column width

function PhaseSection({ block }: { block: PhaseBlock }) {
  const range = block.axisEnd - block.axisStart || 1
  const pct = (m: number) => ((m - block.axisStart) / range) * 100

  const ticks: number[] = []
  for (let m = block.axisStart; m <= block.axisEnd; m += 60) ticks.push(m)

  const [nowMins, setNowMins] = useState(() => {
    const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
  })
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date(); setNowMins(d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60)
    }, 5000)
    return () => clearInterval(id)
  }, [])
  const showNow = nowMins >= block.axisStart && nowMins <= block.axisEnd

  return (
    <div className="mb-8 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Phase header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${PHASE_BADGE[block.phase] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
          {block.phase}
        </span>
        <span className="text-sm text-gray-500">
          {block.stations.length} สถานี · {minsToHHMM(block.axisStart)} – {minsToHHMM(block.axisEnd)}
        </span>
      </div>

      {/* Shared multi-row Gantt */}
      <div className="px-4 pt-3 pb-2">
        {/* Time axis */}
        <div className="flex">
          <div style={{ width: LABEL_W }} className="shrink-0" />
          <div className="flex-1 relative h-6">
            {ticks.map(t => (
              <div key={t} className="absolute top-0 flex flex-col items-center"
                style={{ left: `${pct(t)}%` }}>
                <span className="text-[10px] font-mono text-gray-400 -translate-x-1/2 select-none leading-tight">
                  {Math.floor(t / 60) % 24}:00
                </span>
                <div className="w-px h-2 bg-gray-200 mt-0.5" />
              </div>
            ))}
            {showNow && (
              <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10 pointer-events-none"
                style={{ left: `${pct(nowMins)}%` }} />
            )}
          </div>
        </div>

        {/* Station rows */}
        <div className="flex flex-col gap-1 mt-1">
          {block.stations.map(station => {
            const color = STATION_COLORS[station.station] ?? '#6b7280'
            return (
              <div key={station.station} className="flex items-center" style={{ height: 32 }}>
                <div style={{ width: LABEL_W }} className="shrink-0 pr-3 flex items-center">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-xs font-medium text-gray-700 truncate">{station.station}</span>
                  </div>
                </div>
                <div className="flex-1 relative h-full">
                  {ticks.map(t => (
                    <div key={t} className="absolute top-0 bottom-0 w-px bg-gray-100 pointer-events-none"
                      style={{ left: `${pct(t)}%` }} />
                  ))}
                  {showNow && (
                    <div className="absolute top-0 bottom-0 w-px bg-red-400 z-20 pointer-events-none"
                      style={{ left: `${pct(nowMins)}%` }} />
                  )}
                  <div
                    className="absolute top-2 rounded flex items-center px-2 overflow-hidden"
                    style={{
                      left:   `${pct(station.saw_start)}%`,
                      width:  `${Math.max(pct(station.saw_end) - pct(station.saw_start), 0.4)}%`,
                      height: 22,
                      backgroundColor: color,
                      opacity: 0.9,
                    }}
                    title={`${station.station}\n${minsToHHMM(station.saw_start)} → ${minsToHHMM(station.saw_end)}\n${station.totalQty.toLocaleString()} กก.`}
                  >
                    <span className="text-[10px] font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis leading-none">
                      {minsToHHMM(station.saw_start)} → {minsToHHMM(station.saw_end)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Raw material detail list per station */}
      <div className="border-t border-gray-100">
        {block.stations.map(station => {
          const color = STATION_COLORS[station.station] ?? '#6b7280'
          // Group items by withdrawal_round
          const byRound = new Map<string, WithdrawalRawItem[]>()
          for (const item of station.rawItems) {
            const r = item.withdrawal_round ?? '—'
            if (!byRound.has(r)) byRound.set(r, [])
            byRound.get(r)!.push(item)
          }
          return (
            <div key={station.station}>
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-xs font-semibold text-gray-700">{station.station}</span>
                <span className="text-[11px] text-gray-400 ml-1">
                  {minsToHHMM(station.saw_start)} → {minsToHHMM(station.saw_end)} · ใช้เครื่อง {durLabel(station.saw_dur)} · Raw Mat {station.totalQty.toLocaleString()} กก.
                </span>
              </div>
              {station.rawItems.length === 0 ? (
                <div className="px-4 py-3 text-[11px] text-gray-400">ไม่มีข้อมูลการเบิก Raw Mat</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {Array.from(byRound.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([round, items]) => (
                    <div key={round}>
                      {byRound.size > 1 && (
                        <div className="px-4 py-1.5 bg-gray-50/60 flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-gray-500">รอบ {round} น.</span>
                          <span className="text-[10px] text-gray-400">
                            · {items.reduce((s, i) => s + i.quantity, 0).toLocaleString()} กก.
                          </span>
                        </div>
                      )}
                      {items.map((item, i) => (
                        <div key={`${item.sku}-${i}`} className="flex items-center gap-3 px-4 py-2">
                          <span className="text-[10px] text-gray-400 w-4 shrink-0 text-right">{i + 1}.</span>
                          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium text-gray-800 truncate block">
                              {item.sku_name ?? item.sku}
                            </span>
                            <span className="text-[10px] font-mono text-gray-400">{item.sku}</span>
                          </div>
                          <span className="text-[11px] font-semibold text-gray-700 shrink-0 w-24 text-right">
                            {item.quantity.toLocaleString()} {item.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
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
  const [rawMatByPeriodStation, setRawMatByPeriodStation] = useState<Map<string, Map<string, WithdrawalRawItem[]>>>(new Map())

  const load = useCallback(async (d: string) => {
    setLoading(true)
    try {
      const opts = (phase: number) => ({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: d, phase }),
      })
      const [sawRes, w1, w2, w3] = await Promise.all([
        supabase.from('mas_saw_machine_sku').select('*'),
        fetch('/api/withdrawal/calculate', opts(1)).then(r => r.json()),
        fetch('/api/withdrawal/calculate', opts(2)).then(r => r.json()),
        fetch('/api/withdrawal/calculate', opts(3)).then(r => r.json()),
      ])
      const skus: SawMachineSku[] = sawRes.data ?? []
      setSawSkus(skus)

      const sawSkuCodes = new Set(skus.map(s => s.sku.replace(/^0+/, '')))

      type WItem = {
        sku: string; sku_name: string | null; quantity: number; unit: string
        work_station: string | null; withdrawal_round?: string
        for_products?: { sku: string }[]
      }
      const rawMap = new Map<string, Map<string, WithdrawalRawItem[]>>()
      for (const [period, res] of [['เช้า', w1], ['บ่าย', w2], ['ค่ำ', w3]] as [string, { items?: WItem[] }][]) {
        const stMap = new Map<string, WithdrawalRawItem[]>()
        for (const item of res.items ?? []) {
          if (!item.work_station) continue
          const fps = item.for_products
          if (!fps?.length) continue
          const isForSawSku = fps.some(p =>
            sawSkuCodes.has(p.sku) || sawSkuCodes.has(p.sku.replace(/^0+/, ''))
          )
          if (!isForSawSku) continue
          const st = normalizeStation(item.work_station)
          if (!stMap.has(st)) stMap.set(st, [])
          stMap.get(st)!.push({
            sku: item.sku, sku_name: item.sku_name,
            quantity: item.quantity, unit: item.unit,
            withdrawal_round: item.withdrawal_round ?? null,
          })
        }
        rawMap.set(period, stMap)
      }
      setRawMatByPeriodStation(rawMap)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(date) }, [date, load])

  const phases = useMemo(
    () => computeRawMatBlocks(sawSkus, rawMatByPeriodStation),
    [sawSkus, rawMatByPeriodStation],
  )

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Scissors size={22} className="text-gray-600 shrink-0" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">แผนการใช้เครื่องเลื่อย</h1>
            <p className="text-sm text-gray-500 mt-0.5">เวลาคำนวณจากปริมาณ Raw Mat · แบ่งตาม Phase</p>
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

      {!loading && phases.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 flex flex-col items-center gap-3 text-gray-400">
          <Scissors size={40} strokeWidth={1.5} />
          <p className="text-sm">ไม่มีข้อมูลการผลิตสำหรับวันที่นี้</p>
        </div>
      )}

      {!loading && phases.map(phase => (
        <PhaseSection key={phase.phase} block={phase} />
      ))}
    </div>
  )
}
