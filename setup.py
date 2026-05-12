#!/usr/bin/env python3
"""รัน: python3 setup.py — สร้างไฟล์ทั้งหมดที่จำเป็น"""
import os

def w(path, content):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'  ✓ {path}')

print('กำลังสร้างไฟล์...')

# ─── .env.local ───────────────────────────────────────────────
w('.env.local',
'NEXT_PUBLIC_SUPABASE_URL=https://jtjironqszdfsflvdvld.supabase.co\n'
'NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui\n')

# ─── lib/supabase.ts ──────────────────────────────────────────
w('lib/supabase.ts', """import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type TableName = 'สามชั้น' | 'สะโพก' | 'ไหล่'
export type Shift = 'เช้า' | 'บ่าย' | 'ค่ำ'
export type AssignmentStatus = 'รอดำเนินการ' | 'กำลังผลิต' | 'เสร็จแล้ว'

export interface ProductionAssignment {
  id?: string
  production_date: string
  table_name: TableName
  worker_code: string
  worker_name: string
  sku: string
  sku_name?: string
  target_quantity: number
  unit?: string
  period: string
  deadline_time?: string
  status: AssignmentStatus
  note?: string
}
""")

# ─── lib/parser.ts ────────────────────────────────────────────
w('lib/parser.ts', r"""import * as XLSX from 'xlsx'
import Papa from 'papaparse'

export type ParsedRow = Record<string, string | number | null>

export async function parseFile(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsv(file)
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseExcel(file)
  throw new Error('รองรับเฉพาะไฟล์ .xlsx, .xls และ .csv เท่านั้น')
}

function parseCsv(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true, encoding: 'UTF-8',
      complete: (result) => resolve(result.data as ParsedRow[]),
      error: (err) => reject(new Error(err.message)),
    })
  })
}

function parseExcel(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array', cellDates: true })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        resolve(XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: null }))
      } catch { reject(new Error('ไม่สามารถอ่านไฟล์ Excel ได้')) }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

export function toDateString(val: unknown): string {
  if (!val) return ''
  if (val instanceof Date) return val.toISOString().split('T')[0]
  return String(val).trim()
}
""")

# ─── app/globals.css ──────────────────────────────────────────
w('app/globals.css', """@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;
body { font-family: 'Sarabun', sans-serif; }
@layer components {
  .card { @apply bg-white rounded-xl shadow-sm border border-gray-100 p-6; }
  .btn-primary { @apply bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed; }
  .btn-secondary { @apply bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors font-medium; }
  .badge-pending  { @apply bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full font-medium; }
  .badge-progress { @apply bg-blue-100   text-blue-800   text-xs px-2 py-1 rounded-full font-medium; }
  .badge-done     { @apply bg-green-100  text-green-800  text-xs px-2 py-1 rounded-full font-medium; }
}
""")

# ─── app/layout.tsx ───────────────────────────────────────────
w('app/layout.tsx', """import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'
export const metadata: Metadata = { title: 'ระบบคำสั่งผลิต | CP Foods' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="bg-gray-50">
        <div className="flex">
          <Sidebar />
          <main className="flex-1 min-h-screen p-8 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  )
}
""")

