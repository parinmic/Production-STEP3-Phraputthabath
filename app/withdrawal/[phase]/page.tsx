'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Calendar, Printer, RefreshCw, PackageOpen, Zap, Save, X, ChevronDown, ChevronRight, Clock } from 'lucide-react'

interface WithdrawalItem {
  id: string
  request_date: string
  phase: number
  sku: string
  sku_name: string | null
  quantity: number
  unit: string
  work_station: string | null
  note: string | null
}

interface LotInfo {
  spec_code: string
  factory: string
  prod_date: string
  available: number
  to_withdraw: number
  insufficient?: boolean
}

interface ForProduct {
  sku: string
  sku_name: string | null
  qty: number
}

interface CalcItem {
  sku: string
  sku_name: string | null
  quantity: number
  unit: string
  work_station: string | null
  note: string | null
  lots?: LotInfo[]
  for_products?: ForProduct[]
}

type RowItem = CalcItem

const PHASE_CONFIG = {
  '1': { label: 'Phase 1 — รอบเช้า',  color: 'blue',   time: '08:00 น.' },
  '2': { label: 'Phase 2 — รอบบ่าย',  color: 'orange', time: '13:00 น.' },
  '3': { label: 'Phase 3 — แผน 100%', color: 'purple', time: '18:00 น.' },
} as const

const PHASE_ROUNDS: Record<string, string[]> = {
  '1': ['08:00', '10:00', '12:00'],
  '2': ['13:00', '15:00', '17:00'],
  '3': ['18:00', '20:00'],
}

const STATION_COLORS: Record<string, string> = {
  'สามชั้น': 'bg-blue-100 text-blue-700',
  'สะโพก':   'bg-orange-100 text-orange-700',
  'ไหล่':    'bg-green-100 text-green-700',
}

function splitQuantity(total: number, roundIdx: number, numRounds: number): number {
  const base = Math.floor(total / numRounds)
  const rem  = total % numRounds
  return roundIdx === numRounds - 1 ? base + rem : base
}

function getItemForRound(item: RowItem, roundIdx: number, numRounds: number): RowItem {
  const qty = splitQuantity(item.quantity, roundIdx, numRounds)
  if (!item.lots?.length) return { ...item, quantity: qty }
  return {
    ...item,
    quantity: qty,
    lots: item.lots.map(lot => ({
      ...lot,
      to_withdraw: splitQuantity(lot.to_withdraw, roundIdx, numRounds),
    })),
  }
}

