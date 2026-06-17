'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Zap, CheckCircle2, AlertCircle } from 'lucide-react'

export default function ProductionMenuPage() {
  const [date, setDate] = useState(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }))
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{success:boolean;message:string}|null>(null)

  const generate = async () => {
    setLoading(true); setResult(null)
    try {
      const res = await fetch('/api/production/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      setResult(await res.json())
    } catch { setResult({ success: false, message: 'เกิดข้อผิดพลาด' }) }
    setLoading(false)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">คำสั่งเบิกและผลิต</h1>
      <p className="text-gray-500 mb-8">เลือก Station ที่ต้องการดูคำสั่งผลิต หรือกดสร้างคำสั่งผลิตใหม่</p>
      <div className="card mb-8">
        <h2 className="font-semibold text-gray-800 mb-1">สร้างคำสั่งผลิตประจำวัน</h2>
        <p className="text-sm text-gray-500 mb-4">ระบบจะคำนวณ Quota รวม หาร จำนวนพนักงานแล้วสร้างคำสั่งอัตโนมัติ</p>
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm font-medium text-gray-700">วันที่ผลิต</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button onClick={generate} disabled={loading} className="btn-primary flex items-center gap-2">
          <Zap size={16}/>{loading ? 'กำลังสร้าง...' : 'สร้างคำสั่งผลิต'}
        </button>
        {result && (
          <div className={`mt-4 flex items-center gap-3 rounded-xl p-4 ${result.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {result.success ? <CheckCircle2 size={20}/> : <AlertCircle size={20}/>}{result.message}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-6">
        {[
          { label: 'Station สามชั้น', slug: 'sam-chan',  cls: 'border-blue-500 bg-blue-50',       text: 'text-blue-700',    dot: 'bg-blue-500' },
          { label: 'Station สะโพก',  slug: 'sa-phok',  cls: 'border-orange-500 bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-500' },
          { label: 'Station ไหล่',   slug: 'lai',      cls: 'border-green-500 bg-green-50',    text: 'text-green-700',   dot: 'bg-green-500' },
          { label: 'Station หมูบด',  slug: 'moo-chod', cls: 'border-red-500 bg-red-50',        text: 'text-red-700',     dot: 'bg-red-500' },
          { label: 'Station สไลด์',  slug: 'slide',    cls: 'border-purple-500 bg-purple-50',  text: 'text-purple-700',  dot: 'bg-purple-500' },
          { label: 'Station เผาขา',  slug: 'pao-kha',  cls: 'border-fuchsia-500 bg-fuchsia-50', text: 'text-fuchsia-700', dot: 'bg-fuchsia-500' },
          { label: 'Station เลาะขา', slug: 'loa-kha',  cls: 'border-teal-500 bg-teal-50',      text: 'text-teal-700',    dot: 'bg-teal-500' },
        ].map(t => (
          <Link key={t.slug} href={`/production/${t.slug}?date=${date}`} className={`border-2 ${t.cls} rounded-xl p-6 hover:opacity-80 transition-opacity`}>
            <div className={`w-4 h-4 rounded-full ${t.dot} mb-3`}/>
            <p className={`text-xl font-bold ${t.text}`}>{t.label}</p>
            <p className="text-sm text-gray-500 mt-1">ดูคำสั่งผลิตรายคน →</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
