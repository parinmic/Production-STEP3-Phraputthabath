'use client'
import { useState, useEffect } from 'react'
import { AlertCircle, CalendarDays, Search, User, UserCheck, UserMinus, X } from 'lucide-react'

const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const DAY_ALIASES: Record<string, string[]> = {
  'อาทิตย์': ['อาทิตย์', 'อา.'],
  'จันทร์': ['จันทร์', 'จ.'],
  'อังคาร': ['อังคาร', 'อ.'],
  'พุธ': ['พุธ', 'พ.'],
  'พฤหัสบดี': ['พฤหัสบดี', 'พฤหัส', 'พฤ.'],
  'ศุกร์': ['ศุกร์', 'ศ.'],
  'เสาร์': ['เสาร์', 'ส.']
}

const stations = [
  { value: 'sa-phok-special',  label: 'สะโพกพิเศษ' },
  { value: 'sam-chan-special',  label: 'สามชั้นพิเศษ' },
  { value: 'lai-special',      label: 'ไหล่พิเศษ' },
  { value: 'moo-chod-special', label: 'หมูบดพิเศษ' },
  { value: 'slide-special',    label: 'สไลด์พิเศษ' },
  { value: 'pao-kha-special',  label: 'เผาขาพิเศษ' },
  { value: 'loa-kha-special',  label: 'เลาะขาพิเศษ' },
]