# ─── app/page.tsx ─────────────────────────────────────────────
w('app/page.tsx', """import { supabase } from '@/lib/supabase'
import { Users, ShoppingCart, BarChart3, ClipboardList } from 'lucide-react'
import Link from 'next/link'

async function getStats() {
  const today = new Date().toISOString().split('T')[0]
  const [w, m, q, a] = await Promise.all([
    supabase.from('daily_workforce').select('id', { count: 'exact' }).eq('work_date', today),
    supabase.from('makro_orders').select('id', { count: 'exact' }),
    supabase.from('channel_quotas').select('id', { count: 'exact' }),
    supabase.from('production_assignments').select('id', { count: 'exact' }).eq('production_date', today),
  ])
  return { workforce: w.count ?? 0, makro: m.count ?? 0, quota: q.count ?? 0, assignments: a.count ?? 0 }
}

export default async function DashboardPage() {
  const stats = await getStats()
  const cards = [
    { label: 'พนักงานวันนี้',   value: stats.workforce,   unit: 'คน',     icon: Users,        color: 'bg-blue-500',   href: '/workforce' },
    { label: 'คำสั่งซื้อ Makro', value: stats.makro,      unit: 'รายการ', icon: ShoppingCart,  color: 'bg-orange-500', href: '/makro' },
    { label: 'Quota ทั้งหมด',    value: stats.quota,      unit: 'รายการ', icon: BarChart3,     color: 'bg-purple-500', href: '/quota' },
    { label: 'คำสั่งผลิตวันนี้', value: stats.assignments, unit: 'รายการ', icon: ClipboardList, color: 'bg-green-500',  href: '/production' },
  ]
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-8">ภาพรวมระบบ</h1>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-6 mb-10">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="card hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">{c.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{c.value}</p>
                <p className="text-sm text-gray-400">{c.unit}</p>
              </div>
              <div className={c.color + ' p-3 rounded-xl'}>
                <c.icon className="text-white" size={22} />
              </div>
            </div>
          </Link>
        ))}
      </div>
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">คำสั่งผลิตแยกตามโต้ะ</h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Station สามชั้น', slug: 'sam-chan', cls: 'border-blue-500 bg-blue-50 text-blue-700' },
            { label: 'Station สะโพก',   slug: 'sa-phok', cls: 'border-orange-500 bg-orange-50 text-orange-700' },
            { label: 'Station ไหล่',    slug: 'lai',     cls: 'border-green-500 bg-green-50 text-green-700' },
          ].map((t) => (
            <Link key={t.slug} href={`/production/${t.slug}`}
              className={`border-2 ${t.cls} rounded-xl p-5 font-semibold text-center hover:opacity-80`}>
              {t.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
""")

# ─── components/Sidebar.tsx ───────────────────────────────────
w('components/Sidebar.tsx', """'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, ShoppingCart, BarChart3, ClipboardList, ChevronDown, ChevronRight, Factory } from 'lucide-react'
import { useState } from 'react'

const TABLES = [
  { label: 'Station สามชั้น', slug: 'sam-chan', dot: 'bg-blue-500' },
  { label: 'Station สะโพก',   slug: 'sa-phok', dot: 'bg-orange-500' },
  { label: 'Station ไหล่',    slug: 'lai',     dot: 'bg-green-500' },
]

export default function Sidebar() {
  const p = usePathname()
  const [open, setOpen] = useState(p.startsWith('/production'))
  const a = (href: string) => p === href ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
  return (
    <aside className="w-64 min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="px-6 py-5 border-b border-gray-700 flex items-center gap-3">
        <Factory className="text-blue-400" size={28} />
        <div>
          <p className="font-bold text-sm">ระบบคำสั่งผลิต</p>
          <p className="text-gray-400 text-xs">Production Management</p>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        <Link href="/" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${a('/')}`}>
          <LayoutDashboard size={18} />ภาพรวม
        </Link>
        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider pt-3 pb-1 px-3">อัพโหลดข้อมูล</p>
        {[
          { href: '/workforce', icon: Users,        label: 'กำลังคนประจำวัน' },
          { href: '/makro',     icon: ShoppingCart,  label: 'คำสั่งซื้อ Makro' },
          { href: '/quota',     icon: BarChart3,     label: 'Quota ช่องทางขาย' },
        ].map((m) => (
          <Link key={m.href} href={m.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${a(m.href)}`}>
            <m.icon size={18} />{m.label}
          </Link>
        ))}
        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider pt-3 pb-1 px-3">คำสั่งผลิต</p>
        <button onClick={() => setOpen(!open)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/production') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}>
          <ClipboardList size={18} />
          <span className="flex-1 text-left">คำสั่งผลิตราย Station </span>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {open && (
          <div className="ml-4 space-y-1">
            {TABLES.map((t) => (
              <Link key={t.slug} href={`/production/${t.slug}`}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/production/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className={`w-2 h-2 rounded-full ${t.dot}`} />{t.label}
              </Link>
            ))}
          </div>
        )}
      </nav>
      <div className="px-6 py-4 border-t border-gray-700 text-gray-500 text-xs">CP Foods — Production System</div>
    </aside>
  )
}
""")

