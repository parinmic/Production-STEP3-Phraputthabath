'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const CARCASS_ACTIVE_SEGS = [
  { phase: 1, mins: 210 },
  { phase: 1, mins: 90  },
  { phase: 2, mins: 120 },
  { phase: 3, mins: 30  },
  { phase: 3, mins: 720 },
]

const BASIC_STATIONS = ['สะโพกเบสิค', 'ไหล่เบสิค', 'สามชั้นเบสิค'] as const
const PHASE_PERIOD: Record<number, string> = { 1: 'เช้า', 2: 'บ่าย', 3: 'ค่ำ' }

interface MasYieldRow { carcass_weight: number; product_group: string; yield_pct: number }
interface SayapanRow  { product_group: string; station: string }
interface ProdRow     { sku: string; sku_name: string; product_group: string; station: string }
interface CarcassLot  { qty: number; avg_weight: number; order: number }
interface AssignRow   {
  sku: string; sku_name: string | null; target_quantity: number
  unit: string | null; note: string | null; channel: string | null; table_name: string
  effective_from: string | null
}

function closestWt(avg: number, wts: number[]) {
  if (!wts.length) return 0
  return wts.reduce((b, w) => Math.abs(w - avg) < Math.abs(b - avg) ? w : b, wts[0])
}
function fmt(n: number) { return n.toLocaleString('th-TH', { maximumFractionDigits: 0 }) }

