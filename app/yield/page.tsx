'use client'
import { useState, useRef, useEffect } from 'react'
import { Upload, AlertCircle, CheckCircle2, X, Calendar } from 'lucide-react'
import { parseFile, ParsedRow } from '@/lib/parser'

interface UploadRecord {
  source_file: string
  record_count: number
  uploaded_at: string
}

export default function YieldPage() {
  const today = new Date().toISOString().split('T')[0]
  const [workDate, setWorkDate]   = useState(today)
  const [status, setStatus]       = useState<'idle' | 'parsing' | 'uploading' | 'success' | 'error'>('idle')
  const [message, setMessage]     = useState('')
  const [preview, setPreview]     = useState<ParsedRow[]>([])
  const [filename, setFilename]   = useState('')
  const [history, setHistory]     = useState<UploadRecord[]>([])
  const [deleting, setDeleting]   = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchHistory = async () => {
    try {
      const res  = await fetch('/api/upload-yield')
      const data = await res.json()
      setHistory(data.uploads ?? [])
    } catch { /* silent */ }
  }

  useEffect(() => { fetchHistory() }, [])

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
    if (!preview.length) return
    if (!workDate) { setStatus('error'); setMessage('กรุณาเลือกวันที่ก่อน'); return }
    setStatus('uploading')
    try {
      const file = (inputRef.current!.files as FileList)[0]
      const rows = await parseFile(file)
      const res  = await fetch('/api/upload-yield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, filename: file.name, workDate }),
      })
      const result = await res.json()
      setStatus(result.success ? 'success' : 'error')
      setMessage(result.message)
      if (result.success) {
        setPreview([]); setFilename(''); inputRef.current!.value = ''
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
      const res  = await fetch(`/api/upload-yield?file=${encodeURIComponent(sourceFile)}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) fetchHistory()
      else alert(data.message ?? 'ลบไม่สำเร็จ')
    } catch { alert('เกิดข้อผิดพลาด') }
    finally { setDeleting(null) }
  }

  const cols = preview.length ? Object.keys(preview[0]) : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">อัพโหลดรับผลได้</h1>
        <p className="text-gray-500 mt-1">อัพโหลดข้อมูลรับผลได้</p>
      </div>

      {/* Date picker */}
      <div className="card flex items-center gap-4">
        <Calendar size={20} className="text-blue-500 shrink-0" />
        <label className="font-medium text-gray-700 whitespace-nowrap">วันที่ผลิต</label>
        <input
          type="date"
          value={workDate}
          onChange={e => setWorkDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Upload zone */}
      <div
        className="card border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors cursor-pointer text-center"
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}>
        <Upload className="mx-auto text-gray-400 mb-3" size={36} />
        <p className="font-medium text-gray-700">{filename || 'ลากไฟล์มาวางที่นี่ หรือ คลิกเพื่อเลือกไฟล์'}</p>
        <p className="text-sm text-gray-400 mt-1">รองรับ .xlsx, .xls, .csv</p>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
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

      {/* Preview */}
      {preview.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-semibold text-gray-800">ตัวอย่างข้อมูล (5 แถวแรก)</p>
              <p className="text-xs text-gray-500 mt-0.5">วันที่: {workDate || '—'}</p>
            </div>
            <button onClick={() => { setPreview([]); setFilename(''); inputRef.current!.value = '' }}
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
          <button onClick={handleSubmit} disabled={status === 'uploading'} className="btn-primary mt-4">
            {status === 'uploading' ? 'กำลังบันทึก...' : 'ยืนยันอัพโหลด'}
          </button>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="card">
          <p className="font-semibold text-gray-800 mb-3">ประวัติการอัพโหลด</p>
          <div className="divide-y divide-gray-100">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 hover:bg-gray-50 -mx-1 px-1 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-gray-700 truncate">{h.source_file}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {h.record_count.toLocaleString()} รายการ
                    <span className="mx-1.5">·</span>
                    {new Date(h.uploaded_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(h.source_file)}
                  disabled={deleting === h.source_file}
                  className="shrink-0 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40 p-1">
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
