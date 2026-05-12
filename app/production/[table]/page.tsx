'use client'
import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { CheckCircle2, PlayCircle, AlertCircle, Zap, LayoutList, BarChart2 } from 'lucide-react'
import Link from 'next/link'

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

const PX_PER_MIN = 8

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
}

function shortName(full: string) {
  return full.trim().split(/\s+/)[0] ?? full
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
          const tasks = byWorker[name]
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

// ─── SKU Gantt view (ภาพรวม) ─────────────────────────────────────────────────

interface SkuGanttViewProps {
  items: Assignment[]
  phaseStart: number
  rateMap: Record<string, number>
}

function SkuGanttView({ items, phaseStart, rateMap }: SkuGanttViewProps) {
  const allSkus = Array.from(new Set(items.map(a => a.sku)))
  const skuColor: Record<string, typeof BAR_COLORS[0]> = {}
  allSkus.forEach((sku, i) => { skuColor[sku] = BAR_COLORS[i % BAR_COLORS.length] })

  const phaseStartMins = phaseStart * 60

  const taskDurMins = (task: Assignment) => {
    const rate = rateMap[task.sku] ?? rateMap[task.sku.replace(/^0+/, '')]
    return (rate && rate > 0) ? Math.round((Number(task.target_quantity) / rate) * 60) : 0
  }

  // Compute each assignment's start/end (sequential per worker)
  const byWorker: Record<string, Assignment[]> = {}
  for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }

  type SkuStat = { name: string | null; totalQty: number; minStart: number; maxEnd: number; workerCount: number }
  const skuStats: Record<string, SkuStat> = {}

  for (const tasks of Object.values(byWorker)) {
    let cur = phaseStartMins
    for (const task of tasks) {
      const dur      = taskDurMins(task)
      const startMin = cur
      const endMin   = cur + dur
      cur = endMin

      if (!skuStats[task.sku]) {
        skuStats[task.sku] = { name: task.sku_name, totalQty: 0, minStart: startMin, maxEnd: endMin, workerCount: 0 }
      }
      const s = skuStats[task.sku]
      s.totalQty   += Number(task.target_quantity)
      s.minStart    = Math.min(s.minStart, startMin)
      s.maxEnd      = Math.max(s.maxEnd, endMin)
      s.workerCount += 1
    }
  }

  const skuRows = allSkus
    .filter(sku => skuStats[sku])
    .sort((a, b) => skuStats[a].minStart - skuStats[b].minStart)

  if (!skuRows.length) return null

  const maxEndMin  = Math.max(...skuRows.map(s => skuStats[s].maxEnd))
  const totalMins  = maxEndMin - phaseStartMins + 20
  const chartWidth = totalMins * PX_PER_MIN

  const ticks: number[] = []
  for (let m = 0; m <= totalMins; m += 5) ticks.push(phaseStartMins + m)

  const LEFT_W  = 200
  const RIGHT_W = 110

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <div style={{ minWidth: LEFT_W + chartWidth + RIGHT_W }}>

          {/* Time header */}
          <div className="flex border-b border-gray-100 bg-gray-50/90 sticky top-0 z-20">
            <div className="shrink-0 px-4 py-2 text-xs font-medium text-gray-400 bg-gray-50/90"
              style={{ width: LEFT_W }}>สินค้า (SKU)</div>
            <div className="relative" style={{ width: chartWidth, height: 36 }}>
              {ticks.map(absMin => (
                <div key={absMin} className="absolute bottom-0 flex flex-col items-center"
                  style={{ left: (absMin - phaseStartMins) * PX_PER_MIN }}>
                  <span className="text-xs text-gray-400 whitespace-nowrap mb-1"
                    style={{ transform: 'translateX(-50%)' }}>{minsToLabel(absMin)}</span>
                  <div className="w-px h-2 bg-gray-300" />
                </div>
              ))}
            </div>
            <div className="shrink-0 px-3 py-2 text-xs text-gray-400 text-right bg-gray-50/90"
              style={{ width: RIGHT_W }}>รวม / เสร็จ</div>
          </div>

          {/* SKU rows */}
          <div className="divide-y divide-gray-50">
            {skuRows.map((sku, ri) => {
              const stat   = skuStats[sku]
              const col    = skuColor[sku]
              const leftPx = (stat.minStart - phaseStartMins) * PX_PER_MIN
              const widthPx = Math.max((stat.maxEnd - stat.minStart) * PX_PER_MIN - 2, 4)
              const rowBg  = ri % 2 === 1 ? 'rgba(249,250,251,0.97)' : 'rgba(255,255,255,0.97)'
              const durationMins = stat.maxEnd - stat.minStart
              const durationText = durationMins >= 60
                ? `${Math.floor(durationMins / 60)} ชม. ${durationMins % 60 > 0 ? durationMins % 60 + ' น.' : ''}`
                : `${durationMins} น.`

              return (
                <div key={sku} className="flex items-center" style={{ backgroundColor: ri % 2 === 1 ? '#f9fafb' : '#fff' }}>

                  {/* SKU name – sticky left */}
                  <div className="shrink-0 px-4 py-3 sticky left-0 z-10" style={{ width: LEFT_W, backgroundColor: rowBg }}>
                    <p className="text-sm font-semibold text-gray-800 leading-tight">{stat.name ?? sku}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{sku} · {stat.workerCount} คน</p>
                  </div>

                  {/* Bar */}
                  <div className="relative shrink-0" style={{ width: chartWidth, height: 52 }}>
                    {ticks.map(absMin => (
                      <div key={absMin} className="absolute top-0 bottom-0 w-px bg-gray-100"
                        style={{ left: (absMin - phaseStartMins) * PX_PER_MIN }} />
                    ))}
                    <div style={{
                      left: leftPx, width: widthPx,
                      top: 6, bottom: 6,
                      backgroundColor: col.bg,
                    }}
                      className="absolute rounded overflow-hidden flex flex-col justify-center px-2">
                      {widthPx > 60 && (
                        <span className="text-xs font-semibold truncate" style={{ color: col.fg }}>
                          {stat.name ?? sku}
                        </span>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        {widthPx > 30 && (
                          <span className="text-xs font-bold whitespace-nowrap" style={{ color: col.fg }}>
                            {stat.totalQty.toLocaleString()} กก.
                          </span>
                        )}
                        {widthPx > 100 && (
                          <span className="text-xs font-mono opacity-80 whitespace-nowrap" style={{ color: col.fg }}>
                            {minsToLabel(stat.minStart)}–{minsToLabel(stat.maxEnd)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Summary – sticky right */}
                  <div className="shrink-0 px-3 py-3 text-right sticky right-0 z-10" style={{ width: RIGHT_W, backgroundColor: rowBg }}>
                    <p className="text-sm font-bold text-gray-800">{stat.totalQty.toLocaleString()} กก.</p>
                    <p className="text-xs text-gray-400">{durationText}</p>
                    <p className="text-xs text-gray-500 font-medium">เสร็จ {minsToLabel(stat.maxEnd)} น.</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Gantt view (รายพนักงาน) ─────────────────────────────────────────────────

interface GanttViewProps {
  items: Assignment[]
  phaseStart: number
  phaseEnd: number
  rateMap: Record<string, number>
  nameMap: Record<string, string>
}

const GANTT_PX_PER_MIN = 4   // 4px/min → 1 ชม. = 240px, 6 ชม. = 1440px
const ROW_H = 62              // row height px — พอให้แสดง 3 บรรทัดได้

function GanttView({ items, phaseStart, phaseEnd, rateMap, nameMap }: GanttViewProps) {
  const allSkus = Array.from(new Set(items.map(a => a.sku)))
  const skuColor: Record<string, typeof BAR_COLORS[0]> = {}
  allSkus.forEach((sku, i) => { skuColor[sku] = BAR_COLORS[i % BAR_COLORS.length] })

  const byWorker: Record<string, Assignment[]> = {}
  for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }
  const workers = Object.keys(byWorker).sort()
  if (!workers.length) return null

  const phaseStartMins = phaseStart * 60
  const phaseEndMins   = phaseEnd   * 60
  const totalMins      = phaseEndMins - phaseStartMins
  const chartWidth     = totalMins * GANTT_PX_PER_MIN

  const taskDurationMins = (task: Assignment) => {
    const rate = rateMap[task.sku] ?? rateMap[task.sku.replace(/^0+/, '')]
    return (rate && rate > 0) ? Math.round((Number(task.target_quantity) / rate) * 60) : 0
  }

  type Seg = { task: Assignment; startMin: number; endMin: number; leftPx: number; widthPx: number }
  const workerSegs: Record<string, Seg[]> = {}

  for (const name of workers) {
    let cur = phaseStartMins
    workerSegs[name] = byWorker[name].map(task => {
      const dur      = taskDurationMins(task)
      const startMin = cur
      const endMin   = cur + dur
      cur = endMin
      return {
        task, startMin, endMin,
        leftPx:  (startMin - phaseStartMins) * GANTT_PX_PER_MIN,
        widthPx: dur * GANTT_PX_PER_MIN,
      }
    })
  }

  // Tick every 10 min, label every 30 min
  const ticks: number[] = []
  for (let m = 0; m <= totalMins; m += 10) ticks.push(phaseStartMins + m)

  const skuTotals: Record<string, { name: string | null; total: number }> = {}
  for (const a of items) {
    skuTotals[a.sku] ??= { name: a.sku_name, total: 0 }
    skuTotals[a.sku].total += Number(a.target_quantity)
  }

  const LEFT_W  = 170
  const RIGHT_W = 95

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 py-3 border-b border-gray-100 bg-gray-50">
        {allSkus.map(sku => {
          const col  = skuColor[sku]
          const info = skuTotals[sku]
          return (
            <div key={sku} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: col.bg }} />
              <span className="text-xs text-gray-700">{info.name ?? sku}</span>
              <span className="text-xs font-bold text-gray-400">{info.total.toLocaleString()} กก.</span>
            </div>
          )
        })}
      </div>

      {/* Scrollable table */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: LEFT_W + chartWidth + RIGHT_W }}>

          {/* Time header */}
          <div className="flex border-b border-gray-100 bg-gray-50/90 sticky top-0 z-20">
            <div className="shrink-0 px-4 py-2 text-xs font-medium text-gray-400 bg-gray-50/90"
              style={{ width: LEFT_W }}>พนักงาน</div>
            <div className="relative" style={{ width: chartWidth, height: 36 }}>
              {ticks.map(absMin => {
                const leftPx  = (absMin - phaseStartMins) * GANTT_PX_PER_MIN
                const label   = minsToLabel(absMin)
                const showLbl = (absMin - phaseStartMins) % 30 === 0
                return (
                  <div key={absMin} className="absolute bottom-0 flex flex-col items-center"
                    style={{ left: leftPx }}>
                    {showLbl && (
                      <span className="text-xs text-gray-400 whitespace-nowrap mb-1"
                        style={{ transform: 'translateX(-50%)' }}>{label}</span>
                    )}
                    <div className={`w-px ${showLbl ? 'h-3 bg-gray-300' : 'h-2 bg-gray-200'}`} />
                  </div>
                )
              })}
            </div>
            <div className="shrink-0 px-3 py-2 text-xs text-gray-400 text-right bg-gray-50/90"
              style={{ width: RIGHT_W }}>รวม / เสร็จ</div>
          </div>

          {/* Worker rows */}
          <div className="divide-y divide-gray-50">
            {workers.map((name, wi) => {
              const segs        = workerSegs[name]
              const tasks       = byWorker[name]
              const workerTotal = tasks.reduce((s, t) => s + Number(t.target_quantity), 0)
              const allDone     = tasks.every(t => t.status === 'เสร็จแล้ว')
              const anyActive   = tasks.some(t => t.status === 'กำลังผลิต')
              const lastSeg     = segs[segs.length - 1]
              const finishLabel = lastSeg ? minsToLabel(lastSeg.endMin) : ''
              const displayName = nameMap[name.replace(/\s+/g, ' ').trim()] ?? shortName(name)
              const rowBg       = wi % 2 === 1 ? 'rgba(249,250,251,0.97)' : 'rgba(255,255,255,0.97)'

              return (
                <div key={name} className="flex items-center" style={{ backgroundColor: wi % 2 === 1 ? '#f9fafb' : '#fff' }}>

                  {/* Name – sticky left */}
                  <div className="shrink-0 px-4 sticky left-0 z-10 flex flex-col justify-center"
                    style={{ width: LEFT_W, height: ROW_H, backgroundColor: rowBg }}>
                    <p className="text-sm font-semibold text-gray-800 leading-tight">{displayName}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{tasks[0].worker_code}</p>
                  </div>

                  {/* Bars */}
                  <div className="relative shrink-0" style={{ width: chartWidth, height: ROW_H }}>
                    {ticks.map(absMin => (
                      <div key={absMin}
                        className={`absolute top-0 bottom-0 w-px ${(absMin - phaseStartMins) % 60 === 0 ? 'bg-gray-200' : 'bg-gray-100'}`}
                        style={{ left: (absMin - phaseStartMins) * GANTT_PX_PER_MIN }} />
                    ))}

                    {segs.map(({ task, startMin, endMin, leftPx, widthPx }) => {
                      const col      = skuColor[task.sku]
                      const isDone   = task.status === 'เสร็จแล้ว'
                      const isActive = task.status === 'กำลังผลิต'
                      const startLbl = minsToLabel(startMin)
                      const endLbl   = minsToLabel(endMin)
                      const w        = Math.max(widthPx - 2, 4)

                      return (
                        <div key={task.id}
                          title={`${task.sku_name ?? task.sku}\n${Number(task.target_quantity).toLocaleString()} กก.\n${startLbl}–${endLbl}`}
                          style={{
                            left: leftPx, width: w,
                            top: 5, bottom: 5,
                            backgroundColor: col.bg,
                            opacity: isDone ? 0.6 : 1,
                          }}
                          className={`absolute rounded overflow-hidden flex flex-col justify-center px-2 ${isActive ? 'ring-1 ring-white/80 animate-pulse' : ''}`}>
                          {/* ชื่อ SKU — แสดงเสมอถ้า bar กว้างพอ */}
                          {w > 40 && (
                            <span className="text-xs font-semibold leading-tight" style={{ color: col.fg,
                              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                              {task.sku_name ?? task.sku}
                            </span>
                          )}
                          {w > 24 && (
                            <span className="text-xs font-bold whitespace-nowrap mt-0.5" style={{ color: col.fg }}>
                              {Number(task.target_quantity).toLocaleString()} กก.
                            </span>
                          )}
                          {(isDone || isActive) && (
                            <span className="absolute top-0.5 right-0.5" style={{ color: statusColor(task.status) }}>
                              {statusIcon(task.status)}
                            </span>
                          )}
                        </div>
                      )
                    })}

                    {/* Idle zone */}
                    {lastSeg && lastSeg.endMin < phaseEndMins && (() => {
                      const idleLeft = (lastSeg.endMin - phaseStartMins) * GANTT_PX_PER_MIN
                      const idleW    = (phaseEndMins - lastSeg.endMin) * GANTT_PX_PER_MIN
                      return (
                        <div className="absolute top-5 bottom-5 rounded bg-gray-100/70 flex items-center justify-center"
                          style={{ left: idleLeft, width: idleW }}>
                          {idleW > 60 && <span className="text-xs text-gray-300 font-medium">ว่าง</span>}
                        </div>
                      )
                    })()}
                  </div>

                  {/* Summary – sticky right */}
                  <div className="shrink-0 px-3 text-right sticky right-0 z-10 flex flex-col justify-center"
                    style={{ width: RIGHT_W, height: ROW_H, backgroundColor: rowBg }}>
                    <p className={`text-sm font-bold ${allDone ? 'text-green-600' : anyActive ? 'text-amber-600' : 'text-gray-800'}`}>
                      {workerTotal.toLocaleString()} กก.
                    </p>
                    <p className="text-xs text-gray-400">เสร็จ {finishLabel} น.</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TablePage() {
  const params       = useParams()
  const searchParams = useSearchParams()
  const router       = useRouter()
  const tableSlug    = params.table as string
  const cfg          = CFG[tableSlug]

  const [date, setDate]             = useState(searchParams.get('date') ?? new Date().toISOString().split('T')[0])
  const [selectedPhase, setPhase]   = useState(1)
  const [items, setItems]           = useState<Assignment[]>([])
  const [rateMap, setRateMap]       = useState<Record<string, number>>({})
  const [nameMap, setNameMap]       = useState<Record<string, string>>({})
  const [loading, setLoading]       = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult]   = useState<{ success: boolean; message: string } | null>(null)
  const [viewMode, setViewMode]     = useState<'worker' | 'gantt' | 'sku'>('sku')

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

  const handleDate = (d: string) => {
    setDate(d); setGenResult(null)
    router.replace(`/production/${tableSlug}?date=${d}`)
  }

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
  const others      = Object.entries(CFG).filter(([s]) => s !== tableSlug)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Station {cfg.label}</h1>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={e => handleDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {others.map(([s, c]) => (
            <Link key={s} href={`/production/${s}?date=${date}`}
              className="btn-secondary text-sm">Station {c.label}</Link>
          ))}
        </div>
      </div>

      {/* Phase tabs + generate */}
      <div className="flex items-center gap-3 flex-wrap">
        {PHASES.map(p => (
          <button key={p.phase}
            onClick={() => { setPhase(p.phase); setGenResult(null) }}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${selectedPhase === p.phase ? p.active : p.inactive}`}>
            <span className="block">{p.label}</span>
            <span className="block text-xs font-normal opacity-80">{p.sub}</span>
          </button>
        ))}

        <div className="flex items-center gap-3 ml-auto">
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
          </div>

          {viewMode === 'sku' && (
            <SkuGanttView
              items={filtered}
              phaseStart={phaseConfig.startH}
              rateMap={rateMap}
            />
          )}
          {viewMode === 'gantt' && (
            <GanttView
              items={filtered}
              phaseStart={phaseConfig.startH}
              phaseEnd={phaseConfig.endH}
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
        </div>
      )}
    </div>
  )
}
