'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Coffee } from 'lucide-react'

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

const SEGS = [
  { id: 'p1a', label: 'Phase 1',     sub: '08:30–12:00', mins: 210, isBreak: false, phase: 1,
    barColor: '#38bdf8', headerBg: '#0ea5e9', textColor: '#0c4a6e' },
  { id: 'brk', label: 'พักกลางวัน', sub: '12:00–13:00', mins: 60,  isBreak: true,  phase: 1,
    barColor: '#e5e7eb', headerBg: '#d1d5db', textColor: '#6b7280' },
  { id: 'p1b', label: 'Phase 1 ต่อ', sub: '13:00–14:30', mins: 90,  isBreak: false, phase: 1,
    barColor: '#38bdf8', headerBg: '#0ea5e9', textColor: '#0c4a6e' },
  { id: 'p2',  label: 'Phase 2',     sub: '14:30–16:00', mins: 90,  isBreak: false, phase: 2,
    barColor: '#c084fc', headerBg: '#a855f7', textColor: '#3b0764' },
  { id: 'p3',  label: 'Phase 3',     sub: '16:00–17:00', mins: 60,  isBreak: false, phase: 3,
    barColor: '#fb923c', headerBg: '#f97316', textColor: '#431407' },
]

const PHASE_SEG_IDS: Record<string, string[]> = {
  '1':   ['p1a', 'brk', 'p1b'],
  '2':   ['p2'],
  '3':   ['p3'],
  'all': ['p1a', 'brk', 'p1b', 'p2', 'p3'],
}

interface GroupData {
  product_group: string
  total_kg:      number
  segKg:         Record<string, number>
}

function findClosest(avg: number, weights: number[]) {
  if (!weights.length) return 0
  return weights.reduce((best, w) => Math.abs(w - avg) < Math.abs(best - avg) ? w : best, weights[0])
}

function fmtKg(n: number) {
  if (n >= 1000) return `${(n / 1000).toLocaleString('th-TH', { maximumFractionDigits: 1 })}ต.`
  return n.toLocaleString('th-TH', { maximumFractionDigits: 0 })
}

