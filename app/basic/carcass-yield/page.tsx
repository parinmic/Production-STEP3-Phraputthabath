'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, FlaskConical, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface SelectedLot {
  spec_code:  string
  qty:        number
  avg_weight: number
  order:      number
}

interface MasYieldRow {
  carcass_weight: number
  product_group:  string
  yield_pct:      number
}

interface LotResult {
  lot:            SelectedLot
  matched_weight: number
  parts:          { product_group: string; yield_pct: number; total_kg: number }[]
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function findClosestWeight(avg: number, weights: number[]): number {
  return weights.reduce((best, w) => Math.abs(w - avg) < Math.abs(best - avg) ? w : best, weights[0])
}

export default function CarcassYieldPage() {
  const [lots,    setLots]    = useState<SelectedLot[]>([])
  const [master,  setMaster]  = useState<MasYieldRow[]>([])
  const [results, setResults] = useState<LotResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const loadMaster = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/basic/mas-yield')
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      setMaster(json.rows as MasYieldRow[])
    } catch {
      setError('โหลด Mas Yield ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const raw = localStorage.getItem('pig_carcass_selected')
    if (raw) {
      try { setLots(JSON.parse(raw) as SelectedLot[]) } catch { /* ignore */ }
    }
    loadMaster()
  }, [loadMaster])

