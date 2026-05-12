'use client'
import { useState, useRef, useEffect } from 'react'
import { Upload, AlertCircle, CheckCircle2, X } from 'lucide-react'
import { parseFile, ParsedRow } from '@/lib/parser'

interface UploadRecord {
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
}

export default function FileUpload({ title, description, historyEndpoint, onUpload, parseFileFn }: Props) {
  const [status, setStatus] = useState<'idle'|'parsing'|'uploading'|'success'|'error'>('idle')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<ParsedRow[]>([])
  const [filename, setFilename] = useState('')
  const [history, setHistory] = useState<UploadRecord[]>([])
  const [currentFile, setCurrentFile] = useState<File | null>(null)
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

  const cols = preview.length ? Object.keys(preview[0]) : []
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900">{title}</h1><p className="text-gray-500 mt-1">{description}</p></div>
      <div className="card border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors cursor-pointer text-center"
        onDrop={(e)=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f)}}
        onDragOver={e=>e.preventDefault()} onClick={()=>inputRef.current?.click()}>
        <Upload className="mx-auto text-gray-400 mb-3" size={40}/>
        <p className="font-medium text-gray-700">{filename||'ลากไฟล์มาวางที่นี่ หรือ คลิกเพื่อเลือกไฟล์'}</p>
        <p className="text-sm text-gray-400 mt-1">รองรับ .xlsx, .xls, .csv</p>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={e=>{if(e.target.files?.[0])handleFile(e.target.files[0])}}/>
      </div>
      {status==='error'&&<div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700"><AlertCircle size={20}/>{message}</div>}
      {status==='success'&&<div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4 text-green-700"><CheckCircle2 size={20}/>{message}</div>}
      {preview.length>0&&(
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-left text-gray-600 font-medium border-b">ชื่อไฟล์</th>
                  <th className="px-3 py-2 text-right text-gray-600 font-medium border-b">รายการ</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium border-b">เวลาอัพโหลด</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i)=>(
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700 font-mono text-xs">{h.source_file}</td>
                    <td className="px-3 py-2 text-gray-700 text-right">{h.record_count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(h.uploaded_at).toLocaleString('th-TH', {dateStyle:'short', timeStyle:'short'})}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