export default function CarcassGanttPanel({
  stationName,
  selectedPhase,
}: {
  stationName:   string
  selectedPhase: number | 'all'
}) {
  const [rate,    setRate]    = useState(90)
  const [lots,    setLots]    = useState<SelectedLot[]>([])
  const [master,  setMaster]  = useState<MasYieldRow[]>([])
  const [sayapan, setSayapan] = useState<SayapanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const loadData = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [yRes, sRes] = await Promise.all([
        fetch('/api/basic/mas-yield'),
        fetch('/api/basic/mas-sayapan'),
      ])
      const [yj, sj] = await Promise.all([yRes.json(), sRes.json()])
      if (yj.error) throw new Error(yj.error)
      if (sj.error) throw new Error(sj.error)
      setMaster(yj.rows  as MasYieldRow[])
      setSayapan(sj.rows as SayapanRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSelectedLots = useCallback(() => {
    fetch('/api/pig-carcass-lot-selection')
      .then(r => r.json())
      .then(json => { if (json.selected) setLots(json.selected as SelectedLot[]) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    try {
      const r = localStorage.getItem('pig_carcass_rate')
      const l = localStorage.getItem('pig_carcass_selected')
      if (r) setRate(parseFloat(r) || 90)
      if (l) setLots(JSON.parse(l) as SelectedLot[])
    } catch { /* ignore */ }
    loadSelectedLots()
    loadData()
    // Other machines can change the selected lots — poll so this view stays in sync.
    const id = setInterval(loadSelectedLots, 20_000)
    return () => clearInterval(id)
  }, [loadData, loadSelectedLots])

  // Determine visible segments for this phase
  const phaseKey     = String(selectedPhase)
  const visSegIds    = PHASE_SEG_IDS[phaseKey] ?? PHASE_SEG_IDS['all']
  const visibleSegs  = SEGS.filter(s => visSegIds.includes(s.id))
  const VISIBLE_MINS = visibleSegs.reduce((s, seg) => s + seg.mins, 0)

  // Product groups for this station (from sayapan)
  const allGroups: string[] = []
  for (const r of sayapan.filter(r => r.station === stationName)) {
    if (!allGroups.includes(r.product_group)) allGroups.push(r.product_group)
  }

  // Compute all segments in order (pool consumed sequentially across phases)
  const uniqueWeights = [...new Set(master.map(r => r.carcass_weight))].sort((a, b) => a - b)
  const pool = lots.map(l => ({ ...l, remaining: l.qty }))
  let poolIdx = 0

  const groupMap: Record<string, GroupData> = {}
  for (const g of allGroups) groupMap[g] = { product_group: g, total_kg: 0, segKg: {} }

  const segPigsTotal: Record<string, number> = {}

  for (const seg of SEGS) {
    if (seg.isBreak) continue
    const pigs = Math.floor((seg.mins * 60) / rate)
    segPigsTotal[seg.id] = pigs
    let need = pigs
    const usages: { qty_used: number; avg_weight: number }[] = []

    while (need > 0 && poolIdx < pool.length) {
      const lot  = pool[poolIdx]
      const take = Math.min(need, lot.remaining)
      if (take > 0) {
        usages.push({ qty_used: take, avg_weight: lot.avg_weight })
        lot.remaining -= take
        need -= take
      }
      if (lot.remaining === 0) poolIdx++
    }

    for (const usage of usages) {
      const wt  = findClosest(usage.avg_weight, uniqueWeights)
      const mrs = master.filter(r => r.carcass_weight === wt)
      for (const g of allGroups) {
        const mr = mrs.find(r => r.product_group === g)
        if (!mr) continue
        const kg = (mr.yield_pct / 100) * usage.avg_weight * usage.qty_used
        if (!groupMap[g]) groupMap[g] = { product_group: g, total_kg: 0, segKg: {} }
        groupMap[g].segKg[seg.id] = (groupMap[g].segKg[seg.id] ?? 0) + kg
        groupMap[g].total_kg += kg
      }
    }
  }

  // For display: total only across visible (non-break) segments
  const groups = allGroups
    .map(g => {
      const visKg = visibleSegs
        .filter(s => !s.isBreak)
        .reduce((s, seg) => s + (groupMap[g]?.segKg[seg.id] ?? 0), 0)
      return { ...groupMap[g], vis_kg: visKg }
    })
    .filter(g => g.vis_kg > 0)
    .sort((a, b) => b.vis_kg - a.vis_kg)

  const grandTotal  = groups.reduce((s, g) => s + g.vis_kg, 0)
  const phasePigs   = visibleSegs.filter(s => !s.isBreak).reduce((s, seg) => s + (segPigsTotal[seg.id] ?? 0), 0)
  const totalPigs   = lots.reduce((s, l) => s + l.qty, 0)
  const phaseLabel  = selectedPhase === 'all' ? 'ทั้งวัน' : `Phase ${selectedPhase}`

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden mt-4">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-slate-700 to-slate-600">
        <div>
          <span className="text-white font-bold text-sm">แผนผลิตจากหมูซีก — {stationName}</span>
          <span className="text-slate-300 text-xs ml-3">
            {totalPigs > 0
              ? `${totalPigs.toLocaleString('th-TH')} ตัว · `
              : ''}
            อัตรา {rate} วิ/ตัว
            {phasePigs > 0 && ` · ${phaseLabel}: ${phasePigs.toLocaleString('th-TH')} ตัว`}
            {grandTotal > 0 && ` · ${grandTotal.toLocaleString('th-TH', { maximumFractionDigits: 0 })} กก.`}
          </span>
        </div>
        <button onClick={loadData} disabled={loading}
          className="text-slate-300 hover:text-white text-xs flex items-center gap-1 transition-colors">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />รีโหลด
        </button>
      </div>

      {loading && (
        <div className="bg-white py-6 text-center text-gray-400 text-sm">
          <RefreshCw size={16} className="animate-spin mx-auto mb-1" />กำลังโหลด...
        </div>
      )}

      {!loading && error && (
        <div className="bg-white px-5 py-3 text-red-600 text-sm">{error}</div>
      )}

      {!loading && !error && lots.length === 0 && (
        <div className="bg-white px-5 py-4 text-gray-400 text-sm text-center">
          ยังไม่ได้เลือกล็อตหมูซีก — ไปที่หน้าเบิกหมูซีกเพื่อเลือกล็อต
        </div>
      )}

      {!loading && !error && lots.length > 0 && allGroups.length === 0 && (
        <div className="bg-white px-5 py-4 text-gray-400 text-sm text-center">
          ไม่พบข้อมูล — กรุณาอัพโหลด Mas สายพาน และ Mas Yield
        </div>
      )}

      {!loading && !error && lots.length > 0 && allGroups.length > 0 && groups.length === 0 && (
        <div className="bg-white px-5 py-4 text-gray-400 text-sm text-center">
          ไม่มีการผลิตใน{phaseLabel}
        </div>
      )}

      {!loading && !error && lots.length > 0 && groups.length > 0 && (
        <div className="bg-white">
          {/* Time header */}
          <div className="flex border-b border-gray-100 bg-gray-50">
            <div className="w-44 shrink-0 border-r border-gray-100 px-4 py-2">
              <span className="text-xs font-semibold text-gray-500">กลุ่มชิ้นส่วน</span>
            </div>
            <div className="flex flex-1">
              {visibleSegs.map(seg => (
                <div key={seg.id}
                  style={{ width: `${(seg.mins / VISIBLE_MINS) * 100}%` }}
                  className="flex flex-col items-center justify-center py-2 border-r border-gray-100 last:border-r-0">
                  {seg.isBreak ? (
                    <Coffee size={12} className="text-gray-400 mb-0.5" />
                  ) : (
                    <div className="w-2 h-2 rounded-sm mb-0.5" style={{ backgroundColor: seg.headerBg }} />
                  )}
                  <span className={`text-[10px] font-semibold leading-tight text-center ${seg.isBreak ? 'text-gray-400' : 'text-gray-700'}`}>
                    {seg.label}
                  </span>
                  <span className="text-[9px] text-gray-400 leading-tight">{seg.sub}</span>
                  {!seg.isBreak && (
                    <span className="text-[9px] text-gray-400 mt-0.5">
                      {segPigsTotal[seg.id]?.toLocaleString('th-TH')} ตัว
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="w-24 shrink-0 border-l border-gray-100 px-3 py-2 text-right">
              <span className="text-xs font-semibold text-gray-500">รวม (กก.)</span>
            </div>
          </div>

          {/* Group rows */}
          <div className="divide-y divide-gray-50">
            {groups.map((g, i) => (
              <div key={g.product_group} className={`flex items-stretch min-h-[40px] ${i % 2 === 1 ? 'bg-gray-50/50' : 'bg-white'}`}>
                <div className="w-44 shrink-0 border-r border-gray-100 px-4 py-2 flex items-center">
                  <span className="text-xs font-semibold text-gray-800 leading-tight">{g.product_group}</span>
                </div>
                <div className="flex flex-1 items-stretch">
                  {visibleSegs.map(seg => {
                    const kg = g.segKg[seg.id] ?? 0
                    return (
                      <div key={seg.id}
                        style={{ width: `${(seg.mins / VISIBLE_MINS) * 100}%` }}
                        className="border-r border-gray-100 last:border-r-0 flex items-center justify-center px-1 py-1.5">
                        {seg.isBreak ? (
                          <div className="w-full h-full bg-gray-100 rounded" />
                        ) : kg > 0 ? (
                          <div className="w-full rounded px-1.5 py-1 text-center"
                            style={{ backgroundColor: seg.barColor + '33', border: `1px solid ${seg.barColor}66` }}>
                            <span className="text-[11px] font-bold leading-tight" style={{ color: seg.textColor }}>
                              {fmtKg(kg)}
                            </span>
                            <span className="text-[9px] block leading-none" style={{ color: seg.textColor + 'aa' }}>กก.</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-200">—</span>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="w-24 shrink-0 border-l border-gray-100 px-3 py-2 flex items-center justify-end">
                  <span className="text-xs font-bold text-emerald-700">
                    {g.vis_kg.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Footer total */}
          <div className="flex border-t-2 border-gray-200 bg-gray-50">
            <div className="w-44 shrink-0 border-r border-gray-100 px-4 py-2.5">
              <span className="text-xs font-bold text-gray-700">รวมทั้งหมด</span>
            </div>
            <div className="flex flex-1">
              {visibleSegs.map(seg => {
                const segTotal = seg.isBreak ? 0 : groups.reduce((s, g) => s + (g.segKg[seg.id] ?? 0), 0)
                return (
                  <div key={seg.id}
                    style={{ width: `${(seg.mins / VISIBLE_MINS) * 100}%` }}
                    className="border-r border-gray-100 last:border-r-0 flex items-center justify-center px-1 py-2">
                    {!seg.isBreak && segTotal > 0 && (
                      <span className="text-[11px] font-bold" style={{ color: seg.headerBg }}>
                        {fmtKg(segTotal)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="w-24 shrink-0 border-l border-gray-100 px-3 py-2.5 flex items-center justify-end">
              <span className="text-sm font-bold text-emerald-700">
                {grandTotal.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
