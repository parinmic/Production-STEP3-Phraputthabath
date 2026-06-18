'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertCircle, Coffee } from 'lucide-react'

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

interface SayapanRow {
  product_group: string
  station:       string
}

interface TimeSegment {
  id:      string
  label:   string
  start:   string
  end:     string
  mins:    number
  phase:   number
  isBreak: boolean
  phaseColor: string
  phaseBg:    string
}

const SEGMENTS: TimeSegment[] = [
  { id: 'p1a', label: 'Phase 1',       start: '08:30', end: '12:00', mins: 210, phase: 1, isBreak: false, phaseColor: 'text-sky-700',    phaseBg: 'bg-sky-50 border-sky-200' },
  { id: 'brk', label: 'พักกลางวัน',   start: '12:00', end: '13:00', mins: 60,  phase: 1, isBreak: true,  phaseColor: 'text-gray-400',   phaseBg: 'bg-gray-50 border-gray-200' },
  { id: 'p1b', label: 'Phase 1 (ต่อ)', start: '13:00', end: '14:30', mins: 90,  phase: 1, isBreak: false, phaseColor: 'text-sky-700',    phaseBg: 'bg-sky-50 border-sky-200' },
  { id: 'p2',  label: 'Phase 2',       start: '14:30', end: '16:00', mins: 90,  phase: 2, isBreak: false, phaseColor: 'text-purple-700', phaseBg: 'bg-purple-50 border-purple-200' },
  { id: 'p3',  label: 'Phase 3',       start: '16:00', end: '17:00', mins: 60,  phase: 3, isBreak: false, phaseColor: 'text-orange-700', phaseBg: 'bg-orange-50 border-orange-200' },
]

interface LotUsage {
  spec_code:  string
  qty_used:   number
  avg_weight: number
}

interface SegmentResult {
  segment:   TimeSegment
  pigs:      number
  lotUsages: LotUsage[]
  groups:    { product_group: string; yield_pct: number; total_kg: number }[]
  totalKg:   number
}

