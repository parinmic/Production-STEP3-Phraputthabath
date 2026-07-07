'use client'
import { useState, useRef, useEffect } from 'react'
import { Upload, AlertCircle, CheckCircle2, X, Download, Eye } from 'lucide-react'
import * as XLSX from 'xlsx'
import { parseFile, ParsedRow } from '@/lib/parser'
import { useCanEdit } from '@/lib/session-context'

interface UploadRecord {
  id?: string
  source_file: string
  record_count: number
  uploaded_at: string
}

interface Props {
  title: string
  description: string
  historyEndpoint: string
  onUpload: (rows: ParsedRow[], filename: string) => Promise<{ success: boolean; message: string }>
  parseFileFn?: (file: File) => Promise<ParsedRow[]>
  downloadTable?: string
  downloadSlot?: string
  // เลขเมนู (ตรงกับ SPECIAL_MENU_LABELS) — ถ้า user มีสิทธิ์แค่ "View" จะซ่อนปุ่มอัพโหลด/ลบ เหลือแค่ดูประวัติ/ดาวน์โหลด
  menuKey?: string
}

export default function FileUpload({ title, description, historyEndpoint, onUpload, parseFileFn, downloadTable, downloadSlot, menuKey }: Props) {
  const canEdit = useCanEdit(menuKey)
  const [status, setStatus] = useState<'idle'|'parsing'|'uploading'|'success'|'error'>('idle')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<ParsedRow[]>([])
  const [filename, setFilename] = useState('')
  const [history, setHistory] = useState<UploadRecord[]>([])
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchHistory = async () => {
    try {
      const res = await fetch(historyEndpoint)
      const data = await res.json()
      setHistory(data.uploads ?? [])
    } catch { /* silent */ }
  }

  useEffect(() => { fetchHistory() }, [historyEndpoint])

  const handleFile = async (file: File) => {
    setStatus('parsing'); setMessage(''); setPreview([]); setFilename(file.name); setCurrentFile(file)
    try {
      const rows = await (parseFileFn ?? parseFile)(file)
      if (!rows.length) throw new Error('ไฟล์ไม่มีข้อมูล')
      setPreview(rows.slice(0, 5)); setStatus('idle')
    } catch (e: unknown) { setStatus('error'); setMessage(e instanceof Error ? e.message : 'อ่านไฟล์ไม่ได้') }
  }

  const errMsg = (e: unknown) =>
    e instanceof Error ? e.message
    : typeof e === 'object' && e !== null && 'message' in e ? String((e as {message:unknown}).message)
    : 'เกิดข้อผิดพลาด'

  const handleSubmit = async () => {
    if (!preview.length || !currentFile) return
    setStatus('uploading')
    try {
      const rows = await (parseFileFn ?? parseFile)(currentFile)
      const result = await onUpload(rows, currentFile.name)
      setStatus(result.success ? 'success' : 'error')
      setMessage(result.message)
      if (result.success) {
        setPreview([]); setFilename(''); setCurrentFile(null)
        if (inputRef.current) inputRef.current.value = ''
        fetchHistory()
      }
    } catch (e: unknown) { setStatus('error'); setMessage(errMsg(e)) }
  }

  const handleClear = () => {
    setPreview([]); setFilename(''); setCurrentFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleDelete = async (h: UploadRecord) => {
    if (!confirm(`ลบ "${h.source_file}" และข้อมูลที่อัพโหลดออกจากระบบ?`)) return
    setDeleting(h.source_file)
    try {
      const sep = historyEndpoint.includes('?') ? '&' : '?'
      const param = h.id ? `id=${encodeURIComponent(h.id)}` : `file=${encodeURIComponent(h.source_file)}`
      const res = await fetch(`${historyEndpoint}${sep}${param}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) fetchHistory()
      else alert(data.message ?? 'ลบไม่สำเร็จ')
    } catch { alert('เกิดข้อผิดพลาด') }
    finally { setDeleting(null) }
  }

  const handleDownload = async (h: UploadRecord) => {
    if (!downloadTable) return
    try {
      const slot = downloadSlot ? `&slot=${encodeURIComponent(downloadSlot)}` : ''
      const identifier = h.id ? `id=${encodeURIComponent(h.id)}` : `file=${encodeURIComponent(h.source_file)}`
      const res  = await fetch(`/api/download-upload?table=${encodeURIComponent(downloadTable)}&${identifier}${slot}`)
      const json = await res.json()
      if (!json.data?.length) { alert('ไม่มีข้อมูล'); return }
      const headers: Record<string, string> = json.headers
      const keys = Object.keys(headers)
      const thaiHeaders = keys.map(k => headers[k])
      const rows = (json.data as Record<string, unknown>[]).map(row => keys.map(k => row[k] ?? ''))
      const ws = XLSX.utils.aoa_to_sheet([thaiHeaders, ...rows])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'ข้อมูล')
      const baseName = h.source_file.replace(/\.[^.]+$/, '')
      XLSX.writeFile(wb, `${baseName}_export.xlsx`)
    } catch { alert('ดาวน์โหลดไม่สำเร็จ') }
  }

  const cols = preview.length ? Object.keys(preview[0]) : []
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-gray-500 mt-1 text-sm sm:text-base">{description}</p>
        </div>
        {!canEdit && (
          <span className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
            <Eye size={12} />ดูอย่างเดียว
          </span>
        )}
      </div>
      {canEdit ? (
        <div className="card border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors cursor-pointer text-center"
          onDrop={(e)=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f)}}
          onDragOver={e=>e.preventDefault()} onClick={()=>inputRef.current?.click()}>
          <Upload className="mx-auto text-gray-400 mb-3" size={40}/>
          <p className="font-medium text-gray-700">{filename||'ลากไฟล์มาวางที่นี่ หรือ คลิกเพื่อเลือกไฟล์'}</p>
          <p className="text-sm text-gray-400 mt-1">รองรับ .xlsx, .xls, .csv</p>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e=>{if(e.target.files?.[0])handleFile(e.target.files[0])}}/>
        </div>
      ) : (
        <div className="card border-2 border-dashed border-gray-200 text-center bg-gray-50">
          <Eye className="mx-auto text-gray-300 mb-3" size={40}/>
          <p className="font-medium text-gray-400">คุณมีสิทธิ์ดูข้อมูลเท่านั้น ไม่สามารถอัพโหลดได้</p>
        </div>
      )}
      {status==='error'&&<div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700"><AlertCircle size={20}/>{message}</div>}
      {status==='success'&&<div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4 text-green-700"><CheckCircle2 size={20}/>{message}</div>}
      {canEdit && preview.length>0&&(
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <p className="font-semibold text-gray-800">ตัวอย่างข้อมูล (5 แถวแรก)</p>
            <button onClick={handleClear} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50">{cols.map(c=><th key={c} className="px-3 py-2 text-left text-gray-600 font-medium border-b whitespace-nowrap">{c}</th>)}</tr></thead>
              <tbody>{preview.map((row,i)=><tr key={i} className="border-b hover:bg-gray-50">{cols.map(c=><td key={c} className="px-3 py-2 text-gray-700 whitespace-nowrap">{String(row[c]??'-')}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <button onClick={handleSubmit} disabled={status==='uploading'} className="btn-primary mt-4">
            {status==='uploading'?'กำลังบันทึก...':'ยืนยันอัพโหลด'}
          </button>
        </div>
      )}
      {history.length>0&&(
        <div className="card">
          <p className="font-semibold text-gray-800 mb-3">ประวัติการอัพโหลด</p>
          <div className="space-y-0 divide-y divide-gray-100">
            {history.map((h, i)=>(
              <div key={i} className="flex items-center gap-3 py-2.5 hover:bg-gray-50 -mx-1 px-1 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-gray-700 truncate">{h.source_file}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {h.record_count.toLocaleString()} รายการ
                    <span className="mx-1.5">·</span>
                    {new Date(h.uploaded_at).toLocaleString('th-TH', {dateStyle:'short', timeStyle:'short'})}
                  </p>
                </div>
                {downloadTable && (
                  <button
                    onClick={() => handleDownload(h)}
                    className="shrink-0 text-gray-300 hover:text-blue-500 transition-colors p-1"
                    title="ดาวน์โหลด Excel"
                  >
                    <Download size={14} />
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={() => handleDelete(h)}
                    disabled={deleting === h.source_file}
                    className="shrink-0 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40 p-1"
                    title="ลบ"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
