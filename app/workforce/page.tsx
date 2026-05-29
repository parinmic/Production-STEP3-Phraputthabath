'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Users, Clock, AlertCircle, RefreshCw, Calendar, CheckCircle2, XCircle, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

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

interface Summary {
  present: number
  late: number
  absent: number
  total: number
}

type SortDir = 'asc' | 'desc' | null
type SortCol = keyof AttendanceRow | null

const STATUS_LABEL: Record<string, string> = { Present: 'มาทำงาน', Late: 'มาสาย', Absent: 'ขาด' }
const STATUS_COLOR: Record<string, string> = {
  Present: 'bg-green-100 text-green-700',
  Late:    'bg-yellow-100 text-yellow-700',
  Absent:  'bg-red-100 text-red-700',
}

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol; sortDir: SortDir }) {
  if (sortCol !== col) return <ChevronsUpDown size={13} className="text-gray-300 ml-1 shrink-0" />
  if (sortDir === 'asc')  return <ChevronUp   size={13} className="text-blue-500 ml-1 shrink-0" />
  return <ChevronDown size={13} className="text-blue-500 ml-1 shrink-0" />
}

export default function WorkforcePage() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [date, setDate]       = useState(today)
  const [rows, setRows]       = useState<AttendanceRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  // Filters
  const [filterStatus,  setFilterStatus]  = useState<string>('all')
  const [filterShift,   setFilterShift]   = useState<string>('all')
  const [filterStation, setFilterStation] = useState<string>('all')
  const [filterName,    setFilterName]    = useState('')

  // Sort
  const [sortCol, setSortCol] = useState<SortCol>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)

  const load = useCallback(async (d: string) => {
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

  useEffect(() => { load(date) }, [date, load])

  const handleSort = (col: SortCol) => {
    if (sortCol !== col) { setSortCol(col); setSortDir('asc') }
    else if (sortDir === 'asc')  setSortDir('desc')
    else { setSortCol(null); setSortDir(null) }
  }

  const stations  = useMemo(() => [...new Set(rows.map(r => r.station).filter(Boolean) as string[])].sort(), [rows])
  const shifts    = useMemo(() => [...new Set(rows.map(r => r.shift).filter(Boolean))].sort(), [rows])

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
    if (sortCol && sortDir) {
      result.sort((a, b) => {
        const av = a[sortCol] ?? ''
        const bv = b[sortCol] ?? ''
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'th')
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return result
  }, [rows, filterStatus, filterShift, filterStation, filterName, sortCol, sortDir])

  const planCount = (summary?.present ?? 0) + (summary?.late ?? 0)

  const Th = ({ col, label, className = '' }: { col: SortCol; label: string; className?: string }) => (
    <th
      className={`px-4 py-2.5 text-left text-gray-600 font-medium cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap ${className}`}
      onClick={() => handleSort(col)}
    >
      <span className="flex items-center gap-0.5">
        {label}<SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
      </span>
    </th>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">สถานะกำลังคนประจำวัน</h1>
          <p className="text-gray-500 mt-1 text-sm">ข้อมูลจากระบบสแกนเข้างาน — Sync อัตโนมัติ 9:30 และ 15:30</p>
        </div>
        <button onClick={() => load(date)} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />รีเฟรช
        </button>
      </div>

      {/* Date + search row */}
      <div className="card flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-blue-500 shrink-0" />
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <input
          type="text" placeholder="ค้นหาชื่อ / รหัส..." value={filterName}
          onChange={e => setFilterName(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
        />
        <select value={filterShift} onChange={e => setFilterShift(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">ทุกกะ</option>
          {shifts.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterStation} onChange={e => setFilterStation(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">ทุก Station</option>
          {stations.map(s => <option key={s} value={s}>{s}</option>)}
          <option value="__none__">ไม่พบใน Weekly</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          <AlertCircle size={18} />{error}
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { key: 'Present', label: 'มาทำงาน', value: summary.present, icon: CheckCircle2, color: 'text-green-500', bold: 'text-green-600' },
            { key: 'Late',    label: 'มาสาย',   value: summary.late,    icon: Clock,         color: 'text-yellow-500', bold: 'text-yellow-600' },
            { key: 'Absent',  label: 'ขาด',      value: summary.absent,  icon: XCircle,       color: 'text-red-500',    bold: 'text-red-600' },
            { key: 'all',     label: 'ใช้ใน Plan', value: planCount, icon: Users, color: 'text-blue-500', bold: 'text-blue-600' },
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
                  <Th col="emp_id"           label="รหัส" />
                  <Th col="name"             label="ชื่อ" />
                  <Th col="dept"             label="แผนก" />
                  <Th col="shift"            label="กะ" />
                  <Th col="shift_start"      label="เริ่มกะ" className="text-center" />
                  <Th col="scan_in"          label="Scan In" className="text-center" />
                  <Th col="attendance_status" label="สถานะ" className="text-center" />
                  <Th col="minutes_late"     label="สาย (นาที)" className="text-center" />
                  <Th col="station"          label="Station (Weekly)" className="text-center" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayed.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{r.emp_id}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.name}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs max-w-[180px] truncate" title={r.dept}>{r.dept}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.shift}</td>
                    <td className="px-4 py-2.5 text-center text-gray-500">{r.shift_start}</td>
                    <td className="px-4 py-2.5 text-center font-mono text-gray-700">{r.scan_in || '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[r.attendance_status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[r.attendance_status] ?? r.attendance_status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center text-gray-500">
                      {r.minutes_late > 0 ? <span className="text-yellow-600 font-medium">{r.minutes_late}</span> : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {r.station
                        ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{r.station}</span>
                        : <span className="text-xs text-gray-300">ไม่พบ</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-400 text-right">
            แสดง {displayed.length} จาก {rows.length} รายการ
          </div>
        </div>
      )}
    </div>
  )
}
