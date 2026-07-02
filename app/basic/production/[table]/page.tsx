'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, PlayCircle, AlertCircle, Zap, LayoutList, BarChart2, Clock, Download, ClipboardList, Calendar, RefreshCw } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase, supabaseSchema } from '@/lib/supabase'

const CFG: Record<string, { label: string; accent: string; light: string }> = {
  'sa-phok-basic':  { label: 'สะโพกเบสิค',  accent: 'border-orange-500', light: 'bg-orange-50' },
  'lai-basic':      { label: 'ไหล่เบสิค',   accent: 'border-green-500',  light: 'bg-green-50'  },
  'sam-chan-basic':  { label: 'สามชั้นเบสิค', accent: 'border-blue-500',   light: 'bg-blue-50'   },
}

const PHASES = [
  { phase: 1, label: 'Phase 1', sub: '8:30-14:30',       period: 'เช้า', startH: 8.5,  endH: 14.5,
    active: 'bg-sky-500 text-white',    inactive: 'text-sky-700 border border-sky-300 hover:bg-sky-50' },
  { phase: 2, label: 'Phase 2', sub: '14:30-16:30',      period: 'บ่าย', startH: 14.5, endH: 16.5,
    active: 'bg-purple-500 text-white', inactive: 'text-purple-700 border border-purple-300 hover:bg-purple-50' },
  { phase: 3, label: 'Phase 3', sub: '16:30 เป็นต้นไป', period: 'ค่ำ',  startH: 16.5, endH: 24,
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
  channel: string | null
  note: string | null
}

interface LineBreak {
  id: string
  production_date: string
  station: string
  start_time: string  // 'HH:MM'
  end_time: string    // 'HH:MM'
  reason: string | null
}

function timeToMins(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

const GOLD_COLOR = { bg: '#f59e0b', fg: '#78350f' }

function buildSkuColorMap(allItems: Assignment[]): Record<string, typeof BAR_COLORS[0]> {
  const suppSkus = new Set(allItems.filter(a => a.channel === 'เสริม').map(a => a.sku))
  const nameToColor: Record<string, typeof BAR_COLORS[0]> = {}
  let colorIdx = 0
  const map: Record<string, typeof BAR_COLORS[0]> = {}
  for (const item of allItems) {
    if (item.sku in map) continue
    if (suppSkus.has(item.sku)) {
      map[item.sku] = GOLD_COLOR
      continue
    }
    const nameKey = item.sku_name ?? item.sku
    if (!(nameKey in nameToColor)) {
      nameToColor[nameKey] = BAR_COLORS[colorIdx % BAR_COLORS.length]
      colorIdx++
    }
    map[item.sku] = nameToColor[nameKey]
  }
  return map
}

function shortName(full: string) {
  return full.trim().split(/\s+/)[0] ?? full
}

function mergeTasks(tasks: Assignment[]): Assignment[] {
  if (!tasks || tasks.length === 0) return []

  const periodOrder: Record<string, number> = { 'เช้า': 1, 'บ่าย': 2, 'ค่ำ': 3 }
  const sorted = [...tasks].sort((a, b) => {
    const pA = periodOrder[a.period] ?? 99
    const pB = periodOrder[b.period] ?? 99
    if (pA !== pB) return pA - pB
    const timeA = a.deadline_time || ''
    const timeB = b.deadline_time || ''
    if (timeA !== timeB) return timeA.localeCompare(timeB)
    const seqA = a.seq ?? 999999
    const seqB = b.seq ?? 999999
    return seqA - seqB
  })

  const merged: Assignment[] = []
  for (const t of sorted) {
    if (merged.length === 0) {
      merged.push({ ...t })
      continue
    }
    const last = merged[merged.length - 1]
    if (last.sku === t.sku && last.period === t.period) {
      last.target_quantity = Number(last.target_quantity) + Number(t.target_quantity)
      if (t.seq !== null && (last.seq === null || t.seq < last.seq)) {
        last.seq = t.seq
      }
      if (t.deadline_time && (!last.deadline_time || t.deadline_time < last.deadline_time)) {
        last.deadline_time = t.deadline_time
      }
    } else {
      merged.push({ ...t })
    }
  }
  return merged
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
  const rounded = Math.round(mins)
  const hh = Math.floor(rounded / 60) % 24
  const mm = rounded % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

const BREAKS: [number, number][] = [
  [720, 780],
  [1020, 1080],
]

function getPhaseStart(period: string) {
  if (period === 'เช้า') return 8 * 60 + 30
  if (period === 'บ่าย') return 14 * 60
  if (period === 'ค่ำ') return 16 * 60
  return 8 * 60
}

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

function roundedDisplayQty(sku: string, qty: number, bagMap: Record<string, number>): number {
  const wpb = bagMap[sku] ?? bagMap[sku.replace(/^0+/, '')]
  if (!wpb || wpb <= 0) return qty
  return Math.floor(qty / wpb) * wpb
}

function bagLabel(sku: string, qty: number, bagMap: Record<string, number>): string {
  const wpb = bagMap[sku] ?? bagMap[sku.replace(/^0+/, '')]
  if (!wpb || wpb <= 0) return ''
  const bags = Math.floor(qty / wpb)
  return bags > 0 ? `${bags} ถุง · ` : ''
}

// ─── Worker card view ────────────────────────────────────────────────────────

interface WorkerTableProps {
  items: Assignment[]
  phaseStart: number
  nameMap: Record<string, string>
  bagMap: Record<string, number>
  skuColor: Record<string, typeof BAR_COLORS[0]>
}

function WorkerTable({ items, phaseStart, nameMap, bagMap, skuColor }: WorkerTableProps) {

  const byWorker: Record<string, Assignment[]> = {}
  for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }
  const workers = Object.keys(byWorker).sort()
  if (!workers.length) return null

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
          const workerTotal = tasks.reduce((s, t) => s + roundedDisplayQty(t.sku, Number(t.target_quantity), bagMap), 0)
          const allDone   = tasks.every(t => t.status === 'เสร็จแล้ว')
          const anyActive = tasks.some(t => t.status === 'กำลังผลิต')

          let curMins = 0
          let lastPeriod = ''
          const taskInfo = tasks.map(t => {
            if (t.period !== lastPeriod) {
              curMins = Math.max(curMins, getPhaseStart(t.period))
              lastPeriod = t.period
            }
            const isConcurrent = String(t.note ?? '').includes('concurrent')
            let startMins: number
            if (t.deadline_time) {
              const [dh, dm] = t.deadline_time.split(':').map(Number)
              const deadlineMins = (!isNaN(dh) && !isNaN(dm)) ? dh * 60 + dm : curMins
              startMins = isConcurrent ? deadlineMins : Math.max(curMins, deadlineMins)
            } else {
              startMins = curMins
            }
            curMins = Math.max(curMins, startMins)
            const displayQty = roundedDisplayQty(t.sku, Number(t.target_quantity), bagMap)
            return { ...t, startMins, startLabel: minsToLabel(startMins), displayQty }
          })
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
                        {bagLabel(task.sku, task.displayQty, bagMap)}{task.displayQty.toLocaleString()} กก.
                      </span>
                      <span className="text-xs font-mono opacity-80" style={{ color: col.fg }}>
                        {task.startLabel}
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
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function mergeSegmentsWithWorkers(segs: { start: number; end: number; worker: string }[]) {
  if (!segs.length) return [] as { start: number; end: number; workers: string[] }[]
  const sorted = [...segs].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number; workers: string[] }[] = [
    { start: sorted[0].start, end: sorted[0].end, workers: [sorted[0].worker] }
  ]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end)
      if (!last.workers.includes(sorted[i].worker)) last.workers.push(sorted[i].worker)
    } else {
      merged.push({ start: sorted[i].start, end: sorted[i].end, workers: [sorted[i].worker] })
    }
  }
  return merged
}

// ─── SKU Schedule view (ภาพรวม) ──────────────────────────────────────────────

type BarPopup = { name: string; start: number; end: number; workers: string[]; color: string } | null

interface PigLot { spec_code: string; qty: number; avg_weight: number; order: number }
interface MasYieldRow { carcass_weight: number; product_group: string; yield_pct: number }

interface SkuScheduleViewProps {
  items: Assignment[]
  phaseStart: number
  phaseEnd: number
  bagMap: Record<string, number>
  skuColor: Record<string, typeof BAR_COLORS[0]>
  nameMap: Record<string, string>
  groupMap?: Record<string, string>
  carcassThroughputByGroup?: Record<string, number>
  lineBreaks?: LineBreak[]
  pigLots?: PigLot[]
  masYieldRows?: MasYieldRow[]
  carcassRate?: number
}

