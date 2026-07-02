'use client'
import { useState, useEffect, useCallback } from 'react'
import { Slice, Trash2, Plus, AlertCircle, Download, RefreshCw, CheckCircle2 } from 'lucide-react'
import * as XLSX from 'xlsx'

const STATIONS = ['ทั้งหมด', 'สะโพกเบสิค', 'ไหล่เบสิค', 'สามชั้นเบสิค']

const PHASES = [
  { phase: 1, label: 'Phase 1', startH: 8.5,  endH: 14.5 },
  { phase: 2, label: 'Phase 2', startH: 14.5, endH: 16.5 },
  { phase: 3, label: 'Phase 3', startH: 16.5, endH: 24 },
]

const BREAK_REASONS = [
  'จุดงานเปิดหมูซีกติดขัด',
  'จุดงานสะโพกติดขัด',
  'จุดงานสามชั้นติดขัด',
  'จุดงานไหล่ติดขัด',
  'จำนวนหมูซีกไม่เพียงพอ',
  'หมูซีกอุณหภูมิสูงเกินไป',
  'หมูซีกอุณหภูมิต่ำเกินไป',
  'รางไม่สะอาด',
  'ตรวจพบโลหะ',
  'อื่นๆ',
]

const STATION_COLOR: Record<string, { border: string; bg: string; text: string; dot: string }> = {
  'ทั้งหมด':      { border: 'border-gray-400',   bg: 'bg-gray-50',   text: 'text-gray-700',   dot: 'bg-gray-400' },
  'สะโพกเบสิค':  { border: 'border-orange-400', bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-400' },
  'ไหล่เบสิค':   { border: 'border-green-400',  bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-400' },
  'สามชั้นเบสิค': { border: 'border-blue-400',  bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-400' },
}

interface LineBreak {
  id: string
  production_date: string
  station: string
  start_time: string
  end_time: string
  reason: string | null
  created_at: string
}

function durationLabel(start: string, end: string) {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins <= 0) return ''
  return mins >= 60 ? `${Math.floor(mins / 60)}ชม. ${mins % 60 > 0 ? `${mins % 60}น.` : ''}`.trim() : `${mins} นาที`
}

function breakMins(b: LineBreak): number {
  const [sh, sm] = b.start_time.split(':').map(Number)
  const [eh, em] = b.end_time.split(':').map(Number)
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm))
}

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function exportExcel(date: string, breaks: LineBreak[]) {
  const wb = XLSX.utils.book_new()

  // Sheet 1: detail rows
  const detail = breaks.map(b => ({
    'วันที่':            date,
    'สถานี':            b.station,
    'เวลาเริ่ม':        b.start_time,
    'เวลาสิ้นสุด':      b.end_time,
    'ระยะเวลา (นาที)': breakMins(b),
    'สาเหตุ':           b.reason ?? '',
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'รายการ Breakline')

  // Sheet 2: summary by reason
  const reasonMap = new Map<string, { count: number; mins: number; stations: Set<string> }>()
  for (const b of breaks) {
    const key = b.reason?.trim() || '(ไม่ระบุสาเหตุ)'
    const prev = reasonMap.get(key) ?? { count: 0, mins: 0, stations: new Set<string>() }
    prev.count++
    prev.mins += breakMins(b)
    prev.stations.add(b.station)
    reasonMap.set(key, prev)
  }
  const summary = [...reasonMap.entries()]
    .sort((a, b) => b[1].mins - a[1].mins)
    .map(([reason, { count, mins, stations }]) => ({
      'สาเหตุ':            reason,
      'จำนวนครั้ง':       count,
      'รวมเวลา (นาที)':  mins,
      'สถานีที่เกิด':     [...stations].join(', '),
    }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'สรุปสาเหตุ')

  // Sheet 3: summary by station
  const stationMap = new Map<string, { count: number; mins: number }>()
  for (const b of breaks) {
    const prev = stationMap.get(b.station) ?? { count: 0, mins: 0 }
    prev.count++
    prev.mins += breakMins(b)
    stationMap.set(b.station, prev)
  }
  const byStation = [...stationMap.entries()].map(([station, { count, mins }]) => ({
    'สถานี':            station,
    'จำนวนครั้ง':       count,
    'รวมเวลา (นาที)':  mins,
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byStation), 'สรุปต่อสถานี')

  XLSX.writeFile(wb, `Breakline_${date}.xlsx`)
}

export default function BreaklinePage() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [date, setDate]           = useState(today)
  const [breaks, setBreaks]       = useState<LineBreak[]>([])
  const [loading, setLoading]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState(false)
  const [adjustResult, setAdjustResult] = useState<{ success: boolean; message: string } | null>(null)

  // Form state
  const [station,      setStation]      = useState('ทั้งหมด')
  const [startTime,    setStartTime]    = useState('')
  const [endTime,      setEndTime]      = useState('')
  const [reasonChoice, setReasonChoice] = useState('')
  const [reasonCustom, setReasonCustom] = useState('')

  const fetchBreaks = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/basic/line-break?date=${date}`)
      const data = await res.json()
      setBreaks(data.breaks ?? [])
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { fetchBreaks() }, [fetchBreaks])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!startTime || !endTime) { setError('กรุณากรอกเวลาเริ่มและสิ้นสุด'); return }
    if (startTime >= endTime)   { setError('เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด'); return }
    setError(null)
    setSubmitting(true)
    const reason = reasonChoice === 'อื่นๆ' ? reasonCustom.trim() : reasonChoice
    try {
      const res  = await fetch('/api/basic/line-break', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ production_date: date, station, start_time: startTime, end_time: endTime, reason }),
      })
      const data = await res.json()
      if (!data.success) { setError(data.message); return }
      setStartTime(''); setEndTime(''); setReasonChoice(''); setReasonCustom('')
      fetchBreaks()
    } catch { setError('เกิดข้อผิดพลาด') }
    finally { setSubmitting(false) }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await fetch(`/api/basic/line-break?id=${id}`, { method: 'DELETE' })
      fetchBreaks()
    } finally { setDeletingId(null) }
  }

  const now = new Date()
  const todayDate = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const currentPhase = date === todayDate
    ? PHASES.find(p => nowMins >= p.startH * 60 && nowMins < p.endH * 60)
    : undefined
  const hasCurrentPhaseBreakline = !!currentPhase && breaks.some(b => {
    const bs = timeToMins(b.start_time)
    const be = timeToMins(b.end_time)
    return be > currentPhase.startH * 60 && bs < currentPhase.endH * 60
  })

  const handleAdjustPlan = async () => {
    if (!currentPhase) return
    setAdjusting(true)
    setAdjustResult(null)
    try {
      let carcassLots: unknown = undefined
      let carcassRate: number | undefined = undefined
      let trimmingQty = 0
      try {
        const selRes = await fetch('/api/pig-carcass-lot-selection')
        const selJson = await selRes.json()
        if (selJson.selected?.length) carcassLots = selJson.selected
        if (selJson.rate != null) carcassRate = parseFloat(selJson.rate) || undefined
        if (selJson.trimmingQty) trimmingQty = parseInt(selJson.trimmingQty) || 0
      } catch { /* ignore optional carcass selection */ }

      const res = await fetch('/api/production/generate-basic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          phase: currentPhase.phase,
          deductMode: 'plan',
          carcassLots,
          carcassRate,
          trimmingQty,
        }),
      })
      const result = await res.json()
      setAdjustResult(result)
    } catch {
      setAdjustResult({ success: false, message: 'เกิดข้อผิดพลาด' })
    } finally {
      setAdjusting(false)
    }
  }

  const grouped = STATIONS.filter(s => s !== 'ทั้งหมด').reduce<Record<string, LineBreak[]>>((acc, s) => {
    acc[s] = breaks.filter(b => b.station === s || b.station === 'ทั้งหมด')
    return acc
  }, {})

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
          <Slice size={20} className="text-amber-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Breakline</h1>
          <p className="text-xs text-gray-500">บันทึกการหยุดสาย — แสดงบน Gantt คำสั่งผลิตราย Station</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="date" value={date} onChange={e => { setDate(e.target.value); setAdjustResult(null) }}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button
            onClick={() => exportExcel(date, breaks)}
            disabled={breaks.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Export Excel"
          >
            <Download size={14} />
            Excel
          </button>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
        <p className="text-sm font-semibold text-gray-700">เพิ่มการหยุดสายใหม่</p>

        {/* Station */}
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1.5 block">สถานี</label>
          <div className="flex flex-wrap gap-2">
            {STATIONS.map(s => {
              const c = STATION_COLOR[s]
              return (
                <button key={s} type="button"
                  onClick={() => setStation(s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    station === s ? `${c.border} ${c.bg} ${c.text} shadow-sm` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                  {s}
                </button>
              )
            })}
          </div>
        </div>

        {/* Time range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">เวลาเริ่ม</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">เวลาสิ้นสุด</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
        </div>
        {startTime && endTime && startTime < endTime && (
          <p className="text-xs text-amber-600 font-medium -mt-2">ระยะเวลา {durationLabel(startTime, endTime)}</p>
        )}

        {/* Reason */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500 mb-1.5 block">สาเหตุ</label>
          <select
            value={reasonChoice}
            onChange={e => { setReasonChoice(e.target.value); setReasonCustom('') }}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          >
            <option value="">— เลือกสาเหตุ —</option>
            {BREAK_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {reasonChoice === 'อื่นๆ' && (
            <input
              type="text"
              value={reasonCustom}
              onChange={e => setReasonCustom(e.target.value)}
              placeholder="ระบุสาเหตุ..."
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertCircle size={14} />{error}
          </div>
        )}

        <button type="submit" disabled={submitting}
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
          <Plus size={16} />
          {submitting ? 'กำลังบันทึก...' : 'บันทึก Breakline'}
        </button>
      </form>

      {hasCurrentPhaseBreakline && currentPhase && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800">มี Breakline ใน {currentPhase.label} ที่กำลังทำงานอยู่</p>
            <p className="text-xs text-amber-700 mt-0.5">กดเพื่อคำนวณและเขียนแผน Basic ใหม่ตามเวลาผลิตที่เหลือ</p>
          </div>
          <button
            type="button"
            onClick={handleAdjustPlan}
            disabled={adjusting}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
            <RefreshCw size={16} className={adjusting ? 'animate-spin' : ''} />
            {adjusting ? 'กำลังปรับแผน...' : 'ปรับแผนหลัง Breakline'}
          </button>
        </div>
      )}

      {adjustResult && (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm border ${
          adjustResult.success ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {adjustResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {adjustResult.message}
        </div>
      )}

      {/* Break list */}
      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">กำลังโหลด...</div>
        ) : breaks.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm bg-white rounded-2xl border border-gray-200">
            ยังไม่มี Breakline วันที่ {new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
              รายการ Breakline — {breaks.length} รายการ
            </p>
            {/* Group by station for display */}
            {(['ทั้งหมด', ...STATIONS.filter(s => s !== 'ทั้งหมด')] as string[]).map(s => {
              const rows = breaks.filter(b => b.station === s)
              if (!rows.length) return null
              const c = STATION_COLOR[s]
              return (
                <div key={s} className={`bg-white rounded-2xl border ${c.border} shadow-sm overflow-hidden`}>
                  <div className={`px-4 py-2 ${c.bg} border-b ${c.border} flex items-center gap-2`}>
                    <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                    <span className={`text-xs font-bold ${c.text}`}>{s}</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {rows.map(b => (
                      <div key={b.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gray-900 font-mono">
                              {b.start_time} – {b.end_time}
                            </span>
                            <span className="text-xs text-amber-600 font-medium">
                              {durationLabel(b.start_time, b.end_time)}
                            </span>
                          </div>
                          {b.reason && (
                            <p className="text-xs text-gray-500 mt-0.5 truncate">{b.reason}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDelete(b.id)}
                          disabled={deletingId === b.id}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            {/* Summary per station */}
            <div className="bg-gray-50 rounded-2xl border border-gray-200 p-4">
              <p className="text-xs font-bold text-gray-500 mb-3">สรุปเวลาหยุดสายต่อสถานี</p>
              <div className="space-y-2">
                {STATIONS.filter(s => s !== 'ทั้งหมด').map(s => {
                  const rows = grouped[s] ?? []
                  const totalMins = rows.reduce((sum, b) => {
                    const [sh, sm] = b.start_time.split(':').map(Number)
                    const [eh, em] = b.end_time.split(':').map(Number)
                    return sum + Math.max(0, (eh * 60 + em) - (sh * 60 + sm))
                  }, 0)
                  const c = STATION_COLOR[s]
                  return (
                    <div key={s} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                        <span className="text-xs text-gray-700">{s}</span>
                      </div>
                      <span className={`text-xs font-bold ${totalMins > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                        {totalMins > 0 ? `${totalMins} นาที` : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
