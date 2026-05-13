'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, PlayCircle, AlertCircle, Zap, LayoutList, BarChart2, Clock } from 'lucide-react'

const CFG: Record<string, { label: string; accent: string; light: string }> = {
  'sam-chan': { label: 'สามชั้น', accent: 'border-blue-500',   light: 'bg-blue-50'   },
  'sa-phok':  { label: 'สะโพก',  accent: 'border-orange-500', light: 'bg-orange-50' },
  'lai':      { label: 'ไหล่',   accent: 'border-green-500',  light: 'bg-green-50'  },
}

const PHASES = [
  { phase: 1, label: 'Phase 1', sub: '8:00-14:00',       period: 'เช้า', startH: 8,  endH: 14,
    active: 'bg-sky-500 text-white',    inactive: 'text-sky-700 border border-sky-300 hover:bg-sky-50' },
  { phase: 2, label: 'Phase 2', sub: '14:00-16:00',      period: 'บ่าย', startH: 13, endH: 17,
    active: 'bg-purple-500 text-white', inactive: 'text-purple-700 border border-purple-300 hover:bg-purple-50' },
  { phase: 3, label: 'Phase 3', sub: '16:00 เป็นต้นไป', period: 'ค่ำ',  startH: 17, endH: 19,
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
    const existing = map.get(t.sku)
    if (existing) {
      existing.target_quantity = Number(existing.target_quantity) + Number(t.target_quantity)
    } else {
      map.set(t.sku, { ...t })
    }
  }
  return Array.from(map.values()).sort((a, b) => Number(b.target_quantity) - Number(a.target_quantity))
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

// ─── Worker card view ────────────────────────────────────────────────────────

interface WorkerTableProps {
  items: Assignment[]
  phaseStart: number
  rateMap: Record<string, number>
  nameMap: Record<string, string>
}

function WorkerTable({ items, phaseStart, rateMap, nameMap }: WorkerTableProps) {
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

          let offsetH = 0
          const taskInfo = tasks.map(t => {
            const h = taskHours(t)
            const startMins = phaseStart * 60 + Math.round(offsetH * 60)
            if (h !== null) offsetH += h
            const endMins   = phaseStart * 60 + Math.round(offsetH * 60)
            return { ...t, startLabel: minsToLabel(startMins), finishLabel: minsToLabel(endMins), hours: h }
          })
          const totalFinish = minsToLabel(phaseStart * 60 + Math.round(offsetH * 60))
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
                        {Number(task.target_quantity).toLocaleString()} กก.
                      </span>
                      <span className="text-xs font-mono opacity-80" style={{ color: col.fg }}>
                        {task.startLabel}–{task.finishLabel}
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

// ─── SKU Schedule view (ภาพรวม) ──────────────────────────────────────────────

interface SkuScheduleViewProps {
  items: Assignment[]
  phaseStart: number
  phaseEnd: number
  rateMap: Record<string, number>
}

function SkuScheduleView({ items, phaseStart, phaseEnd, rateMap }: SkuScheduleViewProps) {
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

  type SkuStat = { name: string | null; totalQty: number; minStart: number; maxEnd: number; workers: string[] }
  const skuStats: Record<string, SkuStat> = {}

  for (const rawTasks of Object.values(byWorker)) {
    const tasks = mergeTasks(rawTasks)
    let cur = phaseStartMins
    for (const task of tasks) {
      const dur      = taskDurMins(task)
      const startMin = cur
      const endMin   = cur + dur
      cur = endMin
      if (!skuStats[task.sku]) {
        skuStats[task.sku] = { name: task.sku_name, totalQty: 0, minStart: startMin, maxEnd: endMin, workers: [] }
      }
      const s = skuStats[task.sku]
      s.totalQty += Number(task.target_quantity)
      s.minStart  = Math.min(s.minStart, startMin)
      s.maxEnd    = Math.max(s.maxEnd, endMin)
      if (!s.workers.includes(task.worker_name)) s.workers.push(task.worker_name)
    }
  }

  const sortedSkus = allSkus
    .filter(sku => skuStats[sku])
    .sort((a, b) => skuStats[b].totalQty - skuStats[a].totalQty)

  if (!sortedSkus.length) return null

  const chartStart = phaseStartMins
  const chartEnd   = Math.max(phaseEnd * 60, ...sortedSkus.map(s => skuStats[s].maxEnd))
  const totalRange = chartEnd - chartStart

  const ticks: number[] = []
  for (let m = chartStart; m <= chartEnd; m += 30) ticks.push(m)

  const pct = (mins: number) => ((mins - chartStart) / totalRange) * 100

  const countdown = (endMins: number) => {
    const diffSecs = endMins * 60 - nowSecs
    if (diffSecs <= 0) return { text: 'เสร็จแล้ว', done: true }
    const h = Math.floor(diffSecs / 3600)
    const m = Math.floor((diffSecs % 3600) / 60)
    const s = diffSecs % 60
    const parts = h > 0 ? `${h}ชม. ${m}น. ${s}` : m > 0 ? `${m}น. ${s}` : `${s}`
    return { text: parts, done: false }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* X-axis header — hidden on mobile */}
      <div className="hidden sm:flex border-b border-gray-100">
        <div className="w-28 sm:w-44 shrink-0 border-r border-gray-100" />
        <div className="flex-1 relative h-8">
          {ticks.map(t => (
            <div key={t} className="absolute top-0 h-full flex items-end pb-1.5"
              style={{ left: `${pct(t)}%` }}>
              <span className="text-[10px] font-mono text-gray-400 -translate-x-1/2 select-none">
                {minsToLabel(t)}
              </span>
            </div>
          ))}
        </div>
        <div className="w-24 sm:w-32 shrink-0 border-l border-gray-100" />
      </div>

      {/* SKU rows */}
      <div className="divide-y divide-gray-50">
        {sortedSkus.map(sku => {
          const stat     = skuStats[sku]
          const col      = skuColor[sku]
          const cd       = countdown(stat.maxEnd)
          const barLeft  = pct(stat.minStart)
          const barWidth = Math.max(pct(stat.maxEnd) - pct(stat.minStart), 0.5)

          return (
            <div key={sku} className="flex items-center min-h-[44px] sm:min-h-[56px]">
              {/* Y-axis: SKU name */}
              <div className="w-28 sm:w-44 shrink-0 px-2 sm:px-4 py-1.5 sm:py-2 border-r border-gray-100">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-sm shrink-0" style={{ backgroundColor: col.bg }} />
                  <div className="min-w-0">
                    <p className="text-[11px] sm:text-xs font-semibold text-gray-800 leading-tight line-clamp-2">{stat.name ?? sku}</p>
                    <p className="text-xs sm:text-sm font-bold mt-0.5" style={{ color: col.bg }}>
                      {stat.totalQty.toLocaleString()} กก.
                      <span className="text-[9px] sm:text-[10px] font-normal text-gray-400 ml-1">· {stat.workers.length} คน</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Bar area */}
              <div className="flex-1 relative h-10 sm:h-14">
                {/* Now indicator */}
                {nowMins >= chartStart && nowMins <= chartEnd && (
                  <div className="absolute -top-px -bottom-px w-px bg-red-400 z-10 opacity-30"
                    style={{ left: `${pct(nowMins)}%` }} />
                )}
                {/* Bar */}
                <div className="absolute top-2 bottom-2 sm:top-2.5 sm:bottom-2.5"
                  style={{
                    left: `${barLeft}%`,
                    width: `${barWidth}%`,
                    backgroundColor: col.bg,
                    opacity: cd.done ? 0.45 : 1,
                  }} />
              </div>

              {/* Countdown */}
              <div className="w-24 sm:w-32 shrink-0 px-2 sm:px-3 border-l border-gray-100 text-right">
                {cd.done ? (
                  <span className="text-[10px] sm:text-xs text-green-500 font-semibold">✓ เสร็จแล้ว</span>
                ) : (
                  <span className="text-xs sm:text-sm font-bold text-gray-800">{cd.text}</span>
                )}
                <p className="text-[9px] sm:text-[10px] text-gray-400 mt-0.5">
                  เสร็จ {minsToLabel(stat.maxEnd)}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Worker card view (รายพนักงาน) ──────────────────────────────────────────

interface WorkerCardViewProps {
  items: Assignment[]
  phaseStart: number
  rateMap: Record<string, number>
  nameMap: Record<string, string>
}

function WorkerCardView({ items, phaseStart, rateMap, nameMap }: WorkerCardViewProps) {
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
    <div className="grid grid-cols-3 gap-4">
      {workers.map(name => {
        const tasks       = mergeTasks(byWorker[name])
        const displayName = nameMap[name.replace(/\s+/g, ' ').trim()] ?? shortName(name)
        const workerTotal = tasks.reduce((s, t) => s + Number(t.target_quantity), 0)
        const allDone     = tasks.every(t => t.status === 'เสร็จแล้ว')
        const anyActive   = tasks.some(t => t.status === 'กำลังผลิต')

        let offset = 0
        const taskInfo = tasks.map(t => {
          const dur      = taskDurMins(t)
          const startMin = phaseStartMins + offset
          offset += dur
          return { ...t, startMin, endMin: phaseStartMins + offset, dur,
            startLabel: minsToLabel(phaseStartMins + offset - dur),
            endLabel:   minsToLabel(phaseStartMins + offset) }
        })
        const totalDur    = offset
        const finishLabel = minsToLabel(phaseStartMins + totalDur)

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
                        <span className="text-xs font-mono text-gray-400">{t.startLabel} – {t.endLabel}</span>
                        <span className="text-xs font-bold ml-2" style={{ color: col.fg }}>
                          {Number(t.target_quantity).toLocaleString()} กก.
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
}

function CurrentTimeView({ items, phaseStart, rateMap, nameMap }: CurrentTimeViewProps) {
  const [realNowMins, setRealNowMins] = useState(() => {
    const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
  })
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date(); setRealNowMins(d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60)
    }, 5000)
    return () => clearInterval(id)
  }, [])

  // null = live mode, number = selected hour (e.g. 8 = 08:00–09:00)
  const [selectedHour, setSelectedHour] = useState<number | null>(null)
  const nowMins = selectedHour !== null ? selectedHour * 60 + 30 : realNowMins

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

  // Compute max end across all workers to determine hour range
  let maxEndMins = phaseStartMins
  for (const workerTasks of Object.values(byWorker)) {
    const tasks = mergeTasks(workerTasks)
    const totalDur = tasks.reduce((s, t) => s + taskDurMins(t), 0)
    maxEndMins = Math.max(maxEndMins, phaseStartMins + totalDur)
  }
  const hourSlots: number[] = []
  for (let h = phaseStart; h * 60 < maxEndMins; h++) hourSlots.push(h)

  const isLive = selectedHour === null

  return (
    <div className="space-y-4">
      {/* Hour selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setSelectedHour(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${isLive
            ? 'bg-gray-900 text-white'
            : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
          ตอนนี้
        </button>
        {hourSlots.map(h => (
          <button key={h}
            onClick={() => setSelectedHour(h)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedHour === h
              ? 'bg-gray-900 text-white'
              : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {String(h).padStart(2, '0')}:00
          </button>
        ))}
      </div>

      {/* Worker grid */}
      <div className="grid grid-cols-3 gap-4">
      {workers.map(name => {
        const tasks       = mergeTasks(byWorker[name])
        const displayName = nameMap[name.replace(/\s+/g, ' ').trim()] ?? shortName(name)

        let offset = 0
        const taskInfo = tasks.map(t => {
          const dur      = taskDurMins(t)
          const startMin = phaseStartMins + offset
          offset += dur
          const endMin   = phaseStartMins + offset
          return { ...t, startMin, endMin, dur,
            startLabel: minsToLabel(startMin),
            endLabel:   minsToLabel(endMin) }
        })

        const currentTask = taskInfo.find(t => nowMins >= t.startMin && nowMins < t.endMin)
        const allDone     = nowMins >= phaseStartMins + offset
        const notStarted  = nowMins < phaseStartMins

        const card = currentTask ?? (notStarted ? taskInfo[0] : null)
        const col  = card ? skuColor[card.sku] : { bg: '#e5e7eb', fg: '#6b7280' }

        const taskProgress = currentTask && isLive
          ? Math.min(100, ((nowMins - currentTask.startMin) / Math.max(currentTask.dur, 1)) * 100)
          : currentTask ? Math.min(100, ((nowMins - currentTask.startMin) / Math.max(currentTask.dur, 1)) * 100)
          : allDone ? 100 : 0

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
                <div className="rounded-full overflow-hidden mb-3" style={{ height: 6, backgroundColor: col.bg + '30' }}>
                  <div className="h-full rounded-full transition-all duration-1000"
                    style={{ width: `${taskProgress}%`, backgroundColor: col.bg }} />
                </div>

                {/* Current SKU */}
                <div className="rounded-xl px-3 py-2.5" style={{ backgroundColor: col.bg + '25' }}>
                  <p className="text-sm font-semibold leading-tight mb-1" style={{ color: col.fg }}>
                    {card.sku_name ?? card.sku}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-gray-500">{card.startLabel} – {card.endLabel}</span>
                    <span className="text-xs font-bold" style={{ color: col.fg }}>
                      {Number(card.target_quantity).toLocaleString()} กก.
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TablePage() {
  const params    = useParams()
  const tableSlug = params.table as string
  const cfg       = CFG[tableSlug]

  const [date]                      = useState(new Date().toISOString().split('T')[0])
  const [selectedPhase, setPhase]   = useState(1)
  const [items, setItems]           = useState<Assignment[]>([])
  const [rateMap, setRateMap]       = useState<Record<string, number>>({})
  const [nameMap, setNameMap]       = useState<Record<string, string>>({})
  const [loading, setLoading]       = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult]   = useState<{ success: boolean; message: string } | null>(null)
  const [viewMode, setViewMode]     = useState<'worker' | 'gantt' | 'sku' | 'time'>('sku')

  const loadData = (d: string) => {
    if (!cfg) return
    setLoading(true)
    fetch(`/api/production?date=${d}&table=${cfg.label}`)
      .then(r => r.json())
      .then(data => setItems(data.assignments ?? []))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetch('/api/master/productivity')
      .then(r => r.json())
      .then(data => setRateMap(data.rateMap ?? {}))
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

  useEffect(() => { loadData(date) }, [date, cfg?.label])

  const generate = async () => {
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

  const phaseConfig = PHASES.find(p => p.phase === selectedPhase)!
  const filtered    = items.filter(a => a.period === phaseConfig.period)
  const dateDisplay = new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })

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

        <div className="hidden sm:flex items-center gap-3 ml-auto">
          <button onClick={generate} disabled={generating}
            className="btn-primary flex items-center gap-2 text-sm">
            <Zap size={15} />{generating ? 'กำลังสร้าง...' : `สร้าง Phase ${selectedPhase}`}
          </button>
          {genResult && (
            <div className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm border ${genResult.success
              ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-red-50 text-red-700 border-red-200'}`}>
              {genResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              {genResult.message}
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
          <p className="font-medium">ยังไม่มีคำสั่งผลิต Phase {selectedPhase} วันที่ {date}</p>
          <p className="text-sm mt-1">กรุณากด "สร้าง Phase {selectedPhase}"</p>
        </div>
      )}

      {/* Content */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
            {/* View toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('sku')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === 'sku'
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                <BarChart2 size={15} />ภาพรวม
              </button>
              <button
                onClick={() => setViewMode('gantt')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === 'gantt'
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                <LayoutList size={15} />รายพนักงาน
              </button>
              <button
                onClick={() => setViewMode('time')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === 'time'
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                <Clock size={15} />รายเวลา
              </button>
            </div>

            {viewMode === 'sku' && (
              <SkuScheduleView
                items={filtered}
                phaseStart={phaseConfig.startH}
                phaseEnd={phaseConfig.endH}
                rateMap={rateMap}
              />
            )}
            {viewMode === 'gantt' && (
              <WorkerCardView
                items={filtered}
                phaseStart={phaseConfig.startH}
                rateMap={rateMap}
                nameMap={nameMap}
              />
            )}
            {viewMode === 'worker' && (
              <WorkerTable
                items={filtered}
                phaseStart={phaseConfig.startH}
                rateMap={rateMap}
                nameMap={nameMap}
              />
            )}
            {viewMode === 'time' && (
              <CurrentTimeView
                items={filtered}
                phaseStart={phaseConfig.startH}
                rateMap={rateMap}
                nameMap={nameMap}
              />
            )}
        </div>
      )}
    </div>
  )
}
