'use client'
import { useState, useRef, useEffect } from 'react'
import { Upload, AlertCircle, CheckCircle2, X, Download, CalendarDays, Search, User, UserCheck, UserMinus } from 'lucide-react'
import * as XLSX from 'xlsx'
import { parseFile, ParsedRow } from '@/lib/parser'

interface UploadRecord {
  source_file: string
  record_count: number
  uploaded_at: string
}

interface WeeklyUploaderProps {
  type: string
  label: string
  theme: {
    border: string
    hoverBorder: string
    text: string
    bg: string
    hoverBg: string
  }
  onUploadSuccess?: () => void
}

function WeeklyUploader({ type, label, theme, onUploadSuccess }: WeeklyUploaderProps) {
  const [status, setStatus]   = useState<'idle' | 'parsing' | 'uploading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<ParsedRow[]>([])
  const [filename, setFilename] = useState('')
  const [history, setHistory] = useState<UploadRecord[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchHistory = async () => {
    try {
      const res  = await fetch(`/api/upload-workforce-weekly?type=${type}`)
      const data = await res.json()
      setHistory(data.uploads ?? [])
    } catch { /* silent */ }
  }

  useEffect(() => {
    fetchHistory()
  }, [type])

  const handleDelete = async (sourceFile: string) => {
    if (!confirm(`ลบ "${sourceFile}" และข้อมูลที่อัพโหลดออกจากระบบ?`)) return
    setDeleting(sourceFile)
    try {
      const res  = await fetch(`/api/upload-workforce-weekly?type=${type}&file=${encodeURIComponent(sourceFile)}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        fetchHistory()
        if (onUploadSuccess) onUploadSuccess()
      }
      else alert(data.message ?? 'ลบไม่สำเร็จ')
    } catch { alert('เกิดข้อผิดพลาด') }
    finally { setDeleting(null) }
  }

  const handleDownload = async (sourceFile: string) => {
    try {
      const res  = await fetch(`/api/upload-workforce-weekly?type=${type}&file=${encodeURIComponent(sourceFile)}`)
      const json = await res.json()
      if (!json.data?.length) { alert('ไม่มีข้อมูล'); return }
      const rows = (json.data as { row_data: Record<string, unknown> }[]).map(r => r.row_data)
      const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r))))
      const ws = XLSX.utils.aoa_to_sheet([keys, ...rows.map(r => keys.map(k => r[k] ?? ''))])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'แผนประจำสัปดาห์')
      XLSX.writeFile(wb, `${sourceFile.replace(/\.[^.]+$/, '')}_export.xlsx`)
    } catch { alert('ดาวน์โหลดไม่สำเร็จ') }
  }

  const handleFile = async (file: File) => {
    setStatus('parsing'); setMessage(''); setPreview([]); setFilename(file.name)
    try {
      const rows = await parseFile(file)
      if (!rows.length) throw new Error('ไฟล์ไม่มีข้อมูล')
      setPreview(rows.slice(0, 5)); setStatus('idle')
    } catch (e: unknown) {
      setStatus('error'); setMessage(e instanceof Error ? e.message : 'อ่านไฟล์ไม่ได้')
    }
  }

  const handleSubmit = async () => {
    if (!preview.length || !inputRef.current?.files?.length) return
    setStatus('uploading')
    try {
      const file = inputRef.current.files[0]
      const rows = await parseFile(file)
      const res  = await fetch(`/api/upload-workforce-weekly?type=${type}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rows, filename: file.name }),
      })
      const result = await res.json()
      setStatus(result.success ? 'success' : 'error')
      setMessage(result.message)
      if (result.success) {
        setPreview([]); setFilename(''); inputRef.current.value = ''
        fetchHistory()
        if (onUploadSuccess) onUploadSuccess()
      }
    } catch (e: unknown) {
      setStatus('error'); setMessage(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    }
  }

  const handleClear = () => {
    setPreview([])
    setFilename('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const previewCols = preview.length ? Object.keys(preview[0]).slice(0, 8) : []

  return (
    <div className={`card ${theme.border} pt-4 space-y-4 flex flex-col justify-between`}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <CalendarDays size={20} className={`${theme.text} shrink-0`} />
          <div>
            <p className="font-semibold text-gray-800">{label}</p>
            <p className="text-xs text-gray-500">รองรับไฟล์ .xlsx, .xls, .csv</p>
          </div>
        </div>

        <div
          className={`card border-2 border-dashed border-gray-200 ${theme.hoverBorder} transition-colors cursor-pointer text-center py-6 bg-gray-50/50 hover:bg-white`}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          onDragOver={e => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mx-auto text-gray-400 mb-2" size={32} />
          <p className="font-medium text-sm text-gray-700 px-2 truncate">{filename || 'ลากไฟล์มาวาง หรือ คลิกเพื่อเลือกไฟล์'}</p>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
        </div>

        {status === 'error' && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{message}</span>
          </div>
        )}
        {status === 'success' && (
          <div className="flex items-start gap-2.5 bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700">
            <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
            <span>{message}</span>
          </div>
        )}

        {preview.length > 0 && (
          <div className="border border-gray-100 rounded-xl p-3 bg-white space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700">ตัวอย่างข้อมูล (5 แถวแรก)</p>
              <button onClick={handleClear} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="overflow-x-auto max-h-48 border border-gray-100 rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    {previewCols.map(c => (
                      <th key={c} className="px-2 py-1.5 text-left text-gray-500 font-medium whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-b last:border-b-0 hover:bg-gray-50/50">
                      {previewCols.map(c => (
                        <td key={c} className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{String(row[c] ?? '-')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={handleSubmit}
              disabled={status === 'uploading'}
              className={`w-full ${theme.bg} ${theme.hoverBg} text-white py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50`}
            >
              {status === 'uploading' ? 'กำลังบันทึก...' : 'ยืนยันอัพโหลด'}
            </button>
          </div>
        )}
      </div>

      {/* History section inside card */}
      <div className="pt-4 border-t border-gray-100 mt-2">
        <p className="text-xs font-semibold text-gray-700 mb-2">ประวัติการอัพโหลด</p>
        {history.length > 0 ? (
          <div className="divide-y divide-gray-100 max-h-40 overflow-y-auto pr-1">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-2 py-2 hover:bg-gray-50 rounded px-1">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-mono text-gray-700 truncate" title={h.source_file}>{h.source_file}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {h.record_count.toLocaleString()} รายการ
                    <span className="mx-1">·</span>
                    {new Date(h.uploaded_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
                <button
                  onClick={() => handleDownload(h.source_file)}
                  className="shrink-0 text-gray-300 hover:text-blue-500 transition-colors p-1"
                  title="ดาวน์โหลด Excel"
                >
                  <Download size={13} />
                </button>
                <button
                  onClick={() => handleDelete(h.source_file)}
                  disabled={deleting === h.source_file}
                  className="shrink-0 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40 p-1"
                  title="ลบ"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-gray-400 italic py-1">ไม่มีประวัติการอัพโหลด</p>
        )}
      </div>
    </div>
  )
}

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

export default function WeeklyWorkforcePage() {
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date()
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  })
  const [selectedStation, setSelectedStation] = useState('sa-phok-special')
  const [workforceRows, setWorkforceRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [workerStatuses, setWorkerStatuses] = useState<Record<string, string>>({})
  const [selectedShift, setSelectedShift] = useState<'all' | '1' | '2'>('all')

  const handleStatusChange = (workerName: string, newStatus: string) => {
    setWorkerStatuses(prev => ({
      ...prev,
      [`${selectedDate}_${selectedStation}_${workerName}`]: newStatus
    }))
  }

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'ทำงาน':
        return 'bg-green-50 text-green-700 border-green-200/60'
      case 'วันหยุด':
        return 'bg-amber-50 text-amber-700 border-amber-200/60'
      case 'ลาป่วย':
        return 'bg-red-50 text-red-700 border-red-200/60'
      case 'ลากิจ':
        return 'bg-purple-50 text-purple-700 border-purple-200/60'
      case 'ลาพักร้อน':
        return 'bg-blue-50 text-blue-700 border-blue-200/60'
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200/60'
    }
  }

  const getShiftBadge = (shiftStr: string) => {
    const normalized = String(shiftStr).trim()
    if (normalized === '1' || normalized.includes('1')) {
      return (
        <span className="inline-flex items-center bg-indigo-50 text-indigo-700 border border-indigo-100/80 text-[10px] px-2 py-0.5 rounded-md font-medium">
          กะ 1 (08:00)
        </span>
      )
    }
    if (normalized === '2' || normalized.includes('2')) {
      return (
        <span className="inline-flex items-center bg-sky-50 text-sky-700 border border-sky-100/80 text-[10px] px-2 py-0.5 rounded-md font-medium">
          กะ 2 (14:00)
        </span>
      )
    }
    return <span className="text-gray-400 text-xs">{shiftStr || '-'}</span>
  }



  const [searchTerm, setSearchTerm] = useState('')
  const [statusTab, setStatusTab] = useState<'all' | 'work' | 'off'>('all')

  const themes = {
    'sa-phok-special': {
      border: 'border-t-4 border-orange-500',
      hoverBorder: 'hover:border-orange-400',
      text: 'text-orange-500',
      bg: 'bg-orange-600',
      hoverBg: 'hover:bg-orange-700',
      badgeColor: 'border-orange-200 bg-orange-50 text-orange-700'
    },
    'sam-chan-special': {
      border: 'border-t-4 border-blue-500',
      hoverBorder: 'hover:border-blue-400',
      text: 'text-blue-500',
      bg: 'bg-blue-600',
      hoverBg: 'hover:bg-blue-700',
      badgeColor: 'border-blue-200 bg-blue-50 text-blue-700'
    },
    'lai-special': {
      border: 'border-t-4 border-emerald-500',
      hoverBorder: 'hover:border-emerald-400',
      text: 'text-emerald-500',
      bg: 'bg-emerald-600',
      hoverBg: 'hover:bg-emerald-700',
      badgeColor: 'border-emerald-200 bg-emerald-50 text-emerald-700'
    }
  }

  const stations = [
    { value: 'sa-phok-special', label: 'สะโพกพิเศษ' },
    { value: 'sam-chan-special', label: 'สามชั้นพิเศษ' },
    { value: 'lai-special', label: 'ไหล่พิเศษ' }
  ]

  // Fetch the latest uploaded workforce records whenever the selected station or refresh trigger changes
  useEffect(() => {
    let active = true
    const fetchLatest = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`/api/upload-workforce-weekly?type=${selectedStation}&latest=true`)
        const data = await res.json()
        if (active) {
          if (data.error) {
            setError(data.error)
            setWorkforceRows([])
          } else {
            setWorkforceRows(data.data ?? [])
          }
        }
      } catch (err) {
        if (active) {
          setError('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์')
          setWorkforceRows([])
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    fetchLatest()
    return () => { active = false }
  }, [selectedStation, refreshTrigger])

  const handleUploadChange = () => {
    setRefreshTrigger(prev => prev + 1)
  }

  // Safe helper to extract values from dynamic Excel keys
  const getFieldValue = (rowData: Record<string, any>, prefixes: string[]): string => {
    if (!rowData) return ''
    for (const prefix of prefixes) {
      if (rowData[prefix] !== undefined && rowData[prefix] !== null) {
        return String(rowData[prefix]).trim()
      }
    }
    const keys = Object.keys(rowData)
    for (const prefix of prefixes) {
      const foundKey = keys.find(k => k.toLowerCase().includes(prefix.toLowerCase()))
      if (foundKey && rowData[foundKey] !== undefined && rowData[foundKey] !== null) {
        return String(rowData[foundKey]).trim()
      }
    }
    return ''
  }

  // Calculate day status: returns true if this date is a day off
  const checkIsDayOff = (dayOffVal: string, dateStr: string) => {
    if (!dayOffVal || !dateStr) return false
    const parts = dateStr.split('-')
    if (parts.length !== 3) return false
    const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    const dayIndex = dateObj.getDay()
    const dayName = THAI_DAYS[dayIndex]
    
    const normalizedVal = dayOffVal.trim().toLowerCase()
    const aliases = DAY_ALIASES[dayName] || [dayName]
    
    return aliases.some(alias => normalizedVal.includes(alias.toLowerCase()))
  }

  // Process rows
  const processedWorkers = workforceRows.map((r, i) => {
    const rowData = r.row_data ?? {}
    const name = getFieldValue(rowData, ['รายชื่อพนักงาน', 'ชื่อจริง', 'ชื่อพนักงาน', 'ชื่อ', 'name', 'full_name'])
    const nickname = getFieldValue(rowData, ['ชื่อเล่น', 'nickname', 'nick'])
    const dayOffStr = getFieldValue(rowData, ['วันหยุดประจำสัปดาห์', 'วันหยุดประจำ', 'วันหยุด', 'หยุด', 'dayoff', 'day_off', 'day off'])
    const shiftStr = getFieldValue(rowData, ['กะทำงาน', 'กะ', 'กะงาน', 'shift'])
    
    // Check if worker is off or working
    const isOff = checkIsDayOff(dayOffStr, selectedDate)
    const workerName = name || 'ไม่ระบุชื่อ'
    const status = workerStatuses[`${selectedDate}_${selectedStation}_${workerName}`] || (isOff ? 'วันหยุด' : 'ทำงาน')
    
    return {
      index: i + 1,
      name: workerName,
      nickname: nickname || '-',
      dayOffStr,
      isOff,
      status,
      shiftStr
    }
  }).filter(w => {
    // Search Term Filter
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return w.name.toLowerCase().includes(term) || w.nickname.toLowerCase().includes(term)
  }).filter(w => {
    // Shift Filter
    if (selectedShift === '1') {
      const normalized = w.shiftStr.trim()
      return normalized === '1' || normalized.includes('1')
    }
    if (selectedShift === '2') {
      const normalized = w.shiftStr.trim()
      return normalized === '2' || normalized.includes('2')
    }
    return true
  }).filter(w => {
    // Tab Filter
    if (statusTab === 'work') return w.status === 'ทำงาน'
    if (statusTab === 'off') return w.status !== 'ทำงาน'
    return true
  })

  // Statistics calculations based on shift-filtered list
  const allWorkersCalculated = workforceRows.map(r => {
    const rowData = r.row_data ?? {}
    const name = getFieldValue(rowData, ['รายชื่อพนักงาน', 'ชื่อจริง', 'ชื่อพนักงาน', 'ชื่อ', 'name', 'full_name']) || 'ไม่ระบุชื่อ'
    const dayOffStr = getFieldValue(rowData, ['วันหยุดประจำสัปดาห์', 'วันหยุดประจำ', 'วันหยุด', 'หยุด', 'dayoff', 'day_off', 'day off'])
    const shiftStr = getFieldValue(rowData, ['กะทำงาน', 'กะ', 'กะงาน', 'shift'])
    const isOff = checkIsDayOff(dayOffStr, selectedDate)
    const status = workerStatuses[`${selectedDate}_${selectedStation}_${name}`] || (isOff ? 'วันหยุด' : 'ทำงาน')
    return { status, shiftStr }
  }).filter(w => {
    if (selectedShift === '1') {
      const normalized = w.shiftStr.trim()
      return normalized === '1' || normalized.includes('1')
    }
    if (selectedShift === '2') {
      const normalized = w.shiftStr.trim()
      return normalized === '2' || normalized.includes('2')
    }
    return true
  })
  
  const totalCount = allWorkersCalculated.length
  const workingCount = allWorkersCalculated.filter(w => w.status === 'ทำงาน').length
  const dayOffCount = totalCount - workingCount

  // Get current Thai day name to show in UI
  const getThaiDayLabel = () => {
    const parts = selectedDate.split('-')
    if (parts.length !== 3) return ''
    const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    return `วัน${THAI_DAYS[dateObj.getDay()]}`
  }

  const selectedTheme = themes[selectedStation as keyof typeof themes] ?? themes['sa-phok-special']

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Title */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">แผนเข้างานประจำสัปดาห์</h1>
        <p className="text-xs md:text-sm text-gray-500 mt-1">ตรวจสอบสถานะการทำงานรายวัน และ จัดการอัปโหลดตารางเข้างานของคนงาน</p>
      </div>

      {/* 1. Daily Status Panel & Table (TOP) */}
      <div className="card space-y-5 md:space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-4 md:pb-5">
          <div className="space-y-1">
            <h2 className="text-base md:text-lg font-bold text-gray-900 flex items-center gap-2">
              <CalendarDays className="text-blue-500 shrink-0" size={20} />
              ตรวจสอบสถานะกำลังคนประจำวัน
            </h2>
            <p className="text-[11px] md:text-xs text-gray-500">
              สถานะการทำงานของพนักงานประเมินจาก วันหยุดประจำสัปดาห์ ในแผนงานล่าสุด
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
            {/* Date Input */}
            <div className="flex flex-col flex-1 sm:flex-initial sm:min-w-[150px]">
              <span className="text-[10px] md:text-[11px] font-semibold text-gray-400 mb-1 uppercase tracking-wider">วันที่เข้างาน</span>
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-xs"
              />
            </div>

            {/* Station Dropdown */}
            <div className="flex flex-col flex-1 sm:flex-initial sm:min-w-[160px]">
              <span className="text-[10px] md:text-[11px] font-semibold text-gray-400 mb-1 uppercase tracking-wider">กลุ่มงาน / Station</span>
              <select
                value={selectedStation}
                onChange={e => {
                  setSelectedStation(e.target.value)
                  setStatusTab('all')
                }}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-xs"
              >
                {stations.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Shift Dropdown */}
            <div className="flex flex-col flex-1 sm:flex-initial sm:min-w-[150px]">
              <span className="text-[10px] md:text-[11px] font-semibold text-gray-400 mb-1 uppercase tracking-wider">กะทำงาน</span>
              <select
                value={selectedShift}
                onChange={e => {
                  setSelectedShift(e.target.value as 'all' | '1' | '2')
                }}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-xs"
              >
                <option value="all">ทั้งหมด</option>
                <option value="1">กะที่ 1 (08:00)</option>
                <option value="2">กะที่ 2 (14:00)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        {workforceRows.length > 0 && !loading && (
          <div className="grid grid-cols-3 gap-2 sm:gap-4 bg-gray-50/50 p-3 sm:p-4 rounded-2xl border border-gray-100">
            <div className="text-center py-1">
              <p className="text-[10px] sm:text-[11px] font-semibold text-gray-400 uppercase tracking-wider">คนงานทั้งหมด</p>
              <p className="text-lg sm:text-2xl font-bold text-gray-800 mt-1 flex items-center justify-center gap-1">
                <User size={16} className="text-gray-400 shrink-0" />
                {totalCount} <span className="text-[10px] sm:text-xs font-normal text-gray-500">คน</span>
              </p>
            </div>
            <div className="text-center py-1 border-x border-gray-200">
              <p className="text-[10px] sm:text-[11px] font-semibold text-green-600 uppercase tracking-wider">มาทำงาน</p>
              <p className="text-lg sm:text-2xl font-bold text-green-600 mt-1 flex items-center justify-center gap-1">
                <UserCheck size={16} className="text-green-500 shrink-0" />
                {workingCount} <span className="text-[10px] sm:text-xs font-normal text-green-500/80">คน</span>
              </p>
            </div>
            <div className="text-center py-1">
              <p className="text-[10px] sm:text-[11px] font-semibold text-amber-600 uppercase tracking-wider">วันหยุด ({getThaiDayLabel()})</p>
              <p className="text-lg sm:text-2xl font-bold text-amber-600 mt-1 flex items-center justify-center gap-1">
                <UserMinus size={16} className="text-amber-500 shrink-0" />
                {dayOffCount} <span className="text-[10px] sm:text-xs font-normal text-amber-500/80">คน</span>
              </p>
            </div>
          </div>
        )}

        {/* Filters and search box */}
        {workforceRows.length > 0 && !loading && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
            {/* Toggle tabs */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl w-full sm:w-auto">
              <button
                onClick={() => setStatusTab('all')}
                className={`flex-1 sm:flex-none text-xs font-semibold px-3 sm:px-4 py-2 rounded-lg transition-all ${
                  statusTab === 'all' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                ทั้งหมด ({totalCount})
              </button>
              <button
                onClick={() => setStatusTab('work')}
                className={`flex-1 sm:flex-none text-xs font-semibold px-3 sm:px-4 py-2 rounded-lg transition-all ${
                  statusTab === 'work' ? 'bg-green-600 text-white shadow-sm' : 'text-green-600 hover:bg-green-50'
                }`}
              >
                ทำงาน ({workingCount})
              </button>
              <button
                onClick={() => setStatusTab('off')}
                className={`flex-1 sm:flex-none text-xs font-semibold px-3 sm:px-4 py-2 rounded-lg transition-all ${
                  statusTab === 'off' ? 'bg-amber-600 text-white shadow-sm' : 'text-amber-600 hover:bg-amber-50'
                }`}
              >
                วันหยุด ({dayOffCount})
              </button>
            </div>

            {/* Search inputs */}
            <div className="relative w-full sm:w-72">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <Search size={16} />
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="ค้นหาชื่อพนักงาน หรือชื่อเล่น..."
                className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Data area */}
        {loading ? (
          <div className="py-12 space-y-4">
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
            <p className="text-center text-xs text-gray-400">กำลังโหลดแผนเข้างานประจำวันล่าสุด...</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-2xl p-4 text-sm text-red-700">
            <AlertCircle size={20} className="shrink-0" />
            <span>{error}</span>
          </div>
        ) : workforceRows.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
            <CalendarDays className="mx-auto text-gray-300 mb-3" size={44} />
            <h3 className="font-semibold text-gray-700 text-sm">ไม่พบแผนเข้างานประจำสัปดาห์</h3>
            <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto px-4">
              ยังไม่มีการอัพโหลดแผนเข้างานสำหรับกลุ่มงานนี้ หรือคุณอาจลบแผนงานก่อนหน้านี้ไปแล้ว กรุณาอัพโหลดแผนเข้างานด้านล่าง (เข้าชมด้วยคอมพิวเตอร์เพื่อทำรายการอัปโหลด)
            </p>
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
                      <td className="px-2 py-2.5 sm:px-5 sm:py-3 text-center">
                        {getShiftBadge(w.shiftStr)}
                      </td>
                      <td className="px-2 py-2.5 sm:px-5 sm:py-3 text-center">
                        {w.isOff ? (
                          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200/60 text-[10px] sm:text-xs px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full font-medium shadow-xs">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                            วันหยุด
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200/60 text-[10px] sm:text-xs px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full font-medium shadow-xs">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                            ทำงาน
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 sm:px-5 sm:py-3 text-center">
                        <select
                          value={w.status}
                          onChange={(e) => handleStatusChange(w.name, e.target.value)}
                          className={`text-[10px] sm:text-xs font-semibold px-2 py-0.5 sm:py-1 rounded-full border shadow-xs focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${getStatusBadgeClass(w.status)}`}
                        >
                          <option value="ทำงาน" className="bg-white text-green-700">ทำงาน</option>
                          <option value="วันหยุด" className="bg-white text-amber-700">วันหยุด</option>
                          <option value="ลาป่วย" className="bg-white text-red-700">ลาป่วย</option>
                          <option value="ลากิจ" className="bg-white text-purple-700">ลากิจ</option>
                          <option value="ลาพักร้อน" className="bg-white text-blue-700">ลาพักร้อน</option>
                          <option value="อื่นๆ" className="bg-white text-gray-700">อื่นๆ</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Divider - Hidden on Mobile */}
      <div className="hidden md:block relative py-3">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-gray-200"></div>
        </div>
        <div className="relative flex justify-center text-xs font-semibold uppercase tracking-wider">
          <span className="bg-gray-50 px-4 text-gray-400">อัปโหลดแผนประจำสัปดาห์ (Upload Weekly Plan)</span>
        </div>
      </div>

      {/* 2. Uploader cards (BOTTOM) - Hidden on Mobile */}
      <div className="hidden md:grid grid-cols-1 lg:grid-cols-3 gap-6">
        <WeeklyUploader
          type="sa-phok-special"
          label="สะโพกพิเศษ"
          theme={themes['sa-phok-special']}
          onUploadSuccess={handleUploadChange}
        />
        <WeeklyUploader
          type="sam-chan-special"
          label="สามชั้นพิเศษ"
          theme={themes['sam-chan-special']}
          onUploadSuccess={handleUploadChange}
        />
        <WeeklyUploader
          type="lai-special"
          label="ไหล่พิเศษ"
          theme={themes['lai-special']}
          onUploadSuccess={handleUploadChange}
        />
      </div>
    </div>
  )
}


