'use client'
import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { CheckCircle2, PlayCircle, AlertCircle, Zap, Clock } from 'lucide-react'
import Link from 'next/link'

const CFG: Record<string, { label: string; accent: string; light: string }> = {
  'sam-chan': { label: 'สามชั้น', accent: 'border-blue-500',   light: 'bg-blue-50'   },
  'sa-phok':  { label: 'สะโพก',  accent: 'border-orange-500', light: 'bg-orange-50' },
  'lai':      { label: 'ไหล่',   accent: 'border-green-500',  light: 'bg-green-50'  },
}

const PHASES = [
  { phase: 1, label: 'Phase 1', sub: '8:00-14:00',         period: 'เช้า', startH: 8,  endH: 14, deadline: '14:00',
    active: 'bg-sky-500 text-white', inactive: 'text-sky-700 border border-sky-300 hover:bg-sky-50' },
  { phase: 2, label: 'Phase 2', sub: '14:00-16:00',        period: 'บ่าย', startH: 13, endH: 17, deadline: '17:00',
    active: 'bg-purple-500 text-white', inactive: 'text-purple-700 border border-purple-300 hover:bg-purple-50' },
  { phase: 3, label: 'Phase 3', sub: '16:00 เป็นต้นไป',   period: 'ค่ำ',  startH: 17, endH: 19, deadline: null,
    active: 'bg-orange-500 text-white', inactive: 'text-orange-700 border border-orange-300 hover:bg-orange-50' },
]

const BAR_COLORS = [
  { bg: '#60a5fa', fg: '#1e3a5f' }, // blue
  { bg: '#34d399', fg: '#064e3b' }, // emerald
  { bg: '#fb923c', fg: '#7c2d12' }, // orange
  { bg: '#a78bfa', fg: '#2e1065' }, // violet
  { bg: '#f472b6', fg: '#831843' }, // pink
  { bg: '#22d3ee', fg: '#164e63' }, // cyan
  { bg: '#facc15', fg: '#713f12' }, // yellow
  { bg: '#f87171', fg: '#7f1d1d' }, // red
  { bg: '#4ade80', fg: '#14532d' }, // green
  { bg: '#818cf8', fg: '#1e1b4b' }, // indigo
  { bg: '#e879f9', fg: '#4a044e' }, // fuchsia
  { bg: '#2dd4bf', fg: '#134e4a' }, // teal
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
}

function shortName(full: string) {
  const parts = full.trim().split(/\s+/)
  return parts[0] ?? full
}

function statusIcon(s: string) {
  if (s === 'เสร็จแล้ว')   return <CheckCircle2 size={11} />
  if (s === 'กำลังผลิต')   return <PlayCircle   size={11} />
  return <AlertCircle size={11} />
}