function SkuScheduleView({ items, phaseStart, phaseEnd, bagMap, skuColor, nameMap, groupMap, carcassThroughputByGroup, lineBreaks = [], pigLots = [], masYieldRows = [], carcassRate = 90 }: SkuScheduleViewProps) {
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

  const [barPopup, setBarPopup] = useState<BarPopup>(null)

  const allSkus = Array.from(new Set(items.map(a => a.sku)))

  const phaseStartMins = phaseStart * 60

  const taskDurMins = (_task: Assignment) => 0

  const byWorker: Record<string, Assignment[]> = {}
  for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }

  type SkuStat = { name: string | null; totalQty: number; qtyByPeriod: Record<string, number>; minStart: number; maxEnd: number; workers: string[], segments: { start: number; end: number; worker: string; isDeficit: boolean }[], minSeq: number; isRaw: boolean }
  const skuStats: Record<string, SkuStat> = {}

  const periodOrder: Record<string, number> = { 'เช้า': 1, 'บ่าย': 2, 'ค่ำ': 3 }

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
      const isConcurrent = String(task.note ?? '').includes('concurrent')
      let startMin = cur
      if (task.deadline_time) {
        const [dh, dm] = task.deadline_time.split(':').map(Number)
        if (!isNaN(dh) && !isNaN(dm)) {
          const dl = dh * 60 + dm
          startMin = isConcurrent ? dl : Math.max(startMin, dl)
        }
      }
      const endMin = wallClockFinish(startMin, dur)
      cur = Math.max(cur, endMin)
      if (!skuStats[task.sku]) {
        skuStats[task.sku] = { name: task.sku_name, totalQty: 0, qtyByPeriod: {}, minStart: startMin, maxEnd: endMin, workers: [], segments: [], minSeq: task.seq ?? 999999, isRaw: task.unit === 'RAW' }
      }
      const s = skuStats[task.sku]
      s.totalQty += Number(task.target_quantity)
      s.qtyByPeriod[task.period] = (s.qtyByPeriod[task.period] ?? 0) + Number(task.target_quantity)
      s.minStart = Math.min(s.minStart, startMin)
      s.maxEnd   = Math.max(s.maxEnd, endMin)
      s.minSeq   = Math.min(s.minSeq, task.seq ?? 999999)
      if (task.unit === 'RAW') s.isRaw = true
      if (!s.workers.includes(task.worker_name)) s.workers.push(task.worker_name)
    }

    const sortedRaw = [...rawTasks].sort((a, b) => {
      const pA = periodOrder[a.period] ?? 99, pB = periodOrder[b.period] ?? 99
      if (pA !== pB) return pA - pB
      const tA = a.deadline_time || '', tB = b.deadline_time || ''
      if (tA !== tB) return tA.localeCompare(tB)
      return (a.seq ?? 999999) - (b.seq ?? 999999)
    })
    let curRaw = 0, lastPeriodRaw = ''
    for (const task of sortedRaw) {
      if (task.period !== lastPeriodRaw) {
        curRaw = Math.max(curRaw, getPhaseStart(task.period))
        lastPeriodRaw = task.period
      }
      const dur = taskDurMins(task)
      const isConcurrentRaw = String(task.note ?? '').includes('concurrent')
      let startMin = curRaw
      if (task.deadline_time) {
        const [dh, dm] = task.deadline_time.split(':').map(Number)
        if (!isNaN(dh) && !isNaN(dm)) {
          const dl = dh * 60 + dm
          startMin = isConcurrentRaw ? dl : Math.max(startMin, dl)
        }
      }
      const endMin = wallClockFinish(startMin, dur)
      curRaw = Math.max(curRaw, endMin)
      if (skuStats[task.sku]) {
        skuStats[task.sku].segments.push({ start: startMin, end: endMin, worker: task.worker_name, isDeficit: !!task.note?.includes('|deficit') })
      }
    }
  }

  const getGrp = (sku: string) => groupMap?.[sku] ?? groupMap?.[sku.replace(/^0+/, '')] ?? ''

  const sortedSkus = allSkus
    .filter(sku => skuStats[sku])
    .sort((a, b) => {
      const seqA = skuStats[a].minSeq, seqB = skuStats[b].minSeq
      if (seqA !== seqB) return seqA - seqB
      const grpA = getGrp(a), grpB = getGrp(b)
      if (grpA !== grpB) return grpA.localeCompare(grpB, 'th')
      const startA = skuStats[a].minStart, startB = skuStats[b].minStart
      if (startA !== startB) return startA - startB
      const endA = skuStats[a].maxEnd, endB = skuStats[b].maxEnd
      if (endA !== endB) return endA - endB
      return skuStats[b].totalQty - skuStats[a].totalQty
    })

  // Build group -> SKUs list, then keep groups in their first planned sequence.
  const skuGroups: { grp: string; skus: string[]; totalQty: number; minSeq: number }[] = []
  for (const sku of sortedSkus) {
    const grp = getGrp(sku)
    const existing = skuGroups.find(g => g.grp === grp)
    if (!existing) skuGroups.push({ grp, skus: [sku], totalQty: skuStats[sku].totalQty, minSeq: skuStats[sku].minSeq })
    else {
      existing.skus.push(sku)
      existing.totalQty += skuStats[sku].totalQty
      existing.minSeq = Math.min(existing.minSeq, skuStats[sku].minSeq)
    }
  }
  skuGroups.sort((a, b) => a.minSeq - b.minSeq)

  const usesApproachB = pigLots.some(l => Number(l.qty) > 0) && masYieldRows.length > 0 && carcassRate > 0

  // Approach B: pig-based cumulative yield — segments split around breaklines
  if (usesApproachB) {
    const CARCASS_START = 510 // 08:30
    const sLots = [...pigLots].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const uWts  = Array.from(new Set(masYieldRows.map(r => r.carcass_weight))).sort((a, b) => a - b)
    const totalPigsGantt = sLots.reduce((s, l) => s + l.qty, 0)

    // Sorted breaklines from lineBreaks prop
    const sortedBL = lineBreaks
      .map(lb => ({ start: timeToMins(lb.start_time), end: timeToMins(lb.end_time) }))
      .filter(b => b.end > b.start)
      .sort((a, b) => a.start - b.start)

    // All pauses: static BREAKS + breaklines, sorted
    const allPauses = [
      ...BREAKS.map(([bs, be]) => ({ start: bs, end: be })),
      ...sortedBL,
    ].sort((a, b) => a.start - b.start)

    // Active minutes from CARCASS_START to T, excluding all pauses
    const activeMinsAll = (T: number): number => {
      let net = Math.max(0, T - CARCASS_START)
      for (const { start, end } of allPauses) {
        const oS = Math.max(start, CARCASS_START), oE = Math.min(end, T)
        if (oE > oS) net -= oE - oS
      }
      return Math.max(0, net)
    }

    // Pig index → wall-clock time (skips all pauses including breaklines)
    const pigToWC = (pigIdx: number): number => {
      let pos = CARCASS_START, rem = (pigIdx * carcassRate) / 60
      for (const { start, end } of allPauses) {
        if (pos >= end) continue
        const active = Math.max(0, start - pos)
        if (rem <= active) return pos + rem
        rem -= active
        pos = end
      }
      return pos + rem
    }

    // Pigs processed up to wall-clock T (accounts for all pauses)
    const pigsAt = (T: number): number => activeMinsAll(T) * 60 / carcassRate

    // Cumulative yield for a group up to pig index P
    const yieldUpToPig = (P: number, group: string): number => {
      let consumed = 0, total = 0
      for (const lot of sLots) {
        const pigs = Math.min(lot.qty, Math.max(0, P - consumed))
        if (pigs <= 0) break
        const closestW = uWts.length
          ? uWts.reduce((b, w) => Math.abs(w - lot.avg_weight) < Math.abs(b - lot.avg_weight) ? w : b, uWts[0])
          : 0
        const yRow = masYieldRows.find(r => r.carcass_weight === closestW && r.product_group === group)
        total += pigs * (yRow ? (yRow.yield_pct / 100) * lot.avg_weight : 0)
        consumed += lot.qty
      }
      return total
    }

    // Find pig index where cumulative yield for group reaches targetKg (binary search)
    const pigForYield = (targetKg: number, group: string): number => {
      if (targetKg <= 0) return 0
      let lo = 0, hi = totalPigsGantt
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2
        if (yieldUpToPig(mid, group) < targetKg) lo = mid
        else hi = mid
      }
      return hi
    }

    const pigOffset   = pigsAt(phaseStartMins)
    const phaseEndWall = phaseEnd * 60

    for (const grp of skuGroups) {
      const group = grp.grp
      const prePhaseYield = yieldUpToPig(pigOffset, group)
      const bySeq = [...grp.skus].sort((a, b) => (skuStats[a].minSeq ?? 999999) - (skuStats[b].minSeq ?? 999999))
      let accKg = 0

      for (const sku of bySeq) {
        if (skuStats[sku]?.isRaw) continue  // RAW SKUs get timing from remainder section below
        const skuQty   = skuStats[sku].totalQty
        const startPig = pigForYield(prePhaseYield + accKg, group)
        const endPig   = pigForYield(prePhaseYield + accKg + skuQty, group)

        // Build segments, splitting bar at each breakline that interrupts production
        const segs: { start: number; end: number }[] = []
        let curPig  = startPig
        let curTime = Math.max(phaseStartMins, pigToWC(startPig))

        while (curPig < endPig - 0.001 && curTime < phaseEndWall) {
          // Skip if inside any pause (static or breakline)
          const inPause = allPauses.find(p => p.start <= curTime && p.end > curTime)
          if (inPause) { curTime = Math.min(inPause.end, phaseEndWall); curPig = pigsAt(curTime); continue }

          // Next breakline after curTime (static breaks already skipped by pigToWC)
          const nextBL = sortedBL.find(b => b.start > curTime)
          const windowEnd = nextBL ? Math.min(nextBL.start, phaseEndWall) : phaseEndWall
          const pigAtWindow = pigsAt(windowEnd)

          if (pigAtWindow >= endPig) {
            // SKU finishes before the next breakline
            const segEnd = Math.min(pigToWC(endPig), phaseEndWall)
            if (segEnd > curTime) segs.push({ start: curTime, end: segEnd })
            curPig = endPig
            break
          } else {
            // Breakline interrupts production — close segment at break start
            if (windowEnd > curTime) segs.push({ start: curTime, end: windowEnd })
            if (nextBL) { curTime = nextBL.end; curPig = pigsAt(nextBL.end) }
            else break
          }
        }

        if (!segs.length) {
          const st = Math.max(phaseStartMins, pigToWC(startPig))
          segs.push({ start: st, end: Math.max(st, Math.min(phaseEndWall, pigToWC(endPig))) })
        }

        skuStats[sku].minStart = segs[0].start
        skuStats[sku].maxEnd   = segs[segs.length - 1].end
        skuStats[sku].segments = skuStats[sku].workers.flatMap(w =>
          segs.map(s => ({ start: s.start, end: s.end, worker: w, isDeficit: false }))
        )
        accKg += skuQty
      }

      // After all orders: remaining carcass capacity for this phase
      if (group) {
        const totalGroupPhaseYield = yieldUpToPig(totalPigsGantt, group) - prePhaseYield
        const remainYield = Math.round(totalGroupPhaseYield - accKg)
        if (remainYield > 0) {
          const rawStartPig = pigForYield(prePhaseYield + accKg, group)
          const rawStartT = Math.max(phaseStartMins, pigToWC(rawStartPig))
          const rawEndT   = Math.min(phaseEndWall, pigToWC(totalPigsGantt))
          if (rawEndT > rawStartT) {
            // Build segments splitting around breaklines
            const remSegs: { start: number; end: number }[] = []
            let remPig = rawStartPig, remTime = rawStartT
            while (remPig < totalPigsGantt - 0.001 && remTime < phaseEndWall) {
              const inPause = allPauses.find(p => p.start <= remTime && p.end > remTime)
              if (inPause) { remTime = Math.min(inPause.end, phaseEndWall); remPig = pigsAt(remTime); continue }
              const nextBL = sortedBL.find(b => b.start > remTime)
              const windowEnd = nextBL ? Math.min(nextBL.start, phaseEndWall) : phaseEndWall
              if (pigsAt(windowEnd) >= totalPigsGantt) {
                const segEnd = Math.min(pigToWC(totalPigsGantt), phaseEndWall)
                if (segEnd > remTime) remSegs.push({ start: remTime, end: segEnd })
                break
              } else {
                if (windowEnd > remTime) remSegs.push({ start: remTime, end: windowEnd })
                if (nextBL) { remTime = nextBL.end; remPig = pigsAt(nextBL.end) } else break
              }
            }
            if (!remSegs.length) remSegs.push({ start: rawStartT, end: rawEndT })

            const rawSkuKey = bySeq.find(s => skuStats[s]?.isRaw)
            if (rawSkuKey) {
              skuStats[rawSkuKey].totalQty = remainYield
              skuStats[rawSkuKey].minStart = remSegs[0].start
              skuStats[rawSkuKey].maxEnd   = remSegs[remSegs.length - 1].end
              skuStats[rawSkuKey].workers  = []
              skuStats[rawSkuKey].segments = remSegs.map(s => ({ start: s.start, end: s.end, worker: '__raw__', isDeficit: false }))
            } else {
              // Extend last real SKU's bar
              const lastSku = bySeq[bySeq.length - 1]
              if (lastSku && skuStats[lastSku]) {
                skuStats[lastSku].totalQty += remainYield
                skuStats[lastSku].maxEnd    = remSegs[remSegs.length - 1].end
                skuStats[lastSku].segments  = [
                  ...skuStats[lastSku].segments,
                  ...skuStats[lastSku].workers.flatMap(w =>
                    remSegs.map(s => ({ start: s.start, end: s.end, worker: w, isDeficit: false }))
                  ),
                ]
              }
            }
          }
        }
      }
      grp.skus = bySeq
    }
  } else if ((carcassThroughputByGroup && Object.keys(carcassThroughputByGroup).length > 0) || skuGroups.some(grp => grp.skus.some(sku => skuStats[sku]?.isRaw))) {
    const phaseEndWallSeq = phaseEnd * 60
    let phaseNetMinsSeq = phaseEndWallSeq - phaseStartMins
    for (const [bs, be] of BREAKS) {
      phaseNetMinsSeq -= Math.max(0, Math.min(be, phaseEndWallSeq) - Math.max(bs, phaseStartMins))
    }

    for (const grp of skuGroups) {
      const hasRawRemainder = grp.skus.some(sku => skuStats[sku]?.isRaw)
      const yieldThroughputFromPlan = hasRawRemainder && grp.totalQty > 0 && phaseNetMinsSeq > 0
        ? grp.totalQty / phaseNetMinsSeq
        : 0
      const throughput = (carcassThroughputByGroup?.[grp.grp] ?? 0) || yieldThroughputFromPlan
      if (throughput <= 0) continue
      let cursor = phaseStartMins
      const bySeq = [...grp.skus].sort((a, b) => (skuStats[a].minSeq ?? 999999) - (skuStats[b].minSeq ?? 999999))
      for (const sku of bySeq) {
        if (cursor >= phaseEndWallSeq) {
          skuStats[sku].minStart = phaseEndWallSeq
          skuStats[sku].maxEnd   = phaseEndWallSeq
          skuStats[sku].segments = []
          skuStats[sku].totalQty = 0
          continue
        }
        const durMins = Math.round(skuStats[sku].totalQty / throughput)
        const rawEnd  = wallClockFinish(cursor, durMins)
        const endMins = Math.min(rawEnd, phaseEndWallSeq)
        if (rawEnd > phaseEndWallSeq) {
          let netMins = endMins - cursor
          for (const [bs, be] of BREAKS) netMins -= Math.max(0, Math.min(be, endMins) - Math.max(bs, cursor))
          skuStats[sku].totalQty = Math.round(throughput * Math.max(0, netMins))
        }
        skuStats[sku].minStart = cursor
        skuStats[sku].maxEnd   = endMins
        skuStats[sku].segments = skuStats[sku].workers.map(w => ({ start: cursor, end: endMins, worker: w, isDeficit: false }))
        cursor = endMins
      }
      grp.skus = bySeq
    }
  }

  if (!sortedSkus.length) return null

  const chartStart = Math.floor(phaseStartMins / 60) * 60
  const chartEnd   = Math.max(phaseEnd * 60, ...sortedSkus.map(s => skuStats[s].maxEnd))
  const totalRange = chartEnd - chartStart

  // Net-work minutes from phaseStart to wallClock (excluding static breaks)
  const wallClockToNetWork = (wallClock: number) => {
    let net = Math.max(0, wallClock - phaseStartMins)
    for (const [bs, be] of BREAKS) {
      const oStart = Math.max(bs, phaseStartMins)
      const oEnd   = Math.min(be, wallClock)
      if (oEnd > oStart) net -= (oEnd - oStart)
    }
    return Math.max(0, net)
  }

  // Pre-calculate lineBreak impact using lot-by-lot carcass timeline
  const rateMin = carcassRate / 60  // sec/carcass → min/carcass
  const sortedLots = [...pigLots].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const uniqueWeights = Array.from(new Set(masYieldRows.map(r => r.carcass_weight))).sort((a, b) => a - b)

  // Build cumulative net-work-minute boundaries for each lot
  let cumNet = 0
  const lotBounds: { netStart: number; netEnd: number; lot: PigLot }[] = []
  for (const lot of sortedLots) {
    const dur = lot.qty * rateMin
    lotBounds.push({ netStart: cumNet, netEnd: cumNet + dur, lot })
    cumNet += dur
  }

  const lbImpact = lineBreaks.map(lb => {
    const bs  = timeToMins(lb.start_time)
    const be  = timeToMins(lb.end_time)
    const dur = be - bs

    const netBreakStart = wallClockToNetWork(bs)
    const netBreakEnd   = wallClockToNetWork(be)

    const groupLossKg: Record<string, number> = {}
    let totalLostCarcasses = 0

    for (const { netStart, netEnd, lot } of lotBounds) {
      const overlapStart = Math.max(netStart, netBreakStart)
      const overlapEnd   = Math.min(netEnd, netBreakEnd)
      if (overlapEnd <= overlapStart) continue
      const lostQty = (overlapEnd - overlapStart) / rateMin
      totalLostCarcasses += lostQty
      if (!uniqueWeights.length) continue
      const closestW = uniqueWeights.reduce((best, ww) =>
        Math.abs(ww - lot.avg_weight) < Math.abs(best - lot.avg_weight) ? ww : best,
        uniqueWeights[0]
      )
      for (const row of masYieldRows.filter(r => r.carcass_weight === closestW)) {
        groupLossKg[row.product_group] = (groupLossKg[row.product_group] ?? 0)
          + lostQty * lot.avg_weight * (row.yield_pct / 100)
      }
    }

    const groupLoss: { grp: string; kg: number }[] = Object.entries(groupLossKg)
      .map(([grp, kg]) => ({ grp, kg: Math.round(kg) }))
      .filter(e => e.kg > 0)
      .sort((a, b) => b.kg - a.kg)

    return { lb, dur, lostCarcasses: Math.round(totalLostCarcasses), groupLoss }
  })

  // Breakline loss: distribute proportionally to all real SKUs in the affected group
  const skuLostKgMap = new Map<string, number>()
  for (const { groupLoss } of lbImpact) {
    for (const { grp, kg } of groupLoss) {
      const grpSkus  = sortedSkus.filter(s => getGrp(s) === grp && !skuStats[s].isRaw)
      const grpTotal = grpSkus.reduce((s, s2) => s + skuStats[s2].totalQty, 0)
      if (grpTotal <= 0) continue
      for (const s of grpSkus) {
        const share = skuStats[s].totalQty / grpTotal
        skuLostKgMap.set(s, (skuLostKgMap.get(s) ?? 0) + Math.round(kg * share))
      }
    }
  }

  const ticks: number[] = []
  for (let m = chartStart; m <= chartEnd; m += 60) ticks.push(m)

  const pct = (mins: number) => ((mins - chartStart) / totalRange) * 100

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
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
          {lineBreaks.map((lb, i) => {
            const bs = timeToMins(lb.start_time), be = timeToMins(lb.end_time)
            if (bs >= chartEnd || be <= chartStart) return null
            const l = pct(Math.max(bs, chartStart))
            const w = Math.max(pct(Math.min(be, chartEnd)) - l, 0)
            return (
              <div key={`hdr-lb-${i}`} className="absolute top-0 bottom-0 pointer-events-none z-20"
                style={{ left: `${l}%`, width: `${w}%`, backgroundColor: '#e5e7eb' }} />
            )
          })}
          {nowMins >= chartStart && nowMins <= chartEnd && (
            <div className="absolute top-0 bottom-0 w-px bg-red-400 z-30 pointer-events-none" style={{ left: `${pct(nowMins)}%` }} />
          )}
        </div>
        <div className="w-24 sm:w-32 shrink-0 border-l border-gray-100" />
      </div>

      <div className="divide-y divide-gray-50 relative">
        {skuGroups.map(({ grp, skus }) => {
          const visibleSkus = skus.filter(sku => !sku.startsWith('__raw__'))
          if (!visibleSkus.length) return null
          return (
          <div key={grp || '__other__'}>
            {grp && (
              <div className="flex items-center border-y border-gray-200 bg-gray-100/80 sticky top-8 sm:top-10 z-10">
                <div className="w-28 sm:w-44 shrink-0 px-2 sm:px-4 py-1 border-r border-gray-200">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{grp}</span>
                </div>
                <div className="flex-1" />
                <div className="w-24 sm:w-32 shrink-0" />
              </div>
            )}
            {visibleSkus.map(sku => {
              const stat      = skuStats[sku]
              const col       = skuStats[sku]?.isRaw ? GOLD_COLOR : (skuColor[sku] ?? GOLD_COLOR)
              const diffSecs  = Math.round(stat.maxEnd * 60 - nowSecs)
              const isDone    = diffSecs <= 0
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
                  <div className="w-28 sm:w-44 shrink-0 px-2 sm:px-4 py-1.5 sm:py-2 border-r border-gray-100 bg-white">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-sm shrink-0" style={{ backgroundColor: col.bg }} />
                      <div className="min-w-0">
                        <p className="text-[11px] sm:text-xs font-semibold text-gray-800 leading-tight line-clamp-2">{stat.name ?? sku}</p>
                        <p className="text-xs sm:text-sm font-bold mt-0.5" style={{ color: col.bg }}>
                          {stat.isRaw ? (() => {
                            const wpb = bagMap[sku] ?? bagMap[sku.replace(/^0+/, '')]
                            const baskets = wpb && wpb > 0 ? Math.ceil(stat.totalQty / wpb) : null
                            return (
                              <>
                                {baskets != null && <>{baskets.toLocaleString()} ตะกร้า · </>}
                                {stat.totalQty.toLocaleString()} กก.
                                <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">RAW</span>
                              </>
                            )
                          })() : (() => {
                            // Approach B: production is shifted (not reduced) so show full planned qty
                            const lostKg = usesApproachB ? 0 : (skuLostKgMap.get(sku) ?? 0)
                            const effectiveQty = Math.max(0, stat.totalQty - lostKg)
                            const wpb = bagMap[sku] ?? bagMap[sku.replace(/^0+/, '')]
                            const bags = wpb && wpb > 0 ? Math.floor(effectiveQty / wpb) : 0
                            const displayQty = wpb && wpb > 0 ? bags * wpb : effectiveQty
                            const bagsLabel = bags > 0 ? `${bags} ถุง · ` : ''
                            return (
                              <>
                                {bagsLabel}{displayQty.toLocaleString()} กก.
                              </>
                            )
                          })()}
                          <span className="text-[9px] sm:text-[10px] font-normal text-gray-400 ml-1">· {stat.workers.length} คน</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 relative h-10 sm:h-14">
                    {mergeSegmentsWithWorkers(stat.segments.filter(s => !s.isDeficit)).map((seg, idx) => {
                      const barLeft  = Math.max(pct(seg.start), 0)
                      const barWidth = Math.max(pct(seg.end) - pct(seg.start), 0.5)
                      const segDone  = nowMins >= seg.end
                      const segPend  = nowMins < seg.start
                      return (
                        <div key={`s-${idx}`} className="absolute top-2 bottom-2 sm:top-2.5 sm:bottom-2.5 rounded-sm cursor-pointer"
                          style={{ left: `${barLeft}%`, width: `${barWidth}%`, backgroundColor: col.bg,
                            opacity: segDone ? 0.45 : segPend ? 0.35 : 1 }}
                          onClick={e => { e.stopPropagation(); setBarPopup({ name: stat.name ?? sku, start: seg.start, end: seg.end, workers: seg.workers, color: col.bg }) }} />
                      )
                    })}
                    {mergeSegmentsWithWorkers(stat.segments.filter(s => s.isDeficit)).map((seg, idx) => {
                      const barLeft  = Math.max(pct(seg.start), 0)
                      const barWidth = Math.max(pct(seg.end) - pct(seg.start), 0.5)
                      const segDone  = nowMins >= seg.end
                      const segPend  = nowMins < seg.start
                      const alpha    = segDone ? 0.45 : segPend ? 0.35 : 1
                      return (
                        <div key={`d-${idx}`} className="absolute top-2 bottom-2 sm:top-2.5 sm:bottom-2.5 rounded-sm cursor-pointer"
                          style={{ left: `${barLeft}%`, width: `${barWidth}%`, opacity: alpha, background: col.bg, border: '2px solid #ef4444' }}
                          onClick={e => { e.stopPropagation(); setBarPopup({ name: stat.name ?? sku, start: seg.start, end: seg.end, workers: seg.workers, color: col.bg }) }} />
                      )
                    })}
                  </div>

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
          </div>
          )
        })}

        {BREAKS.flatMap(([bs, be]) => {
          if (bs >= chartEnd || be <= chartStart) return []
          const l = pct(Math.max(bs, chartStart)) / 100
          const w = Math.max(pct(Math.min(be, chartEnd)) - pct(Math.max(bs, chartStart)), 0) / 100
          return [
            <div key={`${bs}-m`} className="sm:hidden absolute top-0 bottom-0 pointer-events-none z-20"
              style={{ left: `calc(7rem + (100% - 13rem) * ${l})`, width: `calc((100% - 13rem) * ${w})`,
                backgroundColor: '#e5e7eb', borderLeft: '1px dashed #9ca3af', borderRight: '1px dashed #9ca3af' }} />,
            <div key={`${bs}-d`} className="hidden sm:block absolute top-0 bottom-0 pointer-events-none z-20"
              style={{ left: `calc(11rem + (100% - 19rem) * ${l})`, width: `calc((100% - 19rem) * ${w})`,
                backgroundColor: '#e5e7eb', borderLeft: '1px dashed #9ca3af', borderRight: '1px dashed #9ca3af' }} />,
          ]
        })}

        {lbImpact.flatMap(({ lb }, i) => {
          const bs = timeToMins(lb.start_time)
          const be = timeToMins(lb.end_time)
          if (bs >= chartEnd || be <= chartStart) return []
          const l = pct(Math.max(bs, chartStart)) / 100
          const w = Math.max(pct(Math.min(be, chartEnd)) - pct(Math.max(bs, chartStart)), 0) / 100
          const lm = `calc(7rem + (100% - 13rem) * ${l})`
          const wm = `calc((100% - 13rem) * ${w})`
          const ld = `calc(11rem + (100% - 19rem) * ${l})`
          const wd = `calc((100% - 19rem) * ${w})`
          return [
            <div key={`lb-${i}-m`} className="sm:hidden absolute top-0 bottom-0 z-30 pointer-events-none"
              style={{ left: lm, width: wm, backgroundColor: '#e5e7eb', borderLeft: '1px dashed #9ca3af', borderRight: '1px dashed #9ca3af' }} />,
            <div key={`lb-${i}-d`} className="hidden sm:block absolute top-0 bottom-0 z-30 pointer-events-none"
              style={{ left: ld, width: wd, backgroundColor: '#e5e7eb', borderLeft: '1px dashed #9ca3af', borderRight: '1px dashed #9ca3af' }} />,
          ]
        })}

        {nowMins >= chartStart && nowMins <= chartEnd && <>
          <div className="sm:hidden absolute top-0 bottom-0 w-px bg-red-400 pointer-events-none z-30"
            style={{ left: `calc(7rem + (100% - 13rem) * ${pct(nowMins) / 100})` }} />
          <div className="hidden sm:block absolute top-0 bottom-0 w-px bg-red-400 pointer-events-none z-30"
            style={{ left: `calc(11rem + (100% - 19rem) * ${pct(nowMins) / 100})` }} />
        </>}
      </div>

      {barPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setBarPopup(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-5 w-72 max-w-[90vw]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: barPopup.color }} />
              <p className="text-sm font-bold text-gray-900 leading-tight flex-1">{barPopup.name}</p>
              <button onClick={() => setBarPopup(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1">×</button>
            </div>
            <div className="border-t border-gray-100 mb-3" />
            <div className="flex flex-col gap-2 mb-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">เริ่ม</span>
                <span className="text-sm font-bold text-gray-900">{minsToLabel(barPopup.start)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">เสร็จ</span>
                <span className="text-sm font-bold text-gray-900">{minsToLabel(barPopup.end)}</span>
              </div>
            </div>
            <div className="border-t border-gray-100 mb-3" />
            <p className="text-xs font-semibold text-gray-500 mb-2">พนักงาน {barPopup.workers.length} คน</p>
            <div className="flex flex-col gap-1.5">
              {barPopup.workers.map(w => (
                <div key={w} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: barPopup.color }} />
                  <span className="text-sm text-gray-700">{nameMap[w.replace(/\s+/g, ' ').trim()] ?? shortName(w)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Production summary view (สรุปแผนผลิต) ───────────────────────────────────

interface ProductionSummaryViewProps {
  items: Assignment[]
  phaseStart: number
  bagMap: Record<string, number>
  date: string
  tableName: string
  groupMap?: Record<string, string>
  productTypeMap?: Record<string, string>
  carcassThroughputByGroup?: Record<string, number>
  phaseNetMins?: number
}

type ActualEntry = { id: string; quantity: number; created_at: string | null; updated_at: string | null }

function ProductionSummaryView({ items, phaseStart, bagMap, date, tableName, groupMap, productTypeMap, carcassThroughputByGroup, phaseNetMins = 300 }: ProductionSummaryViewProps) {
  const [inputVals, setInputVals]   = useState<Record<string, string>>({})
  const [history, setHistory]       = useState<Record<string, ActualEntry[]>>({})
  const [popupSku, setPopupSku]     = useState<string | null>(null)
  const [editMode, setEditMode]     = useState(false)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [yieldMap,       setYieldMap]       = useState<Record<string, number>>({})
  const [yieldWeightMap, setYieldWeightMap] = useState<Record<string, number|null>>({})

  const fetchActual = useCallback(async () => {
    const { data, error } = await supabase
      .from('production_actual')
      .select('id, sku, quantity, created_at, updated_at')
      .eq('production_date', date)
      .eq('table_name', tableName)
      .order('created_at')
    if (error) return
    const grouped: Record<string, ActualEntry[]> = {}
    for (const row of (data ?? [])) {
      grouped[row.sku] ??= []
      grouped[row.sku].push({ id: row.id, quantity: row.quantity, created_at: row.created_at ?? null, updated_at: row.updated_at ?? null })
    }
    setHistory(grouped)
  }, [date, tableName])

  const fetchYield = useCallback(async () => {
    try {
      const res  = await fetch(`/api/yield-actual?date=${date}`)
      const data = await res.json()
      setYieldMap(data.yieldMap ?? {})
      setYieldWeightMap(data.yieldWeightMap ?? {})
    } catch { /* silent */ }
  }, [date])

  useEffect(() => {
    fetchActual()
    fetchYield()
    const poll = setInterval(() => { fetchActual(); fetchYield() }, 3000)

    type Row = { id: string; sku: string; quantity: number; table_name: string; production_date: string; created_at?: string; updated_at?: string }

    const channel = supabase
      .channel(`production_actual:${date}:${tableName}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: supabaseSchema, table: 'production_actual' },
        (payload) => {
          const row = payload.new as Row
          if (row.production_date !== date || row.table_name !== tableName) return
          setHistory(prev => {
            const entries = prev[row.sku] ?? []
            if (entries.some(e => e.id === row.id)) return prev
            const entry: ActualEntry = { id: row.id, quantity: row.quantity, created_at: row.created_at ?? null, updated_at: row.updated_at ?? null }
            const tempIdx = entries.findIndex(e => e.id.startsWith('temp_'))
            if (tempIdx >= 0) {
              const next = [...entries]
              next[tempIdx] = entry
              return { ...prev, [row.sku]: next }
            }
            return { ...prev, [row.sku]: [...entries, entry] }
          })
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: supabaseSchema, table: 'production_actual' },
        (payload) => {
          const row = payload.new as Row
          if (row.production_date !== date || row.table_name !== tableName) return
          setHistory(prev => {
            for (const [sku, entries] of Object.entries(prev)) {
              const idx = entries.findIndex(e => e.id === row.id)
              if (idx >= 0) {
                const next = [...entries]
                next[idx] = { id: row.id, quantity: row.quantity, created_at: row.created_at ?? null, updated_at: row.updated_at ?? null }
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

  const byWorker: Record<string, Assignment[]> = {}
  for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }

  type SkuStat = { name: string | null; totalQty: number; qtyByPeriod: Record<string, number>, minStart: number, minSeq: number, isRaw: boolean }
  const skuStats: Record<string, SkuStat> = {}

  for (const rawTasks of Object.values(byWorker)) {
    const tasks = mergeTasks(rawTasks)
    let cur = phaseStartMins
    for (const task of tasks) {
      let startMin = cur
      if (task.deadline_time) {
        const [dh, dm] = task.deadline_time.split(':').map(Number)
        if (!isNaN(dh) && !isNaN(dm)) {
          startMin = Math.max(startMin, dh * 60 + dm)
        }
      }
      cur = startMin
      if (!skuStats[task.sku]) skuStats[task.sku] = { name: task.sku_name, totalQty: 0, qtyByPeriod: {}, minStart: startMin, minSeq: task.seq ?? 999999, isRaw: task.unit === 'RAW' }
      skuStats[task.sku].totalQty += Number(task.target_quantity)
      skuStats[task.sku].qtyByPeriod[task.period] = (skuStats[task.sku].qtyByPeriod[task.period] ?? 0) + Number(task.target_quantity)
      skuStats[task.sku].minStart = Math.min(skuStats[task.sku].minStart, startMin)
      skuStats[task.sku].minSeq = Math.min(skuStats[task.sku].minSeq, task.seq ?? 999999)
      if (task.unit === 'RAW') skuStats[task.sku].isRaw = true
    }
  }

  const getSummaryGrp = (sku: string) => groupMap?.[sku] ?? groupMap?.[sku.replace(/^0+/, '')] ?? ''

  const sortedSkus = allSkus.filter(sku => skuStats[sku]).sort((a, b) => {
    if (skuStats[a].minSeq !== skuStats[b].minSeq) return skuStats[a].minSeq - skuStats[b].minSeq
    const grpA = getSummaryGrp(a), grpB = getSummaryGrp(b)
    if (grpA !== grpB) return grpA.localeCompare(grpB, 'th')
    if (skuStats[a].minStart !== skuStats[b].minStart) return skuStats[a].minStart - skuStats[b].minStart
    return skuStats[b].totalQty - skuStats[a].totalQty
  })

  // Build groups in their first planned sequence.
  const summaryGroups: { grp: string; skus: string[]; totalQty: number; minSeq: number }[] = []
  for (const sku of sortedSkus) {
    const grp = getSummaryGrp(sku)
    const existing = summaryGroups.find(g => g.grp === grp)
    if (!existing) summaryGroups.push({ grp, skus: [sku], totalQty: skuStats[sku].totalQty, minSeq: skuStats[sku].minSeq })
    else {
      existing.skus.push(sku)
      existing.totalQty += skuStats[sku].totalQty
      existing.minSeq = Math.min(existing.minSeq, skuStats[sku].minSeq)
    }
  }
  summaryGroups.sort((a, b) => a.minSeq - b.minSeq)

  if (!sortedSkus.length) return null

  // Carcass-based yield calculation (Approach B — display only)
  const hasCarcass = carcassThroughputByGroup && Object.keys(carcassThroughputByGroup).length > 0
  // group total qty (non-RAW) used as distribution weights for SKUs within each group
  const grpTotalQty: Record<string, number> = {}
  for (const sku of sortedSkus) {
    if (skuStats[sku].isRaw) continue
    const grp = getSummaryGrp(sku)
    if (grp) grpTotalQty[grp] = (grpTotalQty[grp] ?? 0) + skuStats[sku].totalQty
  }
  // Expected bags from pig carcasses for a given SKU
  const carcassBagsForSku = (sku: string): number | null => {
    if (!hasCarcass || skuStats[sku].isRaw) return null
    const grp = getSummaryGrp(sku)
    if (!grp || !carcassThroughputByGroup![grp] || !grpTotalQty[grp]) return null
    const wpb = bagMap[sku] ?? bagMap[sku.replace(/^0+/, '')]
    if (!wpb || wpb <= 0) return null
    const groupKg  = carcassThroughputByGroup![grp] * phaseNetMins
    const fraction = skuStats[sku].totalQty / grpTotalQty[grp]
    return Math.round((groupKg * fraction) / wpb)
  }
  // Group-level summary for the header card
  const carcassGroupSummary = hasCarcass
    ? Object.entries(carcassThroughputByGroup!).map(([grp, rate]) => ({ grp, kg: Math.round(rate * phaseNetMins) })).filter(e => e.kg > 0)
    : []

  const skuTotal    = (sku: string) => (history[sku] ?? []).reduce((s, e) => s + e.quantity, 0)
  const totalBags   = sortedSkus.reduce((s, sku) => s + skuStats[sku].totalQty, 0)
  const totalProduced = sortedSkus.reduce((s, sku) => s + skuTotal(sku), 0)

  const confirm = async (sku: string, rawValue: string) => {
    const val = parseInt(rawValue.replace(/[^0-9]/g, ''), 10)
    if (isNaN(val) || val <= 0) return
    const tempId = `temp_${Date.now()}`
    setHistory(prev => ({ ...prev, [sku]: [{ id: tempId, quantity: val, created_at: new Date().toISOString(), updated_at: null }] }))
    setInputVals(prev => ({ ...prev, [sku]: '' }))
    await supabase.from('production_actual').delete().eq('production_date', date).eq('table_name', tableName).eq('sku', sku)
    await supabase.from('production_actual').insert({ production_date: date, table_name: tableName, sku, quantity: val })
    fetchActual()
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
      <div className="grid grid-cols-[minmax(0,1fr)_54px_54px_54px_80px] sm:grid-cols-[minmax(0,1fr)_80px_80px_80px_110px] gap-0 px-3 sm:px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500">ชื่อ SKU</span>
        <span className="text-[10px] sm:text-xs font-semibold text-gray-500 text-right leading-tight">แผน<br className="sm:hidden" />(กก.)</span>
        <span className="text-[10px] sm:text-xs font-semibold text-gray-500 text-right leading-tight">ผลิต<br className="sm:hidden" />(กก.)</span>
        <span className="text-[10px] sm:text-xs font-semibold text-gray-500 text-right leading-tight">รับผล<br className="sm:hidden" />ได้(กก.)</span>
        <span className="text-[10px] sm:text-xs font-semibold text-gray-500 text-right leading-tight">ผลิต<br className="sm:hidden" />ได้(กก.)</span>
      </div>

      <div className="divide-y divide-gray-50">
        {(() => {
          const nonRawSkus = summaryGroups.flatMap(g => g.skus.filter(sku => !skuStats[sku].isRaw))
          const rawSkus    = summaryGroups.flatMap(g => g.skus.filter(sku => skuStats[sku].isRaw))
          const flatSkus   = [...nonRawSkus, ...rawSkus]
          const rawStartIdx = nonRawSkus.length
          return flatSkus.map((sku, globalIdx) => {
            const stat      = skuStats[sku]
            const wpb       = bagMap[sku] ?? bagMap[sku.replace(/^0+/, '')]
            const total     = skuTotal(sku)
            const hasData   = total > 0
            const yieldBags   = yieldMap[sku]       ?? yieldMap[sku.replace(/^0+/, '')]       ?? null
            const yieldWeight = yieldWeightMap[sku] ?? yieldWeightMap[sku.replace(/^0+/, '')] ?? null
            const isFirstRaw = globalIdx === rawStartIdx && rawStartIdx > 0

            return (
              <div key={sku}>
                {isFirstRaw && (
                  <div className="px-3 sm:px-4 py-1 bg-amber-50 border-y border-amber-100">
                    <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">RAW</span>
                  </div>
                )}
                <div
                  className={`grid grid-cols-[minmax(0,1fr)_54px_54px_54px_80px] sm:grid-cols-[minmax(0,1fr)_80px_80px_80px_110px] gap-0 px-3 sm:px-4 py-2 items-center ${globalIdx % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'}`}>
                  <div className="flex items-start gap-2 min-w-0 pr-1">
                    <p className="text-[11px] sm:text-sm font-medium text-gray-800 leading-snug break-words overflow-hidden min-w-0" style={{display:'-webkit-box',WebkitBoxOrient:'vertical',WebkitLineClamp:2,overflow:'hidden'}}>
                      {stat.name ?? sku}
                      {stat.isRaw && <span className="ml-1 px-1 rounded text-[9px] font-bold bg-amber-100 text-amber-700">RAW</span>}
                    </p>
                    {!stat.isRaw && wpb && wpb > 0 && stat.totalQty > 0 && (
                      <div className="hidden sm:block flex-1 h-4 relative rounded min-w-[50px]">
                        <div className="absolute inset-0 bg-gray-150 rounded" style={{ backgroundColor: '#e5e7eb' }} />
                        {yieldWeight !== null && yieldWeight > 0 && (
                          <div className="absolute top-0.5 bottom-0.5 left-0 rounded transition-all duration-500"
                            style={{ width: `${Math.min(100, (yieldWeight / stat.totalQty) * 100)}%`, backgroundColor: '#4ade80' }} />
                        )}
                        {hasData && (
                          <div className="absolute top-1 bottom-1 left-0 rounded transition-all duration-500"
                            style={{ width: `${Math.min(100, (total / stat.totalQty) * 100)}%`, backgroundColor: '#3b82f6' }} />
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm font-semibold text-gray-600 text-right">
                    {Math.round(stat.totalQty) > 0 ? Math.round(stat.totalQty).toLocaleString() : '—'}
                  </p>
                  <button
                    onClick={() => { if (hasData) { setPopupSku(sku); setEditMode(false) } }}
                    className={`text-xs sm:text-sm font-bold text-right w-full ${hasData ? 'text-blue-600 underline underline-offset-2 cursor-pointer' : 'text-gray-300 cursor-default'}`}>
                    {hasData ? total.toLocaleString() : '—'}
                  </button>
                  <p className="text-xs sm:text-sm font-semibold text-right text-green-600">
                    {yieldWeight !== null
                      ? Math.round(yieldWeight).toLocaleString()
                      : yieldBags !== null
                        ? (!stat.isRaw && wpb && wpb > 0 ? Math.round(yieldBags * wpb).toLocaleString() : yieldBags.toLocaleString())
                        : '—'}
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
              </div>
            )
          })
        })()}
      </div>

      <div className="grid grid-cols-[1fr_54px_54px_54px_80px] sm:grid-cols-[1fr_80px_80px_80px_110px] gap-0 px-3 sm:px-4 py-3 border-t border-gray-200 bg-gray-50">
        <span className="text-xs sm:text-sm font-bold text-gray-700">รวมทั้งหมด</span>
        <span className="text-xs sm:text-sm font-bold text-right text-gray-900">{totalBags > 0 ? Math.round(totalBags).toLocaleString() : '—'}</span>
        <span className="text-xs sm:text-sm font-bold text-right text-blue-600">{totalProduced > 0 ? totalProduced.toLocaleString() : '—'}</span>
        <span className="text-xs sm:text-sm font-bold text-right text-green-600">
          {(() => {
            const t = sortedSkus.reduce((s, sku) => {
              const w   = yieldWeightMap[sku] ?? yieldWeightMap[sku.replace(/^0+/, '')]
              if (w != null) return s + Math.round(Number(w))
              const y   = yieldMap[sku] ?? yieldMap[sku.replace(/^0+/, '')] ?? 0
              const wpb = bagMap[sku] ?? bagMap[sku.replace(/^0+/, '')]
              if (!skuStats[sku].isRaw && wpb && wpb > 0) return s + Math.round(y * wpb)
              return s + y
            }, 0)
            return t > 0 ? t.toLocaleString() : '—'
          })()}
        </span>
        <span />
      </div>

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
                <h3 className="text-sm font-bold text-gray-800">{skuStats[popupSku]?.name ?? popupSku}</h3>
                <button onClick={() => { setPopupSku(null); setEditMode(false); setEditValues({}) }}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1">×</button>
              </div>
              <p className="text-center text-base font-bold text-blue-600 bg-blue-50 rounded-xl py-2 px-3 mb-4 break-all">
                {formula || '—'}{hist.length > 0 ? ` = ${total}` : ''}
              </p>
              <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
                {hist.map((entry, idx) => {
                  const timeLabel = entry.created_at
                    ? new Date(entry.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false })
                    : null
                  return (
                    <div key={entry.id} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">ครั้งที่ {idx + 1}</span>
                        {timeLabel && <span className="text-[10px] text-gray-300">{timeLabel}</span>}
                      </div>
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
                  )
                })}
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
  nameMap: Record<string, string>
  bagMap: Record<string, number>
  skuColor: Record<string, typeof BAR_COLORS[0]>
}

function WorkerCardView({ items, phaseStart, nameMap, bagMap, skuColor }: WorkerCardViewProps) {
  const [nowMins, setNowMins] = useState(() => {
    const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
  })
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date(); setNowMins(d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60)
    }, 5000)
    return () => clearInterval(id)
  }, [])

  const byWorker: Record<string, Assignment[]> = {}
  for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }
  const workers = Object.keys(byWorker).sort()
  if (!workers.length) return null

  const phaseStartMins = phaseStart * 60

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {workers.map(name => {
        const tasks       = mergeTasks(byWorker[name])
        const displayName = nameMap[name.replace(/\s+/g, ' ').trim()] ?? shortName(name)
        const workerTotal = tasks.reduce((s, t) => s + roundedDisplayQty(t.sku, Number(t.target_quantity), bagMap), 0)
        const allDone     = tasks.every(t => t.status === 'เสร็จแล้ว')
        const anyActive   = tasks.some(t => t.status === 'กำลังผลิต')

        let curMins = phaseStartMins
        const taskInfo = tasks.map(t => {
          const isConcurrent = String(t.note ?? '').includes('concurrent')
          let startMin = curMins
          if (t.deadline_time) {
            const [dh, dm] = t.deadline_time.split(':').map(Number)
            if (!isNaN(dh) && !isNaN(dm)) {
              const dl = dh * 60 + dm
              startMin = isConcurrent ? dl : Math.max(startMin, dl)
            }
          }
          curMins = Math.max(curMins, startMin)
          return { ...t, startMin, startLabel: minsToLabel(startMin) }
        })

        return (
          <div key={name} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-start justify-between">
              <p className="text-sm font-semibold text-gray-900 leading-tight">{displayName}</p>
              <p className={`text-sm font-bold whitespace-nowrap ml-2 ${allDone ? 'text-green-600' : anyActive ? 'text-amber-600' : 'text-gray-800'}`}>
                {workerTotal.toLocaleString()} กก.
              </p>
            </div>
            <div className="mt-0.5 mb-3">
              <p className="text-xs font-mono text-gray-400">{tasks[0].worker_code}</p>
            </div>
            <div className="flex rounded-full overflow-hidden mb-3" style={{ height: 6 }}>
              {taskInfo.map(t => (
                <div key={t.id} style={{
                  flex: 1,
                  backgroundColor: skuColor[t.sku].bg,
                  opacity: t.status === 'เสร็จแล้ว' ? 0.5 : 1,
                }} />
              ))}
            </div>
            <div className="space-y-1.5">
              {taskInfo.map(t => {
                const col      = skuColor[t.sku]
                const isDone   = t.status === 'เสร็จแล้ว'
                const isDeficit = !!t.note?.includes('|deficit')
                const isRaw    = t.unit === 'RAW'
                return (
                  <div key={t.id} className="flex items-start gap-2 rounded-lg px-3 py-2"
                    style={{ background: isRaw ? '#fef3c720' : col.bg + '20', border: isDeficit ? '1.5px solid #ef4444' : isRaw ? '1.5px solid #f59e0b' : '1.5px solid transparent' }}>
                    <span className="w-2 h-2 rounded-sm shrink-0 mt-1" style={{ backgroundColor: isDeficit ? '#ef4444' : isRaw ? '#f59e0b' : col.bg, opacity: isDone ? 0.5 : 1 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight" style={{ color: isDeficit ? '#dc2626' : isRaw ? '#92400e' : col.fg }}>
                        {t.sku_name ?? t.sku}
                        {isRaw && <span className="ml-1 px-1 rounded text-[9px] font-bold bg-amber-100 text-amber-700">RAW</span>}
                      </p>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-xs font-mono text-gray-400">{t.startLabel}</span>
                        <span className="text-xs font-bold ml-2" style={{ color: isDeficit ? '#dc2626' : isRaw ? '#92400e' : col.fg }}>
                          {isRaw
                            ? `${Number(t.target_quantity).toLocaleString()} กก.`
                            : `${bagLabel(t.sku, roundedDisplayQty(t.sku, Number(t.target_quantity), bagMap), bagMap)}${roundedDisplayQty(t.sku, Number(t.target_quantity), bagMap).toLocaleString()} กก.`}
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
  nameMap: Record<string, string>
  bagMap: Record<string, number>
  skuColor: Record<string, typeof BAR_COLORS[0]>
}

function CurrentTimeView({ items, phaseStart, nameMap, bagMap, skuColor }: CurrentTimeViewProps) {
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

  const byWorker: Record<string, Assignment[]> = {}
  for (const a of items) { byWorker[a.worker_name] ??= []; byWorker[a.worker_name].push(a) }
  const workers = Object.keys(byWorker).sort()
  if (!workers.length) return null

  const phaseStartMins = phaseStart * 60

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {workers.map(name => {
        const tasks       = mergeTasks(byWorker[name])
        const displayName = nameMap[name.replace(/\s+/g, ' ').trim()] ?? shortName(name)

        let curMins2 = phaseStartMins
        const taskInfo = tasks.map(t => {
          const isConcurrent = String(t.note ?? '').includes('concurrent')
          let startMin = curMins2
          if (t.deadline_time) {
            const [dh, dm] = t.deadline_time.split(':').map(Number)
            if (!isNaN(dh) && !isNaN(dm)) {
              const dl = dh * 60 + dm
              startMin = isConcurrent ? dl : Math.max(startMin, dl)
            }
          }
          curMins2 = Math.max(curMins2, startMin)
          return { ...t, startMin, startLabel: minsToLabel(startMin) }
        })

        const startedTasks = taskInfo.filter(t => nowMins >= t.startMin)
        const currentTask  = startedTasks.length > 0 ? startedTasks[startedTasks.length - 1] : null
        const allDone      = tasks.every(t => t.status === 'เสร็จแล้ว')
        const notStarted   = nowMins < phaseStartMins

        const card = currentTask ?? (notStarted ? taskInfo[0] : null)
        const col  = card ? skuColor[card.sku] : { bg: '#e5e7eb', fg: '#6b7280' }

        return (
          <div key={name}
            className={`bg-white rounded-2xl border shadow-sm p-4 transition-opacity ${allDone ? 'opacity-50 border-gray-100' : 'border-gray-200'}`}>
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
              <div className="rounded-xl px-3 py-2.5" style={{ backgroundColor: col.bg + '25' }}>
                <p className="text-sm font-semibold leading-tight mb-1" style={{ color: col.fg }}>
                  {card.sku_name ?? card.sku}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-gray-500">{card.startLabel}</span>
                  <span className="text-xs font-bold" style={{ color: col.fg }}>
                    {bagLabel(card.sku, roundedDisplayQty(card.sku, Number(card.target_quantity), bagMap), bagMap)}{roundedDisplayQty(card.sku, Number(card.target_quantity), bagMap).toLocaleString()} กก.
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl px-3 py-4 bg-gray-50 text-center">
                <p className="text-xs text-gray-400">เสร็จสิ้นทุก SKU แล้ว</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Excel Export ─────────────────────────────────────────────────────────────

function exportExcel(
  stationLabel: string,
  date: string,
  allItems: Assignment[],
  nameMap: Record<string, string>,
) {
  const wb = XLSX.utils.book_new()
  const colWidths = [{ wch: 6 }, { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 36 }, { wch: 14 }, { wch: 10 }, { wch: 10 }]
  const header = ['ลำดับ', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'รหัสสินค้า', 'ชื่อสินค้า', 'ปริมาณ (กก.)', 'เวลาเริ่ม', 'Phase']

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
        const isConcurrent = String(task.note ?? '').includes('concurrent')
        let startMin = curMins
        if (task.deadline_time) {
          const [dh, dm] = task.deadline_time.split(':').map(Number)
          if (!isNaN(dh) && !isNaN(dm)) {
            const dl = dh * 60 + dm
            startMin = isConcurrent ? dl : Math.max(startMin, dl)
          }
        }
        curMins = Math.max(curMins, startMin)
        rows.push([seq++, task.worker_code, displayName, task.sku, task.sku_name ?? '', Number(task.target_quantity), minsToLabel(startMin), phaseLabel ?? task.period])
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

export default function BasicTablePage() {
  const params    = useParams()
  const tableSlug = params.table as string
  const cfg       = CFG[tableSlug]

  const [date, setDate]           = useState(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }))
  const [selectedPhase, setPhase] = useState<number | 'all'>(1)
  const [items, setItems]         = useState<Assignment[]>([])
  const [nameMap, setNameMap]     = useState<Record<string, string>>({})
  const [bagMap, setBagMap]       = useState<Record<string, number>>({})
  const [groupMap, setGroupMap]         = useState<Record<string, string>>({})
  const [productTypeMap, setProductTypeMap] = useState<Record<string, string>>({})
  const [pigLots,      setPigLots]      = useState<PigLot[]>([])
  const [masYieldRows, setMasYieldRows] = useState<MasYieldRow[]>([])
  const [carcassRate,  setCarcassRate]  = useState<number>(90)
  const [lineBreaks, setLineBreaks] = useState<LineBreak[]>([])
  const [loading, setLoading]     = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showGenModal, setShowGenModal] = useState(false)
  const [viewMode, setViewMode]   = useState<'worker' | 'gantt' | 'sku' | 'time' | 'summary'>('sku')

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

  const loadPigLots = useCallback(() => {
    fetch('/api/pig-carcass-lot-selection')
      .then(r => r.json())
      .then(json => {
        if (json.selected) setPigLots(json.selected as PigLot[])
        if (json.rate != null) setCarcassRate(parseFloat(json.rate) || 90)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadPigLots()
    // Other machines can change the selected lots — poll so this view stays in sync.
    const id = setInterval(loadPigLots, 20_000)
    return () => clearInterval(id)
  }, [loadPigLots])

  useEffect(() => {
    Promise.all([
      fetch('/api/master/picking-unit').then(r => r.json()),
      fetch('/api/basic/picking-unit').then(r => r.json()),
    ]).then(([std, basic]) => {
      setBagMap({ ...(std.bagMap ?? {}), ...(basic.bagMap ?? {}) })
    })
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
    fetch('/api/basic/mas-productivity')
      .then(r => r.json())
      .then(data => {
        const m: Record<string, string> = {}
        const pt: Record<string, string> = {}
        for (const r of (data.rows ?? []) as { sku: string; product_group: string; product: string }[]) {
          if (!r.product_group) continue
          const norm = r.sku.replace(/^0+/, '')
          if (!m[r.sku]) m[r.sku] = r.product_group
          if (!m[norm])  m[norm]  = r.product_group
          if (r.product) {
            if (!pt[r.sku]) pt[r.sku] = r.product
            if (!pt[norm])  pt[norm]  = r.product
          }
        }
        setGroupMap(m)
        setProductTypeMap(pt)
      })
    fetch('/api/basic/mas-yield')
      .then(r => r.json())
      .then(data => setMasYieldRows((data.rows ?? []).map((r: { carcass_weight: string | number; product_group: string; yield_pct: string | number }) => ({
        carcass_weight: Number(r.carcass_weight),
        product_group:  r.product_group,
        yield_pct:      Number(r.yield_pct),
      }))))
  }, [])

  useEffect(() => {
    loadData(date)
    const id = setInterval(() => loadData(date, true), 3000)
    return () => clearInterval(id)
  }, [date, cfg?.label])

  useEffect(() => {
    if (!cfg) return
    fetch(`/api/basic/line-break?date=${date}&station=${encodeURIComponent(cfg.label)}`)
      .then(r => r.json())
      .then(data => setLineBreaks(data.breaks ?? []))
      .catch(() => {})
    const id = setInterval(() => {
      fetch(`/api/basic/line-break?date=${date}&station=${encodeURIComponent(cfg.label)}`)
        .then(r => r.json())
        .then(data => setLineBreaks(data.breaks ?? []))
        .catch(() => {})
    }, 15000)
    return () => clearInterval(id)
  }, [date, cfg?.label])

  const generate = async (deductMode: 'plan' | 'actual' | 'yield' = 'plan') => {
    if (selectedPhase === 'all') return
    setGenerating(true); setGenResult(null); setShowGenModal(false)
    try {
      let carcassLots: unknown = undefined
      let carcassRate: number | undefined = undefined
      let trimmingQty = 0
      try {
        // Pull the shared selection from the server — it may have been set on a different machine.
        const selRes  = await fetch('/api/pig-carcass-lot-selection')
        const selJson = await selRes.json()
        if (selJson.selected?.length) carcassLots = selJson.selected
        if (selJson.rate != null) carcassRate = parseFloat(selJson.rate) || undefined
        if (selJson.trimmingQty) trimmingQty = parseInt(selJson.trimmingQty) || 0
      } catch { /* ignore */ }
      const res = await fetch('/api/production/generate-basic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, phase: selectedPhase, deductMode, carcassLots, carcassRate, trimmingQty }),
      })
      const result = await res.json()
      setGenResult(result)
      if (result.success) loadData(date)
    } catch { setGenResult({ success: false, message: 'เกิดข้อผิดพลาด' }) }
    setGenerating(false)
  }

  const handleGenerateClick = () => {
    if (selectedPhase === 'all') return
    if (selectedPhase === 1) { generate('plan'); return }
    setShowGenModal(true)
  }

  if (!cfg) return <p className="text-red-500">ไม่พบ Station</p>

  const phaseConfig  = selectedPhase === 'all' ? null : PHASES.find(p => p.phase === selectedPhase)!
  const filtered     = selectedPhase === 'all' ? items : items.filter(a => a.period === phaseConfig!.period)
  const viewStartH   = selectedPhase === 'all' ? PHASES[0].startH  : phaseConfig!.startH
  const viewEndH     = selectedPhase === 'all' ? PHASES[PHASES.length - 1].endH : phaseConfig!.endH
  const dateDisplay  = new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
  const skuColor     = buildSkuColorMap(items)

  // Phase net working minutes (excluding static breaks)
  // Phase 1: 8:30-12:00(210) + 13:00-14:30(90) = 300  Phase 2: 14:30-16:30 = 120
  // Phase 3: 16:30-17:00(30) + 18:00 onwards(90) = 120  all: 540
  const PHASE_NET_MINS: Record<string, number> = { '1': 300, '2': 120, '3': 120, 'all': 540 }

  // Per-group throughput = total_group_kg / phase_net_mins (กก./นาที)
  const carcassThroughputByGroup = (() => {
    if (!pigLots.length || !masYieldRows.length) return {}
    const netMins = PHASE_NET_MINS[String(selectedPhase)] ?? 300
    if (netMins <= 0) return {}
    const uniqueWeights = Array.from(new Set(masYieldRows.map(r => r.carcass_weight))).sort((a, b) => a - b)
    const groupKg: Record<string, number> = {}
    for (const lot of pigLots) {
      const w = uniqueWeights.reduce((best, ww) => Math.abs(ww - lot.avg_weight) < Math.abs(best - lot.avg_weight) ? ww : best, uniqueWeights[0])
      for (const row of masYieldRows.filter(r => r.carcass_weight === w)) {
        groupKg[row.product_group] = (groupKg[row.product_group] ?? 0) + (row.yield_pct / 100) * lot.qty * lot.avg_weight
      }
    }
    const result: Record<string, number> = {}
    for (const [grp, kg] of Object.entries(groupKg)) result[grp] = kg / netMins
    return result
  })()

  const DEDUCT_OPTIONS: { mode: 'plan' | 'actual' | 'yield'; label: string; desc: string }[] = [
    { mode: 'plan',   label: 'แผน Phase ก่อนหน้า',     desc: `หักลบจากยอดที่วางแผนไว้ใน Phase ${(selectedPhase as number) - 1}` },
    { mode: 'actual', label: 'ยอดผลิต Phase ก่อนหน้า', desc: 'หักลบเฉพาะงานที่เสร็จแล้ว (สถานะ: เสร็จแล้ว)' },
    { mode: 'yield',  label: 'ยอดรับผลได้ล่าสุด',       desc: 'หักลบจากข้อมูลที่อัพโหลดในเมนู รับผลได้' },
  ]

  return (
    <>
    {showGenModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
           onClick={() => setShowGenModal(false)}>
        <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm"
             onClick={e => e.stopPropagation()}>
          <h2 className="text-base font-semibold text-gray-900">สร้าง Phase {selectedPhase}</h2>
          <p className="text-sm text-gray-500 mt-1 mb-5">เลือกยอดที่ใช้หักลบจากเป้าหมาย</p>
          <div className="space-y-2.5">
            {DEDUCT_OPTIONS.map(opt => (
              <button key={opt.mode} onClick={() => generate(opt.mode)}
                className="w-full text-left p-4 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <div className="font-medium text-gray-900 text-sm">{opt.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>
          <button onClick={() => setShowGenModal(false)}
            className="mt-4 w-full text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors">
            ยกเลิก
          </button>
        </div>
      </div>
    )}
    <div className="space-y-3 sm:space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Station {cfg.label}</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-500">{dateDisplay}</span>
          <button onClick={() => loadData(date)} disabled={loading}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => { setPhase('all'); setGenResult(null) }}
          className={`flex-1 sm:flex-none px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors border ${selectedPhase === 'all'
            ? 'bg-gray-800 text-white border-gray-800'
            : 'text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
          <span className="block">ทั้งหมด</span>
          <span className="block text-[10px] sm:text-xs font-normal opacity-80">3 Phase</span>
        </button>
        {PHASES.map(p => (
          <button key={p.phase}
            onClick={() => { setPhase(p.phase); setGenResult(null) }}
            className={`flex-1 sm:flex-none px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors ${selectedPhase === p.phase ? p.active : p.inactive}`}>
            <span className="block">{p.label}</span>
            <span className="block text-[10px] sm:text-xs font-normal opacity-80">{p.sub}</span>
          </button>
        ))}

        <div className="hidden sm:flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-sm text-gray-700">
            <Calendar size={14} className="text-gray-400" />
            <input type="date" value={date}
              onChange={e => { setDate(e.target.value); setGenResult(null) }}
              className="outline-none bg-transparent text-sm" />
          </div>
          {selectedPhase !== 'all' && (
            <button onClick={handleGenerateClick} disabled={generating}
              className="btn-primary flex items-center gap-2 text-sm">
              <Zap size={15} />{generating ? 'กำลังสร้าง...' : `สร้าง Phase ${selectedPhase}`}
            </button>
          )}
          {genResult && (
            <div className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm border ${
              genResult.success ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
            }`}>
              {genResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              {genResult.message}
            </div>
          )}
        </div>
      </div>

      {loading && <div className="card text-center py-16 text-gray-400">กำลังโหลด...</div>}

      {!loading && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:flex items-center gap-1.5 sm:gap-2">
            {([
              { mode: 'sku',     icon: BarChart2,     label: 'ภาพรวม' },
              { mode: 'gantt',   icon: LayoutList,    label: 'รายพนักงาน' },
              { mode: 'time',    icon: Clock,         label: 'รายเวลา' },
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
              onClick={() => exportExcel(cfg.label, date, items, nameMap)}
              className="ml-auto hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap">
              <Download size={14} />Export Excel
            </button>
          </div>

          {filtered.length === 0 && (
            <div className="card text-center py-16 text-gray-400">
              <p className="font-medium">ยังไม่มีคำสั่งผลิต{selectedPhase === 'all' ? '' : ` Phase ${selectedPhase}`} วันที่ {date}</p>
              {selectedPhase !== 'all' && <p className="text-sm mt-1">กรุณากด "สร้าง Phase {selectedPhase}"</p>}
            </div>
          )}
          {viewMode === 'sku' && filtered.length > 0 && (
            <SkuScheduleView items={filtered} phaseStart={viewStartH} phaseEnd={viewEndH} bagMap={bagMap} skuColor={skuColor} nameMap={nameMap} groupMap={groupMap} carcassThroughputByGroup={carcassThroughputByGroup} lineBreaks={lineBreaks} pigLots={pigLots} masYieldRows={masYieldRows} carcassRate={carcassRate} />
          )}
          {viewMode === 'gantt' && filtered.length > 0 && (
            <WorkerCardView items={filtered} phaseStart={viewStartH} nameMap={nameMap} bagMap={bagMap} skuColor={skuColor} />
          )}
          {viewMode === 'worker' && filtered.length > 0 && (
            <WorkerTable items={filtered} phaseStart={viewStartH} nameMap={nameMap} bagMap={bagMap} skuColor={skuColor} />
          )}
          {viewMode === 'time' && filtered.length > 0 && (
            <CurrentTimeView items={filtered} phaseStart={viewStartH} nameMap={nameMap} bagMap={bagMap} skuColor={skuColor} />
          )}
          {viewMode === 'summary' && filtered.length > 0 && (
            <ProductionSummaryView items={filtered} phaseStart={viewStartH} bagMap={bagMap} date={date} tableName={cfg.label} groupMap={groupMap} carcassThroughputByGroup={carcassThroughputByGroup} phaseNetMins={PHASE_NET_MINS[String(selectedPhase)] ?? 300} />
          )}
        </div>
      )}
    </div>
    </>
  )
}
