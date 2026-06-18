'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'

const CARCASS_ACTIVE_SEGS = [
  { phase: 1, mins: 210 },
  { phase: 1, mins: 90  },
  { phase: 2, mins: 90  },
  { phase: 3, mins: 60  },
]

interface MasYieldRow  { carcass_weight: number; product_group: string; yield_pct: number }
interface SayapanRow   { product_group: string; station: string }
interface ProdRow      { sku: string; sku_name: string; product_group: string; station: string }
interface CarcassLot   { qty: number; avg_weight: number; order: number }

export interface YieldPlanItem {
  sku:             string
  sku_name:        string | null
  target_quantity: number
  unit:            string | null
  note:            string | null
  channel:         string | null
}

function closestWt(avg: number, wts: number[]) {
  if (!wts.length) return 0
  return wts.reduce((b, w) => Math.abs(w - avg) < Math.abs(b - avg) ? w : b, wts[0])
}

function fmt(n: number, dec = 0) {
  return n.toLocaleString('th-TH', { maximumFractionDigits: dec })
}

export default function CarcassYieldPlanView({
  stationName,
  selectedPhase,
  items,
}: {
  stationName:   string
  selectedPhase: number | 'all'
  items:         YieldPlanItem[]
}) {
  const [lots,     setLots]     = useState<CarcassLot[]>([])
  const [rate,     setRate]     = useState(90)
  const [masYield, setMasYield] = useState<MasYieldRow[]>([])
  const [sayapan,  setSayapan]  = useState<SayapanRow[]>([])
  const [prodMap,  setProdMap]  = useState<Map<string, string>>(new Map())
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  const loadData = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [yRes, sRes, pRes] = await Promise.all([
        fetch('/api/basic/mas-yield'),
        fetch('/api/basic/mas-sayapan'),
        fetch('/api/basic/mas-productivity'),
      ])
      const [yj, sj, pj] = await Promise.all([yRes.json(), sRes.json(), pRes.json()])
      if (yj.error) throw new Error(yj.error)
      if (sj.error) throw new Error(sj.error)
      setMasYield(yj.rows as MasYieldRow[])
      setSayapan(sj.rows as SayapanRow[])
      const m = new Map<string, string>()
      for (const p of (pj.rows ?? []) as ProdRow[]) {
        const norm = p.sku.replace(/^0+/, '')
        if (!m.has(p.sku))  m.set(p.sku, p.product_group)
        if (!m.has(norm))   m.set(norm, p.product_group)
      }
      setProdMap(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    try {
      const r = localStorage.getItem('pig_carcass_rate')
      const l = localStorage.getItem('pig_carcass_selected')
      if (r) setRate(parseFloat(r) || 90)
      if (l) setLots(JSON.parse(l) as CarcassLot[])
    } catch { }
    loadData()
  }, [loadData])

  if (selectedPhase === 'all') {
    return <p className="text-center py-8 text-gray-400 text-sm">กรุณาเลือก Phase เพื่อดูแผนตาม Yield</p>
  }

  // ── Yield calculation ──────────────────────────────────────────────
  const uniqueWts = [...new Set(masYield.map(r => r.carcass_weight))].sort((a, b) => a - b)
  const pool = lots.slice().sort((a, b) => a.order - b.order).map(l => ({ ...l, remaining: l.qty }))
  let poolIdx = 0
  const phaseGroupKg: Record<string, number> = {}

  for (const seg of CARCASS_ACTIVE_SEGS) {
    const pigs = Math.floor((seg.mins * 60) / rate)
    let need   = pigs
    const usages: { qty: number; avg: number }[] = []
    while (need > 0 && poolIdx < pool.length) {
      const lot  = pool[poolIdx]
      const take = Math.min(need, lot.remaining)
      if (take > 0) { usages.push({ qty: take, avg: lot.avg_weight }); lot.remaining -= take; need -= take }
      if (lot.remaining === 0) poolIdx++
    }
    if (seg.phase !== selectedPhase) continue
    for (const u of usages) {
      const wt = closestWt(u.avg, uniqueWts)
      for (const my of masYield) {
        if (my.carcass_weight !== wt) continue
        const kg = (my.yield_pct / 100) * u.avg * u.qty
        phaseGroupKg[my.product_group] = (phaseGroupKg[my.product_group] ?? 0) + kg
      }
    }
  }

  // ── Build group list (station groups, sorted by yield desc) ────────
  const stationGroups = sayapan.filter(r => r.station === stationName).map(r => r.product_group)
  const sortedGroups  = [...stationGroups]
    .map(grp => ({ grp, yieldKg: phaseGroupKg[grp] ?? 0 }))
    .sort((a, b) => b.yieldKg - a.yieldKg)

  // ── Map items to groups ────────────────────────────────────────────
  const rawItems = items.filter(a => a.note?.includes('raw_remainder'))
  const skuItems = items.filter(a => !a.note?.includes('raw_remainder'))

  // Aggregate SKU items by group+sku
  type SkuRow = { sku: string; name: string; qty: number; unit: string; channel: string }
  const skuByGroup: Record<string, SkuRow[]> = {}
  for (const a of skuItems) {
    const norm = (a.sku ?? '').replace(/^0+/, '')
    const grp  = prodMap.get(norm) ?? prodMap.get(a.sku ?? '') ?? '__other__'
    if (!skuByGroup[grp]) skuByGroup[grp] = []
    const ex = skuByGroup[grp].find(x => x.sku.replace(/^0+/, '') === norm)
    if (ex) { ex.qty += a.target_quantity }
    else skuByGroup[grp].push({
      sku:     a.sku ?? '',
      name:    a.sku_name ?? a.sku ?? '',
      qty:     a.target_quantity,
      unit:    a.unit ?? 'กก.',
      channel: a.channel ?? '',
    })
  }

  // Raw items by group
  type RawRow = { name: string; qty: number }
  const rawByGroup: Record<string, RawRow> = {}
  for (const a of rawItems) {
    const norm = (a.sku ?? '').replace(/^0+/, '')
    const grp  = prodMap.get(norm) ?? prodMap.get(a.sku ?? '') ?? '__other__'
    if (!rawByGroup[grp]) rawByGroup[grp] = { name: a.sku_name ?? 'Raw', qty: 0 }
    rawByGroup[grp].qty += a.target_quantity
  }

  // Groups including catch-all for unmatched items
  const displayGroups = [...sortedGroups]
  const hasOther = (skuByGroup['__other__']?.length ?? 0) + (rawByGroup['__other__'] ? 1 : 0) > 0
  if (hasOther) displayGroups.push({ grp: '__other__', yieldKg: 0 })

  const grandYield   = sortedGroups.reduce((s, g) => s + g.yieldKg, 0)
  const grandAssigned = skuItems.reduce((s, a) => s + a.target_quantity, 0)
  const grandRaw     = rawItems.reduce((s, a) => s + a.target_quantity, 0)

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-slate-700 to-slate-600">
        <div>
          <span className="text-white font-bold text-sm">แผนตาม Yield — Phase {selectedPhase} · {stationName}</span>
          {lots.length > 0 && (
            <span className="text-slate-300 text-xs ml-3">
              {lots.reduce((s, l) => s + l.qty, 0).toLocaleString('th-TH')} ตัว · อัตรา {rate} วิ/ตัว
              {grandYield > 0 && ` · Yield รวม ${fmt(grandYield)} กก.`}
            </span>
          )}
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

      {!loading && !error && (
        <div className="bg-white divide-y divide-gray-100">
          {displayGroups.length === 0 && lots.length === 0 && (
            <p className="text-center py-8 text-gray-400 text-sm">
              ยังไม่ได้เลือกล็อตหมูซีก — ไปที่หน้าเบิกหมูซีกเพื่อเลือกล็อต
            </p>
          )}
          {displayGroups.length === 0 && lots.length > 0 && (
            <p className="text-center py-8 text-gray-400 text-sm">
              ไม่พบข้อมูล — กรุณาอัพโหลด Mas สายพาน และ Mas Yield
            </p>
          )}

          {displayGroups.map(({ grp, yieldKg }, gi) => {
            const skus   = skuByGroup[grp] ?? []
            const rawRow = rawByGroup[grp]
            const label  = grp === '__other__' ? 'ไม่ระบุกลุ่ม' : grp
            const assignedKg = skus.reduce((s, x) => s + x.qty, 0) + (rawRow?.qty ?? 0)
            const usedPct    = yieldKg > 0 ? Math.min(100, (assignedKg / yieldKg) * 100) : 0

            return (
              <div key={grp}>
                {/* ── Group header ── */}
                <div className={`flex items-center gap-3 px-4 py-2.5 ${gi % 2 === 0 ? 'bg-slate-50' : 'bg-white'}`}>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-bold text-slate-800">{label}</span>
                    {yieldKg > 0 && (
                      <span className="ml-2 text-xs text-slate-500">Yield {fmt(yieldKg)} กก.</span>
                    )}
                  </div>
                  {yieldKg > 0 && (
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Progress bar */}
                      <div className="w-24 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${usedPct}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-400 w-8 text-right">{Math.round(usedPct)}%</span>
                    </div>
                  )}
                  <span className="text-xs font-bold text-emerald-700 w-20 text-right shrink-0">
                    {assignedKg > 0 ? `${fmt(assignedKg)} กก.` : '—'}
                  </span>
                </div>

                {/* ── SKU sub-items ── */}
                {skus.map((s, si) => (
                  <div key={`${s.sku}-${si}`}
                    className="flex items-center gap-3 px-4 py-1.5 pl-8 border-t border-gray-50 hover:bg-blue-50/30">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-gray-700 truncate">{s.name}</span>
                      {s.channel && (
                        <span className="ml-1.5 text-[10px] text-gray-400">{s.channel}</span>
                      )}
                    </div>
                    <span className={`text-xs font-semibold shrink-0 ${s.unit === 'RAW' ? 'text-amber-600' : 'text-blue-700'}`}>
                      {fmt(s.qty)} {s.unit === 'RAW' ? 'กก.(RAW)' : 'กก.'}
                    </span>
                  </div>
                ))}

                {/* ── Raw remainder ── */}
                {rawRow && (
                  <div className="flex items-center gap-3 px-4 py-1.5 pl-8 border-t border-gray-50 bg-amber-50/40">
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">RAW</span>
                      <span className="text-xs text-amber-700">{rawRow.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-amber-700 shrink-0">{fmt(rawRow.qty)} กก.</span>
                  </div>
                )}

                {/* No plan yet for this group */}
                {skus.length === 0 && !rawRow && items.length === 0 && yieldKg > 0 && (
                  <div className="px-4 py-2 pl-8 border-t border-gray-50">
                    <span className="text-[11px] text-gray-400">ยังไม่มีแผนผลิต — กด "สร้าง Phase {selectedPhase}"</span>
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Grand total footer ── */}
          {(grandAssigned > 0 || grandYield > 0) && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-t-2 border-gray-200">
              <span className="flex-1 text-xs font-bold text-gray-700">รวมทั้งหมด</span>
              {grandYield > 0 && (
                <span className="text-xs text-gray-500">Yield {fmt(grandYield)} กก.</span>
              )}
              {grandRaw > 0 && (
                <span className="text-xs font-semibold text-amber-600">RAW {fmt(grandRaw)} กก.</span>
              )}
              <span className="text-sm font-bold text-emerald-700 w-20 text-right shrink-0">
                {fmt(grandAssigned + grandRaw)} กก.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