  useEffect(() => {
    if (!master.length || !lots.length) { setResults([]); return }

    const uniqueWeights = [...new Set(master.map(r => r.carcass_weight))].sort((a, b) => a - b)

    const computed: LotResult[] = lots.map(lot => {
      const matched = findClosestWeight(lot.avg_weight, uniqueWeights)
      const parts = master
        .filter(r => r.carcass_weight === matched)
        .map(r => ({
          product_group: r.product_group,
          yield_pct:     r.yield_pct,
          total_kg:      (r.yield_pct / 100) * lot.avg_weight * lot.qty,
        }))
        .sort((a, b) => b.yield_pct - a.yield_pct)
      return { lot, matched_weight: matched, parts }
    })

    setResults(computed)
  }, [master, lots])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Yield หมูซีก</h1>
          <p className="text-gray-500 mt-1">คำนวณชิ้นส่วนที่ได้จาก Lot ที่เลือกในหน้าเบิกหมูซีก</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/basic/pig-carcass-withdrawal"
            className="flex items-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <ArrowLeft size={14} />
            กลับหน้าเบิก
          </Link>
          <button
            onClick={loadMaster}
            disabled={loading}
            className="flex items-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            รีโหลด
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* No lots selected */}
      {!loading && lots.length === 0 && (
        <div className="text-center py-14 text-gray-400">
          <FlaskConical size={36} className="mx-auto mb-3 opacity-30" />
          <p>ยังไม่มี Lot ที่เลือก</p>
          <Link href="/basic/pig-carcass-withdrawal" className="mt-2 inline-block text-blue-500 text-sm hover:underline">
            ไปที่หน้าเบิกหมูซีก →
          </Link>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-14 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังโหลด Mas Yield...</p>
        </div>
      )}

      {/* No master data */}
      {!loading && lots.length > 0 && master.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-amber-700 text-sm">
          ไม่พบข้อมูล Mas Yield — กรุณาอัพโหลดที่เมนู Master Calculation → Mas Yield
        </div>
      )}

      {/* Summary table: total kg per product group across all lots */}
      {!loading && results.length > 0 && (() => {
        const groupMap = new Map<string, { yield_pct: number; total_kg: number }>()
        for (const res of results) {
          for (const p of res.parts) {
            const existing = groupMap.get(p.product_group)
            if (existing) {
              existing.total_kg += p.total_kg
            } else {
              groupMap.set(p.product_group, { yield_pct: p.yield_pct, total_kg: p.total_kg })
            }
          }
        }
        const summary = [...groupMap.entries()]
          .map(([group, v]) => ({ product_group: group, yield_pct: v.yield_pct, total_kg: v.total_kg }))
          .sort((a, b) => b.yield_pct - a.yield_pct)
        const grandTotal = summary.reduce((s, g) => s + g.total_kg, 0)

        return (
          <div className="border border-blue-200 rounded-2xl overflow-hidden">
            <div className="bg-blue-600 px-5 py-3">
              <h2 className="text-white font-bold text-sm">สรุปรวม — หมูซีกทั้งหมด {results.length} Lot</h2>
              <p className="text-blue-200 text-xs mt-0.5">น้ำหนักชิ้นส่วนที่คาดว่าจะได้ทั้งหมด (กก.)</p>
            </div>
            <table className="w-full text-sm bg-white">
              <thead className="bg-blue-50 border-b border-blue-100 text-xs">
                <tr>
                  <th className="px-5 py-2.5 text-left font-semibold text-gray-700">กลุ่มชิ้นส่วน</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-purple-700">
                    <div>Yield</div><div className="font-normal text-purple-400">(%)</div>
                  </th>
                  <th className="px-5 py-2.5 text-right font-semibold text-emerald-700">
                    <div>น้ำหนักรวมทั้งหมด</div><div className="font-normal text-emerald-400">(กก.)</div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.map(g => (
                  <tr key={g.product_group} className="hover:bg-blue-50">
                    <td className="px-5 py-2.5 font-medium text-gray-800">{g.product_group}</td>
                    <td className="px-5 py-2.5 text-right text-purple-700">{fmt(g.yield_pct, 2)}</td>
                    <td className="px-5 py-2.5 text-right font-bold text-emerald-700">{fmt(g.total_kg)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-blue-50 border-t-2 border-blue-300">
                <tr className="font-bold text-sm">
                  <td className="px-5 py-2.5 text-blue-800">รวมทั้งหมด</td>
                  <td className="px-5 py-2.5" />
                  <td className="px-5 py-2.5 text-right text-blue-800 text-base">{fmt(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      })()}

      {/* Results: one card per lot */}
      {!loading && results.map((res, idx) => (
        <div key={res.lot.spec_code} className="border border-gray-200 rounded-2xl overflow-hidden">
          {/* Card header */}
          <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex flex-wrap items-center gap-4">
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold shrink-0">
              {idx + 1}
            </span>
            <div>
              <span className="font-mono font-bold text-gray-800">{res.lot.spec_code}</span>
              <span className="text-gray-400 mx-2">·</span>
              <span className="text-sm text-gray-600">จำนวน <b>{res.lot.qty.toLocaleString('th-TH')}</b> ตัว</span>
              <span className="text-gray-400 mx-2">·</span>
              <span className="text-sm text-gray-600">น้ำหนักเฉลี่ย <b>{fmt(res.lot.avg_weight)}</b> กก./ตัว</span>
            </div>
            <div className="ml-auto text-xs text-gray-500 bg-white border border-gray-200 rounded-lg px-3 py-1">
              ใช้น้ำหนักซาก <b className="text-blue-600">{fmt(res.matched_weight)}</b> กก. จาก Master
            </div>
          </div>

          {/* Parts table */}
          <table className="w-full text-sm bg-white">
            <thead className="bg-gray-50 border-b border-gray-100 text-xs">
              <tr>
                <th className="px-5 py-2.5 text-left font-semibold text-gray-700">กลุ่มชิ้นส่วน</th>
                <th className="px-5 py-2.5 text-right font-semibold text-purple-700">
                  <div>Yield</div>
                  <div className="font-normal text-purple-400">(%)</div>
                </th>
                <th className="px-5 py-2.5 text-right font-semibold text-emerald-700">
                  <div>น้ำหนักรวม</div>
                  <div className="font-normal text-emerald-400">(กก.)</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {res.parts.map(p => (
                <tr key={p.product_group} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 font-medium text-gray-800">{p.product_group}</td>
                  <td className="px-5 py-2.5 text-right text-purple-700">{fmt(p.yield_pct, 2)}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-emerald-700">{fmt(p.total_kg)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-300">
              <tr className="font-bold text-sm">
                <td className="px-5 py-2.5 text-gray-700">รวม</td>
                <td className="px-5 py-2.5 text-right text-purple-700">
                  {fmt(res.parts.reduce((s, p) => s + p.yield_pct, 0), 2)}
                </td>
                <td className="px-5 py-2.5 text-right text-emerald-700">
                  {fmt(res.parts.reduce((s, p) => s + p.total_kg, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
    </div>
  )
}
