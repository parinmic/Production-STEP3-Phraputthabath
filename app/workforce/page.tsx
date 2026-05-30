'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Users, Clock, AlertCircle, RefreshCw, Calendar, CheckCircle2, XCircle, Pencil, Check, X, Download } from 'lucide-react'

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

interface EditDraft {
  name: string
  dept: string
  shift: string
  scan_in: string
  attendance_status: string
  minutes_late: number
  station: string
}

interface Summary { present: number; late: number; absent: number; total: number }

const STATIONS   = ['สามชั้นพิเศษ', 'สะโพกพิเศษ', 'ไหล่พิเศษ']
const SHIFTS     = ['กะ 1', 'กะ 2']
const STATUSES   = ['Present', 'Late', 'Absent']
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
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [syncedAt, setSyncedAt] = useState<string | null>(null)

  const [filterStatus,  setFilterStatus]  = useState('all')
  const [filterShift,   setFilterShift]   = useState('all')
  const [filterStation, setFilterStation] = useState('all')
  const [filterName,    setFilterName]    = useState('')

  // editingId → draft values
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft,     setDraft]     = useState<EditDraft | null>(null)
  const [saving,    setSaving]    = useState(false)
  const [syncing,   setSyncing]   = useState(false)
  const [syncMsg,   setSyncMsg]   = useState('')

  // local overrides (for display; resets on page reload)
  const [overrides, setOverrides] = useState<Map<string, Partial<AttendanceRow>>>(new Map())

  const loadAttendance = useCallback(async (d: string) => {
    setLoading(true); setError('')
    try {
      const res  = await fetch(`/api/external-timestamp?date=${d}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setRows(json.data ?? [])
      setSummary(json.summary ?? null)
      setSyncedAt(json.syncedAt ?? null)
      setOverrides(new Map())
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

  const handleSync = async () => {
    setSyncing(true); setSyncMsg('')
    try {
      const res  = await fetch('/api/cron/sync-attendance', { method: 'POST' })
      const json = await res.json()
      if (json.success) {
        setSyncMsg(`ดึงข้อมูลสำเร็จ — รอบ ${json.round} (${json.inserted} คน)`)
        reload(date)
      } else {
        setSyncMsg(`ผิดพลาด: ${json.error ?? json.message ?? 'unknown'}`)
      }
    } catch (e: unknown) {
      setSyncMsg(`ผิดพลาด: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setSyncing(false) }
  }

  useEffect(() => { reload(date) }, [date, reload])

  const startEdit = (r: AttendanceRow) => {
    const plan = planMap.get(r.emp_id)
    const ov   = overrides.get(r.emp_id) ?? {}
    setEditingId(r.emp_id)
    setDraft({
      name:              ov.name              ?? r.name,
      dept:              ov.dept              ?? r.dept,
      shift:             ov.shift             ?? r.shift,
      scan_in:           ov.scan_in           ?? r.scan_in,
      attendance_status: ov.attendance_status ?? r.attendance_status,
      minutes_late:      ov.minutes_late      ?? r.minutes_late,
      station:           planMap.has(r.emp_id) ? (plan?.work_station ?? '') : (r.station ?? ''),
    })
  }

  const cancelEdit = () => { setEditingId(null); setDraft(null) }

  const saveEdit = async (r: AttendanceRow) => {
    if (!draft) return
    setSaving(true)
    try {
      const inPlan = draft.attendance_status !== 'Absent'
      if (inPlan) {
        await fetch('/api/workforce-daily', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date,
            emp_id:       r.emp_id,
            name:         draft.name,
            work_station: draft.station,
            shift:        draft.shift,
          }),
        })
      } else {
        await fetch(`/api/workforce-daily?date=${date}&emp_id=${encodeURIComponent(r.emp_id)}`, { method: 'DELETE' })
      }
      // store local display override
      setOverrides(prev => {
        const next = new Map(prev)
        next.set(r.emp_id, {
          name:              draft.name,
          dept:              draft.dept,
          shift:             draft.shift,
          scan_in:           draft.scan_in,
          attendance_status: draft.attendance_status,
          minutes_late:      draft.minutes_late,
          station:           inPlan ? (draft.station || null) : null,
        })
        return next
      })
      await loadPlan(date)
      setEditingId(null); setDraft(null)
    } finally { setSaving(false) }
  }

  const effectiveRow = (r: AttendanceRow): AttendanceRow => {
    const ov = overrides.get(r.emp_id)
    return ov ? { ...r, ...ov } : r
  }

  const stations = useMemo(() => [...new Set(rows.map(r => r.station).filter(Boolean) as string[])].sort(), [rows])
  const shifts   = useMemo(() => [...new Set(rows.map(r => r.shift).filter(Boolean))].sort(), [rows])

  const displayed = useMemo(() => {
    return rows
      .map(effectiveRow)
      .filter(r => {
        if (filterStatus  !== 'all' && r.attendance_status !== filterStatus) return false
        if (filterShift   !== 'all' && r.shift !== filterShift) return false
        if (filterStation === '__none__' && r.station) return false
        if (filterStation !== 'all' && filterStation !== '__none__' && r.station !== filterStation) return false
        if (filterName.trim()) {
          const q = filterName.trim().toUpperCase()
          if (!r.name.toUpperCase().includes(q) && !r.emp_id.includes(q)) return false
        }
        return true
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, overrides, filterStatus, filterShift, filterStation, filterName])

  const planCount = (summary?.present ?? 0) + (summary?.late ?? 0)

  const sel = (val: string, opts: string[], onChange: (v: string) => void, cls = '') => (
    <select value={val} onChange={e => onChange(e.target.value)}
      className={`border border-blue-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 w-full ${cls}`}>
      {opts.map(o => <option key={o} value={o}>{o || 'ว่าง'}</option>)}
    </select>
  )

  const inp = (val: string, onChange: (v: string) => void, cls = '') => (
    <input value={val} onChange={e => onChange(e.target.value)}
      className={`border border-blue-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 w-full ${cls}`} />
  )

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">สถานะกำลังคนประจำวัน</h1>
          <p className="text-gray-500 mt-1 text-sm">ข้อมูลจากระบบสแกนเข้างาน — Sync อัตโนมัติ 9:30 และ 15:30</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSync} disabled={syncing || loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm hover:bg-blue-600 disabled:opacity-40 transition-colors">
            <Download size={14} className={syncing ? 'animate-bounce' : ''} />
            {syncing ? 'กำลังดึง...' : 'ดึงข้อมูล'}
          </button>
          {syncedAt && (
            <span className="text-xs text-gray-400">
              ดึงล่าสุด {new Date(syncedAt).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button onClick={() => reload(date)} disabled={loading || syncing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />รีเฟรช
          </button>
        </div>
      </div>
      {syncMsg && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm ${syncMsg.startsWith('ผิดพลาด') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {syncMsg}
        </div>
      )}

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

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { key: 'Present', label: 'มาทำงาน',   value: summary.present, icon: CheckCircle2, color: 'text-green-500',  bold: 'text-green-600' },
            { key: 'Late',    label: 'มาสาย',      value: summary.late,    icon: Clock,        color: 'text-yellow-500', bold: 'text-yellow-600' },
            { key: 'Absent',  label: 'ขาด',         value: summary.absent,  icon: XCircle,      color: 'text-red-500',    bold: 'text-red-600' },
            { key: 'all',     label: 'ใช้ใน Plan', value: planCount,       icon: Users,        color: 'text-blue-500',   bold: 'text-blue-600' },
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
                  <th className="px-3 py-2.5 text-left text-gray-600 font-medium whitespace-nowrap">รหัส</th>
                  <th className="px-3 py-2.5 text-left text-gray-600 font-medium whitespace-nowrap">ชื่อ</th>
                  <th className="px-3 py-2.5 text-left text-gray-600 font-medium whitespace-nowrap">แผนก</th>
                  <th className="px-3 py-2.5 text-left text-gray-600 font-medium whitespace-nowrap">กะ</th>
                  <th className="px-3 py-2.5 text-center text-gray-600 font-medium whitespace-nowrap">Scan In</th>
                  <th className="px-3 py-2.5 text-center text-gray-600 font-medium whitespace-nowrap">สถานะ</th>
                  <th className="px-3 py-2.5 text-center text-gray-600 font-medium whitespace-nowrap">Station ในแผน</th>
                  <th className="px-3 py-2.5 text-center text-gray-600 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayed.map((r) => {
                  const origRow = rows.find(x => x.emp_id === r.emp_id) ?? r
                  const plan    = planMap.get(r.emp_id)
                  const isEdit  = editingId === r.emp_id
                  const isOv    = overrides.has(r.emp_id)

                  if (isEdit && draft) {
                    return (
                      <tr key={r.emp_id} className="bg-blue-50">
                        <td className="px-3 py-2 text-gray-500 font-mono text-xs">{r.emp_id}</td>
                        <td className="px-3 py-2">{inp(draft.name, v => setDraft(d => d && ({ ...d, name: v })), 'min-w-[120px]')}</td>
                        <td className="px-3 py-2">{inp(draft.dept, v => setDraft(d => d && ({ ...d, dept: v })), 'min-w-[120px]')}</td>
                        <td className="px-3 py-2">{sel(draft.shift, SHIFTS, v => setDraft(d => d && ({ ...d, shift: v })), 'min-w-[70px]')}</td>
                        <td className="px-3 py-2">{inp(draft.scan_in, v => setDraft(d => d && ({ ...d, scan_in: v })), 'min-w-[60px] text-center')}</td>
                        <td className="px-3 py-2">
                          {sel(draft.attendance_status, STATUSES, v => setDraft(d => d && ({ ...d, attendance_status: v })), 'min-w-[80px]')}
                        </td>
                        <td className="px-3 py-2">
                          {draft.attendance_status !== 'Absent'
                            ? sel(draft.station, ['', ...STATIONS], v => setDraft(d => d && ({ ...d, station: v })), 'min-w-[110px]')
                            : <span className="text-xs text-gray-300">ไม่ใช้</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1.5">
                            <button onClick={() => saveEdit(origRow)} disabled={saving}
                              className="text-green-600 hover:text-green-800 disabled:opacity-40" title="บันทึก">
                              <Check size={16} />
                            </button>
                            <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600" title="ยกเลิก">
                              <X size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  }

                  const hasPlan = planMap.has(r.emp_id)
                  const stationDisplay = hasPlan ? (plan?.work_station ?? null) : (r.station ?? null)
                  const isManual = plan?.upload_round === 'manual' || isOv

                  return (
                    <tr key={r.emp_id} className={`transition-colors hover:bg-gray-50 ${isOv ? 'bg-orange-50/40' : ''}`}>
                      <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{r.emp_id}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-800">{r.name}</td>
                      <td className="px-3 py-2.5 text-gray-600 text-xs max-w-[160px] truncate" title={r.dept}>{r.dept}</td>
                      <td className="px-3 py-2.5 text-gray-600">{r.shift}</td>
                      <td className="px-3 py-2.5 text-center font-mono text-gray-700">{r.scan_in || '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[r.attendance_status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABEL[r.attendance_status] ?? r.attendance_status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {stationDisplay
                          ? <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${isManual ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                              {stationDisplay}{isManual && ' ✎'}
                            </span>
                          : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button onClick={() => startEdit(r)}
                          className="text-gray-300 hover:text-blue-500 transition-colors" title="แก้ไข">
                          <Pencil size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-400 flex items-center justify-between">
            <span className="text-orange-500">✎ = แก้ไขด้วยมือ (รีเซ็ตเมื่อรีเฟรช)</span>
            <span>แสดง {displayed.length} จาก {rows.length} รายการ</span>
          </div>
        </div>
      )}
    </div>
  )
}