export default function WorkforceDailyStatusPage() {
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [selectedStation, setSelectedStation] = useState('sa-phok-special')
  const [selectedShift, setSelectedShift] = useState<'all' | '1' | '2'>('all')
  const [workforceRows, setWorkforceRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [workerStatuses, setWorkerStatuses] = useState<Record<string, string>>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [statusTab, setStatusTab] = useState<'all' | 'work' | 'off'>('all')
  const [statusPopup, setStatusPopup] = useState<{ workerName: string; currentStatus: string } | null>(null)
  const [pendingStatus, setPendingStatus] = useState('')

  useEffect(() => {
    let active = true
    const fetchOverrides = async () => {
      try {
        const res = await fetch(`/api/workforce-daily-status?date=${selectedDate}&station=${selectedStation}`)
        const data = await res.json()
        if (active && data.success) {
          const overrides: Record<string, string> = {}
          if (data.data) {
            for (const item of data.data) {
              overrides[`${item.work_date}_${item.weekly_type}_${item.worker_name}`] = item.status
            }
          }
          setWorkerStatuses(prev => ({ ...prev, ...overrides }))
        }
      } catch {}
    }
    fetchOverrides()
    return () => { active = false }
  }, [selectedDate, selectedStation])

  useEffect(() => {
    let active = true
    const fetchLatest = async () => {
      setLoading(true); setError('')
      try {
        const res = await fetch(`/api/upload-workforce-weekly?type=${selectedStation}&latest=true`)
        const data = await res.json()
        if (active) {
          if (data.error) { setError(data.error); setWorkforceRows([]) }
          else { setWorkforceRows(data.data ?? []) }
        }
      } catch {
        if (active) { setError('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์'); setWorkforceRows([]) }
      } finally { if (active) setLoading(false) }
    }
    fetchLatest()
    return () => { active = false }
  }, [selectedStation])

  const getFieldValue = (rowData: Record<string, any>, prefixes: string[]): string => {
    if (!rowData) return ''
    for (const prefix of prefixes) {
      if (rowData[prefix] !== undefined && rowData[prefix] !== null) return String(rowData[prefix]).trim()
    }
    const keys = Object.keys(rowData)
    for (const prefix of prefixes) {
      const foundKey = keys.find(k => k.toLowerCase().includes(prefix.toLowerCase()))
      if (foundKey && rowData[foundKey] !== undefined) return String(rowData[foundKey]).trim()
    }
    return ''
  }

  const checkIsDayOff = (dayOffVal: string, dateStr: string) => {
    if (!dayOffVal || !dateStr) return false
    const parts = dateStr.split('-')
    if (parts.length !== 3) return false
    const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    const dayName = THAI_DAYS[dateObj.getDay()]
    const normalizedVal = dayOffVal.trim().toLowerCase()
    const aliases = DAY_ALIASES[dayName] || [dayName]
    return aliases.some(alias => normalizedVal.includes(alias.toLowerCase()))
  }

  const handleStatusChange = async (workerName: string, newStatus: string) => {
    setWorkerStatuses(prev => ({ ...prev, [`${selectedDate}_${selectedStation}_${workerName}`]: newStatus }))
    try {
      const res = await fetch('/api/workforce-daily-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, station: selectedStation, workerName, status: newStatus })
      })
      const data = await res.json()
      if (!data.success) alert('บันทึกสถานะไม่สำเร็จ: ' + (data.message || ''))
    } catch { alert('เกิดข้อผิดพลาดในการบันทึกสถานะพนักงาน') }
  }

  const openStatusPopup = (workerName: string, currentStatus: string) => {
    setStatusPopup({ workerName, currentStatus }); setPendingStatus(currentStatus)
  }

  const saveStatusFromPopup = async () => {
    if (!statusPopup) return
    await handleStatusChange(statusPopup.workerName, pendingStatus)
    setStatusPopup(null)
  }

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'ทำงาน': return 'bg-green-50 text-green-700 border-green-200/60'
      case 'วันหยุด': return 'bg-amber-50 text-amber-700 border-amber-200/60'
      case 'ลาป่วย': return 'bg-red-50 text-red-700 border-red-200/60'
      case 'ลากิจ': return 'bg-purple-50 text-purple-700 border-purple-200/60'
      case 'ลาพักร้อน': return 'bg-blue-50 text-blue-700 border-blue-200/60'
      default: return 'bg-gray-50 text-gray-700 border-gray-200/60'
    }
  }

  const getShiftBadge = (shiftStr: string) => {
    const normalized = String(shiftStr).trim()
    if (normalized === '1' || normalized.includes('1'))
      return <span className="inline-flex items-center bg-indigo-50 text-indigo-700 border border-indigo-100/80 text-[10px] px-2 py-0.5 rounded-md font-medium">กะ 1 (08:30 - 17:30)</span>
    if (normalized === '2' || normalized.includes('2'))
      return <span className="inline-flex items-center bg-sky-50 text-sky-700 border border-sky-100/80 text-[10px] px-2 py-0.5 rounded-md font-medium">กะ 2 (14:30 - 23:30)</span>
    return <span className="text-gray-400 text-xs">{shiftStr || '-'}</span>
  }

  const getThaiDayLabel = () => {
    const parts = selectedDate.split('-')
    if (parts.length !== 3) return ''
    return `วัน${THAI_DAYS[new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getDay()]}`
  }

  const allWorkersCalculated = workforceRows.map(r => {
    const rowData = r.row_data ?? {}
    const name = getFieldValue(rowData, ['รายชื่อพนักงาน', 'ชื่อจริง', 'ชื่อพนักงาน', 'ชื่อ', 'name', 'full_name']) || 'ไม่ระบุชื่อ'
    const dayOffStr = getFieldValue(rowData, ['วันหยุดประจำสัปดาห์', 'วันหยุดประจำ', 'วันหยุด', 'หยุด', 'dayoff', 'day_off', 'day off'])
    const shiftStr = getFieldValue(rowData, ['กะทำงาน', 'กะ', 'กะงาน', 'shift'])
    const isOff = checkIsDayOff(dayOffStr, selectedDate)
    const status = workerStatuses[`${selectedDate}_${selectedStation}_${name}`] || (isOff ? 'วันหยุด' : 'ทำงาน')
    return { status, shiftStr }
  }).filter(w => {
    if (selectedShift === '1') return String(w.shiftStr).trim() === '1' || String(w.shiftStr).includes('1')
    if (selectedShift === '2') return String(w.shiftStr).trim() === '2' || String(w.shiftStr).includes('2')
    return true
  })

  const processedWorkers = workforceRows.map((r, i) => {
    const rowData = r.row_data ?? {}
    const name = getFieldValue(rowData, ['รายชื่อพนักงาน', 'ชื่อจริง', 'ชื่อพนักงาน', 'ชื่อ', 'name', 'full_name'])
    const nickname = getFieldValue(rowData, ['ชื่อเล่น', 'nickname', 'nick'])
    const dayOffStr = getFieldValue(rowData, ['วันหยุดประจำสัปดาห์', 'วันหยุดประจำ', 'วันหยุด', 'หยุด', 'dayoff', 'day_off', 'day off'])
    const shiftStr = getFieldValue(rowData, ['กะทำงาน', 'กะ', 'กะงาน', 'shift'])
    const isOff = checkIsDayOff(dayOffStr, selectedDate)
    const workerName = name || 'ไม่ระบุชื่อ'
    const status = workerStatuses[`${selectedDate}_${selectedStation}_${workerName}`] || (isOff ? 'วันหยุด' : 'ทำงาน')
    return { index: i + 1, name: workerName, nickname: nickname || '-', dayOffStr, isOff, status, shiftStr }
  }).filter(w => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      if (!w.name.toLowerCase().includes(term) && !w.nickname.toLowerCase().includes(term)) return false
    }
    if (selectedShift === '1') return String(w.shiftStr).trim() === '1' || String(w.shiftStr).includes('1')
    if (selectedShift === '2') return String(w.shiftStr).trim() === '2' || String(w.shiftStr).includes('2')
    return true
  }).filter(w => {
    if (statusTab === 'work') return w.status === 'ทำงาน'
    if (statusTab === 'off') return w.status !== 'ทำงาน'
    return true
  })

  const totalCount = allWorkersCalculated.length
  const workingCount = allWorkersCalculated.filter(w => w.status === 'ทำงาน').length
  const dayOffCount = totalCount - workingCount

  return (
    <div className="space-y-6 md:space-y-8">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">ตรวจสอบสถานะกำลังคนประจำวัน</h1>
        <p className="text-xs md:text-sm text-gray-500 mt-1">สถานะการทำงานของพนักงานประเมินจาก วันหยุดประจำสัปดาห์ ในแผนงานล่าสุด</p>
      </div>

      <div className="card space-y-5 md:space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-4 md:pb-5">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full">
            <div className="flex flex-col flex-1 sm:min-w-[150px]">
              <span className="text-[10px] md:text-[11px] font-semibold text-gray-400 mb-1 uppercase tracking-wider">วันที่เข้างาน</span>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
            </div>
            <div className="flex flex-col flex-1 sm:min-w-[160px]">
              <span className="text-[10px] md:text-[11px] font-semibold text-gray-400 mb-1 uppercase tracking-wider">กลุ่มงาน / Station</span>
              <select value={selectedStation} onChange={e => { setSelectedStation(e.target.value); setStatusTab('all') }}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                {stations.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col flex-1 sm:min-w-[150px]">
              <span className="text-[10px] md:text-[11px] font-semibold text-gray-400 mb-1 uppercase tracking-wider">กะทำงาน</span>
              <select value={selectedShift} onChange={e => setSelectedShift(e.target.value as 'all' | '1' | '2')}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                <option value="all">ทั้งหมด</option>
                <option value="1">กะที่ 1 (08:30 - 17:30)</option>
                <option value="2">กะที่ 2 (14:30 - 23:30)</option>
              </select>
            </div>
          </div>
        </div>

        {workforceRows.length > 0 && !loading && (
          <div className="grid grid-cols-3 gap-2 sm:gap-4 bg-gray-50/50 p-3 sm:p-4 rounded-2xl border border-gray-100">
            <div className="text-center py-1">
              <p className="text-[10px] sm:text-[11px] font-semibold text-gray-400 uppercase tracking-wider">คนงานทั้งหมด</p>
              <p className="text-lg sm:text-2xl font-bold text-gray-800 mt-1 flex items-center justify-center gap-1">
                <User size={16} className="text-gray-400 shrink-0" />{totalCount} <span className="text-[10px] sm:text-xs font-normal text-gray-500">คน</span>
              </p>
            </div>
            <div className="text-center py-1 border-x border-gray-200">
              <p className="text-[10px] sm:text-[11px] font-semibold text-green-600 uppercase tracking-wider">มาทำงาน</p>
              <p className="text-lg sm:text-2xl font-bold text-green-600 mt-1 flex items-center justify-center gap-1">
                <UserCheck size={16} className="text-green-500 shrink-0" />{workingCount} <span className="text-[10px] sm:text-xs font-normal text-green-500/80">คน</span>
              </p>
            </div>
            <div className="text-center py-1">
              <p className="text-[10px] sm:text-[11px] font-semibold text-amber-600 uppercase tracking-wider">วันหยุด ({getThaiDayLabel()})</p>
              <p className="text-lg sm:text-2xl font-bold text-amber-600 mt-1 flex items-center justify-center gap-1">
                <UserMinus size={16} className="text-amber-500 shrink-0" />{dayOffCount} <span className="text-[10px] sm:text-xs font-normal text-amber-500/80">คน</span>
              </p>
            </div>
          </div>
        )}

        {workforceRows.length > 0 && !loading && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl w-full sm:w-auto">
              <button onClick={() => setStatusTab('all')} className={`flex-1 sm:flex-none text-xs font-semibold px-3 sm:px-4 py-2 rounded-lg transition-all ${statusTab === 'all' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>ทั้งหมด ({totalCount})</button>
              <button onClick={() => setStatusTab('work')} className={`flex-1 sm:flex-none text-xs font-semibold px-3 sm:px-4 py-2 rounded-lg transition-all ${statusTab === 'work' ? 'bg-green-600 text-white shadow-sm' : 'text-green-600 hover:bg-green-50'}`}>ทำงาน ({workingCount})</button>
              <button onClick={() => setStatusTab('off')} className={`flex-1 sm:flex-none text-xs font-semibold px-3 sm:px-4 py-2 rounded-lg transition-all ${statusTab === 'off' ? 'bg-amber-600 text-white shadow-sm' : 'text-amber-600 hover:bg-amber-50'}`}>วันหยุด ({dayOffCount})</button>
            </div>
            <div className="relative w-full sm:w-72">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><Search size={16} /></span>
              <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="ค้นหาชื่อพนักงาน หรือชื่อเล่น..."
                className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
              {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 space-y-4">
            <div className="flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div></div>
            <p className="text-center text-xs text-gray-400">กำลังโหลดแผนเข้างานประจำวันล่าสุด...</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-2xl p-4 text-sm text-red-700"><AlertCircle size={20} className="shrink-0" /><span>{error}</span></div>
        ) : workforceRows.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
            <CalendarDays className="mx-auto text-gray-300 mb-3" size={44} />
            <h3 className="font-semibold text-gray-700 text-sm">ไม่พบแผนเข้างานประจำวัน</h3>
            <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto px-4">ยังไม่มีการอัพโหลดแผนเข้างานสำหรับกลุ่มงานนี้</p>
          </div>
        ) : processedWorkers.length === 0 ? (
          <div className="text-center py-12 border border-gray-100 rounded-2xl">
            <p className="text-xs text-gray-400 italic">ไม่พบพนักงานเข้าเงื่อนไขการค้นหา/ฟิลเตอร์</p>
          </div>
        ) : (
          <div className="overflow-hidden border border-gray-100 rounded-2xl shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold text-[10px] sm:text-xs">
                    <th className="px-2 py-2.5 sm:px-5 sm:py-3 w-10 sm:w-16 text-center">ลำดับ</th>
                    <th className="px-2 py-2.5 sm:px-5 sm:py-3">ชื่อจริง</th>
                    <th className="px-2 py-2.5 sm:px-5 sm:py-3">ชื่อเล่น</th>
                    <th className="px-2 py-2.5 sm:px-5 sm:py-3 w-16 sm:w-24 text-center">กะ</th>
                    <th className="px-2 py-2.5 sm:px-5 sm:py-3 w-20 sm:w-32 text-center">วันทำงาน</th>
                    <th className="px-2 py-2.5 sm:px-5 sm:py-3 w-24 sm:w-40 text-center">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs sm:text-sm">
                  {processedWorkers.map((w) => (
                    <tr key={w.index} className="hover:bg-gray-50/40 transition-colors">
                      <td className="px-2 py-2.5 sm:px-5 sm:py-3 text-center text-[10px] sm:text-xs font-mono text-gray-400">{w.index}</td>
                      <td className="px-2 py-2.5 sm:px-5 sm:py-3 font-medium text-gray-800">{w.name}</td>
                      <td className="px-2 py-2.5 sm:px-5 sm:py-3 text-gray-600">{w.nickname}</td>
                      <td className="px-2 py-2.5 sm:px-5 sm:py-3 text-center">{getShiftBadge(w.shiftStr)}</td>
                      <td className="px-2 py-2.5 sm:px-5 sm:py-3 text-center">
                        {w.isOff ? (
                          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200/60 text-[10px] sm:text-xs px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"></span>วันหยุด
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200/60 text-[10px] sm:text-xs px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-500"></span>ทำงาน
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 sm:px-5 sm:py-3 text-center">
                        <button onClick={() => openStatusPopup(w.name, w.status)}
                          className={`text-[10px] sm:text-xs font-semibold px-2 py-0.5 sm:py-1 rounded-full border shadow-xs cursor-pointer transition-opacity hover:opacity-80 ${getStatusBadgeClass(w.status)}`}>
                          {w.status}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {statusPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setStatusPopup(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-5 w-64 z-10">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-gray-800 text-sm">เปลี่ยนสถานะ</h3>
              <button onClick={() => setStatusPopup(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <p className="text-[11px] text-gray-400 mb-4 truncate">{statusPopup.workerName}</p>
            <div className="space-y-2 mb-5">
              {[
                { value: 'ทำงาน', cls: 'bg-green-50 text-green-700 border-green-300' },
                { value: 'วันหยุด', cls: 'bg-amber-50 text-amber-700 border-amber-300' },
                { value: 'ลาป่วย', cls: 'bg-red-50 text-red-700 border-red-300' },
                { value: 'ลากิจ', cls: 'bg-purple-50 text-purple-700 border-purple-300' },
                { value: 'ลาพักร้อน', cls: 'bg-blue-50 text-blue-700 border-blue-300' },
                { value: 'อื่นๆ', cls: 'bg-gray-50 text-gray-700 border-gray-300' },
              ].map(({ value, cls }) => (
                <button key={value} onClick={() => setPendingStatus(value)}
                  className={`w-full text-left text-xs px-3 py-2 rounded-full border font-semibold transition-all ${pendingStatus === value ? `${cls} ring-2 ring-offset-1 ring-blue-400` : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                  {value}
                </button>
              ))}
            </div>
            <button onClick={saveStatusFromPopup} className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-xl text-xs font-semibold transition-colors">บันทึก</button>
          </div>
        </div>
      )}
    </div>
  )
}