# ─── components/FileUpload.tsx ────────────────────────────────
w('components/FileUpload.tsx', """'use client'
import { useState, useRef } from 'react'
import { Upload, FileText, AlertCircle, CheckCircle2, X } from 'lucide-react'
import { parseFile, ParsedRow } from '@/lib/parser'

interface Props {
  title: string
  description: string
  expectedColumns: string[]
  templateData: Record<string, string>[]
  templateFilename: string
  onUpload: (rows: ParsedRow[]) => Promise<{ success: boolean; message: string }>
}

export default function FileUpload({ title, description, expectedColumns, templateData, templateFilename, onUpload }: Props) {
  const [status, setStatus] = useState<'idle'|'parsing'|'uploading'|'success'|'error'>('idle')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<ParsedRow[]>([])
  const [filename, setFilename] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setStatus('parsing'); setMessage(''); setPreview([]); setFilename(file.name)
    try {
      const rows = await parseFile(file)
      if (!rows.length) throw new Error('ไฟล์ไม่มีข้อมูล')
      setPreview(rows.slice(0, 5)); setStatus('idle')
    } catch (e: unknown) { setStatus('error'); setMessage(e instanceof Error ? e.message : 'อ่านไฟล์ไม่ได้') }
  }

  const downloadTemplate = () => {
    const csv = [expectedColumns.join(','), ...templateData.map(r => expectedColumns.map(c => r[c]??'').join(','))].join('\\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\\ufeff'+csv], {type:'text/csv;charset=utf-8;'}))
    a.download = templateFilename; a.click()
  }

  const handleSubmit = async () => {
    if (!preview.length) return; setStatus('uploading')
    try {
      const rows = await parseFile((inputRef.current!.files as FileList)[0])
      const result = await onUpload(rows)
      setStatus(result.success ? 'success' : 'error'); setMessage(result.message)
      if (result.success) { setPreview([]); setFilename(''); inputRef.current!.value = '' }
    } catch (e: unknown) { setStatus('error'); setMessage(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด') }
  }

  const cols = preview.length ? Object.keys(preview[0]) : []
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900">{title}</h1><p className="text-gray-500 mt-1">{description}</p></div>
      <div className="card flex items-center justify-between">
        <div>
          <p className="font-medium text-gray-800">ดาวน์โหลด Template</p>
          <p className="text-sm text-gray-500">คอลัมน์: <span className="font-mono text-blue-600">{expectedColumns.join(', ')}</span></p>
        </div>
        <button onClick={downloadTemplate} className="btn-secondary flex items-center gap-2"><FileText size={16}/>ดาวน์โหลด</button>
      </div>
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
            <button onClick={()=>{setPreview([]);setFilename('');inputRef.current!.value=''}} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
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
    </div>
  )
}
""")

# ─── app/workforce/page.tsx ───────────────────────────────────
w('app/workforce/page.tsx', """'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow } from '@/lib/parser'
const COLS = ['วันที่','Station ','รหัสพนักงาน','ชื่อพนักงาน','กะ']
const TPL = [
  {'วันที่':'2024-01-15','Station ':'สามชั้น','รหัสพนักงาน':'EMP001','ชื่อพนักงาน':'สมชาย ใจดี','กะ':'เช้า'},
  {'วันที่':'2024-01-15','Station ':'สะโพก','รหัสพนักงาน':'EMP002','ชื่อพนักงาน':'สมหญิง รักงาน','กะ':'เช้า'},
]
async function upload(rows: ParsedRow[]) {
  const res = await fetch('/api/upload-workforce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows})})
  return res.json()
}
export default function WorkforcePage() {
  return <FileUpload title="อัพโหลดกำลังคนประจำวัน" description="อัพโหลดรายชื่อพนักงานแยกตามStation และกะการผลิต" expectedColumns={COLS} templateData={TPL} templateFilename="template_กำลังคน.csv" onUpload={upload}/>
}
""")

