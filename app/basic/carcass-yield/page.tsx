'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, FlaskConical, Package } from 'lucide-react'

interface LotRow { spec_code: string; qty_3: number; weight_3: number }
interface MasYieldRow { carcass_weight: number; product_group: string; yield_pct: number }
interface YieldPart { product_group: string; yield_pct: number; total_kg: number }

interface LotComputed {
  spec: string
  qty: number
  avgWeight: number
  matchedWeight: number
  parts: YieldPart[]
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function findClosestWeight(avg: number, weights: number[]): number {
  return weights.reduce((best, w) => Math.abs(w - avg) < Math.abs(best - avg) ? w : best, weights[0])
}

function lotAgeKey(spec: string): number {
  const day = parseInt(spec.slice(4, 7), 10)
  return isNaN(day) ? Infinity : day
}

function computeLots(lots: LotRow[], master: MasYieldRow[]): LotComputed[] {
  if (!master.length) return []
  const uniqueWeights = [...new Set(master.map(r => r.carcass_weight))].sort((a, b) => a - b)
  return lots.map(lot => {
    const avgWeight = lot.qty_3 > 0 ? lot.weight_3 / lot.qty_3 : 0
    const matchedWeight = uniqueWeights.length ? findClosestWeight(avgWeight, uniqueWeights) : 0
    const parts: YieldPart[] = master
      .filter(r => r.carcass_weight === matchedWeight)
      .map(r => ({ product_group: r.product_group, yield_pct: r.yield_pct, total_kg: (r.yield_pct / 100) * avgWeight * lot.qty_3 }))
      .sort((a, b) => b.yield_pct - a.yield_pct)
    return { spec: lot.spec_code, qty: lot.qty_3, avgWeight, matchedWeight, parts }
  })
}

export default function CarcassYieldPage() {
  const [lots,        setLots]        = useState<LotRow[]>([])
  const [sourceFile,  setSourceFile]  = useState('')
  const [master,      setMaster]      = useState<MasYieldRow[]>([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [activeTab,   setActiveTab]   = useState<'overview' | 'detail'>('overview')
  const [ovGroup,     setOvGroup]     = useState('')   // overview: selected product group
  const [selectedSpec, setSelectedSpec] = useState('') // detail: selected lot
  const [detailGroup, setDetailGroup] = useState('')   // detail: selected product group

  const loadData = useCallback(async () => {
    setLoading(true); setError('')
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
        .sort((a, b) => lotAgeKey(a.spec_code) - lotAgeKey(b.spec_code) || a.spec_code.localeCompare(b.spec_code))
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

  const computed = useMemo(() => computeLots(lots, master), [lots, master])

  const allGroups = useMemo(() => {
    const seen = new Set<string>()
    computed.forEach(l => l.parts.forEach(p => seen.add(p.product_group)))
    return [...seen]
  }, [computed])

  const selectedLotData = computed.find(c => c.spec === selectedSpec) ?? null

  const hasData = !loading && computed.length > 0

  return (
    <div className="space-y-5">
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
        <button onClick={loadData} disabled={loading}
          className="flex items-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shrink-0">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          รีโหลด
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">{error}</div>}

      {loading && (
        <div className="text-center py-14 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังโหลดข้อมูล...</p>
        </div>
      )}

      {!loading && lots.length === 0 && !error && (
        <div className="text-center py-14 text-gray-400">
          <Package size={36} className="mx-auto mb-3 opacity-30" />
          <p>ไม่พบข้อมูล Lot — กรุณาอัพโหลดไฟล์ Stock คลัง 20 ก่อน</p>
        </div>
      )}

      {!loading && lots.length > 0 && master.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-amber-700 text-sm">
          ไม่พบข้อมูล Mas Yield — กรุณาอัพโหลดที่เมนู Master Calculation → Mas Yield
        </div>
      )}

      {hasData && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
            {(['overview', 'detail'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {tab === 'overview' ? 'ภาพรวมทุก Lot' : 'รายละเอียด Lot'}
              </button>
            ))}
          </div>

          {/* ── OVERVIEW TAB ── */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl px-5 py-4">
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">เลือกกลุ่มชิ้นส่วน</label>
                <select value={ovGroup} onChange={e => setOvGroup(e.target.value)}
                  className="w-full sm:w-80 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white">
                  <option value="">— รวมทุกกลุ่ม —</option>
                  {allGroups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm bg-white">
                  <thead className="bg-gray-50 border-b border-gray-100 text-xs">
                    <tr>
                      <th className="px-5 py-3 text-left font-semibold text-gray-700">Lot</th>
                      <th className="px-5 py-3 text-right font-semibold text-gray-600">จำนวน (ตัว)</th>
                      <th className="px-5 py-3 text-right font-semibold text-gray-600">น้ำหนักเฉลี่ย (กก./ตัว)</th>
                      <th className="px-5 py-3 text-right font-semibold text-purple-700">
                        Yield (%)
                        {ovGroup && <div className="text-[10px] font-normal text-purple-400 truncate max-w-[8rem] ml-auto">{ovGroup}</div>}
                      </th>
                      <th className="px-5 py-3 text-right font-semibold text-emerald-700">
                        น้ำหนักรวม (กก.)
                        {ovGroup && <div className="text-[10px] font-normal text-emerald-400 truncate max-w-[8rem] ml-auto">{ovGroup}</div>}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {computed.map(lot => {
                      const part = ovGroup ? lot.parts.find(p => p.product_group === ovGroup) : null
                      const displayYield = ovGroup
                        ? (part?.yield_pct ?? 0)
                        : lot.parts.reduce((s, p) => s + p.yield_pct, 0)
                      const displayKg = ovGroup
                        ? (part?.total_kg ?? 0)
                        : lot.parts.reduce((s, p) => s + p.total_kg, 0)
                      return (
                        <tr key={lot.spec} className="hover:bg-gray-50">
                          <td className="px-5 py-3">
                            <span className="font-mono font-bold text-gray-900">{lot.spec}</span>
                          </td>
                          <td className="px-5 py-3 text-right text-gray-700">{lot.qty.toLocaleString('th-TH')}</td>
                          <td className="px-5 py-3 text-right text-gray-600">{fmt(lot.avgWeight)}</td>
                          <td className="px-5 py-3 text-right text-purple-700">{fmt(displayYield)}</td>
                          <td className="px-5 py-3 text-right font-semibold text-emerald-700">{fmt(displayKg)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {computed.length > 1 && (
                    <tfoot className="bg-emerald-50 border-t-2 border-emerald-200">
                      <tr className="font-bold text-sm">
                        <td className="px-5 py-3 text-emerald-800">รวมทุก Lot</td>
                        <td className="px-5 py-3 text-right text-gray-700">
                          {computed.reduce((s, l) => s + l.qty, 0).toLocaleString('th-TH')}
                        </td>
                        <td className="px-5 py-3 text-right text-gray-400">—</td>
                        <td className="px-5 py-3 text-right text-gray-400">—</td>
                        <td className="px-5 py-3 text-right text-emerald-800">
                          {fmt(computed.reduce((s, l) => {
                            const kg = ovGroup
                              ? (l.parts.find(p => p.product_group === ovGroup)?.total_kg ?? 0)
                              : l.parts.reduce((ss, p) => ss + p.total_kg, 0)
                            return s + kg
                          }, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ── DETAIL TAB ── */}
          {activeTab === 'detail' && (
            <div className="space-y-4">
              {/* Selectors */}
              <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex flex-wrap gap-4">
                <div className="flex-1 min-w-48">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">เลือก Lot</label>
                  <select value={selectedSpec}
                    onChange={e => { setSelectedSpec(e.target.value); setDetailGroup('') }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white">
                    <option value="">— เลือก Lot —</option>
                    {lots.map(r => {
                      const avg = r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0
                      return (
                        <option key={r.spec_code} value={r.spec_code}>
                          {r.spec_code} · {r.qty_3.toLocaleString('th-TH')} ตัว · {fmt(avg)} กก./ตัว
                        </option>
                      )
                    })}
                  </select>
                </div>
                <div className="flex-1 min-w-48">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">เลือกกลุ่มชิ้นส่วน</label>
                  <select value={detailGroup} onChange={e => setDetailGroup(e.target.value)}
                    disabled={!selectedSpec}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white disabled:opacity-50 disabled:bg-gray-50">
                    <option value="">— ทุกกลุ่ม —</option>
                    {selectedLotData?.parts.map(p => (
                      <option key={p.product_group} value={p.product_group}>{p.product_group}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Prompt */}
              {!selectedSpec && (
                <div className="text-center py-10 text-gray-400">
                  <FlaskConical size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">เลือก Lot ด้านบนเพื่อดูผลคำนวณ Yield</p>
                </div>
              )}

              {/* Result card */}
              {selectedLotData && (
                <div className="border border-emerald-200 rounded-2xl overflow-hidden">
                  {/* Card header */}
                  <div className="bg-emerald-600 px-5 py-3 flex flex-wrap items-center gap-4">
                    <div>
                      <p className="text-white font-bold">{selectedLotData.spec}</p>
                      <p className="text-emerald-100 text-xs mt-0.5">
                        {selectedLotData.qty.toLocaleString('th-TH')} ตัว · น้ำหนักเฉลี่ย {fmt(selectedLotData.avgWeight)} กก./ตัว
                      </p>
                    </div>
                    <div className="ml-auto text-xs text-emerald-100 bg-emerald-700/50 rounded-lg px-3 py-1">
                      ใช้น้ำหนักซาก <b className="text-white">{fmt(selectedLotData.matchedWeight)}</b> กก. จาก Master
                    </div>
                  </div>

                  {/* Highlighted group summary (when group selected) */}
                  {detailGroup && (() => {
                    const part = selectedLotData.parts.find(p => p.product_group === detailGroup)
                    if (!part) return null
                    return (
                      <div className="px-5 py-4 bg-emerald-50 border-b border-emerald-100 flex flex-wrap items-center gap-6">
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide">กลุ่มที่เลือก</p>
                          <p className="font-semibold text-gray-900 mt-0.5">{part.product_group}</p>
                        </div>
                        <div className="flex gap-8 ml-auto">
                          <div className="text-center">
                            <p className="text-[10px] text-purple-400 uppercase tracking-wide">Yield</p>
                            <p className="text-2xl font-bold text-purple-700 leading-none mt-1">
                              {fmt(part.yield_pct)}<span className="text-sm font-normal ml-1">%</span>
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-[10px] text-emerald-500 uppercase tracking-wide">น้ำหนักรวม</p>
                            <p className="text-2xl font-bold text-emerald-700 leading-none mt-1">
                              {fmt(part.total_kg)}<span className="text-sm font-normal ml-1">กก.</span>
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Full parts table */}
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
                      {selectedLotData.parts.map(p => {
                        const isHighlighted = p.product_group === detailGroup
                        return (
                          <tr key={p.product_group}
                            className={isHighlighted ? 'bg-emerald-50' : 'hover:bg-gray-50'}>
                            <td className={`px-5 py-2.5 font-medium ${isHighlighted ? 'text-emerald-800 font-semibold' : 'text-gray-800'}`}>
                              {isHighlighted && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 mb-0.5" />}
                              {p.product_group}
                            </td>
                            <td className={`px-5 py-2.5 text-right ${isHighlighted ? 'text-purple-700 font-semibold' : 'text-purple-600'}`}>
                              {fmt(p.yield_pct)}
                            </td>
                            <td className={`px-5 py-2.5 text-right font-semibold ${isHighlighted ? 'text-emerald-800' : 'text-emerald-700'}`}>
                              {fmt(p.total_kg)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="bg-emerald-50 border-t-2 border-emerald-300">
                      <tr className="font-bold text-sm">
                        <td className="px-5 py-2.5 text-emerald-800">รวมทั้งหมด</td>
                        <td className="px-5 py-2.5 text-right text-purple-700">
                          {fmt(selectedLotData.parts.reduce((s, p) => s + p.yield_pct, 0))}
                        </td>
                        <td className="px-5 py-2.5 text-right text-emerald-800 text-base">
                          {fmt(selectedLotData.parts.reduce((s, p) => s + p.total_kg, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