function statusColor(s: string) {
  if (s === 'เสร็จแล้ว') return '#22c55e'
  if (s === 'กำลังผลิต') return '#f59e0b'
  return '#94a3b8'
}

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
  for (const a of items) {
    byWorker[a.worker_name] ??= []
    byWorker[a.worker_name].push(a)
  }
  const workers = Object.keys(byWorker).sort()
  if (!workers.length) return null

  const toTimeLabel = (startH: number, offsetH: number) => {
    const totalMins = startH * 60 + Math.round(offsetH * 60)
    const hh = Math.floor(totalMins / 60) % 24
    const mm = totalMins % 60
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`
  }

  const taskHours = (task: Assignment) => {
    const rate = rateMap[task.sku] ?? rateMap[task.sku.replace(/^0+/, '')]
    return (rate && rate > 0) ? Number(task.target_quantity) / rate : null
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="grid grid-cols-[180px_1fr_110px] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500">พนักงาน</span>
        <span className="text-xs font-semibold text-gray-500">รายการที่ต้องผลิต</span>
        <span className="text-xs font-semibold text-gray-500 text-right">รวม / เสร็จ</span>
      </div>

      <div className="divide-y divide-gray-50">
        {workers.map((name, wi) => {
          const tasks = byWorker[name]
          const workerTotal = tasks.reduce((s, t) => s + Number(t.target_quantity), 0)
          const allDone  = tasks.every(t => t.status === 'เสร็จแล้ว')
          const anyActive = tasks.some(t => t.status === 'กำลังผลิต')

          // compute finish time per task (sequential)
          let offsetH = 0
          const taskInfo = tasks.map(t => {
            const h = taskHours(t)
            const finishTime = h !== null ? toTimeLabel(phaseStart, offsetH + h) : t.deadline_time?.substring(0, 5) ?? null
            if (h !== null) offsetH += h
            return { ...t, finishTime, hours: h }
          })
          const totalFinishTime = toTimeLabel(phaseStart, offsetH)

          const displayName = nameMap[name.replace(/\s+/g, ' ').trim()] ?? shortName(name)

          return (
            <div key={name}
              className={`grid grid-cols-[180px_1fr_110px] gap-3 px-4 py-3 items-start ${wi % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'}`}>

              {/* Worker */}
              <div>
                <p className="text-sm font-semibold text-gray-800 leading-tight">{displayName}</p>
                <p className="text-xs text-gray-400 font-mono mt-0.5">{tasks[0].worker_code}</p>
              </div>

              {/* Task chips */}
              <div className="flex flex-wrap gap-2">
                {taskInfo.map(task => {
                  const col = skuColor[task.sku]
                  const isDone   = task.status === 'เสร็จแล้ว'
                  const isActive = task.status === 'กำลังผลิต'
                  return (
                    <div key={task.id}
                      style={{ backgroundColor: col.bg, opacity: isDone ? 0.6 : 1 }}
                      className={`rounded-lg px-3 py-1.5 flex flex-col gap-0.5 min-w-[120px] relative ${isActive ? 'ring-2 ring-white animate-pulse' : ''}`}>
                      <span className="text-xs font-semibold leading-tight" style={{ color: col.fg }}>
                        {task.sku_name ?? task.sku}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold" style={{ color: col.fg }}>
                          {Number(task.target_quantity).toLocaleString()} กก.
                        </span>
                        {task.finishTime && (
                          <span className="text-xs font-mono flex items-center gap-0.5 opacity-80" style={{ color: col.fg }}>
                            <Clock size={9} />เสร็จ {task.finishTime}
                          </span>
                        )}
                      </div>
                      {(isDone || isActive) && (
                        <span className="absolute top-1 right-1" style={{ color: statusColor(task.status) }}>
                          {statusIcon(task.status)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Summary */}
              <div className="text-right">
                <p className={`text-sm font-bold ${allDone ? 'text-green-600' : anyActive ? 'text-amber-600' : 'text-gray-800'}`}>
                  {workerTotal.toLocaleString()} กก.
                </p>
                <p className="text-xs text-gray-400 mt-0.5">เสร็จ {totalFinishTime} น.</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function TablePage() {
  const params       = useParams()
  const searchParams = useSearchParams()
  const router       = useRouter()
  const tableSlug    = params.table as string
  const cfg          = CFG[tableSlug]

  const [date, setDate]               = useState(searchParams.get('date') ?? new Date().toISOString().split('T')[0])
  const [selectedPhase, setPhase]     = useState(1)
  const [items, setItems]             = useState<Assignment[]>([])
  const [rateMap, setRateMap]         = useState<Record<string, number>>({})
  const [nameMap, setNameMap]         = useState<Record<string, string>>({}) // fullName → display
  const [loading, setLoading]         = useState(false)
  const [generating, setGenerating]   = useState(false)
  const [genResult, setGenResult]     = useState<{ success: boolean; message: string } | null>(null)

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
          const display = w.nickname
            ? `${w.nickname} (${w.firstName})`
            : w.firstName
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  const total       = filtered.reduce((s, a) => s + Number(a.target_quantity), 0)
  const others      = Object.entries(CFG).filter(([s]) => s !== tableSlug)

  // SKU summary for current phase
  const skuSummary = Object.values(
    filtered.reduce((acc, a) => {
      const key = a.sku
      if (!acc[key]) acc[key] = { sku: key, name: a.sku_name, total: 0 }
      acc[key].total += Number(a.target_quantity)
      return acc
    }, {} as Record<string, { sku: string; name: string | null; total: number }>)
  ).sort((a, b) => b.total - a.total)

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

{/* Gantt / empty states */}
      {loading && (
        <div className="card text-center py-16 text-gray-400">กำลังโหลด...</div>
      )}
      {!loading && filtered.length === 0 && (
        <div className="card text-center py-16 text-gray-400">
          <p className="font-medium">ยังไม่มีคำสั่งผลิต Phase {selectedPhase} วันที่ {date}</p>
          <p className="text-sm mt-1">กรุณากด "สร้าง Phase {selectedPhase}"</p>
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <div className="flex gap-4 items-start">
          {/* SKU Summary */}
          <div className={`card ${cfg.light} w-52 flex-shrink-0`}>
            <p className="text-sm font-semibold text-gray-600 mb-3">SKU ที่ต้องผลิต</p>
            <div className="divide-y divide-gray-200">
              {skuSummary.map(s => (
                <div key={s.sku} className="flex items-center justify-between gap-3 py-1.5">
                  <p className="text-xs text-gray-600 leading-tight">{s.name ?? s.sku}</p>
                  <p className="text-sm font-bold text-gray-900 whitespace-nowrap">
                    {s.total.toLocaleString()} <span className="text-xs font-normal text-gray-400">กก.</span>
                  </p>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-200 mt-3 pt-2 flex justify-between items-center">
              <span className="text-xs text-gray-400">{skuSummary.length} SKU</span>
              <span className="text-xs font-semibold text-gray-600">{total.toLocaleString()} กก.</span>
            </div>
          </div>

          {/* Worker table */}
          <div className="flex-1 min-w-0">
            <WorkerTable
              items={filtered}
              phaseStart={phaseConfig.startH}
              rateMap={rateMap}
              nameMap={nameMap}
            />
          </div>
        </div>
      )}
    </div>
  )
}
