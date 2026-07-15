'use client'
import { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { Upload, AlertCircle, CheckCircle2, X, Calendar, Download } from 'lucide-react'
import { todayBangkok } from '@/lib/date'

interface SapResult { sapCode: string; bags: number; weight: number }

interface UploadRecord {
  id: string
  source_file: string
  record_count: number
  uploaded_at: string
}

function parseYieldFile(file: File): Promise<SapResult[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })

        const aggBags:   Record<string, number> = {}
        const aggWeight: Record<string, number> = {}
        for (const row of rows as unknown[][]) {
          const colC = String(row[2] ?? '').trim()    // column C = index 2
          if (colC !== '168' && colC !== '169M' && colC !== '224M') continue
          const sapCode   = String(row[6] ?? '').trim() // column G = index 6
          const bagsRaw   = row[9]                      // column J = index 9
          const weightRaw = row[10]                     // column K = index 10
          if (!sapCode) continue
          const bags   = typeof bagsRaw   === 'number' ? bagsRaw   : parseInt(String(bagsRaw   ?? '0'), 10)
          const weight = typeof weightRaw === 'number' ? weightRaw : parseFloat(String(weightRaw ?? '0'))
          if (isNaN(bags) || bags <= 0) continue
          aggBags[sapCode]   = (aggBags[sapCode]   ?? 0) + bags
          aggWeight[sapCode] = (aggWeight[sapCode] ?? 0) + (isNaN(weight) ? 0 : weight)
        }

        const results = Object.entries(aggBags).map(([sapCode, bags]) => ({ sapCode, bags, weight: aggWeight[sapCode] ?? 0 }))
        if (!results.length) throw new Error('ไม่พบข้อมูลรหัส 168, 169M หรือ 224M ในไฟล์')
        resolve(results)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'))
    reader.readAsArrayBuffer(file)
  })
}

export default function YieldPage() {
  const today = todayBangkok()
  const [workDate, setWorkDate]     = useState(today)
  const [status, setStatus]         = useState<'idle' | 'parsing' | 'uploading' | 'success' | 'error'>('idle')
  const [message, setMessage]       = useState('')
  const [sapResults, setSapResults] = useState<SapResult[]>([])
  const [filename, setFilename]     = useState('')
  const [history, setHistory]       = useState<UploadRecord[]>([])
  const [deleting, setDeleting]     = useState<string | null>(null)
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
    setStatus('parsing'); setMessage(''); setSapResults([]); setFilename(file.name)
    try {
      const results = await parseYieldFile(file)
      setSapResults(results); setStatus('idle')
    } catch (e: unknown) {
      setStatus('error'); setMessage(e instanceof Error ? e.message : 'อ่านไฟล์ไม่ได้')
    }
  }

  const handleSubmit = async () => {
    if (!sapResults.length) return
    if (!workDate) { setStatus('error'); setMessage('กรุณาเลือกวันที่ก่อน'); return }
    setStatus('uploading')
    try {
      const res = await fetch('/api/upload-yield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sapResults, workDate, filename }),
      })
      const result = await res.json()
      setStatus(result.success ? 'success' : 'error')
      setMessage(result.message)
      if (result.success) {
        setSapResults([]); setFilename(''); inputRef.current!.value = ''
        fetchHistory()
      }
    } catch (e: unknown) {
      setStatus('error'); setMessage(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    }
  }

  const handleDownload = async (h: UploadRecord) => {
    try {
      const res  = await fetch(`/api/download-upload?table=yield_bags&id=${encodeURIComponent(h.id)}`)
      const json = await res.json()
      if (!json.data?.length) { alert('ไม่มีข้อมูล'); return }
      const headers: Record<string, string> = json.headers
      const keys = Object.keys(headers)
      const ws = XLSX.utils.aoa_to_sheet([keys.map(k => headers[k]), ...(json.data as Record<string, unknown>[]).map(row => keys.map(k => row[k] ?? ''))])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'รับผลได้')
      XLSX.writeFile(wb, `${h.source_file.replace(/\.[^.]+$/, '')}_export.xlsx`)
    } catch { alert('ดาวน์โหลดไม่สำเร็จ') }
  }

  const handleDelete = async (id: string, sourceFile: string) => {
    if (!confirm(`ลบ "${sourceFile}" และข้อมูลที่อัพโหลดออกจากระบบ?`)) return
    setDeleting(id)
    try {
      const res  = await fetch(`/api/upload-yield?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) fetchHistory()
      else alert(data.message ?? 'ลบไม่สำเร็จ')
    } catch { alert('เกิดข้อผิดพลาด') }
    finally { setDeleting(null) }
  }

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
        <p className="text-sm text-gray-400 mt-1">รองรับ .xlsx, .xls</p>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
      </div>

      {status === 'parsing' && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4 text-blue-700">
          กำลังอ่านไฟล์...
        </div>
      )}
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

      {/* Preview — SAP aggregated results */}
      {sapResults.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-semibold text-gray-800">สรุปรับผลได้ ({sapResults.length} รหัส SAP)</p>
              <p className="text-xs text-gray-500 mt-0.5">วันที่: {workDate || '—'} · กรองเฉพาะรหัส 168, 169M, 224M</p>
            </div>
            <button onClick={() => { setSapResults([]); setFilename(''); inputRef.current!.value = '' }}
              className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-left text-gray-600 font-medium border-b">รหัส SAP</th>
                  <th className="px-3 py-2 text-right text-gray-600 font-medium border-b">จำนวนถุง</th>
                </tr>
              </thead>
              <tbody>
                {sapResults.slice(0, 10).map((r) => (
                  <tr key={r.sapCode} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700 font-mono">{r.sapCode}</td>
                    <td className="px-3 py-2 text-gray-700 text-right font-semibold">{r.bags.toLocaleString()}</td>
                  </tr>
                ))}
                {sapResults.length > 10 && (
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-xs text-gray-400 text-center">
                      ...และอีก {sapResults.length - 10} รหัส
                    </td>
                  </tr>
                )}
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
                    {h.record_count.toLocaleString()} รหัส SAP
                    <span className="mx-1.5">·</span>
                    {new Date(h.uploaded_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
                <button
                  onClick={() => handleDownload(h)}
                  className="shrink-0 text-gray-300 hover:text-blue-500 transition-colors p-1"
                  title="ดาวน์โหลด Excel">
                  <Download size={14} />
                </button>
                <button
                  onClick={() => handleDelete(h.id, h.source_file)}
                  disabled={deleting === h.id}
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