export default function CarcassYieldPlanView({
  selectedPhase,
  date,
  stationName,
}: {
  selectedPhase: number | 'all'
  date: string
  stationName?: string
}) {
  const [lots,     setLots]     = useState<CarcassLot[]>([])
  const [rate,     setRate]     = useState(90)
  const [masYield, setMasYield] = useState<MasYieldRow[]>([])
  const [sayapan,  setSayapan]  = useState<SayapanRow[]>([])
  const [prodMap,  setProdMap]  = useState<Map<string, string>>(new Map())
  const [items,    setItems]    = useState<AssignRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  const loadData = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const period = selectedPhase !== 'all' ? PHASE_PERIOD[selectedPhase] : null
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

      // Fetch production assignments for this station only (or all basic stations if no filter)
      const stationFilter = stationName ? [stationName] : [...BASIC_STATIONS]
      if (period) {
        const { data, error: dbErr } = await supabase
          .from('production_assignments')
          .select('sku, sku_name, target_quantity, unit, note, channel, table_name, effective_from')
          .eq('production_date', date)
          .eq('period', period)
          .in('table_name', stationFilter)
          .order('seq', { ascending: true })
        if (dbErr) throw new Error(dbErr.message)
        const maxEffectiveByStation = new Map<string, string>()
        for (const row of (data ?? []) as AssignRow[]) {
          if (!row.effective_from) continue
          const current = maxEffectiveByStation.get(row.table_name)
          if (!current || row.effective_from > current) maxEffectiveByStation.set(row.table_name, row.effective_from)
        }
        const latestRows = ((data ?? []) as AssignRow[]).filter(row => {
          const latest = maxEffectiveByStation.get(row.table_name)
          return !latest || row.effective_from === latest
        })
        setItems(latestRows)
      } else {
        setItems([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [selectedPhase, date, stationName])

  const loadSelectedLots = useCallback(() => {
    fetch(`/api/pig-carcass-lot-selection?date=${date}`)
      .then(r => r.json())
      .then(json => {
        if (json.selected) setLots(json.selected as CarcassLot[])
        if (json.rate != null) setRate(parseFloat(json.rate) || 90)
      })
      .catch(() => {})
  }, [date])

  useEffect(() => {
    loadSelectedLots()
    loadData()
    // Other machines can change the selected lots — poll so this view stays in sync.
    const id = setInterval(loadSelectedLots, 20_000)
    return () => clearInterval(id)
  }, [loadData, loadSelectedLots])

  if (selectedPhase === 'all') {
    return <p className="text-center py-8 text-gray-400 text-sm">กรุณาเลือก Phase เพื่อดูแผนตาม Yield</p>
  }

  // ── Yield calculation ──────────────────────────────────────────────
  const uniqueWts = [...new Set(masYield.map(r => r.carcass_weight))].sort((a, b) => a - b)
  const pool = lots.slice().sort((a, b) => a.order - b.order).map(l => ({ ...l, remaining: l.qty }))
  let poolIdx = 0
  const phaseGroupKg: Record<string, number> = {}
  const pigsPerPhase: Record<number, number> = {}

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
    const actualPigs = pigs - need
    pigsPerPhase[seg.phase] = (pigsPerPhase[seg.phase] ?? 0) + actualPigs

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

  const phasePigs = pigsPerPhase[selectedPhase as number] ?? 0

  // ── Build per-station group list (sorted by yield desc within each station) ──
  const seenGrps = new Set<string>()
  const stationData = (BASIC_STATIONS as readonly string[]).filter(stn => !stationName || stn === stationName).map(stn => {
    const grps = [...new Set(sayapan.filter(r => r.station === stn).map(r => r.product_group))]
      .filter(g => !seenGrps.has(g))
    grps.forEach(g => seenGrps.add(g))
    const sorted = grps
      .map(grp => ({ grp, yieldKg: phaseGroupKg[grp] ?? 0 }))
      .sort((a, b) => b.yieldKg - a.yieldKg)
    const totalYield = sorted.reduce((s, g) => s + g.yieldKg, 0)
    return { station: stn, groups: sorted, totalYield }
  }).filter(s => s.groups.length > 0)

  // ── Map items to groups ────────────────────────────────────────────
  const rawItems = items.filter(a => a.note?.includes('raw_remainder'))
  const skuItems = items.filter(a => !a.note?.includes('raw_remainder'))

  type SkuRow = { sku: string; name: string; qty: number; unit: string; channel: string; station: string }
  const skuByGroup: Record<string, SkuRow[]> = {}
  for (const a of skuItems) {
    const norm = (a.sku ?? '').replace(/^0+/, '')
    const grp  = prodMap.get(norm) ?? prodMap.get(a.sku ?? '') ?? '__other__'
    if (!skuByGroup[grp]) skuByGroup[grp] = []
    const ex = skuByGroup[grp].find(x => x.sku.replace(/^0+/, '') === norm)
    if (ex) { ex.qty += a.target_quantity }
    else skuByGroup[grp].push({
      sku: a.sku ?? '', name: a.sku_name ?? a.sku ?? '',
      qty: a.target_quantity, unit: a.unit ?? 'กก.',
      channel: a.channel ?? '', station: a.table_name,
    })
  }

  type RawRow = { name: string; qty: number; station: string }
  const rawByGroup: Record<string, RawRow> = {}
  for (const a of rawItems) {
    const norm = (a.sku ?? '').replace(/^0+/, '')
    const grp  = prodMap.get(norm) ?? prodMap.get(a.sku ?? '') ?? '__other__'
    if (!rawByGroup[grp]) rawByGroup[grp] = { name: a.sku_name ?? 'Raw', qty: 0, station: a.table_name }
    rawByGroup[grp].qty += a.target_quantity
  }

  const hasOther   = (skuByGroup['__other__']?.length ?? 0) + (rawByGroup['__other__'] ? 1 : 0) > 0
  const grandYield = stationData.reduce((s, st) => s + st.totalYield, 0)
  const grandAssigned = skuItems.reduce((s, a) => s + a.target_quantity, 0)
  const grandRaw      = rawItems.reduce((s, a) => s + a.target_quantity, 0)
  const totalLots     = lots.reduce((s, l) => s + l.qty, 0)

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-5 py-3 bg-gradient-to-r from-slate-700 to-slate-600">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-white font-bold text-sm">แผนตาม Yield — Phase {selectedPhase}</span>
            <button onClick={loadData} disabled={loading}
              className="sm:hidden shrink-0 text-slate-300 hover:text-white text-xs flex items-center gap-1 transition-colors">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />รีโหลด
            </button>
          </div>
          {totalLots > 0 && (
            <span className="text-slate-300 text-xs block sm:inline sm:ml-3 mt-0.5 sm:mt-0">
              <span className="text-white font-semibold">{phasePigs.toLocaleString('th-TH')} ตัว</span>
              <span className="opacity-60"> / {totalLots.toLocaleString('th-TH')} ตัว รวม 3 Phase</span>
              {` · อัตรา ${rate} วิ/ตัว`}
              {grandYield > 0 && ` · Yield รวม ${fmt(grandYield)} กก.`}
            </span>
          )}
        </div>
        <button onClick={loadData} disabled={loading}
          className="hidden sm:flex shrink-0 text-slate-300 hover:text-white text-xs items-center gap-1 transition-colors">
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
          {stationData.length === 0 && totalLots === 0 && (
            <p className="text-center py-8 text-gray-400 text-sm">
              ยังไม่ได้เลือกล็อตหมูซีก — ไปที่หน้าเบิกหมูซีกเพื่อเลือกล็อต
            </p>
          )}
          {stationData.length === 0 && totalLots > 0 && (
            <p className="text-center py-8 text-gray-400 text-sm">
              ไม่พบข้อมูล — กรุณาอัพโหลด Mas สายพาน และ Mas Yield
            </p>
          )}

          {stationData.map(({ station, groups, totalYield }) => (
            <div key={station}>
              {/* ── Station header ── */}
              <div className="flex items-center justify-between px-4 py-1.5 bg-slate-200/70 border-t border-slate-300">
                <span className="text-xs font-bold text-slate-600 tracking-wide">{station}</span>
                {totalYield > 0 && (
                  <span className="text-[10px] text-slate-500">Yield รวม {fmt(totalYield)} กก.</span>
                )}
              </div>

              {groups.map(({ grp, yieldKg }, gi) => {
                const skus       = skuByGroup[grp] ?? []
                const rawRow     = rawByGroup[grp]
                const assignedKg = skus.reduce((s, x) => s + x.qty, 0) + (rawRow?.qty ?? 0)
                const usedPct    = yieldKg > 0 ? Math.min(100, (assignedKg / yieldKg) * 100) : 0

                return (
                  <div key={grp}>
                    {/* ── Group header ── */}
                    <div className={`flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 px-4 py-2.5 ${gi % 2 === 0 ? 'bg-slate-50' : 'bg-white'}`}>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-bold text-slate-800">{grp}</span>
                        {yieldKg > 0 && (
                          <span className="ml-2 text-xs text-slate-500 whitespace-nowrap">Yield {fmt(yieldKg)} กก.</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 sm:contents">
                        {yieldKg > 0 && (
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="w-24 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${assignedKg > yieldKg ? 'bg-red-500' : 'bg-emerald-500'}`}
                                style={{ width: `${usedPct}%` }} />
                            </div>
                            <span className={`text-[10px] w-8 text-right ${assignedKg > yieldKg ? 'text-red-500 font-semibold' : 'text-slate-400'}`}>
                              {Math.round(usedPct)}%
                            </span>
                          </div>
                        )}
                        <span className={`text-xs font-bold sm:w-20 text-right shrink-0 ml-auto sm:ml-0 ${assignedKg > yieldKg ? 'text-red-600' : 'text-emerald-700'}`}>
                          {assignedKg > 0 ? `${fmt(assignedKg)} กก.` : '—'}
                          {assignedKg > yieldKg && <span className="block text-[9px] font-normal text-red-400">เกิน Yield</span>}
                        </span>
                      </div>
                    </div>

                    {/* ── SKU sub-items ── */}
                    {skus.map((s, si) => (
                      <div key={`${s.sku}-${si}`}
                        className="flex items-center gap-3 px-4 py-1.5 pl-8 border-t border-gray-50 hover:bg-blue-50/30">
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-700 truncate">{s.name}</span>
                          {s.channel && s.channel !== 'RAW' && (
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
                          <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">RAW</span>
                          <span className="text-xs text-amber-700">{rawRow.name}</span>
                        </div>
                        <span className="text-xs font-semibold text-amber-700 shrink-0">{fmt(rawRow.qty)} กก.</span>
                      </div>
                    )}

                    {/* Remainder row: when plan exists but assigned < yield */}
                    {yieldKg > 0 && items.length > 0 && Math.round(yieldKg - assignedKg) > 0 && (() => {
                      const remainKg = Math.round(yieldKg - assignedKg)
                      const hasRaw   = !!(rawByGroup[grp]) || (skuByGroup[grp] ?? []).some(s => s.unit === 'RAW')
                      return (
                        <div className={`flex items-center gap-3 px-4 py-1.5 pl-8 border-t border-dashed ${hasRaw ? 'border-amber-200 bg-amber-50/40' : 'border-blue-100 bg-blue-50/30'}`}>
                          <div className="flex-1 min-w-0 flex items-center gap-1.5">
                            {hasRaw ? (
                              <>
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">RAW</span>
                                <span className="text-xs text-amber-600">ผลิต RAW เพิ่ม</span>
                              </>
                            ) : (
                              <span className="text-xs text-blue-600">ผลิตสินค้าเพิ่ม</span>
                            )}
                          </div>
                          <span className={`text-xs font-semibold shrink-0 ${hasRaw ? 'text-amber-600' : 'text-blue-600'}`}>
                            +{fmt(remainKg)} กก.
                          </span>
                        </div>
                      )
                    })()}

                    {/* No plan generated yet */}
                    {skus.length === 0 && !rawRow && yieldKg > 0 && items.length === 0 && (
                      <div className="flex items-center gap-3 px-4 py-2 pl-8 border-t border-gray-50">
                        <span className="text-[11px] text-gray-400 flex-1">
                          ยังไม่มีแผนผลิต — กด &quot;สร้าง Phase {selectedPhase}&quot;
                        </span>
                        <span className="text-[11px] text-slate-400 shrink-0">คาด {fmt(yieldKg)} กก. ตาม Yield</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}

          {/* ── Other (unmapped group) ── */}
          {hasOther && (() => {
            const skus   = skuByGroup['__other__'] ?? []
            const rawRow = rawByGroup['__other__']
            const assignedKg = skus.reduce((s, x) => s + x.qty, 0) + (rawRow?.qty ?? 0)
            return (
              <div>
                <div className="flex items-center justify-between px-4 py-1.5 bg-slate-200/70 border-t border-slate-300">
                  <span className="text-xs font-bold text-slate-500 tracking-wide">ไม่ระบุกลุ่ม</span>
                </div>
                <div className={`flex items-center gap-3 px-4 py-2.5 bg-slate-50`}>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-bold text-slate-800">ไม่ระบุกลุ่มสินค้า</span>
                  </div>
                  <span className="text-xs font-bold text-emerald-700 w-20 text-right shrink-0">
                    {assignedKg > 0 ? `${fmt(assignedKg)} กก.` : '—'}
                  </span>
                </div>
                {skus.map((s, si) => (
                  <div key={`other-${s.sku}-${si}`}
                    className="flex items-center gap-3 px-4 py-1.5 pl-8 border-t border-gray-50">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-gray-700 truncate">{s.name}</span>
                      {s.channel && s.channel !== 'RAW' && (
                        <span className="ml-1.5 text-[10px] text-gray-400">{s.channel}</span>
                      )}
                    </div>
                    <span className="text-xs font-semibold text-blue-700 shrink-0">{fmt(s.qty)} กก.</span>
                  </div>
                ))}
                {rawRow && (
                  <div className="flex items-center gap-3 px-4 py-1.5 pl-8 border-t border-gray-50 bg-amber-50/40">
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">RAW</span>
                      <span className="text-xs text-amber-700">{rawRow.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-amber-700 shrink-0">{fmt(rawRow.qty)} กก.</span>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── Footer ── */}
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
