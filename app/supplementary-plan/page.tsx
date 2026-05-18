'use client'
import { useState, useRef, useEffect } from 'react'
import { Upload, AlertCircle, CheckCircle2, X, Truck, Clock } from 'lucide-react'
import { ParsedRow, parseLotusWetMarketFile } from '@/lib/parser'

interface UploadRecord {
  source_file: string
  record_count: number
  uploaded_at: string
  loading_time?: string | null
  deadline_time?: string | null
}

function addMinutes(time: string, delta: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + delta
  const hh = Math.floor(((total % 1440) + 1440) % 1440 / 60)
  const mm = ((total % 1440) + 1440) % 1440 % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export default function SupplementaryPlanPage() {
  const [loadingTime, setLoadingTime] = useState('')
  const [status, setStatus]           = useState<'idle' | 'parsing' | 'uploading' | 'success' | 'error'>('idle')
  const [message, setMessage]         = useState('')
  const [preview, setPreview]         = useState<ParsedRow[]>([])
  const [filename, setFilename]       = useState('')
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  const [history, setHistory]         = useState<UploadRecord[]>([])
  const [deleting, setDeleting]       = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const deadlineTime = loadingTime ? addMinutes(loadingTime, -30) : ''

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/upload-supplementary-plan')
      const data = await res.json()
      setHistory(data.uploads ?? [])
    } catch { /* silent */ }
  }

  useEffect(() => { fetchHistory() }, [])

  const handleFile = async (file: File) => {
    setStatus('parsing'); setMessage(''); setPreview([]); setFilename(file.name); setCurrentFile(file)
    try {
      const rows = await parseLotusWetMarketFile(file)
      if (!rows.length) throw new Error('ไฟล์ไม่มีข้อมูล')
      setPreview(rows.slice(0, 5)); setStatus('idle')
    } catch (e: unknown) {
      setStatus('error'); setMessage(e instanceof Error ? e.message : 'อ่านไฟล์ไม่ได้')
    }
  }

  const handleSubmit = async () => {
    if (!currentFile || !preview.length) return
    if (!loadingTime) { setStatus('error'); setMessage('กรุณาระบุเวลาโหลดจ่ายก่อนอัพโหลด'); return }
    setStatus('uploading')
    try {
      const rows = await parseLotusWetMarketFile(currentFile)
      const res = await fetch('/api/upload-supplementary-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, filename: currentFile.name, loading_time: loadingTime, deadline_time: deadlineTime }),
      })
      const result = await res.json()
      setStatus(result.success ? 'success' : 'error')
      setMessage(result.message)
      if (result.success) {
        setPreview([]); setFilename(''); setCurrentFile(null)
        if (inputRef.current) inputRef.current.value = ''
        fetchHistory()
      }
    } catch (e: unknown) {
      setStatus('error'); setMessage(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    }
  }

  const handleDelete = async (sourceFile: string) => {
    if (!confirm(`ลบ "${sourceFile}" และข้อมูลที่อัพโหลดออกจากระบบ?`)) return
    setDeleting(sourceFile)
    try {
      const res = await fetch(`/api/upload-supplementary-plan?file=${encodeURIComponent(sourceFile)}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) fetchHistory()
      else alert(data.message ?? 'ลบไม่สำเร็จ')
    } catch { alert('เกิดข้อผิดพลาด') }
    finally { setDeleting(null) }
  }

  const cols = preview.length ? Object.keys(preview[0]) : []

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">แผนรอบเสริม</h1>
        <p className="text-gray-500 mt-1 text-sm sm:text-base">
          อัพโหลดแผนผลิตที่แทรกเข้ามา — ระบุเวลาโหลดจ่ายเพื่อคำนวณ deadline ผลิต (ก่อนโหลด 30 นาที)
        </p>
      </div>

      {/* Loading time selector */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-gray-700">
            <Truck size={18} className="text-blue-500 shrink-0" />
            <span className="text-sm font-semibold">เวลาโหลดจ่าย</span>
          </div>
          <div className="flex items-center gap-1">
            <select
              value={loadingTime ? loadingTime.split(':')[0] : ''}
              onChange={e => setLoadingTime(e.target.value ? `${e.target.value}:${loadingTime ? loadingTime.split(':')[1] : '00'}` : '')}
              className="border border-gray-300 rounded-lg px-2 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 w-20"
            >
              <option value="">ชม.</option>
              {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <span className="text-gray-500 font-semibold">:</span>
            <select
              value={loadingTime ? loadingTime.split(':')[1] : ''}
              onChange={e => setLoadingTime(loadingTime ? `${loadingTime.split(':')[0]}:${e.target.value}` : '')}
              disabled={!loadingTime || !loadingTime.split(':')[0]}
              className="border border-gray-300 rounded-lg px-2 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 w-20 disabled:opacity-50"
            >
              {['00', '15', '30', '45'].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <span className="text-xs text-gray-400 ml-1">น.</span>
          </div>
          {loadingTime && (
            <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-sm">
              <Clock size={15} className="text-orange-500 shrink-0" />
              <span className="text-orange-700">
                ต้องผลิตเสร็จก่อน <strong>{deadlineTime} น.</strong>
                <span className="text-orange-400 ml-1">(30 นาทีก่อนโหลด)</span>
              </span>
            </div>
          )}
          {!loadingTime && (
            <p className="text-xs text-gray-400">* ต้องระบุก่อนอัพโหลดไฟล์</p>
          )}
        </div>
      </div>

      {/* Drop zone */}
      <div
        className="card border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors cursor-pointer text-center"
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mx-auto text-gray-400 mb-3" size={40} />
        <p className="font-medium text-gray-700">{filename || 'ลากไฟล์มาวางที่นี่ หรือ คลิกเพื่อเลือกไฟล์'}</p>
        <p className="text-sm text-gray-400 mt-1">รองรับ .xlsx, .xls, .csv — รูปแบบเดียวกับไฟล์คำสั่งซื้อตลาดสด</p>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
      </div>

      {status === 'error' && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
          <AlertCircle size={20} />{message}
        </div>
      )}
      {status === 'success' && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4 text-green-700">
          <CheckCircle2 size={20} />{message}
        </div>
      )}

      {/* Preview + submit */}
      {preview.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <p className="font-semibold text-gray-800">ตัวอย่างข้อมูล (5 แถวแรก)</p>
            <button onClick={() => { setPreview([]); setFilename(''); setCurrentFile(null); if (inputRef.current) inputRef.current.value = '' }}
              className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  {cols.map(c => <th key={c} className="px-3 py-2 text-left text-gray-600 font-medium border-b whitespace-nowrap">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    {cols.map(c => <td key={c} className="px-3 py-2 text-gray-700 whitespace-nowrap">{String(row[c] ?? '-')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={handleSubmit} disabled={status === 'uploading'}
            className="btn-primary mt-4">
            {status === 'uploading' ? 'กำลังบันทึก...' : 'ยืนยันอัพโหลด'}
          </button>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="card">
          <p className="font-semibold text-gray-800 mb-3">ประวัติการอัพโหลด</p>
          <div className="space-y-0 divide-y divide-gray-100">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 hover:bg-gray-50 -mx-1 px-1 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-gray-700 truncate">{h.source_file}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <p className="text-xs text-gray-400">
                      {h.record_count.toLocaleString()} รายการ
                      <span className="mx-1.5">·</span>
                      {new Date(h.uploaded_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                    {h.loading_time && (
                      <span className="text-xs bg-orange-50 text-orange-600 border border-orange-200 rounded px-1.5 py-0.5 flex items-center gap-1">
                        <Truck size={10} />โหลด {h.loading_time} น.
                      </span>
                    )}
                    {h.deadline_time && (
                      <span className="text-xs bg-red-50 text-red-600 border border-red-200 rounded px-1.5 py-0.5 flex items-center gap-1">
                        <Clock size={10} />deadline {h.deadline_time} น.
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(h.source_file)}
                  disabled={deleting === h.source_file}
                  className="shrink-0 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40 p-1"
                  title="ลบ"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
