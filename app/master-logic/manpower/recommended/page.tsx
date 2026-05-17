'use client'
import { useState } from 'react'
import { Calendar, Download } from 'lucide-react'

export default function RecommendedManpowerPage() {
  const today = new Date().toISOString().split('T')[0]
  const [date, setDate] = useState(today)
  const [loading, setLoading] = useState(false)

  const handleDownload = async () => {
    setLoading(true)
    try {
      // TODO: implement download logic
      console.log('download for date:', date)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">กำลังคนแนะนำ</h1>
        <p className="text-gray-500 mt-1">เลือกวันที่เพื่อดาวน์โหลดไฟล์กำลังคนแนะนำ</p>
      </div>

      <div className="card flex items-center gap-4">
        <Calendar size={20} className="text-blue-500 shrink-0" />
        <label className="font-medium text-gray-700 whitespace-nowrap">วันที่</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleDownload}
          disabled={!date || loading}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
        >
          <Download size={16} />
          {loading ? 'กำลังดาวน์โหลด...' : 'ดาวน์โหลด'}
        </button>
      </div>
    </div>
  )
}