# ─── app/makro/page.tsx ───────────────────────────────────────
w('app/makro/page.tsx', """'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow } from '@/lib/parser'
const COLS = ['วันที่สั่ง','SKU','ชื่อสินค้า','ปริมาณ','วันที่ส่ง','ช่วงเวลา']
const TPL = [{'วันที่สั่ง':'2024-01-15','SKU':'SKU-001','ชื่อสินค้า':'ชิ้นส่วนสามชั้น A','ปริมาณ':'500','วันที่ส่ง':'2024-01-17','ช่วงเวลา':'เช้า'}]
async function upload(rows: ParsedRow[]) {
  const res = await fetch('/api/upload-makro',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows})})
  return res.json()
}
export default function MakroPage() {
  return <FileUpload title="อัพโหลดคำสั่งซื้อ Makro" description="สำหรับใช้คำนวณปริมาณแนะนำผลิต" expectedColumns={COLS} templateData={TPL} templateFilename="template_makro.csv" onUpload={upload}/>
}
""")

# ─── app/quota/page.tsx ───────────────────────────────────────
w('app/quota/page.tsx', """'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow } from '@/lib/parser'
const COLS = ['วันที่','ช่องทาง','SKU','ชื่อสินค้า','Quota','ช่วงเวลา']
const TPL = [{'วันที่':'2024-01-15','ช่องทาง':'Makro','SKU':'SKU-001','ชื่อสินค้า':'ชิ้นส่วนสามชั้น A','Quota':'500','ช่วงเวลา':'เช้า'}]
async function upload(rows: ParsedRow[]) {
  const res = await fetch('/api/upload-quota',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows})})
  return res.json()
}
export default function QuotaPage() {
  return <FileUpload title="อัพโหลด Quota ช่องทางขาย" description="สำหรับใช้คำนวณปริมาณแนะนำผลิต" expectedColumns={COLS} templateData={TPL} templateFilename="template_quota.csv" onUpload={upload}/>
}
""")

# ─── app/production/page.tsx ──────────────────────────────────
w('app/production/page.tsx', """'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Zap, CheckCircle2, AlertCircle } from 'lucide-react'
export default function ProductionMenuPage() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{success:boolean;message:string}|null>(null)
  const generate = async () => {
    setLoading(true); setResult(null)
    try {
      const res = await fetch('/api/production/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:new Date().toISOString().split('T')[0]})})
      setResult(await res.json())
    } catch { setResult({success:false,message:'เกิดข้อผิดพลาด'}) }
    setLoading(false)
  }
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">คำสั่งผลิต</h1>
      <p className="text-gray-500 mb-8">เลือกStation ที่ต้องการดูคำสั่งผลิต หรือกดสร้างคำสั่งผลิตใหม่</p>
      <div className="card mb-8">
        <h2 className="font-semibold text-gray-800 mb-1">สร้างคำสั่งผลิตประจำวัน</h2>
        <p className="text-sm text-gray-500 mb-4">ระบบจะคำนวณ Quota รวม หาร จำนวนพนักงานแล้วสร้างคำสั่งอัตโนมัติ</p>
        <button onClick={generate} disabled={loading} className="btn-primary flex items-center gap-2">
          <Zap size={16}/>{loading?'กำลังสร้าง...':'สร้างคำสั่งผลิตวันนี้'}
        </button>
        {result&&<div className={`mt-4 flex items-center gap-3 rounded-xl p-4 ${result.success?'bg-green-50 text-green-700 border border-green-200':'bg-red-50 text-red-700 border border-red-200'}`}>
          {result.success?<CheckCircle2 size={20}/>:<AlertCircle size={20}/>}{result.message}
        </div>}
      </div>
      <div className="grid grid-cols-3 gap-6">
        {[
          {label:'Station สามชั้น',slug:'sam-chan',cls:'border-blue-500 bg-blue-50',text:'text-blue-700',dot:'bg-blue-500'},
          {label:'Station สะโพก',  slug:'sa-phok',cls:'border-orange-500 bg-orange-50',text:'text-orange-700',dot:'bg-orange-500'},
          {label:'Station ไหล่',   slug:'lai',    cls:'border-green-500 bg-green-50',text:'text-green-700',dot:'bg-green-500'},
        ].map(t=>(
          <Link key={t.slug} href={`/production/${t.slug}`} className={`border-2 ${t.cls} rounded-xl p-6 hover:opacity-80 transition-opacity`}>
            <div className={`w-4 h-4 rounded-full ${t.dot} mb-3`}/>
            <p className={`text-xl font-bold ${t.text}`}>{t.label}</p>
            <p className="text-sm text-gray-500 mt-1">ดูคำสั่งผลิตรายคน →</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
""")

