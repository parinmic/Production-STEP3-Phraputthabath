'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Calendar, Printer, RefreshCw, PackageOpen, Zap, Save, X } from 'lucide-react'

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

interface CalcItem {
  sku: string
  sku_name: string | null
  quantity: number
  unit: string
  work_station: string | null
  note: string | null
  lots?: LotInfo[]
}

type RowItem = CalcItem

const PHASE_CONFIG = {
  '1': { label: 'Phase 1 — รอบเช้า',  color: 'blue',   time: '08:00 น.' },
  '2': { label: 'Phase 2 — รอบบ่าย',  color: 'orange', time: '13:00 น.' },
  '3': { label: 'Phase 3 — แผน 100%', color: 'purple', time: '18:00 น.' },
} as const

const STATION_COLORS: Record<string, string> = {
  'สามชั้น': 'bg-blue-100 text-blue-700',
  'สะโพก':   'bg-orange-100 text-orange-700',
  'ไหล่':    'bg-green-100 text-green-700',
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
  const printRef = useRef<HTMLDivElement>(null)

  const cfg = PHASE_CONFIG[phase as keyof typeof PHASE_CONFIG] ?? PHASE_CONFIG['1']

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
      // flatten lots into individual rows (one row per lot)
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

  // Parse lot info from saved note: "Lot: [spec] | รร.[factory] | ผลิต [date]"
  function parseLotNote(note: string | null): { spec_code: string; factory: string; prod_date: string } | null {
    if (!note?.startsWith('Lot:')) return null
    const parts = note.split(' | ')
    return {
      spec_code: parts[0]?.replace('Lot:', '').trim() ?? note,
      factory:   parts[1]?.replace('รร.', '').trim() ?? '-',
      prod_date: parts[2]?.replace('ผลิต', '').trim() ?? '-',
    }
  }

  // Group saved items by (station, sku) and reconstruct lot sub-rows from notes
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
          const isInsufficient = item.note?.includes('ไม่เพียงพอ') ?? false
          return {
            spec_code:    p?.spec_code ?? item.note ?? '-',
            factory:      p?.factory   ?? '-',
            prod_date:    p?.prod_date ?? '-',
            available:    0,
            to_withdraw:  item.quantity,
            insufficient: isInsufficient,
          } satisfies LotInfo
        }),
      } as RowItem
    })
  }

  const displayItems: RowItem[] = preview ?? groupSaved(items)

  const grouped = displayItems.reduce<Record<string, RowItem[]>>((acc, item) => {
    const key = item.work_station ?? 'ไม่ระบุ Station'
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})

  const totalQty = displayItems.reduce((s, i) => s + i.quantity, 0)

  const borderCls = cfg.color === 'blue'   ? 'border-blue-500'
                  : cfg.color === 'orange' ? 'border-orange-500'
                  :                          'border-purple-500'
  const badgeCls  = cfg.color === 'blue'   ? 'bg-blue-100 text-blue-700'
                  : cfg.color === 'orange' ? 'bg-orange-100 text-orange-700'
                  :                          'bg-purple-100 text-purple-700'

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
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

          {/* Calculate button */}
          <button onClick={calculate} disabled={calculating}
            className="flex items-center gap-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-1.5 rounded-lg transition-colors">
            <Zap size={14} className={calculating ? 'animate-pulse' : ''} />
            {calculating ? 'กำลังคำนวณ...' : 'คำนวณอัตโนมัติ'}
          </button>

          <span className={`ml-auto px-3 py-1 rounded-full text-sm font-semibold ${badgeCls}`}>
            {cfg.label} · {cfg.time}
          </span>
        </div>

        {/* Calc error message */}
        {calcMsg && (
          <div className="no-print bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <span className="font-medium">⚠</span> {calcMsg}
          </div>
        )}

        {/* Preview banner */}
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
            <div className="space-y-6">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4 no-print">
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">{displayItems.length}</p>
                  <p className="text-sm text-gray-500 mt-0.5">รายการ</p>
                </div>
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">{Object.keys(grouped).length}</p>
                  <p className="text-sm text-gray-500 mt-0.5">Station</p>
                </div>
                <div className="card text-center">
                  <p className="text-2xl font-bold text-gray-900">{totalQty.toLocaleString()}</p>
                  <p className="text-sm text-gray-500 mt-0.5">รวม กก.</p>
                </div>
              </div>

              {/* Tables by station */}
              {Object.entries(grouped).map(([station, stationItems]) => (
                <div key={station} className="card">
                  <div className="flex items-center gap-3 mb-4">
                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${STATION_COLORS[station] ?? 'bg-gray-100 text-gray-700'}`}>
                      {station}
                    </span>
                    <span className="text-sm text-gray-500">
                      {stationItems.length} รายการ · รวม {stationItems.reduce((s, i) => s + i.quantity, 0).toLocaleString()} กก.
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
                      {stationItems.map((item, idx) => (
                        <>
                          <tr key={`${item.sku}-${idx}`} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                            <td className="px-3 py-2.5 font-mono text-gray-700">{item.sku}</td>
                            <td className="px-3 py-2.5 text-gray-800">{item.sku_name ?? '-'}</td>
                            <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{item.quantity.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-gray-600">{item.unit}</td>
                            <td className="px-3 py-2.5 text-gray-500 text-xs">{item.note ?? ''}</td>
                            <td className="px-3 py-2.5 text-center no-print">
                              {!item.lots?.length && <input type="checkbox" className="w-4 h-4 cursor-pointer" />}
                            </td>
                          </tr>
                          {item.lots?.map((lot, li) => (
                            <tr key={`${item.sku}-lot-${li}`}
                              className={`border-b text-xs ${lot.insufficient ? 'bg-red-50' : 'bg-indigo-50/50'}`}>
                              <td />
                              <td className="px-3 py-1.5 pl-7 font-mono text-gray-500">
                                └ {lot.spec_code}
                              </td>
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
                      ))}
                      <tr className="bg-gray-50 font-semibold">
                        <td colSpan={3} className="px-3 py-2.5 text-right text-gray-600">รวม</td>
                        <td className="px-3 py-2.5 text-right text-gray-900">
                          {stationItems.reduce((s, i) => s + i.quantity, 0).toLocaleString()}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}

              {/* Grand total */}
              <div className="card bg-gray-900 text-white flex items-center justify-between px-6 py-4">
                <span className="font-semibold">รวมทั้งหมด — {cfg.label}</span>
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
