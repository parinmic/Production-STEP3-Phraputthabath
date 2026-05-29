'use client'
import { useState, useEffect, useCallback } from 'react'
import { Users, Clock, AlertCircle, RefreshCw, Calendar, CheckCircle2, XCircle } from 'lucide-react'

interface AttendanceRow {
  emp_id: string
  name: string
  dept: string
  shift: string
  shift_start: string
  scan_in: string
  attendance_status: string
  minutes_late: number
}

interface Summary {
  present: number
  late: number
  absent: number
  total: number
}

const STATUS_LABEL: Record<string, string> = {
  Present: 'มาทำงาน',
  Late:    'มาสาย',
  Absent:  'ขาด',
}

const STATUS_COLOR: Record<string, string> = {
  Present: 'bg-green-100 text-green-700',
  Late:    'bg-yellow-100 text-yellow-700',
  Absent:  'bg-red-100 text-red-700',
}

export default function WorkforcePage() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [date, setDate] = useState(today)
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'Present' | 'Late' | 'Absent'>('all')

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/external-timestamp?date=${d}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setRows(json.data ?? [])
      setSummary(json.summary ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(date) }, [date, load])

  const displayed = filter === 'all' ? rows : rows.filter(r => r.attendance_status === filter)
  const planCount = (summary?.present ?? 0) + (summary?.late ?? 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">สถานะกำลังคนประจำวัน</h1>
          <p className="text-gray-500 mt-1 text-sm">ข้อมูลจากระบบสแกนเข้างาน — อัพเดตอัตโนมัติ</p>
        </div>
        <button
          onClick={() => load(date)}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          รีเฟรช
        </button>
      </div>

      {/* Date picker */}
      <div className="card flex items-center gap-4">
        <Calendar size={20} className="text-blue-500 shrink-0" />
        <label className="font-medium text-gray-700 whitespace-nowrap">วันที่</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
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
          <button
            onClick={() => setFilter(filter === 'Present' ? 'all' : 'Present')}
            className={`card text-left transition-all ${filter === 'Present' ? 'ring-2 ring-green-400' : 'hover:shadow-md'}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={18} className="text-green-500" />
              <span className="text-sm text-gray-500">มาทำงาน</span>
            </div>
            <p className="text-3xl font-bold text-green-600">{summary.present}</p>
            <p className="text-xs text-gray-400 mt-1">คน</p>
          </button>

          <button
            onClick={() => setFilter(filter === 'Late' ? 'all' : 'Late')}
            className={`card text-left transition-all ${filter === 'Late' ? 'ring-2 ring-yellow-400' : 'hover:shadow-md'}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Clock size={18} className="text-yellow-500" />
              <span className="text-sm text-gray-500">มาสาย</span>
            </div>
            <p className="text-3xl font-bold text-yellow-600">{summary.late}</p>
            <p className="text-xs text-gray-400 mt-1">คน</p>
          </button>

          <button
            onClick={() => setFilter(filter === 'Absent' ? 'all' : 'Absent')}
            className={`card text-left transition-all ${filter === 'Absent' ? 'ring-2 ring-red-400' : 'hover:shadow-md'}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <XCircle size={18} className="text-red-500" />
              <span className="text-sm text-gray-500">ขาด</span>
            </div>
            <p className="text-3xl font-bold text-red-600">{summary.absent}</p>
            <p className="text-xs text-gray-400 mt-1">คน</p>
          </button>

          <button
            onClick={() => setFilter('all')}
            className={`card text-left transition-all ${filter === 'all' ? 'ring-2 ring-blue-400' : 'hover:shadow-md'}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Users size={18} className="text-blue-500" />
              <span className="text-sm text-gray-500">ใช้ใน Plan</span>
            </div>
            <p className="text-3xl font-bold text-blue-600">{planCount}</p>
            <p className="text-xs text-gray-400 mt-1">Present + Late</p>
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="card text-center py-12 text-gray-400">
          <RefreshCw size={24} className="animate-spin mx-auto mb-3" />
          กำลังโหลด...
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
                  <th className="px-4 py-3 text-left text-gray-600 font-medium">รหัส</th>
                  <th className="px-4 py-3 text-left text-gray-600 font-medium">ชื่อ</th>
                  <th className="px-4 py-3 text-left text-gray-600 font-medium">แผนก</th>
                  <th className="px-4 py-3 text-left text-gray-600 font-medium">กะ</th>
                  <th className="px-4 py-3 text-center text-gray-600 font-medium">เริ่มกะ</th>
                  <th className="px-4 py-3 text-center text-gray-600 font-medium">Scan In</th>
                  <th className="px-4 py-3 text-center text-gray-600 font-medium">สถานะ</th>
                  <th className="px-4 py-3 text-center text-gray-600 font-medium">สาย (นาที)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayed.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{r.emp_id}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.name}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs max-w-[180px] truncate">{r.dept}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.shift}</td>
                    <td className="px-4 py-2.5 text-center text-gray-500">{r.shift_start}</td>
                    <td className="px-4 py-2.5 text-center font-mono text-gray-700">{r.scan_in || '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[r.attendance_status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[r.attendance_status] ?? r.attendance_status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center text-gray-500">
                      {r.minutes_late > 0 ? (
                        <span className="text-yellow-600 font-medium">{r.minutes_late}</span>
                      ) : '—'}
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