# ─── app/production/[table]/page.tsx ─────────────────────────
w('app/production/[table]/page.tsx', """import { supabase } from '@/lib/supabase'
import { ProductionAssignment } from '@/lib/supabase'
import { Clock, CheckCircle2, PlayCircle, AlertCircle } from 'lucide-react'
import Link from 'next/link'

const CFG: Record<string, { label: string; border: string; bg: string; text: string }> = {
  'sam-chan': { label: 'สามชั้น', border: 'border-blue-500',   bg: 'bg-blue-50',   text: 'text-blue-700' },
  'sa-phok':  { label: 'สะโพก',  border: 'border-orange-500', bg: 'bg-orange-50', text: 'text-orange-700' },
  'lai':      { label: 'ไหล่',   border: 'border-green-500',  bg: 'bg-green-50',  text: 'text-green-700' },
}

async function getData(tableName: string) {
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase.from('production_assignments').select('*')
    .eq('production_date', today).eq('table_name', tableName)
    .order('worker_name').order('period')
  return (data ?? []) as ProductionAssignment[]
}

function group(items: ProductionAssignment[]) {
  return items.reduce<Record<string, ProductionAssignment[]>>((acc, a) => {
    (acc[a.worker_name] ??= []).push(a); return acc
  }, {})
}

export default async function TablePage({ params }: { params: { table: string } }) {
  const cfg = CFG[params.table]
  if (!cfg) return <p className="text-red-500">ไม่พบStation ที่ระบุ</p>
  const items = await getData(cfg.label)
  const byWorker = group(items)
  const workers = Object.keys(byWorker).sort()
  const total = items.reduce((s, a) => s + Number(a.target_quantity), 0)
  const others = Object.entries(CFG).filter(([s]) => s !== params.table)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">คำสั่งผลิต — Station {cfg.label}</h1>
        <div className="flex gap-2">
          {others.map(([s, c]) => <Link key={s} href={`/production/${s}`} className="btn-secondary text-sm">Station {c.label}</Link>)}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {label:'พนักงาน',value:workers.length,unit:'คน'},
          {label:'เป้าหมายรวม',value:total.toLocaleString(),unit:'ชิ้น'},
          {label:'เสร็จแล้ว',value:items.filter(a=>a.status==='เสร็จแล้ว').length,unit:'รายการ'},
          {label:'กำลังผลิต',value:items.filter(a=>a.status==='กำลังผลิต').length,unit:'รายการ'},
        ].map(s=>(
          <div key={s.label} className={`card ${cfg.bg}`}>
            <p className="text-sm text-gray-500">{s.label}</p>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-400">{s.unit}</p>
          </div>
        ))}
      </div>
      {workers.length === 0 && (
        <div className="card text-center py-16 text-gray-400">
          <p className="font-medium">ยังไม่มีคำสั่งผลิตสำหรับวันนี้</p>
          <p className="text-sm mt-1">กรุณาอัพโหลดกำลังคนและ Quota ก่อน</p>
        </div>
      )}
      <div className="space-y-4">
        {workers.map(name => {
          const tasks = byWorker[name]
          return (
            <div key={name} className={`card border-l-4 ${cfg.border}`}>
              <div className="flex justify-between mb-4">
                <div><p className="font-bold text-gray-900 text-lg">{name}</p><p className="text-sm text-gray-400">{tasks[0].worker_code}</p></div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">เป้าหมายรวม</p>
                  <p className="font-bold text-gray-900">{tasks.reduce((s,t)=>s+Number(t.target_quantity),0).toLocaleString()} ชิ้น</p>
                </div>
              </div>
              <div className="space-y-2">
                {tasks.map(task => (
                  <div key={task.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
                    <div><p className="font-medium text-gray-800">{task.sku_name||task.sku}</p><p className="text-xs text-gray-400">{task.sku}</p></div>
                    <div className="flex items-center gap-4">
                      <div className="text-right"><p className="font-bold text-gray-900">{Number(task.target_quantity).toLocaleString()}</p><p className="text-xs text-gray-400">{task.unit||'ชิ้น'}</p></div>
                      {task.deadline_time&&<div className="flex items-center gap-1 text-sm font-medium bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg"><Clock size={14}/>{task.deadline_time.substring(0,5)} น.</div>}
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${task.period==='บ่าย'?'bg-purple-100 text-purple-700':'bg-sky-100 text-sky-700'}`}>{task.period}</span>
                      <span className={task.status==='เสร็จแล้ว'?'badge-done':task.status==='กำลังผลิต'?'badge-progress':'badge-pending'}>
                        {task.status==='เสร็จแล้ว'?<CheckCircle2 size={12} className="inline mr-1"/>:task.status==='กำลังผลิต'?<PlayCircle size={12} className="inline mr-1"/>:<AlertCircle size={12} className="inline mr-1"/>}
                        {task.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
""")

