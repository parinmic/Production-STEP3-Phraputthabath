'use client'
import { useState } from 'react'
import { Calendar, Download, Loader2, AlertCircle } from 'lucide-react'
import * as XLSX from 'xlsx'

interface SkuDetail {
  sku: string
  skuName: string
  avgQty: number
  rate: number
  manHr: number
}

interface StationResult {
  station: string
  manHr: number
  people: number
  finishHr: number | null
  skuDetail: SkuDetail[]
}

interface ApiResult {
  date: string
  histDates: string[]
  totalManHr: number
  stations: StationResult[]
}

export default function RecommendedManpowerPage() {
  const today = new Date().toISOString().split('T')[0]
  const [date, setDate] = useState(today)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ApiResult | null>(null)

  const handleCalculate = async () => {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch(`/api/recommended-manpower?date=${date}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (!data.stations?.length) throw new Error('ไม่พบข้อมูลออเดอร์หรือ Mas Productivity สำหรับวันที่เลือก')
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (!result) return

    // Sheet 1: Summary
    const summaryRows = [
      ['กำลังคนแนะนำ', `วันที่ ${date}`],
      ['ข้อมูลอ้างอิงจากวัน', result.histDates.join(', ')],
      [''],
      ['Station', 'Man-Hr รวม', 'คนแนะนำ (คน)', 'เวลาเสร็จโดยประมาณ (ชม.)'],
      ...result.stations.map(s => [s.station, s.manHr, s.people, s.finishHr != null ? s.finishHr : '-']),
      ['รวม', result.totalManHr, result.stations.reduce((sum, s) => sum + s.people, 0), ''] as (string | number)[],
    ]

    // Sheet 2: SKU Detail
    const detailRows: (string | number)[][] = [
      ['Station', 'SKU', 'ชื่อสินค้า', 'Avg Qty เฉลี่ย 3 วัน (กก.)', 'Rate (กก./ชม./คน)', 'Man-Hr'],
    ]
    for (const s of result.stations) {
      for (const d of s.skuDetail) {
        detailRows.push([s.station, d.sku, d.skuName, Math.round(d.avgQty * 100) / 100, d.rate, Math.round(d.manHr * 100) / 100])
      }
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'สรุปกำลังคนแนะนำ')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), 'รายละเอียด SKU')
    XLSX.writeFile(wb, `กำลังคนแนะนำ_${date}.xlsx`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">กำลังคนแนะนำ</h1>
        <p className="text-gray-500 mt-1">คำนวณจากออเดอร์ย้อนหลัง 3 วัน และ Mas Productivity</p>
      </div>

      {/* Controls */}
      <div className="card flex flex-wrap items-center gap-4">
        <Calendar size={20} className="text-blue-500 shrink-0" />
        <label className="font-medium text-gray-700 whitespace-nowrap">วันที่เป้าหมาย</label>
        <input
          type="date"
          value={date}
          onChange={e => { setDate(e.target.value); setResult(null); setError('') }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleCalculate}
          disabled={!date || loading}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : null}
          {loading ? 'กำลังคำนวณ...' : 'คำนวณ'}
        </button>
        {result && (
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors"
          >
            <Download size={16} />
            ดาวน์โหลด Excel
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
          <AlertCircle size={18} className="shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            อ้างอิงออเดอร์จากวัน: <span className="font-medium text-gray-700">{result.histDates.join(', ')}</span>
            {' '}· Man-Hr รวมทั้งหมด: <span className="font-medium text-gray-700">{result.totalManHr.toLocaleString()} ชม.</span>
          </p>

          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Station</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-700">Man-Hr รวม</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-700">% ของทั้งหมด</th>
                  <th className="text-right px-4 py-3 font-semibold text-blue-700">คนแนะนำ</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-700">เวลาเสร็จ (ชม.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.stations.map(s => (
                  <tr key={s.station} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.station}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{s.manHr.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {result.totalManHr > 0 ? ((s.manHr / result.totalManHr) * 100).toFixed(1) : 0}%
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-blue-700 text-base">{s.people}</td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {s.finishHr != null ? `${s.finishHr} ชม.` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td className="px-4 py-3 font-semibold text-gray-700">รวม</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-700">{result.totalManHr.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-500">100%</td>
                  <td className="px-4 py-3 text-right font-bold text-blue-700 text-base">
                    {result.stations.reduce((s, r) => s + r.people, 0)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
