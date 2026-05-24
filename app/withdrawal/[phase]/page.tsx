'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Calendar, Printer, RefreshCw, PackageOpen, Zap, Save, X, ChevronDown, ChevronRight, Clock } from 'lucide-react'
import { downloadWithdrawalPDF } from '@/lib/withdrawal-pdf'

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
  withdrawal_round?: string  // "08:00"
}

type RowItem = CalcItem

type PopupItem = { item: RowItem; station: string; roundTime: string } | null

const PHASE_CONFIG = {
  '1': { label: 'Phase 1 — รอบเช้า',  color: 'blue',   time: '08:30 น.' },
  '2': { label: 'Phase 2 — รอบบ่าย',  color: 'orange', time: '14:30 น.' },
  '3': { label: 'Phase 3 — แผน 100%', color: 'purple', time: '16:30 น.' },
} as const

const PHASE_ROUNDS: Record<string, string[]> = {
  '1': ['08:30', '10:00', '13:00'],
  '2': ['14:30'],
  '3': ['16:30', '18:00', '20:00'],
}

const STATION_COLORS: Record<string, string> = {
  'สามชั้น': 'bg-blue-100 text-blue-700',
  'สะโพก':   'bg-orange-100 text-orange-700',
  'ไหล่':    'bg-green-100 text-green-700',
}

