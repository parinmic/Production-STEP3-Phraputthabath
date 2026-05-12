'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Calendar, Printer, RefreshCw, PackageOpen } from 'lucide-react'

interface WithdrawalItem {
  id: string
  request_date: string
  phase: number
  sku: string
  sku_name: string | null
  quantity: number
  unit: string
  work_station: string | null
  note: string | null
}

const PHASE_CONFIG = {
  '1': { label: 'Phase 1 — รอบเช้า',   color: 'blue',   time: '08:00 น.' },
  '2': { label: 'Phase 2 — รอบบ่าย',   color: 'orange', time: '13:00 น.' },
  '3': { label: 'Phase 3 — แผน 100%',    color: 'purple', time: '18:00 น.' },
} as const

const STATION_COLORS: Record<string, string> = {
  'สามชั้น': 'bg-blue-100 text-blue-700',
  'สะโพก':   'bg-orange-100 text-orange-700',
  'ไหล่':    'bg-green-100 text-green-700',
}

export default function WithdrawalPage() {
  const { phase } = useParams() as { phase: string }
  const today = new Date().toISOString().split('T')[0]
  const [date, setDate] = useState(today)
  const [items, setItems] = useState<WithdrawalItem[]>([])
  const [loading, setLoading] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  const cfg = PHASE_CONFIG[phase as keyof typeof PHASE_CONFIG] ?? PHASE_CONFIG['1']

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/withdrawal?date=${date}&phase=${phase}`)
      const data = await res.json()
      setItems(data.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [date, phase])

  useEffect(() => { load() }, [load])

  const handlePrint = () => window.print()

  // Group by work_station
  const grouped = items.reduce<Record<string, WithdrawalItem[]>>((acc, item) => {
    const key = item.work_station ?? 'ไม่ระบุ Station'
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})

  const totalQty = items.reduce((s, i) => s + i.quantity, 0)

  const borderCls = cfg.color === 'blue'   ? 'border-blue-500'
                  : cfg.color === 'orange' ? 'border-orange-500'
                  :                          'border-purple-500'
  const badgeCls  = cfg.color === 'blue'   ? 'bg-blue-100 text-blue-700'
                  : cfg.color === 'orange' ? 'bg-orange-100 text-orange-700'
                  :                          'bg-purple-100 text-purple-700'

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">รายการเบิกสินค้า</h1>
            <p className="text-gray-500 mt-1">แสดงรายการสินค้าที่ต้องเบิกเพื่อการผลิต</p>
          </div>
          <button onClick={handlePrint}
            className="no-print flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors text-sm">
            <Printer size={16} /> ดาวน์โหลด / พิมพ์ PDF
          </button>
        </div>

        {/* Phase tabs */}
        <div className="no-print flex gap-2">
          {(['1','2','3'] as const).map((ph) => {
            const c = PHASE_CONFIG[ph]
            const active = ph === phase
            return (
              <Link key={ph} href={`/withdrawal/${ph}`}
                className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                  active
                    ? `border-${c.color}-500 bg-${c.color}-50 text-${c.color}-700`
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}>
                Phase {ph}
              </Link>
            )
          })}
        </div>

        {/* Filter bar */}
        <div className={`no-print card border-l-4 ${borderCls} flex items-center gap-4 flex-wrap`}>
          <Calendar size={18} className="text-gray-400 shrink-0" />
          <label className="font-medium text-gray-700 whitespace-nowrap">วันที่</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-300 rounded-lg">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> โหลดใหม่
          </button>
          <span className={`ml-auto px-3 py-1 rounded-full text-sm font-semibold ${badgeCls}`}>
            {cfg.label} · {cfg.time}
          </span>
        </div>

        {/* Print area */}
        <div id="print-area" ref={printRef}>
          {/* Print header (only visible when printing) */}
          <div className="hidden print:block mb-6">
            <div className="flex items-center justify-between border-b-2 border-gray-800 pb-3 mb-4">
              <div>
                <p className="text-xl font-bold">ใบเบิกสินค้า — {cfg.label}</p>
                <p className="text-sm text-gray-600 mt-0.5">วันที่ผลิต: {date} · เวลา: {cfg.time}</p>
              </div>
              <div className="text-right text-sm text-gray-600">
                <p>CP Foods Production System</p>
                <p>พิมพ์เมื่อ: {new Date().toLocaleString('th-TH')}</p>
              </div>
            </div>
          </div>

          {loading && (
            <div className="card text-center py-12 text-gray-400 no-print">
              <RefreshCw size={32} className="animate-spin mx-auto mb-3" />
              <p>กำลังโหลดข้อมูล...</p>
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="card text-center py-12 no-print">
              <PackageOpen size={40} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 font-medium">ยังไม่มีรายการเบิกสินค้า</p>
              <p className="text-sm text-gray-400 mt-1">วันที่ {date} · {cfg.label}</p>
            </div>
          )}

          {!loading && items.length > 0 && (
            <div className="space-y-6">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4 no-print">
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">{items.length}</p>
                  <p className="text-sm text-gray-500 mt-0.5">รายการ SKU</p>
                </div>
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">{Object.keys(grouped).length}</p>
                  <p className="text-sm text-gray-500 mt-0.5">Station</p>
                </div>
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">{totalQty.toLocaleString()}</p>
                  <p className="text-sm text-gray-500 mt-0.5">จำนวนรวม</p>
                </div>
              </div>

              {/* Tables by station */}
              {Object.entries(grouped).map(([station, stationItems]) => (
                <div key={station} className="card">
                  <div className="flex items-center gap-3 mb-4">
                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${STATION_COLORS[station] ?? 'bg-gray-100 text-gray-700'}`}>
                      {station}
                    </span>
                    <span className="text-sm text-gray-500">
                      {stationItems.length} รายการ · รวม {stationItems.reduce((s, i) => s + i.quantity, 0).toLocaleString()} ชิ้น
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="px-3 py-2.5 text-left text-gray-600 font-medium w-8">#</th>
                        <th className="px-3 py-2.5 text-left text-gray-600 font-medium">รหัส SKU</th>
                        <th className="px-3 py-2.5 text-left text-gray-600 font-medium">ชื่อสินค้า</th>
                        <th className="px-3 py-2.5 text-right text-gray-600 font-medium">จำนวน</th>
                        <th className="px-3 py-2.5 text-left text-gray-600 font-medium">หน่วย</th>
                        <th className="px-3 py-2.5 text-left text-gray-600 font-medium">หมายเหตุ</th>
                        <th className="px-3 py-2.5 text-center text-gray-600 font-medium no-print">เบิกแล้ว ✓</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stationItems.map((item, idx) => (
                        <tr key={item.id} className="border-b hover:bg-gray-50">
                          <td className="px-3 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                          <td className="px-3 py-2.5 font-mono text-gray-700">{item.sku}</td>
                          <td className="px-3 py-2.5 text-gray-800">{item.sku_name ?? '-'}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{item.quantity.toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-gray-600">{item.unit}</td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">{item.note ?? ''}</td>
                          <td className="px-3 py-2.5 text-center no-print">
                            <input type="checkbox" className="w-4 h-4 cursor-pointer" />
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-semibold">
                        <td colSpan={3} className="px-3 py-2.5 text-right text-gray-600">รวม</td>
                        <td className="px-3 py-2.5 text-right text-gray-900">
                          {stationItems.reduce((s, i) => s + i.quantity, 0).toLocaleString()}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}

              {/* Grand total */}
              <div className="card bg-gray-900 text-white flex items-center justify-between px-6 py-4">
                <span className="font-semibold">รวมทั้งหมด — {cfg.label}</span>
                <span className="text-2xl font-bold">{totalQty.toLocaleString()} ชิ้น</span>
              </div>

              {/* Signature area for print */}
              <div className="hidden print:grid grid-cols-3 gap-8 mt-8 pt-6 border-t border-gray-300">
                {['ผู้เบิก', 'ผู้จ่ายของ', 'ผู้อนุมัติ'].map(role => (
                  <div key={role} className="text-center">
                    <div className="border-b border-gray-400 mb-2 pb-8" />
                    <p className="text-sm text-gray-600">{role}</p>
                    <p className="text-xs text-gray-400 mt-1">วันที่ ............../............../..............  </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
