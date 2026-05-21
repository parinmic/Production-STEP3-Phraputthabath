'use client'
import { useState, useRef, useEffect } from 'react'
import { Upload, AlertCircle, CheckCircle2, X, Download, CalendarDays } from 'lucide-react'
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
}

function WeeklyUploader({ type, label, theme }: WeeklyUploaderProps) {
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
      if (data.success) fetchHistory()
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

export default function WeeklyWorkforcePage() {
  const themes = {
    'sa-phok-special': {
      border: 'border-t-4 border-orange-500',
      hoverBorder: 'hover:border-orange-400',
      text: 'text-orange-500',
      bg: 'bg-orange-600',
      hoverBg: 'hover:bg-orange-700'
    },
    'sam-chan-special': {
      border: 'border-t-4 border-blue-500',
      hoverBorder: 'hover:border-blue-400',
      text: 'text-blue-500',
      bg: 'bg-blue-600',
      hoverBg: 'hover:bg-blue-700'
    },
    'lai-special': {
      border: 'border-t-4 border-emerald-500',
      hoverBorder: 'hover:border-emerald-400',
      text: 'text-emerald-500',
      bg: 'bg-emerald-600',
      hoverBg: 'hover:bg-emerald-700'
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">แผนเข้างานประจำสัปดาห์</h1>
        <p className="text-gray-500 mt-1">อัพโหลดไฟล์แผนการเข้างานของคนงานแยกตามสัปดาห์และแผนกพิเศษ</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <WeeklyUploader
          type="sa-phok-special"
          label="สะโพกพิเศษ (Special Hip)"
          theme={themes['sa-phok-special']}
        />
        <WeeklyUploader
          type="sam-chan-special"
          label="สามชั้นพิเศษ (Special Belly)"
          theme={themes['sam-chan-special']}
        />
        <WeeklyUploader
          type="lai-special"
          label="ไหล่พิเศษ (Special Shoulder)"
          theme={themes['lai-special']}
        />
      </div>
    </div>
  )
}

