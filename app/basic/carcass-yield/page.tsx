'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, FlaskConical, Package } from 'lucide-react'

interface LotRow {
  spec_code: string
  qty_3:     number
  weight_3:  number
}

interface MasYieldRow {
  carcass_weight: number
  product_group:  string
  yield_pct:      number
}

interface YieldPart {
  product_group: string
  yield_pct:     number
  total_kg:      number
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function findClosestWeight(avg: number, weights: number[]): number {
  return weights.reduce((best, w) => Math.abs(w - avg) < Math.abs(best - avg) ? w : best, weights[0])
}

export default function CarcassYieldPage() {
  const [lots,         setLots]         = useState<LotRow[]>([])
  const [sourceFile,   setSourceFile]   = useState('')
  const [selectedSpec, setSelectedSpec] = useState<string>('')
  const [master,       setMaster]       = useState<MasYieldRow[]>([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [lotRes, masterRes] = await Promise.all([
        fetch('/api/pig-carcass-withdrawal'),
        fetch('/api/basic/mas-yield'),
      ])
      const lotJson    = await lotRes.json()
      const masterJson = await masterRes.json()

      if (lotJson.error)    setError(lotJson.error)
      if (masterJson.error) setError(masterJson.error)

      const sorted: LotRow[] = (lotJson.rows as LotRow[] ?? [])
        .filter(r => r.qty_3 > 0)
        .sort((a, b) => a.spec_code.slice(-1).localeCompare(b.spec_code.slice(-1)))
      setLots(sorted)
      setSourceFile(lotJson.source_file ?? '')
      setMaster(masterJson.rows as MasYieldRow[] ?? [])
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Compute yield for selected lot
  const selectedLot = lots.find(r => r.spec_code === selectedSpec) ?? null
  let parts: YieldPart[] = []
  let matchedWeight = 0

  if (selectedLot && master.length > 0) {
    const avgWeight     = selectedLot.qty_3 > 0 ? selectedLot.weight_3 / selectedLot.qty_3 : 0
    const uniqueWeights = [...new Set(master.map(r => r.carcass_weight))].sort((a, b) => a - b)
    matchedWeight = findClosestWeight(avgWeight, uniqueWeights)
    parts = master
      .filter(r => r.carcass_weight === matchedWeight)
      .map(r => ({
        product_group: r.product_group,
        yield_pct:     r.yield_pct,
        total_kg:      (r.yield_pct / 100) * avgWeight * selectedLot.qty_3,
      }))
      .sort((a, b) => b.yield_pct - a.yield_pct)
  }

  const avgWeight  = selectedLot && selectedLot.qty_3 > 0 ? selectedLot.weight_3 / selectedLot.qty_3 : 0
  const grandTotal = parts.reduce((s, p) => s + p.total_kg, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FlaskConical size={24} className="text-emerald-500" />
            Yield หมูซีก
          </h1>
          <p className="text-gray-500 mt-1 text-sm">คำนวณชิ้นส่วนที่ได้จาก Lot หมูซีก</p>
          {sourceFile && <p className="text-xs text-gray-400 mt-0.5">ไฟล์ล่าสุด: {sourceFile}</p>}
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          รีโหลด
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-14 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังโหลดข้อมูล...</p>
        </div>
      )}

      {/* No lots */}
      {!loading && lots.length === 0 && !error && (
        <div className="text-center py-14 text-gray-400">
          <Package size={36} className="mx-auto mb-3 opacity-30" />
          <p>ไม่พบข้อมูล Lot — กรุณาอัพโหลดไฟล์ Stock คลัง 20 ก่อน</p>
        </div>
      )}

      {/* Lot selector */}
      {!loading && lots.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-4">
          <label className="block text-sm font-semibold text-gray-700 mb-3">เลือก Lot หมูซีก</label>
          <div className="flex flex-wrap gap-2">
            {lots.map(r => {
              const avg     = r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0
              const isSelected = r.spec_code === selectedSpec
              return (
                <button
                  key={r.spec_code}
                  onClick={() => setSelectedSpec(isSelected ? '' : r.spec_code)}
                  className={`flex flex-col items-start px-4 py-2.5 rounded-xl border text-sm transition-colors ${
                    isSelected
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-emerald-400 hover:bg-emerald-50'
                  }`}
                >
                  <span className="font-mono font-bold">{r.spec_code}</span>
                  <span className={`text-xs mt-0.5 ${isSelected ? 'text-emerald-100' : 'text-gray-400'}`}>
                    {r.qty_3.toLocaleString('th-TH')} ตัว · {fmt(avg)} กก./ตัว
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Prompt to select */}
      {!loading && lots.length > 0 && !selectedSpec && (
        <div className="text-center py-10 text-gray-400">
          <FlaskConical size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">เลือก Lot ด้านบนเพื่อดูผลคำนวณ Yield</p>
        </div>
      )}

      {/* No master data */}
      {!loading && selectedSpec && master.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-amber-700 text-sm">
          ไม่พบข้อมูล Mas Yield — กรุณาอัพโหลดที่เมนู Master Calculation → Mas Yield
        </div>
      )}

      {/* Result */}
      {!loading && selectedLot && parts.length > 0 && (
        <div className="border border-emerald-200 rounded-2xl overflow-hidden">
          {/* Card header */}
          <div className="bg-emerald-600 px-5 py-3 flex flex-wrap items-center gap-4">
            <div>
              <p className="text-white font-bold">{selectedLot.spec_code}</p>
              <p className="text-emerald-100 text-xs mt-0.5">
                {selectedLot.qty_3.toLocaleString('th-TH')} ตัว · น้ำหนักเฉลี่ย {fmt(avgWeight)} กก./ตัว
              </p>
            </div>
            <div className="ml-auto text-xs text-emerald-100 bg-emerald-700/50 rounded-lg px-3 py-1">
              ใช้น้ำหนักซาก <b className="text-white">{fmt(matchedWeight)}</b> กก. จาก Master
            </div>
          </div>

          {/* Parts table */}
          <table className="w-full text-sm bg-white">
            <thead className="bg-gray-50 border-b border-gray-100 text-xs">
              <tr>
                <th className="px-5 py-2.5 text-left font-semibold text-gray-700">กลุ่มชิ้นส่วน</th>
                <th className="px-5 py-2.5 text-right font-semibold text-purple-700">
                  <div>Yield</div><div className="font-normal text-purple-400">(%)</div>
                </th>
                <th className="px-5 py-2.5 text-right font-semibold text-emerald-700">
                  <div>น้ำหนักรวม</div><div className="font-normal text-emerald-400">(กก.)</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {parts.map(p => (
                <tr key={p.product_group} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 font-medium text-gray-800">{p.product_group}</td>
                  <td className="px-5 py-2.5 text-right text-purple-700">{fmt(p.yield_pct)}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-emerald-700">{fmt(p.total_kg)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-emerald-50 border-t-2 border-emerald-300">
              <tr className="font-bold text-sm">
                <td className="px-5 py-2.5 text-emerald-800">รวมทั้งหมด</td>
                <td className="px-5 py-2.5 text-right text-purple-700">
                  {fmt(parts.reduce((s, p) => s + p.yield_pct, 0))}
                </td>
                <td className="px-5 py-2.5 text-right text-emerald-800 text-base">{fmt(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
