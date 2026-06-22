'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Thermometer, CheckCircle2, XCircle, Package } from 'lucide-react'

interface LotRow {
  spec_code: string
  qty_3:     number
  weight_3:  number
}

function tempStatus(value: string): 'green' | 'red-low' | 'red-high' | 'none' {
  const n = parseFloat(value)
  if (isNaN(n)) return 'none'
  if (n >= 4 && n <= 7) return 'green'
  if (n < 4) return 'red-low'
  return 'red-high'
}

function TempCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const status = tempStatus(value)
  const inputCls =
    status === 'green'    ? 'border-green-400 text-green-700 bg-green-50 focus:ring-green-500 focus:border-green-500' :
    status !== 'none'     ? 'border-red-400 text-red-700 bg-red-50 focus:ring-red-500 focus:border-red-500' :
                            'border-gray-300 text-gray-700 focus:ring-blue-500 focus:border-blue-500'
  const label =
    status === 'green'    ? <span className="text-xs text-green-600 font-medium">ผ่าน</span> :
    status === 'red-low'  ? <span className="text-xs text-red-500 font-medium">ต่ำเกิน</span> :
    status === 'red-high' ? <span className="text-xs text-red-500 font-medium">สูงเกิน</span> :
                            null

  return (
    <div className="flex items-center justify-center gap-2">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="—"
        className={`w-24 text-right text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 transition-colors ${inputCls}`}
      />
      <div className="w-12 text-left">{label}</div>
    </div>
  )
}

export default function BasicTemperatureCheckPage() {
  const [rows,       setRows]       = useState<LotRow[]>([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [sourceFile, setSourceFile] = useState('')
  const [temps,      setTemps]      = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/pig-carcass-withdrawal')
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      const sorted: LotRow[] = (json.rows as LotRow[])
        .filter(r => r.qty_3 > 0)
        .sort((a, b) => a.spec_code.slice(-1).localeCompare(b.spec_code.slice(-1)))
      setRows(sorted)
      setSourceFile(json.source_file ?? '')
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('pig_carcass_temps')
      if (saved) setTemps(JSON.parse(saved))
    } catch { /* ignore */ }
    load()
  }, [load])

  useEffect(() => {
    localStorage.setItem('pig_carcass_temps', JSON.stringify(temps))
  }, [temps])

  const filledRows = rows.filter(r => temps[r.spec_code] && temps[r.spec_code] !== '')
  const goodCount  = filledRows.filter(r => tempStatus(temps[r.spec_code]) === 'green').length
  const badCount   = filledRows.filter(r => tempStatus(temps[r.spec_code]) !== 'none' && tempStatus(temps[r.spec_code]) !== 'green').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Thermometer size={24} className="text-cyan-500" />
            ตรวจอุณหภูมิ (QC)
          </h1>
          <p className="text-gray-500 mt-1 text-sm">Lot หมูซีก จาก Stock คลัง 20 — รหัสสินค้า 90007</p>
          {sourceFile && <p className="text-xs text-gray-400 mt-0.5">ไฟล์ล่าสุด: {sourceFile}</p>}
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
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">{error}</div>
      )}

      {/* Empty */}
      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-14 text-gray-400">
          <Package size={36} className="mx-auto mb-3 opacity-30" />
          <p>ไม่พบข้อมูล — กรุณาอัพโหลดไฟล์ Stock คลัง 20 ก่อน</p>
        </div>
      )}

      {/* Summary */}
      {!loading && rows.length > 0 && (
        <div className="rounded-xl border bg-gray-50 border-gray-200 px-5 py-4 flex flex-wrap gap-6 items-center">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">Lot ทั้งหมด</p>
            <p className="text-2xl font-bold text-gray-700">
              {rows.length} <span className="text-sm font-normal">ล็อต</span>
            </p>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">กรอกแล้ว</p>
            <p className={`text-2xl font-bold ${filledRows.length > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
              {filledRows.length} <span className="text-sm font-normal">ล็อต</span>
            </p>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={18} className={goodCount > 0 ? 'text-green-500' : 'text-gray-300'} />
              <div>
                <p className="text-xs text-gray-500">อุณหภูมิเหมาะสม (4–7 °C)</p>
                <p className={`text-xl font-bold leading-tight ${goodCount > 0 ? 'text-green-600' : 'text-gray-300'}`}>
                  {goodCount} <span className="text-sm font-normal">ล็อต</span>
                </p>
              </div>
            </div>
            {badCount > 0 && (
              <div className="flex items-center gap-1.5">
                <XCircle size={18} className="text-red-400" />
                <div>
                  <p className="text-xs text-gray-500">ไม่เหมาะสม</p>
                  <p className="text-xl font-bold leading-tight text-red-500">
                    {badCount} <span className="text-sm font-normal">ล็อต</span>
                  </p>
                </div>
              </div>
            )}
          </div>
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
                    <div>จำนวน</div><div className="font-normal text-blue-400">(ตัว)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-emerald-700">
                    <div>น้ำหนักเฉลี่ย</div><div className="font-normal text-emerald-400">(กก./ตัว)</div>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-cyan-700">
                    <div>อุณหภูมิ</div><div className="font-normal text-cyan-400">(องศาเซลเซียส)</div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => {
                  const avg    = r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0
                  const status = tempStatus(temps[r.spec_code] ?? '')
                  const rowBg  =
                    status === 'green' ? 'bg-green-50' :
                    status !== 'none'  ? 'bg-red-50'   : 'hover:bg-gray-50'
                  return (
                    <tr key={r.spec_code} className={`transition-colors ${rowBg}`}>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">{r.spec_code}</td>
                      <td className="px-4 py-2.5 text-right text-blue-700 font-semibold">{r.qty_3.toLocaleString('th-TH')}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-700">
                        {avg > 0 ? avg.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <TempCell
                          value={temps[r.spec_code] ?? ''}
                          onChange={v => setTemps(prev => ({ ...prev, [r.spec_code]: v }))}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