const STATION_DISPLAY: Record<string, string> = {
  'สามชั้น': 'สามชั้นพิเศษ',
  'สะโพก':   'สะโพกพิเศษ',
  'ไหล่':    'ไหล่พิเศษ',
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
  const [printModal, setPrintModal]       = useState(false)
  const [printDate, setPrintDate]         = useState(today)
  const [printRoundSel, setPrintRoundSel] = useState<Set<string>>(new Set())
  const [downloading, setDownloading]     = useState(false)
  const [basketMap, setBasketMap]         = useState<Map<string, number>>(new Map())
  const [popupItem, setPopupItem]         = useState<PopupItem>(null)
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

  useEffect(() => {
    fetch('/api/master-trakra')
      .then(r => r.json())
      .then((data: { sku: string; rate: number }[]) => {
        const map = new Map<string, number>()
        for (const d of data) map.set(d.sku, d.rate)
        setBasketMap(map)
      })
      .catch(() => {/* silent — ถ้าไม่มีข้อมูลก็ไม่แสดงตะกร้า */})
  }, [])

  const openPrintModal = () => {
    setPrintDate(date)
    setPrintRoundSel(new Set(rounds))
    setPrintModal(true)
  }

  const confirmPrint = async () => {
    setPrintModal(false)
    setDownloading(true)
    try {
      const filteredItems = displayItems.filter(item => {
        const r = (item as CalcItem).withdrawal_round
        return r ? printRoundSel.has(r) : true
      })
      await downloadWithdrawalPDF({
        date: printDate,
        phase,
        rounds: Array.from(printRoundSel),
        items: filteredItems,
        cfg: { label: cfg.label, time: cfg.time, color: cfg.color },
        basketMap,
      })
    } catch {
      alert('เกิดข้อผิดพลาดในการสร้าง PDF')
    } finally {
      setDownloading(false)
    }
  }

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
        const fpTag = encodeFPTag(item.for_products ?? [])
        const roundPrefix = item.withdrawal_round ? `[Round: ${item.withdrawal_round}] ` : ''
        if (!item.lots?.length) return [
          {
            sku:          item.sku,
            sku_name:     item.sku_name,
            quantity:     item.quantity,
            unit:         item.unit,
            work_station: item.work_station,
            note:         `${roundPrefix}${fpTag}${item.note ?? ''}`,
          }
        ]
        return item.lots.map(lot => ({
          sku:          item.sku,
          sku_name:     item.sku_name,
          quantity:     lot.to_withdraw,
          unit:         item.unit,
          work_station: item.work_station,
          note: lot.insufficient
            ? `${roundPrefix}${fpTag}ไม่เพียงพอในสต็อก (ขาด ${lot.to_withdraw} กก.)`
            : `${roundPrefix}${fpTag}Lot: ${lot.spec_code} | รร.${lot.factory} | ผลิต ${lot.prod_date}`,
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

  function getBaskets(sku: string, qty: number): number | null {
    const rate = basketMap.get(String(sku).replace(/^0+/, '').trim())
    if (!rate || rate <= 0) return null
    return Math.ceil(qty / rate)
  }

  function roundTo5Or0(qty: number): number {
    if (qty <= 0) return 0
    const rounded = Math.round(qty / 5) * 5
    return rounded === 0 ? 5 : rounded
  }

  // ถ้ามี lots ให้ sum ceil ต่อ lot แทน ceil ของ total (เพื่อให้ sub-rows + = หัว)
  function getTotalBaskets(item: RowItem): number | null {
    if (!item.lots?.length) return getBaskets(item.sku, item.quantity)
    const byDate = new Map<string, number>()
    for (const lot of item.lots) {
      if (lot.insufficient) continue
      byDate.set(lot.prod_date, (byDate.get(lot.prod_date) ?? 0) + lot.to_withdraw)
    }
    if (!byDate.size) return null
    let total = 0
    for (const qty of Array.from(byDate.values())) {
      const b = getBaskets(item.sku, qty)
      if (b == null) return null
      total += b
    }
    return total
  }

  function encodeFPTag(products: ForProduct[]): string {
    if (!products.length) return ''
    const s = products
      .map(p => `${p.sku}~${(p.sku_name ?? '').replace(/[|~[\]]/g, ' ')}~${p.qty}`)
      .join('|')
    return `[FP:${s}] `
  }

  function parseFPFromNote(note: string | null): ForProduct[] {
    if (!note) return []
    const m = note.match(/\[FP:([^\]]*)\]/)
    if (!m?.[1]) return []
    return m[1].split('|').filter(Boolean).map(entry => {
      const parts = entry.split('~')
      return { sku: parts[0] ?? '', sku_name: parts[1] || null, qty: parseFloat(parts[2] ?? '0') }
    })
  }

  function parseRoundFromNote(note: string | null): { round: string | null; cleanNote: string | null } {
    if (!note) return { round: null, cleanNote: null }
    let rest = note
    let round: string | null = null
    const roundM = rest.match(/^\[Round:\s*([^\]]+)\]\s*/)
    if (roundM) { round = roundM[1].trim(); rest = rest.slice(roundM[0].length) }
    // strip FP tag so it doesn't appear as visible note text
    const fpM = rest.match(/^\[FP:[^\]]*\]\s*/)
    if (fpM) rest = rest.slice(fpM[0].length)
    return { round, cleanNote: rest.trim() || null }
  }

  function groupSaved(raw: WithdrawalItem[]): RowItem[] {
    const map = new Map<string, { round: string | null; items: WithdrawalItem[] }>()
    for (const item of raw) {
      const { round } = parseRoundFromNote(item.note)
      const k = `${item.work_station ?? ''}|||${item.sku}|||${round ?? ''}`
      const entry = map.get(k) ?? { round, items: [] }
      entry.items.push(item)
      map.set(k, entry)
    }
    return Array.from(map.values()).map(({ round, items: group }) => {
      const first = group[0]
      // reconstruct for_products from any note that has the FP tag
      const forProducts = group.map(i => parseFPFromNote(i.note)).find(fp => fp.length > 0) ?? []
      const cleanedGroup = group.map(i => {
        const { cleanNote } = parseRoundFromNote(i.note)
        return { ...i, note: cleanNote }
      })
      const hasLot = cleanedGroup.some(i => parseLotNote(i.note) !== null || i.note?.includes('ไม่เพียงพอ'))
      if (!hasLot) {
        return {
          sku:          first.sku,
          sku_name:     first.sku_name,
          quantity:     cleanedGroup.reduce((s, i) => s + i.quantity, 0),
          unit:         first.unit,
          work_station: first.work_station,
          note:         cleanedGroup[0]?.note ?? null,
          withdrawal_round: round ?? undefined,
          for_products: forProducts.length ? forProducts : undefined,
        } as RowItem
      }
      return {
        sku:          first.sku,
        sku_name:     first.sku_name,
        quantity:     cleanedGroup.reduce((s, i) => s + i.quantity, 0),
        unit:         first.unit,
        work_station: first.work_station,
        note:         'คำนวณจาก BOM',
        withdrawal_round: round ?? undefined,
        for_products: forProducts.length ? forProducts : undefined,
        lots: cleanedGroup.map(item => {
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
  const totalQty = displayItems.reduce((s, i) => s + roundTo5Or0(i.quantity), 0)

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

  function renderStationTable(roundItems: RowItem[], roundTime: string, station: string) {
    const stationTotal = roundItems.reduce((s, i) => s + roundTo5Or0(i.quantity), 0)

    return (
      <div key={`${station}-${roundTime}`} className="card mb-4">
        <div className="flex items-center gap-3 mb-4">
          <span className={`px-3 py-1 rounded-full text-sm font-semibold ${STATION_COLORS[station] ?? 'bg-gray-100 text-gray-700'}`}>
            {STATION_DISPLAY[station] ?? station}
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
              <th className="px-3 py-2.5 text-right text-gray-600 font-medium">ตะกร้า</th>
            </tr>
          </thead>
          <tbody>
            {roundItems.map((item, idx) => {
              const rowKey = `${station}|||${item.sku}|||${roundTime}|||${idx}`
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
                    <td className="px-2 py-1.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setPopupItem({ item, station, roundTime }) }}
                        className="font-bold text-gray-900 bg-gray-100 active:bg-blue-100 hover:bg-blue-50 rounded-xl px-3 py-2 min-w-[56px] w-full touch-manipulation transition-colors text-right">
                        {roundTo5Or0(item.quantity).toLocaleString()}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{item.unit}</td>
                    <td className="px-3 py-2.5 text-right text-orange-600 font-medium">
                      {getTotalBaskets(item) != null
                        ? `${getTotalBaskets(item)} ตะกร้า`
                        : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                  {isExpanded && hasProducts && (
                    <tr key={`${rowKey}-expand`} className="bg-indigo-50/60 border-b">
                      <td />
                      <td colSpan={5} className="px-3 py-2.5 pl-7">
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
                  {item.lots && item.lots.length > 0 && (() => {
                    // Group by prod_date, sum to_withdraw
                    const byDate = new Map<string, { qty: number; insufficient: boolean }>()
                    for (const lot of item.lots!) {
                      const key = lot.insufficient ? '⚠ ไม่เพียงพอ' : lot.prod_date
                      const cur = byDate.get(key) ?? { qty: 0, insufficient: lot.insufficient ?? false }
                      cur.qty += lot.to_withdraw
                      byDate.set(key, cur)
                    }
                    return Array.from(byDate.entries()).map(([date, { qty, insufficient }]) => (
                      <tr key={`${item.sku}-date-${date}`}
                        className={`border-b text-xs ${insufficient ? 'bg-red-50' : 'bg-blue-50/40'}`}>
                        <td />
                        <td className="px-3 py-1.5 text-gray-500">
                          {insufficient
                            ? <span className="text-red-500 font-medium">⚠ สต็อกไม่เพียงพอ</span>
                            : <span>ผลิต <span className="font-medium">{date}</span></span>}
                        </td>
                        <td />
                        <td className={`px-3 py-1.5 text-right font-semibold ${insufficient ? 'text-red-600' : 'text-blue-700'}`}>
                          {roundTo5Or0(qty).toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">กก.</td>
                        <td className="px-3 py-1.5 text-right text-orange-500 text-xs">
                          {!insufficient && getBaskets(item.sku, qty) != null
                            ? `${getBaskets(item.sku, qty)} ตะกร้า`
                            : ''}
                        </td>
                      </tr>
                    ))
                  })()}
                </>
              )
            })}
            <tr className="bg-gray-50 font-semibold">
              <td colSpan={3} className="px-3 py-2.5 text-right text-gray-600">รวม</td>
              <td className="px-3 py-2.5 text-right text-gray-900">{stationTotal.toLocaleString()}</td>
              <td colSpan={2} />
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
          @page { size: A4; margin: 15mm; margin-top: 5mm; margin-bottom: 5mm; }
        }
        /* suppress browser-injected header/footer (date, title, URL) */
        @page { margin-top: 5mm; margin-bottom: 5mm; }
      `}</style>

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">รายการเบิกสินค้า</h1>
            <p className="text-gray-500 mt-1">คำนวณจากคำสั่งผลิต + BOM หรือดูรายการที่บันทึกไว้</p>
          </div>
          <button onClick={openPrintModal}
            className="no-print flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors text-sm">
            <Printer size={16} /> ดาวน์โหลด / พิมพ์ PDF
          </button>
        </div>

        {/* Phase tabs + date + calculate */}
        <div className="no-print flex items-center gap-2 flex-wrap">
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
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <Calendar size={16} className="text-gray-400 shrink-0" />
          <input type="date" value={date} onChange={e => { setDate(e.target.value); setPreview(null) }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={calculate} disabled={calculating}
            className="flex items-center gap-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors">
            <Zap size={14} className={calculating ? 'animate-pulse' : ''} />
            {calculating ? 'กำลังคำนวณ...' : 'คำนวณอัตโนมัติ'}
          </button>
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
              {/* Rounds */}
              {rounds.map((roundTime, roundIdx) => {
                const isCollapsed = collapsedRounds.has(roundTime)
                // preview: filter by withdrawal_round; saved items (no round): put all in first round
                const roundDisplayItems = displayItems.filter(item => {
                  const r = (item as CalcItem).withdrawal_round
                  return r ? r === roundTime : roundIdx === 0
                })
                const roundTotal = roundDisplayItems.reduce((s, i) => s + roundTo5Or0(i.quantity), 0)

                const grouped = roundDisplayItems.reduce<Record<string, RowItem[]>>((acc, item) => {
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
                          renderStationTable(stationItems, roundTime, station)
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
              <div className="no-print card bg-gray-900 text-white flex items-center justify-between px-6 py-4">
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

      {/* Item detail bottom-sheet popup */}
      {popupItem && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={() => setPopupItem(null)}>
          <div className="bg-white rounded-t-2xl w-full max-w-lg shadow-2xl max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-gray-300 rounded-full" />
            </div>

            {/* Header */}
            <div className="px-5 pt-2 pb-4 border-b border-gray-100">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATION_COLORS[popupItem.station] ?? 'bg-gray-100 text-gray-700'}`}>
                      {STATION_DISPLAY[popupItem.station] ?? popupItem.station}
                    </span>
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Clock size={11} /> รอบ {popupItem.roundTime} น.
                    </span>
                  </div>
                  <p className="font-mono text-xs text-gray-400 mb-0.5">{popupItem.item.sku}</p>
                  <p className="font-bold text-gray-900 text-base leading-snug">{popupItem.item.sku_name ?? '-'}</p>
                </div>
                <button onClick={() => setPopupItem(null)}
                  className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors shrink-0 mt-0.5">
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Main quantity cards */}
            <div className="px-5 py-4 flex gap-3">
              <div className="flex-1 bg-blue-50 rounded-2xl px-4 py-4 text-center">
                <p className="text-xs text-blue-500 font-medium mb-1">จำนวนรวม</p>
                <p className="text-3xl font-bold text-blue-700 leading-none">
                  {roundTo5Or0(popupItem.item.quantity).toLocaleString()}
                </p>
                <p className="text-sm text-blue-400 mt-1">{popupItem.item.unit}</p>
              </div>
              {getTotalBaskets(popupItem.item) != null && (
                <div className="flex-1 bg-orange-50 rounded-2xl px-4 py-4 text-center">
                  <p className="text-xs text-orange-500 font-medium mb-1">จำนวนตะกร้า</p>
                  <p className="text-3xl font-bold text-orange-600 leading-none">
                    {getTotalBaskets(popupItem.item)}
                  </p>
                  <p className="text-sm text-orange-400 mt-1">ตะกร้า</p>
                </div>
              )}
            </div>

            {/* For products */}
            {(popupItem.item.for_products?.length ?? 0) > 0 && (
              <div className="px-5 pb-4">
                <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-2.5">ใช้ผลิตสินค้า</p>
                <div className="space-y-2">
                  {popupItem.item.for_products!.map((p, pi) => (
                    <div key={pi} className="flex items-center justify-between bg-indigo-50 rounded-xl px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-xs font-mono text-gray-400">{p.sku}</p>
                        <p className="text-sm font-semibold text-gray-800 leading-snug">{p.sku_name ?? p.sku}</p>
                      </div>
                      <span className="text-base font-bold text-indigo-600 shrink-0 ml-3">
                        {p.qty.toLocaleString()} กก.
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lot breakdown */}
            {(popupItem.item.lots?.length ?? 0) > 0 && (
              <div className="px-5 pb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2.5">แบ่งตาม Lot</p>
                <div className="space-y-2">
                  {(() => {
                    const byDate = new Map<string, { qty: number; insufficient: boolean }>()
                    for (const lot of popupItem.item.lots!) {
                      const key = lot.insufficient ? '⚠ ไม่เพียงพอ' : lot.prod_date
                      const cur = byDate.get(key) ?? { qty: 0, insufficient: lot.insufficient ?? false }
                      cur.qty += lot.to_withdraw
                      byDate.set(key, cur)
                    }
                    return Array.from(byDate.entries()).map(([d, { qty, insufficient }]) => (
                      <div key={d} className={`flex items-center justify-between rounded-xl px-4 py-3 ${insufficient ? 'bg-red-50' : 'bg-blue-50'}`}>
                        <div className="flex items-center gap-2">
                          {insufficient ? (
                            <span className="text-red-500 text-sm font-semibold">⚠ สต็อกไม่เพียงพอ</span>
                          ) : (
                            <>
                              <span className="text-xs text-gray-400">ผลิต</span>
                              <span className="text-sm font-semibold text-gray-800">{d}</span>
                            </>
                          )}
                        </div>
                        <div className="text-right">
                          <p className={`text-base font-bold ${insufficient ? 'text-red-600' : 'text-blue-700'}`}>
                            {roundTo5Or0(qty).toLocaleString()} กก.
                          </p>
                          {!insufficient && getBaskets(popupItem.item.sku, qty) != null && (
                            <p className="text-xs text-orange-500 mt-0.5">{getBaskets(popupItem.item.sku, qty)} ตะกร้า</p>
                          )}
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              </div>
            )}

            {/* Note */}
            {popupItem.item.note && (
              <div className="px-5 pb-5">
                <p className="text-xs text-gray-400">หมายเหตุ: {popupItem.item.note}</p>
              </div>
            )}

            {/* Safe area spacer for iOS */}
            <div className="pb-safe h-6" />
          </div>
        </div>
      )}

      {/* Print modal */}
      {printModal && (
        <div className="no-print fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80">
            <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Printer size={16} /> ตั้งค่าก่อนพิมพ์
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">วันที่ผลิต</label>
                <input type="date" value={printDate}
                  onChange={e => setPrintDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">รอบเวลา</label>
                <div className="space-y-2">
                  {rounds.map(r => (
                    <label key={r} className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                      <input type="checkbox"
                        checked={printRoundSel.has(r)}
                        onChange={e => {
                          const next = new Set(printRoundSel)
                          if (e.target.checked) next.add(r); else next.delete(r)
                          setPrintRoundSel(next)
                        }}
                        className="w-4 h-4 rounded" />
                      รอบ {r} น.
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setPrintModal(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors">
                ยกเลิก
              </button>
              <button onClick={confirmPrint} disabled={printRoundSel.size === 0 || downloading}
                className="px-4 py-2 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium flex items-center gap-2 transition-colors disabled:opacity-40">
                {downloading
                  ? <><RefreshCw size={14} className="animate-spin" /> กำลังสร้าง PDF...</>
                  : <><Printer size={14} /> สร้าง PDF</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
