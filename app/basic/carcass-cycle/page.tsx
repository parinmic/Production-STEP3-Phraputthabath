'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Timer } from 'lucide-react'
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

function findClosestWeight(avg: number, weights: number[]): number {
  return weights.reduce((best, w) => Math.abs(w - avg) < Math.abs(best - avg) ? w : best, weights[0])
}

function fmtTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} วิ`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  if (mins < 60) return secs > 0 ? `${mins} นาที ${secs} วิ` : `${mins} นาที`
  const hrs  = Math.floor(mins / 60)
  const rem  = mins % 60
  return rem > 0 ? `${hrs} ชม. ${rem} นาที` : `${hrs} ชม.`
}

function fmt(n: number, d = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function CarcassCyclePage() {
  const [lots,       setLots]       = useState<SelectedLot[]>([])
  const [master,     setMaster]     = useState<MasYieldRow[]>([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [rate,       setRate]       = useState('80')
  const rateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const loadSelectedLots = useCallback(() => {
    fetch('/api/pig-carcass-lot-selection')
      .then(r => r.json())
      .then(json => {
        if (json.selected) setLots(json.selected as SelectedLot[])
        if (json.rate != null) setRate(String(json.rate))
      })
      .catch(() => {})
  }, [])

  const persistRate = useCallback((val: string) => {
    if (rateDebounceRef.current) clearTimeout(rateDebounceRef.current)
    rateDebounceRef.current = setTimeout(() => {
      fetch('/api/pig-carcass-lot-selection', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rate: parseFloat(val) || 80 }),
      }).catch(() => {})
    }, 600)
  }, [])

  useEffect(() => {
    try {
      const savedLots = localStorage.getItem('pig_carcass_selected')
      if (savedLots) setLots(JSON.parse(savedLots))
    } catch { /* ignore */ }
    loadSelectedLots()
    loadMaster()
    // Other machines can change the selected lots — poll so this view stays in sync.
    const id = setInterval(loadSelectedLots, 20_000)
    return () => clearInterval(id)
  }, [loadMaster, loadSelectedLots])

  const rateNum        = parseFloat(rate) || 80
  const uniqueWeights  = [...new Set(master.map(r => r.carcass_weight))].sort((a, b) => a - b)

  // Build results per lot
  const lotResults = lots.map(lot => {
    const matched = uniqueWeights.length ? findClosestWeight(lot.avg_weight, uniqueWeights) : 0
    const parts = master
      .filter(r => r.carcass_weight === matched)
      .map(r => {
        const kg      = (r.yield_pct / 100) * lot.qty * lot.avg_weight
        const timeSec = rateNum * lot.qty * (r.yield_pct / 100)
        return { product_group: r.product_group, yield_pct: r.yield_pct, kg, timeSec }
      })
      .sort((a, b) => b.yield_pct - a.yield_pct)
    return { lot, matched, parts }
  })

  // Grand summary per product_group across all lots
  const summaryMap = new Map<string, { yield_pct: number; totalKg: number; totalSec: number }>()
  for (const lr of lotResults) {
    for (const p of lr.parts) {
      const ex = summaryMap.get(p.product_group)
      if (ex) { ex.totalKg += p.kg; ex.totalSec += p.timeSec }
      else summaryMap.set(p.product_group, { yield_pct: p.yield_pct, totalKg: p.kg, totalSec: p.timeSec })
    }
  }
  const summary = [...summaryMap.entries()]
    .map(([grp, v]) => ({ product_group: grp, ...v }))
    .sort((a, b) => b.yield_pct - a.yield_pct)

  const totalSec = summary.reduce((s, g) => s + g.totalSec, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Timer size={24} className="text-indigo-500" />
            รอบการลงหมูซีก
          </h1>
          <p className="text-gray-500 mt-1 text-sm">คำนวณเวลาการทำงานแต่ละชิ้นส่วนตาม Yield และ Lot ที่เลือก</p>
        </div>
        <button onClick={loadMaster} disabled={loading}
          className="flex items-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shrink-0">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          รีโหลด
        </button>
      </div>

      {/* Rate input */}
      <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-5 py-4">
        <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">อัตราการลงหมูซีก</label>
        <input
          type="text"
          inputMode="decimal"
          value={rate}
          onChange={e => { const v = e.target.value.replace(/[^0-9.]/g, ''); setRate(v); persistRate(v) }}
          className="w-28 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
        />
        <span className="text-sm text-gray-500">วิ/ตัว</span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">{error}</div>
      )}

      {loading && (
        <div className="text-center py-14 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังโหลด Mas Yield...</p>
        </div>
      )}

      {/* No lots selected */}
      {!loading && lots.length === 0 && (
        <div className="text-center py-14 text-gray-400">
          <Timer size={36} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">ยังไม่มี Lot ที่เลือก</p>
          <Link href="/basic/pig-carcass-withdrawal" className="mt-2 inline-block text-blue-500 text-sm hover:underline">
            ไปที่หน้าเบิกหมูซีก →
          </Link>
        </div>
      )}

      {/* No master */}
      {!loading && lots.length > 0 && master.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-amber-700 text-sm">
          ไม่พบข้อมูล Mas Yield — กรุณาอัพโหลดที่เมนู Master Calculation → Mas Yield
        </div>
      )}

      {/* Grand summary */}
      {!loading && summary.length > 0 && (
        <div className="border border-indigo-200 rounded-2xl overflow-hidden">
          <div className="bg-indigo-600 px-5 py-3">
            <h2 className="text-white font-bold text-sm">สรุปรวม — {lots.length} Lot · {lots.reduce((s, l) => s + l.qty, 0).toLocaleString('th-TH')} ตัว</h2>
            <p className="text-indigo-200 text-xs mt-0.5">เวลารวมทั้งหมด: <b className="text-white">{fmtTime(totalSec)}</b></p>
          </div>
          <table className="w-full text-sm bg-white">
            <thead className="bg-indigo-50 border-b border-indigo-100 text-xs">
              <tr>
                <th className="px-5 py-2.5 text-left font-semibold text-gray-700">กลุ่มชิ้นส่วน</th>
                <th className="px-5 py-2.5 text-right font-semibold text-purple-700">Yield (%)</th>
                <th className="px-5 py-2.5 text-right font-semibold text-emerald-700">น้ำหนักรวม (กก.)</th>
                <th className="px-5 py-2.5 text-right font-semibold text-indigo-700">เวลาทำงาน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {summary.map(g => (
                <tr key={g.product_group} className="hover:bg-indigo-50">
                  <td className="px-5 py-2.5 font-medium text-gray-800">{g.product_group}</td>
                  <td className="px-5 py-2.5 text-right text-purple-700">{fmt(g.yield_pct)}</td>
                  <td className="px-5 py-2.5 text-right text-emerald-700">{fmt(g.totalKg, 0)}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-indigo-700">{fmtTime(g.totalSec)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-indigo-50 border-t-2 border-indigo-300">
              <tr className="font-bold text-sm">
                <td className="px-5 py-2.5 text-indigo-800">รวมทั้งหมด</td>
                <td className="px-5 py-2.5 text-right text-purple-700">{fmt(summary.reduce((s, g) => s + g.yield_pct, 0))}</td>
                <td className="px-5 py-2.5 text-right text-emerald-700">{fmt(summary.reduce((s, g) => s + g.totalKg, 0), 0)}</td>
                <td className="px-5 py-2.5 text-right text-indigo-800 text-base">{fmtTime(totalSec)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Per-lot breakdown */}
      {!loading && lotResults.map((lr, idx) => (
        <div key={lr.lot.spec_code} className="border border-gray-200 rounded-2xl overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex flex-wrap items-center gap-4">
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold shrink-0">
              {idx + 1}
            </span>
            <div>
              <span className="font-mono font-bold text-gray-800">{lr.lot.spec_code}</span>
              <span className="text-gray-400 mx-2">·</span>
              <span className="text-sm text-gray-600">{lr.lot.qty.toLocaleString('th-TH')} ตัว</span>
              <span className="text-gray-400 mx-2">·</span>
              <span className="text-sm text-gray-600">เฉลี่ย {fmt(lr.lot.avg_weight)} กก./ตัว</span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded-lg px-3 py-1">
                ซาก <b className="text-indigo-600">{fmt(lr.matched)}</b> กก.
              </span>
              <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded-lg px-3 py-1">
                รวม <b className="text-indigo-600">{fmtTime(lr.parts.reduce((s, p) => s + p.timeSec, 0))}</b>
              </span>
            </div>
          </div>
          <table className="w-full text-sm bg-white">
            <thead className="bg-gray-50 border-b border-gray-100 text-xs">
              <tr>
                <th className="px-5 py-2 text-left font-semibold text-gray-700">กลุ่มชิ้นส่วน</th>
                <th className="px-5 py-2 text-right font-semibold text-purple-700">Yield (%)</th>
                <th className="px-5 py-2 text-right font-semibold text-emerald-700">น้ำหนัก (กก.)</th>
                <th className="px-5 py-2 text-right font-semibold text-indigo-700">เวลาทำงาน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lr.parts.map(p => (
                <tr key={p.product_group} className="hover:bg-gray-50">
                  <td className="px-5 py-2 font-medium text-gray-800">{p.product_group}</td>
                  <td className="px-5 py-2 text-right text-purple-700">{fmt(p.yield_pct)}</td>
                  <td className="px-5 py-2 text-right text-emerald-700">{fmt(p.kg, 0)}</td>
                  <td className="px-5 py-2 text-right font-semibold text-indigo-700">{fmtTime(p.timeSec)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr className="font-bold text-xs">
                <td className="px-5 py-2 text-gray-600">รวม</td>
                <td className="px-5 py-2 text-right text-purple-700">{fmt(lr.parts.reduce((s, p) => s + p.yield_pct, 0))}</td>
                <td className="px-5 py-2 text-right text-emerald-700">{fmt(lr.parts.reduce((s, p) => s + p.kg, 0), 0)}</td>
                <td className="px-5 py-2 text-right text-indigo-700">{fmtTime(lr.parts.reduce((s, p) => s + p.timeSec, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
    </div>
  )
}
