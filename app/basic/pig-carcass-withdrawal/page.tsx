'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Package } from 'lucide-react'

interface LotRow {
  spec_code: string
  qty_3:     number
  weight_3:  number
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export default function PigCarcassWithdrawalPage() {
  const [rows,    setRows]    = useState<LotRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/pig-carcass-withdrawal')
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      const sorted: LotRow[] = (json.rows as LotRow[]).sort((a, b) =>
        a.spec_code.slice(-1).localeCompare(b.spec_code.slice(-1))
      )
      setRows(sorted)
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const totalQty = rows.reduce((s, r) => s + r.qty_3,    0)
  const totalWgt = rows.reduce((s, r) => s + r.weight_3, 0)
  const totalAvg = totalQty > 0 ? totalWgt / totalQty : 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">เบิกหมูซีก</h1>
          <p className="text-gray-500 mt-1">ข้อมูลจาก Stock คลัง 20 — รหัสสินค้า 90007</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          รีโหลด
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-14 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังโหลดข้อมูล...</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-14 text-gray-400">
          <Package size={36} className="mx-auto mb-3 opacity-30" />
          <p>ไม่พบข้อมูล — กรุณาอัพโหลดไฟล์ Stock คลัง 20 ก่อน</p>
        </div>
      )}

      {/* Table */}
      {!loading && rows.length > 0 && (
        <div className="border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-400 w-8">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Lot</th>
                  <th className="px-4 py-3 text-right font-semibold text-blue-700">
                    <div>จำนวน</div>
                    <div className="font-normal text-blue-400">(ตัว)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-emerald-700">
                    <div>น้ำหนัก</div>
                    <div className="font-normal text-emerald-400">(กก.)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-orange-700">
                    <div>น้ำหนักเฉลี่ย</div>
                    <div className="font-normal text-orange-400">(กก./ตัว)</div>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => {
                  const avg = r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0
                  return (
                    <tr key={r.spec_code} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">{r.spec_code}</td>
                      <td className="px-4 py-2.5 text-right text-blue-700 font-semibold">
                        {r.qty_3.toLocaleString('th-TH')}
                      </td>
                      <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(r.weight_3)}</td>
                      <td className="px-4 py-2.5 text-right text-orange-700">{fmt(avg)}</td>
                    </tr>
                  )
                })}
              </tbody>

              <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                <tr className="font-bold text-sm">
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-gray-700">รวมทั้งหมด ({rows.length} ล็อต)</td>
                  <td className="px-4 py-3 text-right text-blue-700">
                    {totalQty.toLocaleString('th-TH')}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-700">{fmt(totalWgt)}</td>
                  <td className="px-4 py-3 text-right text-orange-700">{fmt(totalAvg)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
