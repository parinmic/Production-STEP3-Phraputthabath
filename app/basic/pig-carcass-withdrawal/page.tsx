'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Package, ArrowUp, ArrowDown, CheckCircle2, XCircle, RotateCcw } from 'lucide-react'

interface LotRow {
  spec_code: string
  qty_3:     number
  weight_3:  number
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
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
    status === 'green' ? 'border-green-400 text-green-700 bg-green-50 focus:ring-green-500 focus:border-green-500' :
    status !== 'none'  ? 'border-red-400 text-red-700 bg-red-50 focus:ring-red-500 focus:border-red-500' :
                         'border-gray-300 text-gray-700 focus:ring-blue-500 focus:border-blue-500'

  return (
    <div className="flex items-center justify-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        onClick={e => e.stopPropagation()}
        placeholder="—"
        className={`w-20 text-right text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 transition-colors ${inputCls}`}
      />
      {status === 'red-low'  && <ArrowUp   size={14} className="text-red-500 shrink-0" />}
      {status === 'red-high' && <ArrowDown size={14} className="text-red-500 shrink-0" />}
    </div>
  )
}

export default function PigCarcassWithdrawalPage() {
  const [rows,          setRows]          = useState<LotRow[]>([])
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState('')
  const [sourceFile,    setSourceFile]    = useState('')
  const [lotOrder,      setLotOrder]      = useState<Record<string, string>>({})
  const [temps,         setTemps]         = useState<Record<string, string>>({})
  const [trimmingQty,   setTrimmingQty]   = useState('')
  const [carcassRate,   setCarcassRate]   = useState('90')
  const [usedQty,       setUsedQty]       = useState<Record<string, string>>({})

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
    // Restore persisted user input on mount
    try {
      const savedOrder    = localStorage.getItem('pig_carcass_lot_order')
      const savedTemps    = localStorage.getItem('pig_carcass_temps')
      const savedTrimming = localStorage.getItem('pig_carcass_trimming')
      const savedRate     = localStorage.getItem('pig_carcass_rate')
      const savedUsed     = localStorage.getItem('pig_carcass_used')
      if (savedOrder)    setLotOrder(JSON.parse(savedOrder))
      if (savedTemps)    setTemps(JSON.parse(savedTemps))
      if (savedTrimming) setTrimmingQty(savedTrimming)
      if (savedRate)     setCarcassRate(savedRate)
      if (savedUsed)     setUsedQty(JSON.parse(savedUsed))
    } catch { /* ignore */ }
    load()
  }, [load])

  // Persist lotOrder and sync enriched data for Yield page
  useEffect(() => {
    localStorage.setItem('pig_carcass_lot_order', JSON.stringify(lotOrder))
    const selected = rows
      .filter(r => lotOrder[r.spec_code])
      .map(r => ({
        spec_code:  r.spec_code,
        qty:        r.qty_3,
        avg_weight: r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0,
        order:      Number(lotOrder[r.spec_code]),
      }))
      .sort((a, b) => a.order - b.order)
    localStorage.setItem('pig_carcass_selected', JSON.stringify(selected))
  }, [lotOrder, rows])

  // Persist temps, trimmingQty, carcassRate, usedQty
  useEffect(() => { localStorage.setItem('pig_carcass_temps', JSON.stringify(temps)) }, [temps])
  useEffect(() => { localStorage.setItem('pig_carcass_trimming', trimmingQty) }, [trimmingQty])
  useEffect(() => { localStorage.setItem('pig_carcass_rate', carcassRate) }, [carcassRate])
  useEffect(() => { localStorage.setItem('pig_carcass_used', JSON.stringify(usedQty)) }, [usedQty])

  function resetAll() {
    setLotOrder({})
    setTemps({})
    setTrimmingQty('')
    setCarcassRate('90')
    setUsedQty({})
    localStorage.removeItem('pig_carcass_selected')
    localStorage.removeItem('pig_carcass_lot_order')
    localStorage.removeItem('pig_carcass_temps')
    localStorage.removeItem('pig_carcass_trimming')
    localStorage.removeItem('pig_carcass_rate')
    localStorage.removeItem('pig_carcass_used')
  }

  const totalQty   = rows.reduce((s, r) => s + r.qty_3,    0)
  const totalWgt   = rows.reduce((s, r) => s + r.weight_3, 0)
  const totalAvg   = totalQty > 0 ? totalWgt / totalQty : 0
  const selRows    = rows.filter(r => lotOrder[r.spec_code])
  const selQty     = selRows.reduce((s, r) => s + r.qty_3,    0)
  const selWgt     = selRows.reduce((s, r) => s + r.weight_3, 0)
  const selAvg     = selQty > 0 ? selWgt / selQty : 0
  const goodCount  = selRows.filter(r => tempStatus(temps[r.spec_code] ?? '') === 'green').length
  const badCount   = selRows.length - goodCount

  const trimmingNum = parseInt(trimmingQty) || 0
  const diff        = trimmingNum > 0 ? trimmingNum - selQty : null

  const rateNum     = parseFloat(carcassRate) || 90
  const totalSecs   = selQty > 0 ? selQty * rateNum : 0
  const totalMins   = Math.floor(totalSecs / 60)
  const totalHrs    = Math.floor(totalMins / 60)
  const remMins     = totalMins % 60

  const dropdownOptions = Array.from({ length: rows.length }, (_, i) => i + 1)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">เบิกหมูซีก</h1>
          <p className="text-gray-500 mt-1">ข้อมูลจาก Stock คลัง 20 — รหัสสินค้า 90007</p>
          {sourceFile && <p className="text-xs text-gray-400 mt-0.5">ไฟล์ล่าสุด: {sourceFile}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={resetAll}
            className="flex items-center gap-2 text-red-600 border border-red-300 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            title="ล้างข้อมูลทั้งหมด"
          >
            <RotateCcw size={14} />
            รีเซ็ต
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            รีโหลด
          </button>
        </div>
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

      {/* Summary card */}
      {!loading && rows.length > 0 && (
        <div className={`rounded-xl border px-5 py-4 flex flex-wrap gap-6 items-center transition-colors ${selRows.length > 0 ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">ล็อตที่เลือก</p>
            <p className={`text-2xl font-bold ${selRows.length > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
              {selRows.length} <span className="text-sm font-normal">ล็อต</span>
            </p>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">จำนวนตัวที่เลือก</p>
            <p className={`text-2xl font-bold ${selRows.length > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
              {selRows.length > 0 ? selQty.toLocaleString('th-TH') : '—'} <span className="text-sm font-normal">ตัว</span>
            </p>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">น้ำหนักเฉลี่ย</p>
            <p className={`text-2xl font-bold ${selRows.length > 0 ? 'text-orange-600' : 'text-gray-300'}`}>
              {selRows.length > 0 ? fmt(selAvg) : '—'} <span className="text-sm font-normal">กก./ตัว</span>
            </p>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={18} className={goodCount > 0 ? 'text-green-500' : 'text-gray-300'} />
              <div>
                <p className="text-xs text-gray-500">อุณหภูมิเหมาะสม</p>
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
          {selRows.length === 0 && (
            <p className="text-sm text-gray-400 ml-2">— เลือก Lot จาก dropdown เพื่อดูสรุป</p>
          )}
        </div>
      )}

      {/* จำนวนตัดแต่ง input */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-5 py-3">
          <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">จำนวนตัดแต่งหมู</label>
          <input
            type="text"
            inputMode="numeric"
            value={trimmingQty}
            onChange={e => setTrimmingQty(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="กรอกจำนวนตัว..."
            className="w-36 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          <span className="text-sm text-gray-500">ตัว</span>
          {trimmingNum > 0 && selQty > 0 && (
            <>
              <div className="w-px h-6 bg-gray-200" />
              <span className="text-sm text-gray-500">หมูซีกที่เลือก <b className="text-blue-700">{selQty.toLocaleString('th-TH')}</b> ตัว</span>
              <div className="w-px h-6 bg-gray-200" />
              <span className={`text-sm font-semibold ${diff === 0 ? 'text-green-600' : 'text-orange-600'}`}>
                {diff === 0 ? 'ครบพอดี' : diff! > 0 ? `ขาด ${diff!.toLocaleString('th-TH')} ตัว` : `เกิน ${Math.abs(diff!).toLocaleString('th-TH')} ตัว`}
              </span>
            </>
          )}
          {trimmingNum > 0 && selQty === 0 && (
            <span className="text-sm text-gray-400">— ยังไม่ได้เลือก Lot</span>
          )}
        </div>
      )}

      {/* อัตราการลงหมูซีก */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-5 py-3">
          <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">อัตราการลงหมูซีก</label>
          <input
            type="text"
            inputMode="decimal"
            value={carcassRate}
            onChange={e => setCarcassRate(e.target.value.replace(/[^0-9.]/g, ''))}
            className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          <span className="text-sm text-gray-500">วินาที/ตัว</span>
          <span className="text-xs text-gray-400">(มาตรฐาน 90 วินาที/ตัว)</span>
          {selQty > 0 && totalSecs > 0 && (
            <>
              <div className="w-px h-6 bg-gray-200" />
              <span className="text-sm text-gray-500">
                เวลารวมที่คาดว่าใช้:&nbsp;
                <b className="text-indigo-700">
                  {totalHrs > 0 ? `${totalHrs} ชม. ${remMins} นาที` : `${totalMins} นาที`}
                </b>
                <span className="text-gray-400 ml-1">({selQty.toLocaleString('th-TH')} ตัว × {rateNum} วิ)</span>
              </span>
            </>
          )}
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
                    <div>น้ำหนัก</div><div className="font-normal text-emerald-400">(กก.)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-orange-700">
                    <div>น้ำหนักเฉลี่ย</div><div className="font-normal text-orange-400">(กก./ตัว)</div>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-cyan-700">
                    <div>อุณหภูมิ</div><div className="font-normal text-cyan-400">(องศาเซลเซียส)</div>
                  </th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-500 w-28">ลำดับตัดแต่ง</th>
                  <th className="px-4 py-3 text-center font-semibold text-rose-700">
                    <div>ใช้ไป</div><div className="font-normal text-rose-400">(ตัว)</div>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-teal-700">
                    <div>คงเหลือ</div><div className="font-normal text-teal-400">(ตัว)</div>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => {
                  const avg      = r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0
                  const picked   = !!lotOrder[r.spec_code]
                  const tStatus  = tempStatus(temps[r.spec_code] ?? '')
                  const usedRaw  = usedQty[r.spec_code] ?? ''
                  const usedNum  = Math.min(parseInt(usedRaw) || 0, r.qty_3)
                  const remaining = r.qty_3 - usedNum
                  return (
                    <tr key={r.spec_code} className={`transition-colors ${picked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">{r.spec_code}</td>
                      <td className="px-4 py-2.5 text-right text-blue-700 font-semibold">{r.qty_3.toLocaleString('th-TH')}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(r.weight_3)}</td>
                      <td className="px-4 py-2.5 text-right text-orange-700">{fmt(avg)}</td>
                      <td className="px-3 py-2">
                        <TempCell
                          value={temps[r.spec_code] ?? ''}
                          onChange={v => setTemps(prev => ({ ...prev, [r.spec_code]: v }))}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <select
                          value={lotOrder[r.spec_code] ?? ''}
                          onChange={e => setLotOrder(prev => ({ ...prev, [r.spec_code]: e.target.value }))}
                          className={`text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors ${
                            picked
                              ? tStatus === 'green' ? 'border-green-400 bg-green-50 text-green-700'
                              : tStatus !== 'none'  ? 'border-red-400 bg-red-50 text-red-700'
                              : 'border-blue-400 bg-blue-50 text-blue-700'
                              : 'border-gray-300 bg-white text-gray-500'
                          }`}
                        >
                          <option value="">—</option>
                          {dropdownOptions.map(n => (
                            <option key={n} value={String(n)}>{n}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={usedRaw}
                          onChange={e => {
                            const val = e.target.value.replace(/[^0-9]/g, '')
                            const num = parseInt(val) || 0
                            setUsedQty(prev => ({ ...prev, [r.spec_code]: num > r.qty_3 ? String(r.qty_3) : val }))
                          }}
                          placeholder="0"
                          className={`w-20 text-right text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 transition-colors ${
                            usedNum > 0
                              ? usedNum === r.qty_3 ? 'border-teal-400 bg-teal-50 text-teal-700 focus:ring-teal-500'
                              : 'border-rose-400 bg-rose-50 text-rose-700 focus:ring-rose-500'
                              : 'border-gray-300 text-gray-600 focus:ring-blue-500'
                          }`}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`font-semibold text-sm ${
                          remaining === 0 ? 'text-teal-600' :
                          usedNum > 0     ? 'text-rose-600' : 'text-gray-400'
                        }`}>
                          {remaining === 0 && usedNum > 0 ? '✓ หมด' : remaining.toLocaleString('th-TH')}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                <tr className="font-bold text-sm">
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-gray-700">รวมทั้งหมด ({rows.length} ล็อต)</td>
                  <td className="px-4 py-3 text-right text-blue-700">{totalQty.toLocaleString('th-TH')}</td>
                  <td className="px-4 py-3 text-right text-emerald-700">{fmt(totalWgt)}</td>
                  <td className="px-4 py-3 text-right text-orange-700">{fmt(totalAvg)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-3 py-3 text-center text-xs text-gray-400">
                    {selRows.length > 0 ? `${selRows.length} เลือก` : ''}
                  </td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
