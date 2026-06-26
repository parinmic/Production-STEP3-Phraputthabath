'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Package } from 'lucide-react'

interface LotRow {
  spec_code: string
  qty_3:     number
  weight_3:  number
}

interface PointTemps {
  hip:       string // สะโพก
  outerLoin: string // สันนอก
  neckLoin:  string // สันคอ
}

interface AnimalSet {
  a1: PointTemps
  a2: PointTemps
  a3: PointTemps
}

interface TempRecord {
  start: AnimalSet // ชุดต้น Lot
  end:   AnimalSet // ชุดท้าย Lot
}

const POINTS: (keyof PointTemps)[] = ['hip', 'outerLoin', 'neckLoin']
const ANIMALS: (keyof AnimalSet)[] = ['a1', 'a2', 'a3']
const SETS: (keyof TempRecord)[] = ['start', 'end']

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function parseNum(v: string): number | null {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function calcAvgTemp(t: TempRecord | undefined): number | null {
  if (!t) return null
  const vals = SETS.flatMap(s => ANIMALS.flatMap(a => POINTS.map(p => parseNum(t[s][a][p]))))
    .filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function avgTempStatus(avg: number | null): 'green' | 'red' | 'none' {
  if (avg === null) return 'none'
  return avg >= 4 && avg <= 7 ? 'green' : 'red'
}

// Chars 5-7 of spec_code are the day-of-year (Julian day, 1-365/366) — sort by that to order lots by age.
function lotAgeKey(spec: string): number {
  const day = parseInt(spec.slice(4, 7), 10)
  return isNaN(day) ? Infinity : day
}

export default function PigCarcassWithdrawalPage() {
  const [rows,        setRows]        = useState<LotRow[]>([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [sourceFile,  setSourceFile]  = useState('')
  const [lotOrder,    setLotOrder]    = useState<Record<string, string>>({})
  const [qcTemps,     setQcTemps]     = useState<Record<string, TempRecord>>({})
  const [chillRoom,   setChillRoom]   = useState<Record<string, string>>({})
  const [trimmingQty, setTrimmingQty] = useState('')

  const loadQcTemps = useCallback(async () => {
    try {
      const res  = await fetch('/api/qc-lot-checks')
      const json = await res.json()
      if (json.temps)     setQcTemps(json.temps)
      if (json.chillRoom) setChillRoom(json.chillRoom)
    } catch { /* ignore */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/pig-carcass-withdrawal')
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      const sorted: LotRow[] = (json.rows as LotRow[])
        .filter(r => r.qty_3 > 0)
        .sort((a, b) => lotAgeKey(a.spec_code) - lotAgeKey(b.spec_code) || a.spec_code.localeCompare(b.spec_code))
      setRows(sorted)
      setSourceFile(json.source_file ?? '')
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
    loadQcTemps()
  }, [loadQcTemps])

  useEffect(() => {
    try {
      const savedOrder    = localStorage.getItem('pig_carcass_lot_order')
      const savedTrimming = localStorage.getItem('pig_carcass_trimming')
      if (savedOrder)    setLotOrder(JSON.parse(savedOrder))
      if (savedTrimming) setTrimmingQty(savedTrimming)
    } catch { /* ignore */ }
    load()
  }, [load])

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

  useEffect(() => { localStorage.setItem('pig_carcass_trimming', trimmingQty) }, [trimmingQty])

  const totalQty  = rows.reduce((s, r) => s + r.qty_3,    0)
  const totalWgt  = rows.reduce((s, r) => s + r.weight_3, 0)
  const totalAvg  = totalQty > 0 ? totalWgt / totalQty : 0
  const selRows   = rows.filter(r => lotOrder[r.spec_code])
  const selQty    = selRows.reduce((s, r) => s + r.qty_3,    0)
  const selWgt    = selRows.reduce((s, r) => s + r.weight_3, 0)
  const selAvg    = selQty > 0 ? selWgt / selQty : 0

  const trimmingNum = parseInt(trimmingQty) || 0
  const diff        = trimmingNum > 0 ? trimmingNum - selQty : null

  // Numbers already assigned to other lots (only active rows — exclude stale localStorage entries)
  const activeSpecs = new Set(rows.map(r => r.spec_code))
  const usedOrders  = new Set(
    Object.entries(lotOrder)
      .filter(([spec]) => activeSpecs.has(spec))
      .map(([, v]) => v)
      .filter(v => v !== '')
  )

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">เบิกหมูซีก</h1>
        </div>
        <div className="shrink-0">
          <button onClick={load} disabled={loading} className="flex items-center justify-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />รีโหลด
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-14 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังโหลดข้อมูล...</p>
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">{error}</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-14 text-gray-400">
          <Package size={36} className="mx-auto mb-3 opacity-30" />
          <p>ไม่พบข้อมูล — กรุณาอัพโหลดไฟล์ Stock คลัง 20 ก่อน</p>
        </div>
      )}

      {/* Summary card */}
      {!loading && rows.length > 0 && (
        <div className={`rounded-xl border px-3 sm:px-5 py-3 sm:py-4 grid grid-cols-3 sm:flex sm:flex-wrap gap-3 sm:gap-6 sm:items-center transition-colors ${selRows.length > 0 ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">ล็อตที่เลือก</p>
            <p className={`text-lg sm:text-2xl font-bold ${selRows.length > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
              {selRows.length} <span className="text-sm font-normal">ล็อต</span>
            </p>
          </div>
          <div className="hidden sm:block w-px h-10 bg-gray-200" />
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">จำนวนตัวที่เลือก</p>
            <p className={`text-lg sm:text-2xl font-bold ${selRows.length > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
              {selRows.length > 0 ? selQty.toLocaleString('th-TH') : '—'} <span className="text-sm font-normal">ตัว</span>
            </p>
          </div>
          <div className="hidden sm:block w-px h-10 bg-gray-200" />
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">น้ำหนักเฉลี่ย</p>
            <p className={`text-lg sm:text-2xl font-bold ${selRows.length > 0 ? 'text-orange-600' : 'text-gray-300'}`}>
              {selRows.length > 0 ? fmt(selAvg) : '—'} <span className="text-sm font-normal">กก./ตัว</span>
            </p>
          </div>
        </div>
      )}

      {/* จำนวนตัดแต่ง */}
      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 bg-white border border-gray-200 rounded-xl px-4 sm:px-5 py-3">
          <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">จำนวนตัดแต่งหมู</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={trimmingQty}
              onChange={e => setTrimmingQty(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="กรอกจำนวนตัว..."
              className="w-28 sm:w-36 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
            <span className="text-sm text-gray-500">ตัว</span>
          </div>
          {trimmingNum > 0 && selQty > 0 && (
            <>
              <span className="text-sm text-gray-500">หมูซีกที่เลือก <b className="text-blue-700">{selQty.toLocaleString('th-TH')}</b> ตัว</span>
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

      {/* Mobile card list */}
      {!loading && rows.length > 0 && (
        <div className="md:hidden space-y-1.5">
          {rows.map(r => {
            const avg     = r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0
            const picked  = !!lotOrder[r.spec_code]
            const tAvg    = calcAvgTemp(qcTemps[r.spec_code])
            const tStatus = avgTempStatus(tAvg)

            const availableNums = Array.from({ length: rows.length }, (_, k) => k + 1)
              .filter(n => !usedOrders.has(String(n)) || lotOrder[r.spec_code] === String(n))

            return (
              <div key={r.spec_code} className={`border rounded-lg overflow-hidden px-2.5 py-1.5 transition-colors ${picked ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-semibold text-gray-800 text-xs shrink-0 truncate">{r.spec_code}</span>
                  {chillRoom[r.spec_code] && (
                    <span className="text-xs font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 py-0.5 shrink-0">
                      Chill {chillRoom[r.spec_code]}
                    </span>
                  )}
                  <select
                    value={lotOrder[r.spec_code] ?? ''}
                    onChange={e => setLotOrder(prev => ({ ...prev, [r.spec_code]: e.target.value }))}
                    className={`ml-auto shrink-0 text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors ${
                      picked ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-500'
                    }`}
                  >
                    <option value="">—</option>
                    {availableNums.map(n => (
                      <option key={n} value={String(n)}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs">
                  <span className="text-blue-700 font-semibold">{r.qty_3.toLocaleString('th-TH')} <span className="text-gray-400 font-normal">ตัว</span></span>
                  <span className="text-orange-600 font-semibold">{fmt(avg)} <span className="text-gray-400 font-normal">กก./ตัว</span></span>
                  <span className="ml-auto">
                    {tAvg !== null ? (
                      <span className={`font-bold ${tStatus === 'green' ? 'text-green-600' : tStatus === 'red' ? 'text-red-500' : 'text-gray-500'}`}>
                        {tAvg.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°C
                        {tStatus === 'green' && <span className="ml-0.5">✓</span>}
                        {tStatus === 'red'   && <span className="ml-0.5">✗</span>}
                      </span>
                    ) : <span className="text-gray-300">ยังไม่ได้ตรวจ</span>}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Table (desktop) */}
      {!loading && rows.length > 0 && (
        <div className="hidden md:block border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs">
                <tr>
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
                    <div>อุณหภูมิเฉลี่ย</div><div className="font-normal text-cyan-400">(°C จาก QC)</div>
                  </th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-500 w-28">ลำดับตัดแต่ง</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const avg      = r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0
                  const picked   = !!lotOrder[r.spec_code]
                  const tAvg     = calcAvgTemp(qcTemps[r.spec_code])
                  const tStatus  = avgTempStatus(tAvg)

                  // Available order numbers: not used by others (or currently selected by this row)
                  const availableNums = Array.from({ length: rows.length }, (_, k) => k + 1)
                    .filter(n => !usedOrders.has(String(n)) || lotOrder[r.spec_code] === String(n))

                  return (
                    <tr key={r.spec_code} className={`transition-colors ${picked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">
                        <span className="flex items-center gap-2">
                          {r.spec_code}
                          {chillRoom[r.spec_code] && (
                            <span className="text-xs font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 py-0.5">
                              Chill {chillRoom[r.spec_code]}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-blue-700 font-semibold">{r.qty_3.toLocaleString('th-TH')}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(r.weight_3)}</td>
                      <td className="px-4 py-2.5 text-right text-orange-700">{fmt(avg)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {tAvg !== null ? (
                          <span className={`font-bold text-sm ${
                            tStatus === 'green' ? 'text-green-600' :
                            tStatus === 'red'   ? 'text-red-500'   : 'text-gray-500'
                          }`}>
                            {tAvg.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C
                            {tStatus === 'green' && <span className="ml-1 text-xs font-normal">✓</span>}
                            {tStatus === 'red'   && <span className="ml-1 text-xs font-normal">✗</span>}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">ยังไม่ได้ตรวจ</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <select
                          value={lotOrder[r.spec_code] ?? ''}
                          onChange={e => setLotOrder(prev => ({ ...prev, [r.spec_code]: e.target.value }))}
                          className={`text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors ${
                            picked ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-500'
                          }`}
                        >
                          <option value="">—</option>
                          {availableNums.map(n => (
                            <option key={n} value={String(n)}>{n}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                <tr className="font-bold text-sm">
                  <td className="px-4 py-3 text-gray-700">รวมทั้งหมด ({rows.length} ล็อต)</td>
                  <td className="px-4 py-3 text-right text-blue-700">{totalQty.toLocaleString('th-TH')}</td>
                  <td className="px-4 py-3 text-right text-emerald-700">{fmt(totalWgt)}</td>
                  <td className="px-4 py-3 text-right text-orange-700">{fmt(totalAvg)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-3 py-3 text-center text-xs text-gray-400">
                    {selRows.length > 0 ? `${selRows.length} เลือก` : ''}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
