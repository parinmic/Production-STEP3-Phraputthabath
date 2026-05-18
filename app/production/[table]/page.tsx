'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, PlayCircle, AlertCircle, Zap, LayoutList, BarChart2, Clock, Download, ClipboardList, Calendar } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'

const CFG: Record<string, { label: string; accent: string; light: string }> = {
  'sam-chan': { label: 'สามชั้น', accent: 'border-blue-500',   light: 'bg-blue-50'   },
  'sa-phok':  { label: 'สะโพก',  accent: 'border-orange-500', light: 'bg-orange-50' },
  'lai':      { label: 'ไหล่',   accent: 'border-green-500',  light: 'bg-green-50'  },
}

const PHASES = [
  { phase: 1, label: 'Phase 1', sub: '8:30-14:00',       period: 'เช้า', startH: 8.5,  endH: 14,
    active: 'bg-sky-500 text-white',    inactive: 'text-sky-700 border border-sky-300 hover:bg-sky-50' },
  { phase: 2, label: 'Phase 2', sub: '14:00-16:00',      period: 'บ่าย', startH: 14, endH: 16,
    active: 'bg-purple-500 text-white', inactive: 'text-purple-700 border border-purple-300 hover:bg-purple-50' },
  { phase: 3, label: 'Phase 3', sub: '16:00 เป็นต้นไป', period: 'ค่ำ',  startH: 16, endH: 24,
    active: 'bg-orange-500 text-white', inactive: 'text-orange-700 border border-orange-300 hover:bg-orange-50' },
]

const BAR_COLORS = [
  { bg: '#60a5fa', fg: '#1e3a5f' },
  { bg: '#34d399', fg: '#064e3b' },
  { bg: '#fb923c', fg: '#7c2d12' },
  { bg: '#a78bfa', fg: '#2e1065' },
  { bg: '#f472b6', fg: '#831843' },
  { bg: '#22d3ee', fg: '#164e63' },
  { bg: '#facc15', fg: '#713f12' },
  { bg: '#f87171', fg: '#7f1d1d' },
  { bg: '#4ade80', fg: '#14532d' },
  { bg: '#818cf8', fg: '#1e1b4b' },
  { bg: '#e879f9', fg: '#4a044e' },
  { bg: '#2dd4bf', fg: '#134e4a' },
]


interface Assignment {
  id: string
  worker_code: string
  worker_name: string
  sku: string
  sku_name: string | null
  target_quantity: number
  unit: string | null
  period: string
  deadline_time: string | null
  status: string
  seq: number | null
}

function shortName(full: string) {
  return full.trim().split(/\s+/)[0] ?? full
}

function mergeTasks(tasks: Assignment[]): Assignment[] {
  const map = new Map<string, Assignment>()
  for (const t of tasks) {
    const key = `${t.sku}_${t.period}`
    const existing = map.get(key)
    if (existing) {
      existing.target_quantity = Number(existing.target_quantity) + Number(t.target_quantity)
    } else {
      map.set(key, { ...t })
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const periodOrder: Record<string, number> = { 'เช้า': 1, 'บ่าย': 2, 'ค่ำ': 3 }
    const pA = periodOrder[a.period] ?? 99
    const pB = periodOrder[b.period] ?? 99
    if (pA !== pB) return pA - pB
    return Number(b.target_quantity) - Number(a.target_quantity)
  })
}

function statusIcon(s: string) {
  if (s === 'เสร็จแล้ว') return <CheckCircle2 size={11} />
  if (s === 'กำลังผลิต') return <PlayCircle   size={11} />
  return <AlertCircle size={11} />
}

function statusColor(s: string) {
  if (s === 'เสร็จแล้ว') return '#22c55e'
  if (s === 'กำลังผลิต') return '#f59e0b'
  return '#94a3b8'
}