export default function WithdrawalPage() {
  const { phase } = useParams() as { phase: string }
  const today = new Date().toISOString().split('T')[0]
  const [date, setDate]           = useState(today)
  const [items, setItems]         = useState<WithdrawalItem[]>([])
  const [loading, setLoading]     = useState(false)
  const [calculating, setCalc]    = useState(false)
  const [saving, setSaving]       = useState(false)
  const [preview, setPreview]     = useState<CalcItem[] | null>(null)
  const [calcMsg, setCalcMsg]     = useState<string | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [collapsedRounds, setCollapsedRounds] = useState<Set<string>>(new Set())
  const printRef = useRef<HTMLDivElement>(null)

  const cfg    = PHASE_CONFIG[phase as keyof typeof PHASE_CONFIG] ?? PHASE_CONFIG['1']
  const rounds = PHASE_ROUNDS[phase] ?? PHASE_ROUNDS['1']

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/withdrawal?date=${date}&phase=${phase}`)
      const data = await res.json()
      setItems(data.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [date, phase])

  useEffect(() => { load(); setPreview(null); setCalcMsg(null) }, [load])

  const calculate = async () => {
    setCalc(true); setCalcMsg(null)
    try {
      const res = await fetch('/api/withdrawal/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, phase: Number(phase) }),
      })
      const data = await res.json()
      if (data.error) { setCalcMsg(data.error); return }
      if (!data.items?.length) { setCalcMsg(data.message ?? 'ไม่พบข้อมูลคำสั่งผลิต'); return }
      setPreview(data.items)
    } catch {
      setCalcMsg('เกิดข้อผิดพลาด ไม่สามารถคำนวณได้')
    } finally {
      setCalc(false)
    }
  }

  const save = async () => {
    if (!preview) return
    setSaving(true); setCalcMsg(null)
    try {
      const flatItems = preview.flatMap(item => {
        if (!item.lots?.length) return [item]
        return item.lots.map(lot => ({
          sku:          item.sku,
          sku_name:     item.sku_name,
          quantity:     lot.to_withdraw,
          unit:         item.unit,
          work_station: item.work_station,
          note:         lot.insufficient
            ? `ไม่เพียงพอในสต็อก (ขาด ${lot.to_withdraw} กก.)`
            : `Lot: ${lot.spec_code} | รร.${lot.factory} | ผลิต ${lot.prod_date}`,
        }))
      })
      const res = await fetch('/api/withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: flatItems, requestDate: date, phase: Number(phase) }),
      })
      const data = await res.json()
      if (data.success) {
        setPreview(null)
        await load()
      } else {
        setCalcMsg(data.message ?? 'บันทึกไม่สำเร็จ')
      }
    } catch {
      setCalcMsg('บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  function parseLotNote(note: string | null): { spec_code: string; factory: string; prod_date: string } | null {
    if (!note?.startsWith('Lot:')) return null
    const parts = note.split(' | ')
    return {
      spec_code: parts[0]?.replace('Lot:', '').trim() ?? note,
      factory:   parts[1]?.replace('รร.', '').trim() ?? '-',
      prod_date: parts[2]?.replace('ผลิต', '').trim() ?? '-',
    }
  }

  function groupSaved(raw: WithdrawalItem[]): RowItem[] {
    const map = new Map<string, WithdrawalItem[]>()
    for (const item of raw) {
      const k = `${item.work_station ?? ''}|||${item.sku}`
      const list = map.get(k) ?? []
      list.push(item)
      map.set(k, list)
    }
    return Array.from(map.values()).map(group => {
      const first = group[0]
      const hasLot = group.some(i => parseLotNote(i.note) !== null)
      if (!hasLot) return { ...first } as RowItem
      return {
        sku:          first.sku,
        sku_name:     first.sku_name,
        quantity:     group.reduce((s, i) => s + i.quantity, 0),
        unit:         first.unit,
        work_station: first.work_station,
        note:         'คำนวณจาก BOM',
        lots: group.map(item => {
          const p = parseLotNote(item.note)
          return {
            spec_code:    p?.spec_code ?? item.note ?? '-',
            factory:      p?.factory   ?? '-',
            prod_date:    p?.prod_date ?? '-',
            available:    0,
            to_withdraw:  item.quantity,
            insufficient: item.note?.includes('ไม่เพียงพอ') ?? false,
          } satisfies LotInfo
        }),
      } as RowItem
    })
  }

  const displayItems: RowItem[] = preview ?? groupSaved(items)
  const totalQty = displayItems.reduce((s, i) => s + i.quantity, 0)

  const borderCls = cfg.color === 'blue'   ? 'border-blue-500'
                  : cfg.color === 'orange' ? 'border-orange-500'
                  :                          'border-purple-500'
  const badgeCls  = cfg.color === 'blue'   ? 'bg-blue-100 text-blue-700'
                  : cfg.color === 'orange' ? 'bg-orange-100 text-orange-700'
                  :                          'bg-purple-100 text-purple-700'

  const roundHeaderCls = cfg.color === 'blue'   ? 'bg-blue-600'
                       : cfg.color === 'orange' ? 'bg-orange-500'
                       :                          'bg-purple-600'

  function toggleRound(r: string) {
    setCollapsedRounds(prev => {
      const next = new Set(prev)
      next.has(r) ? next.delete(r) : next.add(r)
      return next
    })
  }

  function renderStationTable(stationItems: RowItem[], roundIdx: number, station: string) {
    const roundItems = stationItems.map(item => getItemForRound(item, roundIdx, rounds.length))
    const stationTotal = roundItems.reduce((s, i) => s + i.quantity, 0)

    return (
      <div key={`${station}-${roundIdx}`} className="card mb-4">
        <div className="flex items-center gap-3 mb-4">
          <span className={`px-3 py-1 rounded-full text-sm font-semibold ${STATION_COLORS[station] ?? 'bg-gray-100 text-gray-700'}`}>
            {station}
          </span>
          <span className="text-sm text-gray-500">
            {roundItems.length} รายการ · รวม {stationTotal.toLocaleString()} กก.
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="px-3 py-2.5 text-left text-gray-600 font-medium w-8">#</th>
              <th className="px-3 py-2.5 text-left text-gray-600 font-medium">รหัส</th>
              <th className="px-3 py-2.5 text-left text-gray-600 font-medium">ชื่อสินค้า / วัตถุดิบ</th>
              <th className="px-3 py-2.5 text-right text-gray-600 font-medium">จำนวน</th>
              <th className="px-3 py-2.5 text-left text-gray-600 font-medium">หน่วย</th>
              <th className="px-3 py-2.5 text-left text-gray-600 font-medium">หมายเหตุ</th>
              <th className="px-3 py-2.5 text-center text-gray-600 font-medium no-print">เบิกแล้ว ✓</th>
            </tr>
          </thead>
          <tbody>
            {roundItems.map((item, idx) => {
              const rowKey = `${station}|||${item.sku}|||${roundIdx}|||${idx}`
              const isExpanded = expandedKey === rowKey
              const hasProducts = (item.for_products?.length ?? 0) > 0
              return (
                <>
                  <tr key={`${item.sku}-${idx}`}
                    className={`border-b hover:bg-gray-50 ${hasProducts ? 'cursor-pointer' : ''}`}
                    onClick={() => hasProducts && setExpandedKey(isExpanded ? null : rowKey)}>
                    <td className="px-3 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-mono text-gray-700">{item.sku}</td>
                    <td className="px-3 py-2.5 text-gray-800">
                      <div className="flex items-center gap-1.5">
                        {hasProducts && (
                          isExpanded
                            ? <ChevronDown size={14} className="text-indigo-500 shrink-0" />
                            : <ChevronRight size={14} className="text-gray-400 shrink-0" />
                        )}
                        {item.sku_name ?? '-'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{item.quantity.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-gray-600">{item.unit}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{item.note ?? ''}</td>
                    <td className="px-3 py-2.5 text-center no-print">
                      {!item.lots?.length && <input type="checkbox" className="w-4 h-4 cursor-pointer" onClick={e => e.stopPropagation()} />}
                    </td>
                  </tr>
                  {isExpanded && hasProducts && (
                    <tr key={`${rowKey}-expand`} className="bg-indigo-50/60 border-b">
                      <td />
                      <td colSpan={6} className="px-3 py-2.5 pl-7">
                        <p className="text-xs font-semibold text-indigo-700 mb-1.5">ใช้ผลิต</p>
                        <div className="flex flex-wrap gap-2">
                          {item.for_products!.map((p, pi) => (
                            <div key={pi} className="flex items-center gap-1.5 bg-white border border-indigo-200 rounded-lg px-2.5 py-1">
                              <span className="text-xs font-mono text-gray-500">{p.sku}</span>
                              <span className="text-xs text-gray-700 font-medium">{p.sku_name ?? p.sku}</span>
                              <span className="text-xs font-bold text-indigo-600">{p.qty.toLocaleString()} กก.</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  {item.lots?.map((lot, li) => (
                    <tr key={`${item.sku}-lot-${li}`}
                      className={`border-b text-xs ${lot.insufficient ? 'bg-red-50' : 'bg-indigo-50/50'}`}>
                      <td />
                      <td className="px-3 py-1.5 pl-7 font-mono text-gray-500">└ {lot.spec_code}</td>
                      <td className="px-3 py-1.5 text-gray-500">
                        รร.{lot.factory} · ผลิต {lot.prod_date}
                        {!lot.insufficient && (
                          <span className="ml-2 text-gray-400">มี {lot.available.toLocaleString()} กก.</span>
                        )}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-bold ${lot.insufficient ? 'text-red-600' : 'text-indigo-700'}`}>
                        {lot.to_withdraw.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500">กก.</td>
                      <td className="px-3 py-1.5 text-gray-400">
                        {lot.insufficient ? '⚠ สต็อกไม่เพียงพอ' : ''}
                      </td>
                      <td className="px-3 py-1.5 text-center no-print">
                        {!lot.insufficient && <input type="checkbox" className="w-4 h-4 cursor-pointer" />}
                      </td>
                    </tr>
                  ))}
                </>
              )
            })}
            <tr className="bg-gray-50 font-semibold">
              <td colSpan={3} className="px-3 py-2.5 text-right text-gray-600">รวม</td>
              <td className="px-3 py-2.5 text-right text-gray-900">{stationTotal.toLocaleString()}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          .round-section { page-break-inside: avoid; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">รายการเบิกสินค้า</h1>
            <p className="text-gray-500 mt-1">คำนวณจากคำสั่งผลิต + BOM หรือดูรายการที่บันทึกไว้</p>
          </div>
          <button onClick={() => window.print()}
            className="no-print flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors text-sm">
            <Printer size={16} /> ดาวน์โหลด / พิมพ์ PDF
          </button>
        </div>

        {/* Phase tabs */}
        <div className="no-print flex gap-2">
          {(['1','2','3'] as const).map((ph) => {
            const c = PHASE_CONFIG[ph]
            const active = ph === phase
            return (
              <Link key={ph} href={`/withdrawal/${ph}`}
                className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                  active
                    ? `border-${c.color}-500 bg-${c.color}-50 text-${c.color}-700`
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}>
                Phase {ph}
              </Link>
            )
          })}
        </div>

        {/* Filter + action bar */}
        <div className={`no-print card border-l-4 ${borderCls} flex items-center gap-3 flex-wrap`}>
          <Calendar size={18} className="text-gray-400 shrink-0" />
          <label className="font-medium text-gray-700 whitespace-nowrap">วันที่</label>
          <input type="date" value={date} onChange={e => { setDate(e.target.value); setPreview(null) }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-300 rounded-lg">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> โหลดใหม่
          </button>
          <button onClick={calculate} disabled={calculating}
            className="flex items-center gap-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-1.5 rounded-lg transition-colors">
            <Zap size={14} className={calculating ? 'animate-pulse' : ''} />
            {calculating ? 'กำลังคำนวณ...' : 'คำนวณอัตโนมัติ'}
          </button>
          <span className={`ml-auto px-3 py-1 rounded-full text-sm font-semibold ${badgeCls}`}>
            {cfg.label} · {cfg.time}
          </span>
        </div>

        {calcMsg && (
          <div className="no-print bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <span className="font-medium">⚠</span> {calcMsg}
          </div>
        )}

        {preview && (
          <div className="no-print bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-semibold text-indigo-800">ผลการคำนวณ — {preview.length} รายการ</p>
              <p className="text-sm text-indigo-600 mt-0.5">ตรวจสอบแล้วกด "บันทึก" เพื่อบันทึกลงระบบ</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPreview(null)}
                className="flex items-center gap-1.5 text-sm text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg font-medium">
                <X size={14} /> ยกเลิก
              </button>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-5 py-2 rounded-lg transition-colors">
                <Save size={14} /> {saving ? 'กำลังบันทึก...' : 'บันทึกรายการ'}
              </button>
            </div>
          </div>
        )}

        {/* Print area */}
        <div id="print-area" ref={printRef}>
          <div className="hidden print:block mb-6">
            <div className="flex items-center justify-between border-b-2 border-gray-800 pb-3 mb-4">
              <div>
                <p className="text-xl font-bold">ใบเบิกสินค้า — {cfg.label}</p>
                <p className="text-sm text-gray-600 mt-0.5">วันที่ผลิต: {date} · เวลา: {cfg.time}</p>
              </div>
              <div className="text-right text-sm text-gray-600">
                <p>CP Foods Production System</p>
                <p>พิมพ์เมื่อ: {new Date().toLocaleString('th-TH')}</p>
              </div>
            </div>
          </div>

          {loading && (
            <div className="card text-center py-12 text-gray-400 no-print">
              <RefreshCw size={32} className="animate-spin mx-auto mb-3" />
              <p>กำลังโหลดข้อมูล...</p>
            </div>
          )}

          {!loading && displayItems.length === 0 && (
            <div className="card text-center py-12 no-print">
              <PackageOpen size={40} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 font-medium">ยังไม่มีรายการเบิกสินค้า</p>
              <p className="text-sm text-gray-400 mt-1">กด "คำนวณอัตโนมัติ" เพื่อสร้างรายการจากคำสั่งผลิต</p>
            </div>
          )}

          {!loading && displayItems.length > 0 && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-4 gap-4 no-print">
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">{displayItems.length}</p>
                  <p className="text-sm text-gray-500 mt-0.5">รายการ</p>
                </div>
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">
                    {Object.keys(displayItems.reduce<Record<string, boolean>>((a, i) => { a[i.work_station ?? '-'] = true; return a }, {})).length}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">Station</p>
                </div>
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">{rounds.length}</p>
                  <p className="text-sm text-gray-500 mt-0.5">รอบเบิก</p>
                </div>
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">{totalQty.toLocaleString()}</p>
                  <p className="text-sm text-gray-500 mt-0.5">รวม กก.</p>
                </div>
              </div>

              {/* Rounds */}
              {rounds.map((roundTime, roundIdx) => {
                const isCollapsed = collapsedRounds.has(roundTime)
                const roundDisplayItems = displayItems.map(item => getItemForRound(item, roundIdx, rounds.length))
                const roundTotal = roundDisplayItems.reduce((s, i) => s + i.quantity, 0)

                const grouped = displayItems.reduce<Record<string, RowItem[]>>((acc, item) => {
                  const key = item.work_station ?? 'ไม่ระบุ Station'
                  if (!acc[key]) acc[key] = []
                  acc[key].push(item)
                  return acc
                }, {})

                return (
                  <div key={roundTime} className="round-section border border-gray-200 rounded-xl overflow-hidden">
                    {/* Round header */}
                    <button
                      onClick={() => toggleRound(roundTime)}
                      className={`no-print w-full flex items-center justify-between px-5 py-3.5 ${roundHeaderCls} text-white`}>
                      <div className="flex items-center gap-3">
                        <Clock size={18} />
                        <span className="font-bold text-lg">รอบ {roundTime} น.</span>
                        <span className="text-sm opacity-80">
                          ({roundIdx + 1}/{rounds.length}) · {roundTotal.toLocaleString()} กก.
                        </span>
                      </div>
                      {isCollapsed
                        ? <ChevronRight size={20} className="opacity-80" />
                        : <ChevronDown size={20} className="opacity-80" />}
                    </button>

                    {/* Print-only round header */}
                    <div className={`hidden print:flex items-center gap-3 px-5 py-3 ${roundHeaderCls} text-white`}>
                      <Clock size={16} />
                      <span className="font-bold">รอบ {roundTime} น.</span>
                      <span className="text-sm opacity-80">· {roundTotal.toLocaleString()} กก.</span>
                    </div>

                    {!isCollapsed && (
                      <div className="p-4 space-y-0">
                        {Object.entries(grouped).map(([station, stationItems]) =>
                          renderStationTable(stationItems, roundIdx, station)
                        )}
                        <div className={`rounded-lg px-5 py-3 flex items-center justify-between text-white ${roundHeaderCls} opacity-90`}>
                          <span className="font-medium text-sm">รวมรอบ {roundTime} น.</span>
                          <span className="font-bold">{roundTotal.toLocaleString()} กก.</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Grand total */}
              <div className="card bg-gray-900 text-white flex items-center justify-between px-6 py-4">
                <span className="font-semibold">รวมทั้งหมด — {cfg.label} ({rounds.length} รอบ)</span>
                <span className="text-2xl font-bold">{totalQty.toLocaleString()} กก.</span>
              </div>

              {/* Signature area for print */}
              <div className="hidden print:grid grid-cols-3 gap-8 mt-8 pt-6 border-t border-gray-300">
                {['ผู้เบิก', 'ผู้จ่ายของ', 'ผู้อนุมัติ'].map(role => (
                  <div key={role} className="text-center">
                    <div className="border-b border-gray-400 mb-2 pb-8" />
                    <p className="text-sm text-gray-600">{role}</p>
                    <p className="text-xs text-gray-400 mt-1">วันที่ ............../............../..............  </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