# ─── API Routes ───────────────────────────────────────────────
w('app/api/upload-workforce/route.ts', """import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { toDateString } from '@/lib/parser'
export async function POST(req: NextRequest) {
  try {
    const { rows } = await req.json()
    if (!rows?.length) return NextResponse.json({success:false,message:'ไม่มีข้อมูล'},{status:400})
    const records = rows.map((r: Record<string,unknown>) => ({
      work_date: toDateString(r['วันที่']),
      table_name: String(r['Station ']??'').trim(),
      worker_code: String(r['รหัสพนักงาน']??'').trim(),
      worker_name: String(r['ชื่อพนักงาน']??'').trim(),
      shift: String(r['กะ']??'เช้า').trim(),
    })).filter((r: {work_date:string;worker_code:string;worker_name:string}) => r.work_date && r.worker_code && r.worker_name)
    const { error } = await supabase.from('daily_workforce').insert(records)
    if (error) throw error
    return NextResponse.json({success:true,message:`บันทึกสำเร็จ ${records.length} รายการ`})
  } catch(e: unknown) {
    return NextResponse.json({success:false,message:e instanceof Error?e.message:'เกิดข้อผิดพลาด'},{status:500})
  }
}
""")

w('app/api/upload-makro/route.ts', """import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { toDateString } from '@/lib/parser'
export async function POST(req: NextRequest) {
  try {
    const { rows } = await req.json()
    if (!rows?.length) return NextResponse.json({success:false,message:'ไม่มีข้อมูล'},{status:400})
    const records = rows.map((r: Record<string,unknown>) => ({
      order_date: toDateString(r['วันที่สั่ง']),
      delivery_date: toDateString(r['วันที่ส่ง']),
      sku: String(r['SKU']??'').trim(),
      sku_name: String(r['ชื่อสินค้า']??'').trim(),
      quantity: Number(r['ปริมาณ'])||0,
      period: String(r['ช่วงเวลา']??'').trim()||null,
    })).filter((r: {sku:string;quantity:number}) => r.sku && r.quantity > 0)
    const { error } = await supabase.from('makro_orders').insert(records)
    if (error) throw error
    return NextResponse.json({success:true,message:`บันทึกสำเร็จ ${records.length} รายการ`})
  } catch(e: unknown) {
    return NextResponse.json({success:false,message:e instanceof Error?e.message:'เกิดข้อผิดพลาด'},{status:500})
  }
}
""")