function minsToLabel(mins: number) {
  const hh = Math.floor(mins / 60) % 24
  const mm = mins % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

const BREAKS: [number, number][] = [
  [720, 780],   // 12:00–13:00
  [1020, 1080], // 17:00–18:00
]

function getPhaseStart(period: string) {
  if (period === 'เช้า') return 8 * 60 + 30
  if (period === 'บ่าย') return 14 * 60
  if (period === 'ค่ำ') return 16 * 60
  return 8 * 60
}

/** Return time label like "10:55 → 12:00 │ 13:00 → 13:15" when task spans a break */
function timeRangeLabel(startMins: number, endMins: number): string {
  const parts: string[] = []
  let cur = startMins
  for (const [bs, be] of BREAKS) {
    if (cur >= endMins || bs >= endMins) break
    if (be <= cur) continue
    if (bs > cur) parts.push(`${minsToLabel(cur)} → ${minsToLabel(bs)}`)
    cur = be
  }
  if (cur < endMins) parts.push(`${minsToLabel(cur)} → ${minsToLabel(endMins)}`)
  return parts.join(' │ ')
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

function bagLabel(sku: string, qty: number, bagMap: Record<string, number>): string {
  const wpb = bagMap[sku] ?? bagMap[sku.replace(/^0+/, '')]
  if (!wpb || wpb <= 0) return ''
  const bags = Math.round(qty / wpb)
  return bags > 0 ? `${bags} ถุง · ` : ''
}

// ─── Worker card view ────────────────────────────────────────────────────────

interface WorkerTableProps {
  items: Assignment[]
  phaseStart: number
  rateMap: Record<string, number>
  nameMap: Record<string, string>
  bagMap: Record<string, number>
}

function WorkerTable({ items, phaseStart, rateMap, nameMap, bagMap }: WorkerTableProps) {
  const allSkus = Array.from(new Set(items.map(a => a.sku)))
  const skuColor: Record<string, typeof BAR_COLORS[0]> = {}
  allSkus.forEach((sku, i) => { skuColor[sku] = BAR_COLORS[i % BAR_COLORS.length] })

  const byWorker: Record<string, Assignment[]> = {}
  for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }
  const workers = Object.keys(byWorker).sort()
  if (!workers.length) return null

  const taskHours = (task: Assignment) => {
    const rate = rateMap[task.sku] ?? rateMap[task.sku.replace(/^0+/, '')]
    return (rate && rate > 0) ? Number(task.target_quantity) / rate : null
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="grid grid-cols-[180px_1fr_110px] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500">พนักงาน</span>
        <span className="text-xs font-semibold text-gray-500">รายการที่ต้องผลิต</span>
        <span className="text-xs font-semibold text-gray-500 text-right">รวม / เสร็จ</span>
      </div>
      <div className="divide-y divide-gray-50">
        {workers.map((name, wi) => {
          const tasks = mergeTasks(byWorker[name])
          const workerTotal = tasks.reduce((s, t) => s + Number(t.target_quantity), 0)
          const allDone   = tasks.every(t => t.status === 'เสร็จแล้ว')
          const anyActive = tasks.some(t => t.status === 'กำลังผลิต')

          let curMins = 0
          let lastPeriod = ''
          const taskInfo = tasks.map(t => {
            if (t.period !== lastPeriod) {
              curMins = Math.max(curMins, getPhaseStart(t.period))
              lastPeriod = t.period
            }
            const h         = taskHours(t)
            const startMins = curMins
            const durMins   = h !== null ? Math.round(h * 60) : 0
            const endMins   = wallClockFinish(curMins, durMins)
            curMins = endMins
            return { ...t, startMins, endMins, startLabel: minsToLabel(startMins), finishLabel: minsToLabel(endMins), hours: h }
          })
          const totalFinish = minsToLabel(curMins)
          const displayName = nameMap[name.replace(/\s+/g, ' ').trim()] ?? shortName(name)

          return (
            <div key={name}
              className={`grid grid-cols-[180px_1fr_110px] gap-3 px-4 py-3 items-start ${wi % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'}`}>
              <div>
                <p className="text-sm font-semibold text-gray-800 leading-tight">{displayName}</p>
                <p className="text-xs text-gray-400 font-mono mt-0.5">{tasks[0].worker_code}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {taskInfo.map(task => {
                  const col = skuColor[task.sku]
                  const isDone   = task.status === 'เสร็จแล้ว'
                  const isActive = task.status === 'กำลังผลิต'
                  return (
                    <div key={task.id}
                      style={{ backgroundColor: col.bg, opacity: isDone ? 0.6 : 1 }}
                      className={`rounded-lg px-3 py-1.5 flex flex-col gap-0.5 min-w-[130px] relative ${isActive ? 'ring-2 ring-white animate-pulse' : ''}`}>
                      <span className="text-xs font-semibold leading-tight" style={{ color: col.fg }}>
                        {task.sku_name ?? task.sku}
                      </span>
                      <span className="text-xs font-bold" style={{ color: col.fg }}>
                        {bagLabel(task.sku, Number(task.target_quantity), bagMap)}{Number(task.target_quantity).toLocaleString()} กก.
                      </span>
                      <span className="text-xs font-mono opacity-80" style={{ color: col.fg }}>
                        {timeRangeLabel(task.startMins, task.endMins)}
                      </span>
                      {(isDone || isActive) && (
                        <span className="absolute top-1 right-1" style={{ color: statusColor(task.status) }}>
                          {statusIcon(task.status)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${allDone ? 'text-green-600' : anyActive ? 'text-amber-600' : 'text-gray-800'}`}>
                  {workerTotal.toLocaleString()} กก.
                </p>
                <p className="text-xs text-gray-400 mt-0.5">เสร็จ {totalFinish} น.</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function mergeSegments(segs: { start: number; end: number }[]) {
  if (!segs.length) return segs
  const sorted = [...segs].sort((a, b) => a.start - b.start)
  const merged = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    if (sorted[i].start <= last.end) last.end = Math.max(last.end, sorted[i].end)
    else merged.push({ ...sorted[i] })
  }
  return merged
}

// ─── SKU Schedule view (ภาพรวม) ──────────────────────────────────────────────

interface SkuScheduleViewProps {
  items: Assignment[]
  phaseStart: number
  phaseEnd: number
  rateMap: Record<string, number>
  bagMap: Record<string, number>
}

function SkuScheduleView({ items, phaseStart, phaseEnd, rateMap, bagMap }: SkuScheduleViewProps) {
  const [nowSecs, setNowSecs] = useState(() => {
    const d = new Date()
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
  })
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date()
      setNowSecs(d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds())
    }, 1000)
    return () => clearInterval(id)
  }, [])
  const nowMins = nowSecs / 60

  const allSkus = Array.from(new Set(items.map(a => a.sku)))
  const skuColor: Record<string, typeof BAR_COLORS[0]> = {}
  allSkus.forEach((sku, i) => { skuColor[sku] = BAR_COLORS[i % BAR_COLORS.length] })

  const phaseStartMins = phaseStart * 60

  const taskDurMins = (task: Assignment) => {
    const rate = rateMap[task.sku] ?? rateMap[task.sku.replace(/^0+/, '')]
    return (rate && rate > 0) ? Math.round((Number(task.target_quantity) / rate) * 60) : 0
  }

  const byWorker: Record<string, Assignment[]> = {}
  for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }

  type SkuStat = { name: string | null; totalQty: number; minStart: number; maxEnd: number; workers: string[], segments: { start: number; end: number }[] }
  const skuStats: Record<string, SkuStat> = {}

  for (const rawTasks of Object.values(byWorker)) {
    const tasks = mergeTasks(rawTasks)
    let cur = 0
    let lastPeriod = ''
    for (const task of tasks) {
      if (task.period !== lastPeriod) {
        cur = Math.max(cur, getPhaseStart(task.period))
        lastPeriod = task.period
      }
      const dur      = taskDurMins(task)
      const startMin = cur
      const endMin   = wallClockFinish(cur, dur)
      cur = endMin
      if (!skuStats[task.sku]) {
        skuStats[task.sku] = { name: task.sku_name, totalQty: 0, minStart: startMin, maxEnd: endMin, workers: [], segments: [] }
      }
      const s = skuStats[task.sku]
      s.totalQty += Number(task.target_quantity)
      s.minStart  = Math.min(s.minStart, startMin)
      s.maxEnd    = Math.max(s.maxEnd, endMin)
      if (!s.workers.includes(task.worker_name)) s.workers.push(task.worker_name)
      s.segments.push({ start: startMin, end: endMin })
    }
  }

  const sortedSkus = allSkus
    .filter(sku => skuStats[sku])
    .sort((a, b) => skuStats[b].totalQty - skuStats[a].totalQty)

  if (!sortedSkus.length) return null

  const chartStart = Math.floor(phaseStartMins / 60) * 60
  const chartEnd   = Math.max(phaseEnd * 60, ...sortedSkus.map(s => skuStats[s].maxEnd))
  const totalRange = chartEnd - chartStart

  const ticks: number[] = []
  for (let m = chartStart; m <= chartEnd; m += 60) ticks.push(m)

  const pct = (mins: number) => ((mins - chartStart) / totalRange) * 100

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      {/* Chart header (time axis) */}
      <div className="flex border-b border-gray-100 bg-gray-50/50 sticky top-0 z-20 h-8 sm:h-10">
        <div className="w-28 sm:w-44 shrink-0 border-r border-gray-100" />
        <div className="flex-1 relative h-8">
          {ticks.map(t => (
            <div key={t} className="absolute top-0 h-full flex items-end pb-1.5"
              style={{ left: `${pct(t)}%` }}>
              <span className="text-[10px] font-mono text-gray-400 -translate-x-1/2 select-none">
                {t % 60 === 0 ? Math.floor(t / 60) % 24 : `${Math.floor(t / 60) % 24}.${String(t % 60).padStart(2, '0')}`}
              </span>
            </div>
          ))}
          {/* Current time line */}
          {nowMins >= chartStart && nowMins <= chartEnd && (
            <div className="absolute top-0 bottom-0 w-px bg-red-400 z-30 pointer-events-none" style={{ left: `${pct(nowMins)}%` }} />
          )}
        </div>
        <div className="w-24 sm:w-32 shrink-0 border-l border-gray-100" />
      </div>

      {/* Chart body */}
      <div className="divide-y divide-gray-50 relative">
        
        {sortedSkus.map(sku => {
          const stat      = skuStats[sku]
          const col       = skuColor[sku]
          
          const diffSecs = stat.maxEnd * 60 - nowSecs
          const isDone = diffSecs <= 0
          
          let cdText = ''
          if (!isDone) {
            const h = Math.floor(diffSecs / 3600)
            const m = Math.floor((diffSecs % 3600) / 60)
            const s = diffSecs % 60
            cdText = h > 0 ? `${h}ชม. ${m}น. ${s}` : m > 0 ? `${m}น. ${s}` : `${s}`
          }

          const isActive  = !isDone && nowMins >= stat.minStart
          const isPending = !isDone && nowMins < stat.minStart

          const countdownCls = isDone
            ? 'text-[10px] sm:text-xs text-green-500 font-semibold'
            : isActive
              ? 'text-xs sm:text-sm font-bold text-red-500'
              : isPending
                ? 'text-xs sm:text-sm font-bold text-gray-300'
                : 'text-xs sm:text-sm font-bold text-gray-800'

          return (
            <div key={sku} className="flex items-center min-h-[44px] sm:min-h-[56px] relative z-10 bg-white">
              {/* Y-axis: SKU name */}
              <div className="w-28 sm:w-44 shrink-0 px-2 sm:px-4 py-1.5 sm:py-2 border-r border-gray-100 bg-white">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-sm shrink-0" style={{ backgroundColor: col.bg }} />
                  <div className="min-w-0">
                    <p className="text-[11px] sm:text-xs font-semibold text-gray-800 leading-tight line-clamp-2">{stat.name ?? sku}</p>
                    <p className="text-xs sm:text-sm font-bold mt-0.5" style={{ color: col.bg }}>
                      {bagLabel(sku, stat.totalQty, bagMap)}{stat.totalQty.toLocaleString()} กก.
                      <span className="text-[9px] sm:text-[10px] font-normal text-gray-400 ml-1">· {stat.workers.length} คน</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Bar area */}
              <div className="flex-1 relative h-10 sm:h-14">
                {mergeSegments(stat.segments).map((seg, idx) => {
                  const barLeft  = Math.max(pct(seg.start), 0)
                  const barWidth = Math.max(pct(seg.end) - pct(seg.start), 0.5)
                  const segDone  = nowMins >= seg.end
                  const segPend  = nowMins < seg.start
                  return (
                    <div key={idx} className="absolute top-2 bottom-2 sm:top-2.5 sm:bottom-2.5 rounded-sm"
                      style={{ left: `${barLeft}%`, width: `${barWidth}%`, backgroundColor: col.bg,
                        opacity: segDone ? 0.45 : segPend ? 0.35 : 1 }} />
                  )
                })}
              </div>

              {/* Countdown */}
              <div className="w-24 sm:w-32 shrink-0 px-2 sm:px-3 border-l border-gray-100 text-right">
                {isDone ? (
                  <span className={countdownCls}>✓ เสร็จแล้ว</span>
                ) : (
                  <span className={countdownCls}>{cdText}</span>
                )}
                <p className="text-[9px] sm:text-[10px] text-gray-400 mt-0.5">
                  เสร็จ {minsToLabel(stat.maxEnd)}
                </p>
              </div>
            </div>
          )
        })}

        {/* Break bands — full-height, above rows (z-20 > row z-10), semi-transparent */}
        {BREAKS.flatMap(([bs, be]) => {
          if (bs >= chartEnd || be <= chartStart) return []
          const l = pct(Math.max(bs, chartStart)) / 100
          const w = Math.max(pct(Math.min(be, chartEnd)) - pct(Math.max(bs, chartStart)), 0) / 100
          return [
            <div key={`${bs}-m`} className="sm:hidden absolute top-0 bottom-0 pointer-events-none z-20"
              style={{ left: `calc(7rem + (100% - 13rem) * ${l})`, width: `calc((100% - 13rem) * ${w})`,
                backgroundColor: 'rgba(209,213,219,0.75)', borderLeft: '1px dashed #9ca3af', borderRight: '1px dashed #9ca3af' }} />,
            <div key={`${bs}-d`} className="hidden sm:block absolute top-0 bottom-0 pointer-events-none z-20"
              style={{ left: `calc(11rem + (100% - 19rem) * ${l})`, width: `calc((100% - 19rem) * ${w})`,
                backgroundColor: 'rgba(209,213,219,0.75)', borderLeft: '1px dashed #9ca3af', borderRight: '1px dashed #9ca3af' }} />,
          ]
        })}

        {/* Current time line — full-height, highest z-index */}
        {nowMins >= chartStart && nowMins <= chartEnd && <>
          <div className="sm:hidden absolute top-0 bottom-0 w-px bg-red-400 pointer-events-none z-30"
            style={{ left: `calc(7rem + (100% - 13rem) * ${pct(nowMins) / 100})` }} />
          <div className="hidden sm:block absolute top-0 bottom-0 w-px bg-red-400 pointer-events-none z-30"
            style={{ left: `calc(11rem + (100% - 19rem) * ${pct(nowMins) / 100})` }} />
        </>}
      </div>
    </div>
  )
}

// ─── Production summary view (สรุปแผนผลิต) ───────────────────────────────────

interface ProductionSummaryViewProps {
  items: Assignment[]
  phaseStart: number
  rateMap: Record<string, number>
  bagMap: Record<string, number>
  date: string
  tableName: string
}

type ActualEntry = { id: string; quantity: number }

function ProductionSummaryView({ items, phaseStart, rateMap, bagMap, date, tableName }: ProductionSummaryViewProps) {
  const [inputVals, setInputVals]   = useState<Record<string, string>>({})
  const [history, setHistory]       = useState<Record<string, ActualEntry[]>>({})
  const [popupSku, setPopupSku]     = useState<string | null>(null)
  const [editMode, setEditMode]     = useState(false)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [yieldMap, setYieldMap]     = useState<Record<string, number>>({})

  const fetchActual = useCallback(async () => {
    const { data } = await supabase
      .from('production_actual')
      .select('id, sku, quantity')
      .eq('production_date', date)
      .eq('table_name', tableName)
      .order('created_at')
    const grouped: Record<string, ActualEntry[]> = {}
    for (const row of (data ?? [])) {
      grouped[row.sku] ??= []
      grouped[row.sku].push({ id: row.id, quantity: row.quantity })
    }
    setHistory(grouped)
  }, [date, tableName])

  const fetchYield = useCallback(async () => {
    try {
      const res  = await fetch(`/api/yield-actual?date=${date}`)
      const data = await res.json()
      setYieldMap(data.yieldMap ?? {})
    } catch { /* silent */ }
  }, [date])

  useEffect(() => {
    fetchActual()
    fetchYield()
    const poll = setInterval(() => { fetchActual(); fetchYield() }, 3000)

    type Row = { id: string; sku: string; quantity: number; table_name: string; production_date: string }

    const channel = supabase
      .channel(`production_actual:${date}:${tableName}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'production_actual' },
        (payload) => {
          const row = payload.new as Row
          if (row.production_date !== date || row.table_name !== tableName) return
          setHistory(prev => {
            const entries = prev[row.sku] ?? []
            if (entries.some(e => e.id === row.id)) return prev          // ซ้ำ
            const tempIdx = entries.findIndex(e => e.id.startsWith('temp_'))
            if (tempIdx >= 0) {
              const next = [...entries]
              next[tempIdx] = { id: row.id, quantity: row.quantity }     // แทน temp
              return { ...prev, [row.sku]: next }
            }
            return { ...prev, [row.sku]: [...entries, { id: row.id, quantity: row.quantity }] }
          })
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'production_actual' },
        (payload) => {
          const row = payload.new as Row
          if (row.production_date !== date || row.table_name !== tableName) return
          setHistory(prev => {
            for (const [sku, entries] of Object.entries(prev)) {
              const idx = entries.findIndex(e => e.id === row.id)
              if (idx >= 0) {
                const next = [...entries]
                next[idx] = { id: row.id, quantity: row.quantity }
                return { ...prev, [sku]: next }
              }
            }
            return prev
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel); clearInterval(poll) }
  }, [fetchActual, fetchYield])

  const allSkus = Array.from(new Set(items.map(a => a.sku)))

  const phaseStartMins = phaseStart * 60

  const taskDurMins = (task: Assignment) => {
    const rate = rateMap[task.sku] ?? rateMap[task.sku.replace(/^0+/, '')]
    return (rate && rate > 0) ? Math.round((Number(task.target_quantity) / rate) * 60) : 0
  }

  const byWorker: Record<string, Assignment[]> = {}
  for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }

  type SkuStat = { name: string | null; totalQty: number }
  const skuStats: Record<string, SkuStat> = {}

  for (const rawTasks of Object.values(byWorker)) {
    const tasks = mergeTasks(rawTasks)
    let cur = phaseStartMins
    for (const task of tasks) {
      const dur = taskDurMins(task)
      cur = wallClockFinish(cur, dur)
      if (!skuStats[task.sku]) skuStats[task.sku] = { name: task.sku_name, totalQty: 0 }
      skuStats[task.sku].totalQty += Number(task.target_quantity)
    }
  }

  const sortedSkus = allSkus
    .filter(sku => skuStats[sku])
    .sort((a, b) => skuStats[b].totalQty - skuStats[a].totalQty)

  if (!sortedSkus.length) return null

  const skuTotal    = (sku: string) => (history[sku] ?? []).reduce((s, e) => s + e.quantity, 0)
  const totalBags   = sortedSkus.reduce((s, sku) => {
    const wpb = bagMap[sku] ?? bagMap[sku.replace(/^0+/, '')]
    return s + (wpb && wpb > 0 ? Math.round(skuStats[sku].totalQty / wpb) : 0)
  }, 0)
  const totalProduced = sortedSkus.reduce((s, sku) => s + skuTotal(sku), 0)

  const confirm = async (sku: string, rawValue: string) => {
    const val = parseInt(rawValue.replace(/[^0-9]/g, ''), 10)
    if (isNaN(val) || val <= 0) return
    // Optimistic update — แสดงทันที ไม่รอ Supabase
    const tempId = `temp_${Date.now()}`
    setHistory(prev => ({ ...prev, [sku]: [...(prev[sku] ?? []), { id: tempId, quantity: val }] }))
    setInputVals(prev => ({ ...prev, [sku]: '' }))
    await supabase.from('production_actual').insert({ production_date: date, table_name: tableName, sku, quantity: val })
    fetchActual() // แทน tempId ด้วย id จริงจาก DB โดยเร็ว
  }

  const saveEdits = async () => {
    await Promise.all(
      Object.entries(editValues)
        .filter(([id]) => !id.startsWith('temp_'))
        .map(([id, val]) => {
          const qty = parseInt(val, 10)
          if (isNaN(qty) || qty < 0) return
          if (qty === 0)
            return supabase.from('production_actual').delete().eq('id', id)
          return supabase.from('production_actual').update({ quantity: qty }).eq('id', id)
        })
    )
    setEditMode(false)
    setEditValues({})
    fetchActual()
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="grid grid-cols-[1fr_54px_54px_54px_80px] sm:grid-cols-[1fr_80px_80px_80px_110px] gap-0 px-3 sm:px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500">ชื่อ SKU</span>
        <span className="text-[10px] sm:text-xs font-semibold text-gray-500 text-right leading-tight">แผน<br className="sm:hidden" />(ถุง)</span>
        <span className="text-[10px] sm:text-xs font-semibold text-gray-500 text-right leading-tight">ผลิต<br className="sm:hidden" />(ถุง)</span>
        <span className="text-[10px] sm:text-xs font-semibold text-gray-500 text-right leading-tight">รับผล<br className="sm:hidden" />ได้(ถุง)</span>
        <span className="text-[10px] sm:text-xs font-semibold text-gray-500 text-right leading-tight">ผลิต<br className="sm:hidden" />ได้(ถุง)</span>
      </div>

      {/* SKU rows */}
      <div className="divide-y divide-gray-50">
        {sortedSkus.map((sku, i) => {
          const stat    = skuStats[sku]
          const wpb     = bagMap[sku] ?? bagMap[sku.replace(/^0+/, '')]
          const bags    = wpb && wpb > 0 ? Math.round(stat.totalQty / wpb) : null
          const total   = skuTotal(sku)
          const hasData = total > 0

          const yieldBags = yieldMap[sku] ?? yieldMap[sku.replace(/^0+/, '')] ?? null

          return (
            <div key={sku}
              className={`grid grid-cols-[1fr_54px_54px_54px_80px] sm:grid-cols-[1fr_80px_80px_80px_110px] gap-0 px-3 sm:px-4 py-2 items-center ${i % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'}`}>
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <p className="text-xs sm:text-sm font-medium text-gray-800 leading-tight shrink-0">{stat.name ?? sku}</p>
                {/* Overlapping bullet bars — desktop only, only when plan bags known */}
                {bags !== null && bags > 0 && (
                  <div className="hidden sm:block flex-1 h-4 relative rounded min-w-[50px]">
                    {/* Plan — 100% reference (gray background) */}
                    <div className="absolute inset-0 bg-gray-150 rounded" style={{ backgroundColor: '#e5e7eb' }} />
                    {/* รับผลได้ bar — green, slightly shorter */}
                    {yieldBags !== null && yieldBags > 0 && (
                      <div className="absolute top-0.5 bottom-0.5 left-0 rounded transition-all duration-500"
                        style={{ width: `${Math.min(100, (yieldBags / bags) * 100)}%`, backgroundColor: '#4ade80' }} />
                    )}
                    {/* ผลิต bar — blue, thinnest (foreground) */}
                    {hasData && (
                      <div className="absolute top-1 bottom-1 left-0 rounded transition-all duration-500"
                        style={{ width: `${Math.min(100, (total / bags) * 100)}%`, backgroundColor: '#3b82f6' }} />
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs sm:text-sm font-semibold text-gray-600 text-right">
                {bags !== null ? bags.toLocaleString() : '—'}
              </p>
              <button
                onClick={() => { if (hasData) { setPopupSku(sku); setEditMode(false) } }}
                className={`text-xs sm:text-sm font-bold text-right w-full ${hasData ? 'text-blue-600 underline underline-offset-2 cursor-pointer' : 'text-gray-300 cursor-default'}`}>
                {hasData ? total.toLocaleString() : '—'}
              </button>
              <p className="text-xs sm:text-sm font-semibold text-right text-green-600">
                {yieldBags !== null ? yieldBags.toLocaleString() : '—'}
              </p>
              <div className="flex justify-end">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={inputVals[sku] ?? ''}
                  onChange={e => {
                    const val = e.target.value.replace(/[^0-9]/g, '')
                    setInputVals(prev => ({ ...prev, [sku]: val }))
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') confirm(sku, (e.target as HTMLInputElement).value) }}
                  onBlur={e => confirm(sku, e.currentTarget.value)}
                  placeholder="—"
                  className="w-16 sm:w-20 text-xs sm:text-sm font-semibold text-right border border-gray-300 rounded-lg px-1.5 sm:px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white"
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer totals */}
      <div className="grid grid-cols-[1fr_54px_54px_54px_80px] sm:grid-cols-[1fr_80px_80px_80px_110px] gap-0 px-3 sm:px-4 py-3 border-t border-gray-200 bg-gray-50">
        <span className="text-xs sm:text-sm font-bold text-gray-700">รวมทั้งหมด</span>
        <span className="text-xs sm:text-sm font-bold text-right text-gray-900">{totalBags > 0 ? totalBags.toLocaleString() : '—'}</span>
        <span className="text-xs sm:text-sm font-bold text-right text-blue-600">{totalProduced > 0 ? totalProduced.toLocaleString() : '—'}</span>
        <span className="text-xs sm:text-sm font-bold text-right text-green-600">
          {(() => { const t = sortedSkus.reduce((s, sku) => s + (yieldMap[sku] ?? yieldMap[sku.replace(/^0+/, '')] ?? 0), 0); return t > 0 ? t.toLocaleString() : '—' })()}
        </span>
        <span />
      </div>

      {/* Popup */}
      {popupSku && (() => {
        const hist    = history[popupSku] ?? []
        const total   = editMode
          ? Object.values(editValues).reduce((s, v) => s + (parseInt(v, 10) || 0), 0)
          : skuTotal(popupSku)
        const formula = editMode
          ? Object.values(editValues).filter(v => parseInt(v, 10) > 0).join(' + ')
          : hist.map(e => e.quantity).join(' + ')

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => { setPopupSku(null); setEditMode(false); setEditValues({}) }}>
            <div className="bg-white rounded-2xl shadow-xl p-5 w-80 max-w-[90vw]"
              onClick={e => e.stopPropagation()}>

              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-800">
                  {skuStats[popupSku]?.name ?? popupSku}
                </h3>
                <button onClick={() => { setPopupSku(null); setEditMode(false); setEditValues({}) }}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1">×</button>
              </div>

              <p className="text-center text-base font-bold text-blue-600 bg-blue-50 rounded-xl py-2 px-3 mb-4 break-all">
                {formula || '—'}{hist.length > 0 ? ` = ${total}` : ''}
              </p>

              <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
                {hist.map((entry, idx) => (
                  <div key={entry.id} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">ครั้งที่ {idx + 1}</span>
                    {editMode ? (
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={editValues[entry.id] ?? String(entry.quantity)}
                        onChange={e => {
                          const v = e.target.value.replace(/[^0-9]/g, '')
                          setEditValues(prev => ({ ...prev, [entry.id]: v }))
                        }}
                        className="w-24 text-sm font-semibold text-right border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    ) : (
                      <span className="text-sm font-bold text-blue-600">{entry.quantity.toLocaleString()}</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (editMode) {
                      saveEdits()
                    } else {
                      const init: Record<string, string> = {}
                      for (const e of hist) init[e.id] = String(e.quantity)
                      setEditValues(init)
                      setEditMode(true)
                    }
                  }}
                  className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors">
                  {editMode ? 'บันทึก' : 'แก้ไข'}
                </button>
                <button
                  onClick={() => { setPopupSku(null); setEditMode(false); setEditValues({}) }}
                  className="flex-1 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 transition-colors">
                  ปิด
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Worker card view (รายพนักงาน) ──────────────────────────────────────────

interface WorkerCardViewProps {
  items: Assignment[]
  phaseStart: number
  rateMap: Record<string, number>
  nameMap: Record<string, string>
  bagMap: Record<string, number>
}

function WorkerCardView({ items, phaseStart, rateMap, nameMap, bagMap }: WorkerCardViewProps) {
  const allSkus = Array.from(new Set(items.map(a => a.sku)))
  const skuColor: Record<string, typeof BAR_COLORS[0]> = {}
  allSkus.forEach((sku, i) => { skuColor[sku] = BAR_COLORS[i % BAR_COLORS.length] })

  const byWorker: Record<string, Assignment[]> = {}
  for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }
  const workers = Object.keys(byWorker).sort()
  if (!workers.length) return null

  const phaseStartMins = phaseStart * 60

  const taskDurMins = (task: Assignment) => {
    const rate = rateMap[task.sku] ?? rateMap[task.sku.replace(/^0+/, '')]
    return (rate && rate > 0) ? Math.round((Number(task.target_quantity) / rate) * 60) : 0
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {workers.map(name => {
        const tasks       = mergeTasks(byWorker[name])
        const displayName = nameMap[name.replace(/\s+/g, ' ').trim()] ?? shortName(name)
        const workerTotal = tasks.reduce((s, t) => s + Number(t.target_quantity), 0)
        const allDone     = tasks.every(t => t.status === 'เสร็จแล้ว')
        const anyActive   = tasks.some(t => t.status === 'กำลังผลิต')

        let curMins = phaseStartMins
        const taskInfo = tasks.map(t => {
          const dur      = taskDurMins(t)
          const startMin = curMins
          const endMin   = wallClockFinish(curMins, dur)
          curMins = endMin
          return { ...t, startMin, endMin, dur,
            startLabel: minsToLabel(startMin),
            endLabel:   minsToLabel(endMin) }
        })
        const totalDur    = curMins - phaseStartMins
        const finishLabel = minsToLabel(curMins)

        return (
          <div key={name} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            {/* Header */}
            <div className="flex items-start justify-between">
              <p className="text-sm font-semibold text-gray-900 leading-tight">{displayName}</p>
              <p className={`text-sm font-bold whitespace-nowrap ml-2 ${allDone ? 'text-green-600' : anyActive ? 'text-amber-600' : 'text-gray-800'}`}>
                {workerTotal.toLocaleString()} กก.
              </p>
            </div>
            <div className="flex items-center justify-between mt-0.5 mb-3">
              <p className="text-xs font-mono text-gray-400">{tasks[0].worker_code}</p>
              <p className="text-xs text-gray-400">{minsToLabel(phaseStartMins)} → {finishLabel}</p>
            </div>

            {/* Progress bar */}
            <div className="flex rounded-full overflow-hidden mb-3" style={{ height: 6 }}>
              {taskInfo.map(t => (
                <div key={t.id} style={{
                  width: totalDur > 0 ? `${(t.dur / totalDur) * 100}%` : '0%',
                  backgroundColor: skuColor[t.sku].bg,
                  opacity: t.status === 'เสร็จแล้ว' ? 0.5 : 1,
                }} />
              ))}
            </div>

            {/* Task list */}
            <div className="space-y-1.5">
              {taskInfo.map(t => {
                const col    = skuColor[t.sku]
                const isDone = t.status === 'เสร็จแล้ว'
                return (
                  <div key={t.id} className="flex items-start gap-2 rounded-lg px-3 py-2"
                    style={{ backgroundColor: col.bg + '20' }}>
                    <span className="w-2 h-2 rounded-sm shrink-0 mt-1" style={{ backgroundColor: col.bg, opacity: isDone ? 0.5 : 1 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight" style={{ color: col.fg }}>
                        {t.sku_name ?? t.sku}
                      </p>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-xs font-mono text-gray-400">{timeRangeLabel(t.startMin, t.endMin)}</span>
                        <span className="text-xs font-bold ml-2" style={{ color: col.fg }}>
                          {bagLabel(t.sku, Number(t.target_quantity), bagMap)}{Number(t.target_quantity).toLocaleString()} กก.
                        </span>
                      </div>
                    </div>
                    {isDone && <CheckCircle2 size={12} className="shrink-0 mt-1 text-green-500" />}
                    {t.status === 'กำลังผลิต' && <PlayCircle size={12} className="shrink-0 mt-1 text-amber-500" />}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Current-time view (รายเวลา) ─────────────────────────────────────────────

interface CurrentTimeViewProps {
  items: Assignment[]
  phaseStart: number
  rateMap: Record<string, number>
  nameMap: Record<string, string>
  bagMap: Record<string, number>
}

function CurrentTimeView({ items, phaseStart, rateMap, nameMap, bagMap }: CurrentTimeViewProps) {
  const [realNowMins, setRealNowMins] = useState(() => {
    const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
  })
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date(); setRealNowMins(d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60)
    }, 5000)
    return () => clearInterval(id)
  }, [])

  const nowMins = realNowMins

  const allSkus = Array.from(new Set(items.map(a => a.sku)))
  const skuColor: Record<string, typeof BAR_COLORS[0]> = {}
  allSkus.forEach((sku, i) => { skuColor[sku] = BAR_COLORS[i % BAR_COLORS.length] })

  const byWorker: Record<string, Assignment[]> = {}
  for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }
  const workers = Object.keys(byWorker).sort()
  if (!workers.length) return null

  const phaseStartMins = phaseStart * 60

  const taskDurMins = (task: Assignment) => {
    const rate = rateMap[task.sku] ?? rateMap[task.sku.replace(/^0+/, '')]
    return (rate && rate > 0) ? Math.round((Number(task.target_quantity) / rate) * 60) : 0
  }

  const isLive = true

  return (
    <div className="space-y-4">

      {/* Worker grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {workers.map(name => {
        const tasks       = mergeTasks(byWorker[name])
        const displayName = nameMap[name.replace(/\s+/g, ' ').trim()] ?? shortName(name)

        let curMins2 = phaseStartMins
        const taskInfo = tasks.map(t => {
          const dur      = taskDurMins(t)
          const startMin = curMins2
          const endMin   = wallClockFinish(curMins2, dur)
          curMins2 = endMin
          return { ...t, startMin, endMin, dur,
            startLabel: minsToLabel(startMin),
            endLabel:   minsToLabel(endMin) }
        })

        const currentTask = taskInfo.find(t => nowMins >= t.startMin && nowMins < t.endMin)
        const allDone     = nowMins >= curMins2
        const notStarted  = nowMins < phaseStartMins

        const card = currentTask ?? (notStarted ? taskInfo[0] : null)
        const col  = card ? skuColor[card.sku] : { bg: '#e5e7eb', fg: '#6b7280' }

        const elapsedPct = currentTask
          ? Math.min(100, ((nowMins - currentTask.startMin) / Math.max(currentTask.dur, 1)) * 100)
          : allDone ? 100 : 0
        const taskProgress = 100 - elapsedPct

        const remainSecs = currentTask && isLive ? Math.max(0, (currentTask.endMin - nowMins) * 60) : 0
        const rh = Math.floor(remainSecs / 3600)
        const rm = Math.floor((remainSecs % 3600) / 60)
        const remainLabel = rh > 0 ? `เหลืออีก ${rh}ชม. ${rm}น.` : rm > 0 ? `เหลืออีก ${rm}น.` : currentTask ? 'กำลังเสร็จ' : ''

        return (
          <div key={name}
            className={`bg-white rounded-2xl border shadow-sm p-4 transition-opacity ${allDone ? 'opacity-50 border-gray-100' : 'border-gray-200'}`}>

            {/* Header */}
            <div className="flex items-start justify-between mb-1">
              <p className="text-sm font-semibold text-gray-900 leading-tight">{displayName}</p>
              {allDone
                ? <span className="text-xs font-semibold text-green-500 flex items-center gap-1"><CheckCircle2 size={12} />เสร็จแล้ว</span>
                : notStarted
                  ? <span className="text-xs text-gray-400">เริ่ม {taskInfo[0]?.startLabel ?? ''}</span>
                  : <span className="text-xs font-semibold text-amber-500 flex items-center gap-1"><PlayCircle size={12} />กำลังผลิต</span>
              }
            </div>
            <p className="text-xs font-mono text-gray-400 mb-3">{tasks[0].worker_code}</p>

            {card ? (
              <>
                {/* Progress bar */}
                <div className="rounded-full overflow-hidden mb-3" style={{ height: 6, backgroundColor: isLive ? col.bg + '30' : '#e5e7eb' }}>
                  <div className="h-full rounded-full transition-all duration-1000"
                    style={{ width: isLive ? `${taskProgress}%` : '100%', backgroundColor: isLive ? col.bg : '#d1d5db' }} />
                </div>

                {/* Current SKU */}
                <div className="rounded-xl px-3 py-2.5" style={{ backgroundColor: col.bg + '25' }}>
                  <p className="text-sm font-semibold leading-tight mb-1" style={{ color: col.fg }}>
                    {card.sku_name ?? card.sku}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-gray-500">{timeRangeLabel(card.startMin, card.endMin)}</span>
                    <span className="text-xs font-bold" style={{ color: col.fg }}>
                      {bagLabel(card.sku, Number(card.target_quantity), bagMap)}{Number(card.target_quantity).toLocaleString()} กก.
                    </span>
                  </div>
                  {currentTask && isLive && (
                    <p className="text-xs text-gray-400 mt-1">{remainLabel}</p>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-xl px-3 py-4 bg-gray-50 text-center">
                <p className="text-xs text-gray-400">เสร็จสิ้นทุก SKU แล้ว</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
    </div>
  )
}

// ─── Excel Export ─────────────────────────────────────────────────────────────

function exportExcel(
  stationLabel: string,
  date: string,
  allItems: Assignment[],
  rateMap: Record<string, number>,
  nameMap: Record<string, string>,
) {
  const wb = XLSX.utils.book_new()

  const colWidths = [{ wch: 6 }, { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 36 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }]
  const header = ['ลำดับ', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'รหัสสินค้า', 'ชื่อสินค้า', 'ปริมาณ (กก.)', 'เวลาเริ่ม', 'เวลาเสร็จ', 'Phase']

  const buildRows = (items: Assignment[], phaseStartMins: number, phaseLabel?: string) => {
    const byWorker: Record<string, Assignment[]> = {}
    for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }
    const rows: (string | number)[][] = []
    let seq = 1
    for (const [workerName, workerTasks] of Object.entries(byWorker).sort()) {
      const tasks = mergeTasks(workerTasks)
      const displayName = nameMap[workerName.replace(/\s+/g, ' ').trim()] ?? shortName(workerName)
      let curMins = phaseStartMins
      for (const task of tasks) {
        const rate = rateMap[task.sku] ?? rateMap[task.sku.replace(/^0+/, '')]
        const dur    = (rate && rate > 0) ? Math.round((Number(task.target_quantity) / rate) * 60) : 0
        const startMin = curMins
        const endMin   = wallClockFinish(curMins, dur)
        curMins = endMin
        rows.push([
          seq++,
          task.worker_code,
          displayName,
          task.sku,
          task.sku_name ?? '',
          Number(task.target_quantity),
          minsToLabel(startMin),
          minsToLabel(endMin),
          phaseLabel ?? task.period,
        ])
      }
    }
    return rows
  }

  for (const phase of PHASES) {
    const phaseItems = allItems.filter(a => a.period === phase.period)
    const rows = [[...header], ...buildRows(phaseItems, phase.startH * 60)]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = colWidths
    XLSX.utils.book_append_sheet(wb, ws, `Phase ${phase.phase} (${phase.sub})`)
  }

  // Sheet รวม 3 Phase
  const allRows: (string | number)[][] = [[...header]]
  for (const phase of PHASES) {
    const phaseItems = allItems.filter(a => a.period === phase.period)
    allRows.push(...buildRows(phaseItems, phase.startH * 60, `Phase ${phase.phase}`))
  }
  const wsAll = XLSX.utils.aoa_to_sheet(allRows)
  wsAll['!cols'] = colWidths
  XLSX.utils.book_append_sheet(wb, wsAll, 'รวมทั้งหมด')

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `คำสั่งผลิต_${stationLabel}_${date}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TablePage() {
  const params    = useParams()
  const tableSlug = params.table as string
  const cfg       = CFG[tableSlug]

  const [date, setDate]             = useState(new Date().toISOString().split('T')[0])
  const [selectedPhase, setPhase]   = useState<number | 'all'>(1)
  const [items, setItems]           = useState<Assignment[]>([])
  const [rateMap, setRateMap]       = useState<Record<string, number>>({})
  const [nameMap, setNameMap]       = useState<Record<string, string>>({})
  const [bagMap, setBagMap]         = useState<Record<string, number>>({})
  const [loading, setLoading]       = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult]   = useState<{ success: boolean; message: string } | null>(null)
  const [viewMode, setViewMode]     = useState<'worker' | 'gantt' | 'sku' | 'time' | 'summary'>('sku')

  const loadData = (d: string, silent = false) => {
    if (!cfg) return
    if (!silent) setLoading(true)
    fetch(`/api/production?date=${d}&table=${cfg.label}`)
      .then(r => r.json())
      .then(data => {
        const assignments = (data.assignments ?? []) as Assignment[]
        const normalized = assignments.map(a => ({ ...a, sku: a.sku.replace(/^0+/, '') }))
        setItems(normalized)
      })
      .finally(() => { if (!silent) setLoading(false) })
  }

  useEffect(() => {
    fetch('/api/master/productivity')
      .then(r => r.json())
      .then(data => setRateMap(data.rateMap ?? {}))
    fetch('/api/master/picking-unit')
      .then(r => r.json())
      .then(data => setBagMap(data.bagMap ?? {}))
    fetch('/api/master/job-assign')
      .then(r => r.json())
      .then(data => {
        const map: Record<string, string> = {}
        for (const w of data.workers ?? []) {
          const display = w.nickname ? `${w.nickname} (${w.firstName})` : w.firstName
          map[w.fullName] = display
          if (w.nickname) map[w.nickname] = display
          if (w.firstName && w.firstName !== w.nickname) map[w.firstName] = display
        }
        setNameMap(map)
      })
  }, [])

  useEffect(() => {
    loadData(date)
    const id = setInterval(() => loadData(date, true), 3000)
    return () => clearInterval(id)
  }, [date, cfg?.label])

  const generate = async () => {
    if (selectedPhase === 'all') return
    setGenerating(true); setGenResult(null)
    try {
      const res    = await fetch('/api/production/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, phase: selectedPhase }),
      })
      const result = await res.json()
      setGenResult(result)
      if (result.success) loadData(date)
    } catch { setGenResult({ success: false, message: 'เกิดข้อผิดพลาด' }) }
    setGenerating(false)
  }

  if (!cfg) return <p className="text-red-500">ไม่พบ Station</p>

  const phaseConfig  = selectedPhase === 'all' ? null : PHASES.find(p => p.phase === selectedPhase)!
  const filtered     = selectedPhase === 'all' ? items : items.filter(a => a.period === phaseConfig!.period)
  const viewStartH   = selectedPhase === 'all' ? PHASES[0].startH  : phaseConfig!.startH
  const viewEndH     = selectedPhase === 'all' ? PHASES[PHASES.length - 1].endH : phaseConfig!.endH
  const dateDisplay  = new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="space-y-3 sm:space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Station {cfg.label}</h1>
        <span className="text-sm font-medium text-gray-500">{dateDisplay}</span>
      </div>

      {/* Phase tabs + generate */}
      <div className="flex items-center gap-2">
        {PHASES.map(p => (
          <button key={p.phase}
            onClick={() => { setPhase(p.phase); setGenResult(null) }}
            className={`flex-1 sm:flex-none px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors ${selectedPhase === p.phase ? p.active : p.inactive}`}>
            <span className="block">{p.label}</span>
            <span className="block text-[10px] sm:text-xs font-normal opacity-80">{p.sub}</span>
          </button>
        ))}
        <button
          onClick={() => { setPhase('all'); setGenResult(null) }}
          className={`flex-1 sm:flex-none px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors border ${selectedPhase === 'all'
            ? 'bg-gray-800 text-white border-gray-800'
            : 'text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
          <span className="block">ทั้งหมด</span>
          <span className="block text-[10px] sm:text-xs font-normal opacity-80">3 Phase</span>
        </button>

        <div className="hidden sm:flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-sm text-gray-700">
            <Calendar size={14} className="text-gray-400" />
            <input type="date" value={date}
              onChange={e => { setDate(e.target.value); setGenResult(null) }}
              className="outline-none bg-transparent text-sm" />
          </div>
          {selectedPhase !== 'all' && (
            <button onClick={generate} disabled={generating}
              className="btn-primary flex items-center gap-2 text-sm">
              <Zap size={15} />{generating ? 'กำลังสร้าง...' : `สร้าง Phase ${selectedPhase}`}
            </button>
          )}
          {genResult && (
            <div className="flex items-center gap-2">
              <div className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm border ${genResult.success
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-red-50 text-red-700 border-red-200'}`}>
                {genResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {genResult.message}
              </div>
              {genResult.success && (
                <button
                  onClick={() => exportExcel(cfg.label, date, items, rateMap, nameMap)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap">
                  <Download size={14} />
                  ดาวน์โหลด
                </button>
              )}
            </div>
          )}
        </div>
      </div>


      {/* Empty / loading */}
      {loading && (
        <div className="card text-center py-16 text-gray-400">กำลังโหลด...</div>
      )}
      {!loading && filtered.length === 0 && (
        <div className="card text-center py-16 text-gray-400">
          <p className="font-medium">ยังไม่มีคำสั่งผลิต{selectedPhase === 'all' ? '' : ` Phase ${selectedPhase}`} วันที่ {date}</p>
          {selectedPhase !== 'all' && <p className="text-sm mt-1">กรุณากด "สร้าง Phase {selectedPhase}"</p>}
        </div>
      )}

      {/* Content */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
            {/* View toggle */}
            <div className="grid grid-cols-2 sm:flex items-center gap-1.5 sm:gap-2">
              {([
                { mode: 'sku',     icon: BarChart2,    label: 'ภาพรวม' },
                { mode: 'gantt',   icon: LayoutList,   label: 'รายพนักงาน' },
                { mode: 'time',    icon: Clock,        label: 'รายเวลา' },
                { mode: 'summary', icon: ClipboardList, label: 'สรุปแผนผลิต' },
              ] as const).map(({ mode, icon: Icon, label }) => (
                <button key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors w-full sm:w-auto sm:flex-none ${viewMode === mode
                    ? 'bg-gray-900 text-white'
                    : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                  <Icon size={14} />{label}
                </button>
              ))}
              <button
                onClick={() => exportExcel(cfg.label, date, items, rateMap, nameMap)}
                className="ml-auto hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap">
                <Download size={14} />
                Export Excel
              </button>
            </div>

            {viewMode === 'sku' && (
              <SkuScheduleView
                items={filtered}
                phaseStart={viewStartH}
                phaseEnd={viewEndH}
                rateMap={rateMap}
                bagMap={bagMap}
              />
            )}
            {viewMode === 'gantt' && (
              <WorkerCardView
                items={filtered}
                phaseStart={viewStartH}
                rateMap={rateMap}
                nameMap={nameMap}
                bagMap={bagMap}
              />
            )}
            {viewMode === 'worker' && (
              <WorkerTable
                items={filtered}
                phaseStart={viewStartH}
                rateMap={rateMap}
                nameMap={nameMap}
                bagMap={bagMap}
              />
            )}
            {viewMode === 'time' && (
              <CurrentTimeView
                items={filtered}
                phaseStart={viewStartH}
                rateMap={rateMap}
                nameMap={nameMap}
                bagMap={bagMap}
              />
            )}
            {viewMode === 'summary' && (
              <ProductionSummaryView
                items={filtered}
                phaseStart={viewStartH}
                rateMap={rateMap}
                bagMap={bagMap}
                date={date}
                tableName={cfg.label}
              />
            )}
        </div>
      )}
    </div>
  )
}
