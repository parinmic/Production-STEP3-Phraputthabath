'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Users, Clock, AlertCircle, RefreshCw, Calendar, CheckCircle2, XCircle, Pencil, Trash2, Check, X } from 'lucide-react'

interface AttendanceRow {
  emp_id: string
  name: string
  dept: string
  shift: string
  shift_start: string
  scan_in: string
  attendance_status: string
  minutes_late: number
  station: string | null
}

interface PlanEntry {
  emp_id: string
  name: string
  work_station: string
  shift: string
  upload_round: string
}

interface Summary { present: number; late: number; absent: number; total: number }

const STATIONS = ['สามชั้นพิเศษ', 'สะโพกพิเศษ', 'ไหล่พิเศษ']
const STATUS_LABEL: Record<string, string> = { Present: 'มาทำงาน', Late: 'มาสาย', Absent: 'ขาด' }
const STATUS_COLOR: Record<string, string> = {
  Present: 'bg-green-100 text-green-700',
  Late:    'bg-yellow-100 text-yellow-700',
  Absent:  'bg-red-100 text-red-700',
}

export default function WorkforcePage() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [date, setDate]       = useState(today)
  const [rows, setRows]       = useState<AttendanceRow[]>([])
  const [planMap, setPlanMap] = useState<Map<string, PlanEntry>>(new Map())
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  // Filters
  const [filterStatus,  setFilterStatus]  = useState('all')
  const [filterShift,   setFilterShift]   = useState('all')
  const [filterStation, setFilterStation] = useState('all')
  const [filterName,    setFilterName]    = useState('')

  // Inline edit state: emp_id → editing station value
  const [editingId,      setEditingId]      = useState<string | null>(null)
  const [editingStation, setEditingStation] = useState('')
  const [saving,         setSaving]         = useState<string | null>(null)

  const loadAttendance = useCallback(async (d: string) => {
    setLoading(true); setError('')
    try {
      const res  = await fetch(`/api/external-timestamp?date=${d}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setRows(json.data ?? [])
      setSummary(json.summary ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally { setLoading(false) }
  }, [])

  const loadPlan = useCallback(async (d: string) => {
    try {
      const res  = await fetch(`/api/workforce-daily?date=${d}`)
      const json = await res.json()
      const map  = new Map<string, PlanEntry>()
      for (const e of (json.data ?? []) as PlanEntry[]) map.set(e.emp_id, e)
      setPlanMap(map)
    } catch { /* silent */ }
  }, [])

  const reload = useCallback((d: string) => {
    loadAttendance(d); loadPlan(d)
  }, [loadAttendance, loadPlan])

  useEffect(() => { reload(date) }, [date, reload])

  // Save manual override (add or update station)
  const saveOverride = async (row: AttendanceRow, station: string) => {
    setSaving(row.emp_id)
    await fetch('/api/workforce-daily', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date, emp_id: row.emp_id, name: row.name,
        work_station: station, shift: row.shift,
      }),
    })
    setEditingId(null)
    setSaving(null)
    loadPlan(date)
  }

  // Remove from plan
  const removeFromPlan = async (emp_id: string) => {
    setSaving(emp_id)
    await fetch(`/api/workforce-daily?date=${date}&emp_id=${encodeURIComponent(emp_id)}`, { method: 'DELETE' })
    setSaving(null)
    loadPlan(date)
  }

  const stations = useMemo(() => [...new Set(rows.map(r => r.station).filter(Boolean) as string[])].sort(), [rows])
  const shifts   = useMemo(() => [...new Set(rows.map(r => r.shift).filter(Boolean))].sort(), [rows])

  const displayed = useMemo(() => {
    let result = [...rows]
    if (filterStatus  !== 'all') result = result.filter(r => r.attendance_status === filterStatus)
    if (filterShift   !== 'all') result = result.filter(r => r.shift === filterShift)
    if (filterStation === '__none__') result = result.filter(r => !r.station)
    else if (filterStation !== 'all') result = result.filter(r => r.station === filterStation)
    if (filterName.trim()) {
      const q = filterName.trim().toUpperCase()
      result = result.filter(r => r.name.toUpperCase().includes(q) || r.emp_id.includes(q))
    }
    return result
  }, [rows, filterStatus, filterShift, filterStation, filterName])

  const planCount = (summary?.present ?? 0) + (summary?.late ?? 0)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">สถานะกำลังคนประจำวัน</h1>
          <p className="text-gray-500 mt-1 text-sm">ข้อมูลจากระบบสแกนเข้างาน — Sync อัตโนมัติ 9:30 และ 15:30</p>
        </div>
        <button onClick={() => reload(date)} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />รีเฟรช
        </button>
      </div>

      {/* Date + filters */}
      <div className="card flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-blue-500 shrink-0" />
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <input type="text" placeholder="ค้นหาชื่อ / รหัส..." value={filterName}
          onChange={e => setFilterName(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48" />
        <select value={filterShift} onChange={e => setFilterShift(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">ทุกกะ</option>
          {shifts.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterStation} onChange={e => setFilterStation(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">ทุก Station</option>
          {stations.map(s => <option key={s} value={s}>{s}</option>)}
          <option value="__none__">ไม่พบใน Weekly/Job Assign</option>
        </select>
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          <AlertCircle size={18} />{error}
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { key: 'Present', label: 'มาทำงาน',    value: summary.present, icon: CheckCircle2, color: 'text-green-500',  bold: 'text-green-600' },
            { key: 'Late',    label: 'มาสาย',       value: summary.late,    icon: Clock,        color: 'text-yellow-500', bold: 'text-yellow-600' },
            { key: 'Absent',  label: 'ขาด',          value: summary.absent,  icon: XCircle,      color: 'text-red-500',    bold: 'text-red-600' },
            { key: 'all',     label: 'ใช้ใน Plan',  value: planCount,       icon: Users,        color: 'text-blue-500',   bold: 'text-blue-600' },
          ].map(({ key, label, value, icon: Icon, color, bold }) => (
            <button key={key}
              onClick={() => setFilterStatus(filterStatus === key ? 'all' : key)}
              className={`card text-left transition-all hover:shadow-md ${filterStatus === key ? 'ring-2 ring-blue-400' : ''}`}>
              <div className="flex items-center gap-2 mb-2">
                <Icon size={17} className={color} />
                <span className="text-sm text-gray-500">{label}</span>
              </div>
              <p className={`text-3xl font-bold ${bold}`}>{value}</p>
              <p className="text-xs text-gray-400 mt-1">{key === 'all' ? 'Present + Late' : 'คน'}</p>
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="card text-center py-12 text-gray-400">
          <RefreshCw size={24} className="animate-spin mx-auto mb-3" />กำลังโหลด...
        </div>
      ) : displayed.length === 0 && !error ? (
        <div className="card text-center py-12 text-gray-400">
          <Users size={36} className="mx-auto mb-3 opacity-30" />
          {rows.length === 0 ? 'ยังไม่มีข้อมูล Attendance วันนี้' : 'ไม่มีรายการที่ตรงกับตัวกรอง'}
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-2.5 text-left text-gray-600 font-medium whitespace-nowrap">รหัส</th>
                  <th className="px-4 py-2.5 text-left text-gray-600 font-medium whitespace-nowrap">ชื่อ</th>
                  <th className="px-4 py-2.5 text-left text-gray-600 font-medium whitespace-nowrap">แผนก</th>
                  <th className="px-4 py-2.5 text-left text-gray-600 font-medium whitespace-nowrap">กะ</th>
                  <th className="px-4 py-2.5 text-center text-gray-600 font-medium whitespace-nowrap">Scan In</th>
                  <th className="px-4 py-2.5 text-center text-gray-600 font-medium whitespace-nowrap">สถานะ</th>
                  <th className="px-4 py-2.5 text-center text-gray-600 font-medium whitespace-nowrap">Station ในแผน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayed.map((r) => {
                  const plan    = planMap.get(r.emp_id)
                  const isEdit  = editingId === r.emp_id
                  const isSaving = saving === r.emp_id
                  const isManual = plan?.upload_round === 'manual'

                  return (
                    <tr key={r.emp_id} className={`transition-colors ${isEdit ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{r.emp_id}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{r.name}</td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs max-w-[160px] truncate" title={r.dept}>{r.dept}</td>
                      <td className="px-4 py-2.5 text-gray-600">{r.shift}</td>
                      <td className="px-4 py-2.5 text-center font-mono text-gray-700">{r.scan_in || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[r.attendance_status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABEL[r.attendance_status] ?? r.attendance_status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        {isEdit ? (
                          /* ── Inline edit mode ── */
                          <div className="flex items-center justify-center gap-2">
                            <select
                              value={editingStation}
                              onChange={e => setEditingStation(e.target.value)}
                              className="border border-blue-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                              {STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <button
                              onClick={() => saveOverride(r, editingStation)}
                              disabled={isSaving}
                              className="text-green-600 hover:text-green-800 disabled:opacity-40"
                              title="บันทึก"
                            >
                              <Check size={15} />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-gray-400 hover:text-gray-600"
                              title="ยกเลิก"
                            >
                              <X size={15} />
                            </button>
                          </div>
                        ) : plan ? (
                          /* ── Has plan entry ── */
                          <div className="flex items-center justify-center gap-2">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${isManual ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                              {plan.work_station}
                              {isManual && <span className="ml-1 opacity-60">✎</span>}
                            </span>
                            <button
                              onClick={() => { setEditingId(r.emp_id); setEditingStation(plan.work_station) }}
                              className="text-gray-300 hover:text-blue-500 transition-colors"
                              title="แก้ไข Station"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => removeFromPlan(r.emp_id)}
                              disabled={isSaving}
                              className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40"
                              title="ถอดออกจากแผน"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ) : (
                          /* ── Not in plan ── */
                          <button
                            onClick={() => {
                              setEditingId(r.emp_id)
                              setEditingStation(r.station ?? STATIONS[0])
                            }}
                            className="text-xs text-gray-300 hover:text-blue-500 transition-colors flex items-center gap-1 mx-auto"
                            title="เพิ่มเข้าแผน"
                          >
                            <span>—</span>
                            <Pencil size={11} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-400 flex items-center justify-between">
            <span className="text-orange-500">✎ = แก้ไขด้วยมือ</span>
            <span>แสดง {displayed.length} จาก {rows.length} รายการ</span>
          </div>
        </div>
      )}
    </div>
  )
}