w('app/api/upload-quota/route.ts', """import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { toDateString } from '@/lib/parser'
export async function POST(req: NextRequest) {
  try {
    const { rows } = await req.json()
    if (!rows?.length) return NextResponse.json({success:false,message:'ไม่มีข้อมูล'},{status:400})
    const records = rows.map((r: Record<string,unknown>) => ({
      quota_date: toDateString(r['วันที่']),
      channel: String(r['ช่องทาง']??'').trim(),
      sku: String(r['SKU']??'').trim(),
      sku_name: String(r['ชื่อสินค้า']??'').trim(),
      quantity: Number(r['Quota'])||0,
      period: String(r['ช่วงเวลา']??'').trim()||null,
    })).filter((r: {sku:string;channel:string;quantity:number}) => r.sku && r.channel && r.quantity > 0)
    const { error } = await supabase.from('channel_quotas').insert(records)
    if (error) throw error
    return NextResponse.json({success:true,message:`บันทึกสำเร็จ ${records.length} รายการ`})
  } catch(e: unknown) {
    return NextResponse.json({success:false,message:e instanceof Error?e.message:'เกิดข้อผิดพลาด'},{status:500})
  }
}
""")

w('app/api/production/generate/route.ts', """import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
export async function POST(req: NextRequest) {
  try {
    const { date } = await req.json()
    const productionDate: string = date ?? new Date().toISOString().split('T')[0]
    const [{ data: workforce }, { data: skuMaster }, { data: quotas }] = await Promise.all([
      supabase.from('daily_workforce').select('*').eq('work_date', productionDate),
      supabase.from('sku_master').select('*').eq('is_active', true),
      supabase.from('channel_quotas').select('*').eq('quota_date', productionDate),
    ])
    if (!workforce?.length) return NextResponse.json({success:false,message:'ไม่พบข้อมูลกำลังคนวันนี้'},{status:400})
    if (!quotas?.length) return NextResponse.json({success:false,message:'ไม่พบข้อมูล Quota วันนี้'},{status:400})
    const skuMap = Object.fromEntries((skuMaster??[]).map(s => [s.sku, s]))
    const quotaBySku: Record<string,{total:number;sku_name:string;period:string}> = {}
    for (const q of quotas) {
      const key = `${q.sku}__${q.period??'เช้า'}`
      quotaBySku[key] ??= {total:0,sku_name:q.sku_name??q.sku,period:q.period??'เช้า'}
      quotaBySku[key].total += Number(q.quantity)
    }
    const workersByTable: Record<string,typeof workforce> = {}
    for (const w of workforce) (workersByTable[w.table_name] ??= []).push(w)
    const assignments = []
    for (const [skuPeriod, info] of Object.entries(quotaBySku)) {
      const [sku] = skuPeriod.split('__')
      const skuInfo = skuMap[sku]; if (!skuInfo) continue
      const tableWorkers = workersByTable[skuInfo.table_name] ?? []; if (!tableWorkers.length) continue
      const perWorker = Math.ceil(info.total / tableWorkers.length)
      const deadline = info.period === 'บ่าย' ? '17:00:00' : '12:00:00'
      for (const worker of tableWorkers) {
        assignments.push({production_date:productionDate,table_name:skuInfo.table_name,worker_code:worker.worker_code,worker_name:worker.worker_name,sku,sku_name:skuInfo.sku_name,target_quantity:perWorker,unit:skuInfo.unit??'ชิ้น',period:info.period,deadline_time:deadline,status:'รอดำเนินการ'})
      }
    }
    if (!assignments.length) return NextResponse.json({success:false,message:'ไม่สามารถสร้างคำสั่ง — ตรวจสอบ SKU Master'},{status:400})
    await supabase.from('production_assignments').delete().eq('production_date', productionDate)
    const { error } = await supabase.from('production_assignments').insert(assignments)
    if (error) throw error
    return NextResponse.json({success:true,message:`สร้างคำสั่งผลิต ${assignments.length} รายการเรียบร้อย`,count:assignments.length})
  } catch(e: unknown) {
    return NextResponse.json({success:false,message:e instanceof Error?e.message:'เกิดข้อผิดพลาด'},{status:500})
  }
}
""")

print('\n✅ สร้างไฟล์ทั้งหมดเสร็จแล้ว! รัน npm run dev ได้เลย')