function fmt(n: number, d = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function findClosestWeight(avg: number, weights: number[]): number {
  if (!weights.length) return 0
  return weights.reduce((best, w) => Math.abs(w - avg) < Math.abs(best - avg) ? w : best, weights[0])
}

function computeSegmentResults(
  lots:          SelectedLot[],
  rate:          number,
  productGroups: string[],
  master:        MasYieldRow[],
): SegmentResult[] {
  const uniqueWeights = [...new Set(master.map(r => r.carcass_weight))].sort((a, b) => a - b)

  const pool = lots.map(l => ({ ...l, remaining: l.qty }))
  let poolIdx = 0

  return SEGMENTS.map(seg => {
    if (seg.isBreak) {
      return { segment: seg, pigs: 0, lotUsages: [], groups: [], totalKg: 0 }
    }

    const pigs = Math.floor((seg.mins * 60) / rate)
    let pigsNeeded = pigs
    const lotUsages: LotUsage[] = []

    while (pigsNeeded > 0 && poolIdx < pool.length) {
      const lot = pool[poolIdx]
      const take = Math.min(pigsNeeded, lot.remaining)
      if (take > 0) {
        lotUsages.push({ spec_code: lot.spec_code, qty_used: take, avg_weight: lot.avg_weight })
        lot.remaining -= take
        pigsNeeded -= take
      }
      if (lot.remaining === 0) poolIdx++
    }

    // Calculate yield per product group
    const groupMap: Record<string, { yield_pct: number; total_kg: number }> = {}

    for (const usage of lotUsages) {
      const matchedWeight = findClosestWeight(usage.avg_weight, uniqueWeights)
      const masterRows    = master.filter(r => r.carcass_weight === matchedWeight)

      for (const g of productGroups) {
        const row = masterRows.find(r => r.product_group === g)
        if (!row) continue
        if (!groupMap[g]) groupMap[g] = { yield_pct: row.yield_pct, total_kg: 0 }
        groupMap[g].yield_pct = row.yield_pct
        groupMap[g].total_kg += (row.yield_pct / 100) * usage.avg_weight * usage.qty_used
      }
    }

    const groups = productGroups.map(g => ({
      product_group: g,
      yield_pct:     groupMap[g]?.yield_pct ?? 0,
      total_kg:      groupMap[g]?.total_kg  ?? 0,
    }))

    return {
      segment:  seg,
      pigs,
      lotUsages,
      groups,
      totalKg: groups.reduce((s, g) => s + g.total_kg, 0),
    }
  })
}

export default function CarcassProductionView({ stationName }: { stationName: string }) {
  const [rate,    setRate]    = useState(90)
  const [lots,    setLots]    = useState<SelectedLot[]>([])
  const [master,  setMaster]  = useState<MasYieldRow[]>([])
  const [sayapan, setSayapan] = useState<SayapanRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [yRes, sRes] = await Promise.all([
        fetch('/api/basic/mas-yield'),
        fetch('/api/basic/mas-sayapan'),
      ])
      const yJson = await yRes.json()
      const sJson = await sRes.json()
      if (yJson.error) throw new Error(yJson.error)
      if (sJson.error) throw new Error(sJson.error)
      setMaster(yJson.rows  as MasYieldRow[])
      setSayapan(sJson.rows as SayapanRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    try {
      const savedRate = localStorage.getItem('pig_carcass_rate')
      const savedLots = localStorage.getItem('pig_carcass_selected')
      if (savedRate) setRate(parseFloat(savedRate) || 90)
      if (savedLots) setLots(JSON.parse(savedLots) as SelectedLot[])
    } catch { /* ignore */ }
    loadData()
  }, [loadData])

  // Product groups for this station (in insertion order = slot order)
  const productGroups = [...new Set(
    sayapan.filter(r => r.station === stationName).map(r => r.product_group)
  )]

  const totalLotQty = lots.reduce((s, l) => s + l.qty, 0)
  const totalAvgWeight = totalLotQty > 0
    ? lots.reduce((s, l) => s + l.avg_weight * l.qty, 0) / totalLotQty
    : 0

  const results = (master.length && productGroups.length && lots.length && rate > 0)
    ? computeSegmentResults(lots, rate, productGroups, master)
    : []

  const grandTotal = results.reduce((s, r) => s + r.totalKg, 0)
  const grandPigs  = results.reduce((s, r) => s + r.pigs,    0)

  return (
    <div className="space-y-4">
      {/* Header info bar */}
      <div className="flex flex-wrap items-center gap-4 bg-white border border-gray-200 rounded-xl px-5 py-3">
        <div className="text-sm">
          <span className="text-gray-500">สถานี: </span>
          <span className="font-semibold text-gray-800">{stationName}</span>
        </div>
        <div className="w-px h-5 bg-gray-200" />
        <div className="text-sm">
          <span className="text-gray-500">อัตรา: </span>
          <span className="font-semibold text-gray-800">{rate} วิ/ตัว</span>
        </div>
        <div className="w-px h-5 bg-gray-200" />
        <div className="text-sm">
          <span className="text-gray-500">หมูซีกทั้งหมด: </span>
          <span className="font-semibold text-blue-700">{totalLotQty.toLocaleString('th-TH')} ตัว</span>
          <span className="text-gray-400 ml-1">({lots.length} Lot)</span>
        </div>
        <div className="w-px h-5 bg-gray-200" />
        <div className="text-sm">
          <span className="text-gray-500">น้ำหนักเฉลี่ย: </span>
          <span className="font-semibold text-orange-700">{fmt(totalAvgWeight)} กก./ตัว</span>
        </div>
        <div className="w-px h-5 bg-gray-200" />
        <div className="text-sm">
          <span className="text-gray-500">คาดจะตัดแต่งรวม: </span>
          <span className="font-semibold text-indigo-700">{grandPigs.toLocaleString('th-TH')} ตัว</span>
        </div>
        <button onClick={loadData} disabled={loading}
          className="ml-auto flex items-center gap-1.5 text-gray-500 hover:text-gray-700 text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          รีโหลด
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-red-700 text-sm">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {!loading && lots.length === 0 && (
        <div className="text-center py-10 text-gray-400 bg-white border border-gray-200 rounded-xl">
          <p className="text-sm">ยังไม่ได้เลือก Lot — ไปที่หน้าเบิกหมูซีกก่อน</p>
        </div>
      )}

      {!loading && productGroups.length === 0 && lots.length > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-amber-700 text-sm">
          <AlertCircle size={16} />ไม่พบกลุ่มสินค้าสำหรับสถานี &quot;{stationName}&quot; — กรุณาอัพโหลด Mas สายพาน
        </div>
      )}

      {loading && (
        <div className="text-center py-10 text-gray-400">
          <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
          <p className="text-sm">กำลังโหลดข้อมูล...</p>
        </div>
      )}

      {/* Grand summary across all non-break segments */}
      {!loading && results.length > 0 && grandTotal > 0 && (
        <div className="border border-emerald-200 rounded-2xl overflow-hidden">
          <div className="bg-emerald-600 px-5 py-3">
            <h2 className="text-white font-bold text-sm">สรุปรวมทั้งวัน — {stationName}</h2>
            <p className="text-emerald-200 text-xs mt-0.5">ผลผลิตที่คาดว่าจะได้จากทุก Phase</p>
          </div>
          <table className="w-full text-sm bg-white">
            <thead className="bg-emerald-50 border-b border-emerald-100 text-xs">
              <tr>
                <th className="px-5 py-2 text-left font-semibold text-gray-700">กลุ่มชิ้นส่วน</th>
                <th className="px-5 py-2 text-right font-semibold text-purple-700">Yield (%)</th>
                <th className="px-5 py-2 text-right font-semibold text-emerald-700">น้ำหนักรวม (กก.)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {productGroups.map(g => {
                const totalForGroup = results.reduce((s, r) => s + (r.groups.find(x => x.product_group === g)?.total_kg ?? 0), 0)
                const yieldPct = results.find(r => r.groups.find(x => x.product_group === g))?.groups.find(x => x.product_group === g)?.yield_pct ?? 0
                return (
                  <tr key={g} className="hover:bg-emerald-50">
                    <td className="px-5 py-2 font-medium text-gray-800">{g}</td>
                    <td className="px-5 py-2 text-right text-purple-700">{fmt(yieldPct)}</td>
                    <td className="px-5 py-2 text-right font-bold text-emerald-700">{fmt(totalForGroup)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-emerald-50 border-t-2 border-emerald-300">
              <tr className="font-bold">
                <td className="px-5 py-2 text-emerald-800">รวม ({grandPigs.toLocaleString('th-TH')} ตัว)</td>
                <td />
                <td className="px-5 py-2 text-right text-emerald-800 text-base">{fmt(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Timeline — one card per segment */}
      {!loading && results.length > 0 && (
        <div className="space-y-3">
          {results.map(r => {
            if (r.segment.isBreak) {
              return (
                <div key={r.segment.id}
                  className="flex items-center gap-4 border border-dashed border-gray-200 rounded-xl px-5 py-3 bg-gray-50">
                  <Coffee size={16} className="text-gray-400 shrink-0" />
                  <span className="text-sm text-gray-400 font-medium">{r.segment.label}</span>
                  <span className="text-xs text-gray-300">{r.segment.start} – {r.segment.end}</span>
                </div>
              )
            }

            return (
              <div key={r.segment.id} className={`border rounded-2xl overflow-hidden ${r.segment.phaseBg}`}>
                {/* Segment header */}
                <div className="px-5 py-3 flex flex-wrap items-center gap-4 border-b border-inherit">
                  <div>
                    <span className={`font-bold text-sm ${r.segment.phaseColor}`}>{r.segment.label}</span>
                    <span className="text-gray-400 text-xs ml-2">{r.segment.start} – {r.segment.end}</span>
                    <span className="text-gray-400 text-xs ml-1">({r.segment.mins} นาที)</span>
                  </div>
                  <div className={`flex items-center gap-1.5 text-sm font-bold ${r.segment.phaseColor}`}>
                    {r.pigs.toLocaleString('th-TH')} ตัว
                  </div>
                  {r.lotUsages.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 ml-auto">
                      {r.lotUsages.map(u => (
                        <span key={u.spec_code}
                          className="text-xs bg-white border border-gray-200 rounded-full px-2.5 py-0.5 text-gray-700 font-mono">
                          {u.spec_code}: <b>{u.qty_used}</b> ตัว
                          <span className="text-gray-400 ml-1">({fmt(u.avg_weight)} กก.)</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {r.pigs > totalLotQty && (
                    <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
                      หมูซีกไม่พอ
                    </span>
                  )}
                </div>

                {/* Product group table */}
                {r.groups.length > 0 ? (
                  <table className="w-full text-sm bg-white">
                    <thead className="bg-gray-50 border-b border-gray-100 text-xs">
                      <tr>
                        <th className="px-5 py-2 text-left font-semibold text-gray-700">กลุ่มชิ้นส่วน</th>
                        <th className="px-5 py-2 text-right font-semibold text-purple-700">Yield (%)</th>
                        <th className="px-5 py-2 text-right font-semibold text-emerald-700">น้ำหนักรวม (กก.)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {r.groups.map(g => (
                        <tr key={g.product_group} className="hover:bg-gray-50">
                          <td className="px-5 py-2 text-gray-800">{g.product_group}</td>
                          <td className="px-5 py-2 text-right text-purple-700">{fmt(g.yield_pct)}</td>
                          <td className="px-5 py-2 text-right font-semibold text-emerald-700">{fmt(g.total_kg)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr className="font-bold text-sm">
                        <td className="px-5 py-2 text-gray-700">รวม</td>
                        <td />
                        <td className="px-5 py-2 text-right text-emerald-700">{fmt(r.totalKg)}</td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <div className="px-5 py-3 text-sm text-gray-400 bg-white">
                    {r.lotUsages.length === 0 ? 'หมูซีกถูกใช้หมดในช่วงก่อนหน้าแล้ว' : 'ไม่พบข้อมูล Mas Yield สำหรับน้ำหนักนี้'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
