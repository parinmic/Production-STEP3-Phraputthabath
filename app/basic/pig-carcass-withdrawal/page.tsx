'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Package, ArrowUp, ArrowDown } from 'lucide-react'

interface LotRow {
  spec_code: string
  qty_3:     number
  weight_3:  number
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function TempCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const num = parseFloat(value)
  const valid = !isNaN(num)

  let indicator: React.ReactNode = null
  let inputCls = 'border-gray-300 text-gray-700 focus:ring-blue-500 focus:border-blue-500'

  if (valid) {
    if (num >= 4 && num <= 7) {
      inputCls = 'border-green-400 text-green-700 bg-green-50 focus:ring-green-500 focus:border-green-500'
    } else if (num < 4) {
      inputCls = 'border-red-400 text-red-700 bg-red-50 focus:ring-red-500 focus:border-red-500'
      indicator = <ArrowUp size={14} className="text-red-500 shrink-0" />
    } else {
      inputCls = 'border-red-400 text-red-700 bg-red-50 focus:ring-red-500 focus:border-red-500'
      indicator = <ArrowDown size={14} className="text-red-500 shrink-0" />
    }
  }

  return (
    <div className="flex items-center justify-center gap-1">
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={e => onChange(e.target.value)}
        onClick={e => e.stopPropagation()}
        placeholder="—"
        className={`w-20 text-right text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 transition-colors ${inputCls}`}
      />
      {indicator}
    </div>
  )
}

export default function PigCarcassWithdrawalPage() {
  const [rows,       setRows]       = useState<LotRow[]>([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [sourceFile, setSourceFile] = useState('')
  const [selected,   setSelected]   = useState<Set<string>>(new Set())
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
      setSelected(new Set())
      setTemps({})
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function toggle(code: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }

  function toggleAll() {
    setSelected(prev => prev.size === rows.length ? new Set() : new Set(rows.map(r => r.spec_code)))
  }

  function setTemp(code: string, val: string) {
    setTemps(prev => ({ ...prev, [code]: val }))
  }

  const totalQty = rows.reduce((s, r) => s + r.qty_3,    0)
  const totalWgt = rows.reduce((s, r) => s + r.weight_3, 0)
  const totalAvg = totalQty > 0 ? totalWgt / totalQty : 0

  const selRows = rows.filter(r => selected.has(r.spec_code))
  const selQty  = selRows.reduce((s, r) => s + r.qty_3,    0)
  const selWgt  = selRows.reduce((s, r) => s + r.weight_3, 0)
  const selAvg  = selQty > 0 ? selWgt / selQty : 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">เบิกหมูซีก</h1>
          <p className="text-gray-500 mt-1">ข้อมูลจาก Stock คลัง 20 — รหัสสินค้า 90007</p>
          {sourceFile && (
            <p className="text-xs text-gray-400 mt-0.5">ไฟล์ล่าสุด: {sourceFile}</p>
          )}
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

      {/* Selected summary */}
      {!loading && rows.length > 0 && (
        <div className={`rounded-xl border px-5 py-4 flex flex-wrap gap-6 items-center transition-colors ${selected.size > 0 ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">ล็อตที่เลือก</p>
            <p className={`text-2xl font-bold ${selected.size > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
              {selected.size} <span className="text-sm font-normal">ล็อต</span>
            </p>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">จำนวนตัวที่เลือก</p>
            <p className={`text-2xl font-bold ${selected.size > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
              {selected.size > 0 ? selQty.toLocaleString('th-TH') : '—'} <span className="text-sm font-normal">ตัว</span>
            </p>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">น้ำหนักเฉลี่ย</p>
            <p className={`text-2xl font-bold ${selected.size > 0 ? 'text-orange-600' : 'text-gray-300'}`}>
              {selected.size > 0 ? fmt(selAvg) : '—'} <span className="text-sm font-normal">กก./ตัว</span>
            </p>
          </div>
          {selected.size === 0 && (
            <p className="text-sm text-gray-400 ml-2">— ติ๊กเลือก Lot เพื่อดูสรุป</p>
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
                  <th className="px-4 py-3 text-center font-semibold text-cyan-700">
                    <div>อุณหภูมิ</div>
                    <div className="font-normal text-cyan-400">(องศาเซลเซียส)</div>
                  </th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-500 w-16">
                    <input
                      type="checkbox"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={toggleAll}
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                      title="เลือกทั้งหมด"
                    />
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => {
                  const avg     = r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0
                  const checked = selected.has(r.spec_code)
                  return (
                    <tr
                      key={r.spec_code}
                      onClick={() => toggle(r.spec_code)}
                      className={`cursor-pointer transition-colors ${checked ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'}`}
                    >
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">{r.spec_code}</td>
                      <td className="px-4 py-2.5 text-right text-blue-700 font-semibold">
                        {r.qty_3.toLocaleString('th-TH')}
                      </td>
                      <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(r.weight_3)}</td>
                      <td className="px-4 py-2.5 text-right text-orange-700">{fmt(avg)}</td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        <TempCell
                          value={temps[r.spec_code] ?? ''}
                          onChange={v => setTemp(r.spec_code, v)}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(r.spec_code)}
                          onClick={e => e.stopPropagation()}
                          className="w-4 h-4 accent-blue-600 cursor-pointer"
                        />
                      </td>
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
                  <td className="px-4 py-3" />
                  <td className="px-3 py-3 text-center text-xs text-gray-400">
                    {selected.size > 0 ? `${selected.size} เลือก` : ''}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Selected lot list */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 flex items-center gap-3 text-sm">
          <span className="text-blue-700 font-semibold">เลือกแล้ว {selected.size} ล็อต:</span>
          <span className="text-blue-600 font-mono">
            {rows.filter(r => selected.has(r.spec_code)).map(r => r.spec_code).join(', ')}
          </span>
        </div>
      )}
    </div>
  )
}
