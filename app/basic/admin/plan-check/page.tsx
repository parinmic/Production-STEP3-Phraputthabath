'use client'
import { Fragment, useState, useEffect, useCallback } from 'react'
import { Calendar, RefreshCw } from 'lucide-react'

const STATION_ORDER = ['สะโพกเบสิค', 'ไหล่เบสิค', 'สามชั้นเบสิค']

const STATION_COLORS: Record<string, string> = {
  'สะโพกเบสิค': 'bg-orange-100 text-orange-700',
  'ไหล่เบสิค': 'bg-green-100 text-green-700',
  'สามชั้นเบสิค': 'bg-blue-100 text-blue-700',
}

interface ChannelQty { wetMarket: number; lotus: number; makro: number }
interface ExtraQty { supplementary: number; raw: number }
interface ReasonNote { label: string; quantity: number }
interface ChannelNote { stockCovered: number; shortage: number; surplus: number; shortageReasons: ReasonNote[]; surplusReasons: ReasonNote[] }
interface ChannelNotes { wetMarket: ChannelNote; lotus: ChannelNote; makro: ChannelNote }
interface PlanCheckRow { station: string; sku: string; skuName: string | null; openingStockKg: number; plan100: ChannelQty; produced: ChannelQty; extra: ExtraQty; notes: ChannelNotes }

function fmt(n: number): string {
  return n > 0 ? n.toLocaleString('th-TH', { maximumFractionDigits: 0 }) : '—'
}

function sumChannel(rows: PlanCheckRow[], field: 'plan100' | 'produced'): ChannelQty {
  return rows.reduce((acc, r) => ({
    wetMarket: acc.wetMarket + r[field].wetMarket,
    lotus: acc.lotus + r[field].lotus,
    makro: acc.makro + r[field].makro,
  }), { wetMarket: 0, lotus: 0, makro: 0 })
}

function sumNotes(rows: PlanCheckRow[], channel: keyof ChannelNotes): ChannelNote {
  const shortageMap = new Map<string, number>()
  const surplusMap = new Map<string, number>()
  let stockCovered = 0
  let shortage = 0
  let surplus = 0
  const add = (map: Map<string, number>, notes: ReasonNote[]) => {
    for (const note of notes) map.set(note.label, (map.get(note.label) ?? 0) + note.quantity)
  }
  for (const r of rows) {
    const note = r.notes[channel]
    stockCovered += note.stockCovered
    shortage += note.shortage
    surplus += note.surplus
    add(shortageMap, note.shortageReasons ?? [])
    add(surplusMap, note.surplusReasons ?? [])
  }
  return {
    stockCovered,
    shortage,
    surplus,
    shortageReasons: Array.from(shortageMap.entries()).map(([label, quantity]) => ({ label, quantity })),
    surplusReasons: Array.from(surplusMap.entries()).map(([label, quantity]) => ({ label, quantity })),
  }
}

function PlanQtyCell({
  qty,
  note,
  supplementary = 0,
  raw = 0,
  total = false,
}: {
  qty: number
  note: ChannelNote
  supplementary?: number
  raw?: number
  total?: boolean
}) {
  return (
    <>
      <span className={total ? 'font-bold text-emerald-700' : 'font-semibold text-emerald-700'}>{fmt(qty)}</span>
      {note.stockCovered > 0 && (
        <span className="block text-[11px] text-sky-600">(มีสต็อกยกมา {fmt(note.stockCovered)})</span>
      )}
      {(note.surplusReasons ?? []).map((reason, idx) => (
        <span key={`surplus-${idx}`} className="block text-[11px] text-amber-600">(+{fmt(reason.quantity)} {reason.label})</span>
      ))}
      {supplementary > 0 && (
        <span className="block text-[11px] text-amber-600">(+{fmt(supplementary)} เสริม)</span>
      )}
      {raw > 0 && (
        <span className="block text-[11px] text-indigo-600">(+{fmt(raw)} ชดเชย Yield)</span>
      )}
      {(note.shortageReasons ?? []).map((reason, idx) => (
        <span key={`shortage-${idx}`} className="block text-[11px] text-red-600">(ขาด {fmt(reason.quantity)} {reason.label})</span>
      ))}
    </>
  )
}

export default function BasicPlanCheckPage() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [date, setDate] = useState(today)
  const [rows, setRows] = useState<PlanCheckRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/basic/admin/plan-check?date=${date}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setRows(data.rows ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])

  const grouped = STATION_ORDER
    .map(station => ({ station, items: rows.filter(r => r.station === station) }))
    .filter(g => g.items.length > 0)

  const grandPlan100 = sumChannel(rows, 'plan100')
  const grandProduced = sumChannel(rows, 'produced')
  const grandExtraSupp = rows.reduce((s, r) => s + r.extra.supplementary, 0)
  const grandExtraRaw = rows.reduce((s, r) => s + r.extra.raw, 0)
  const grandWetNotes = sumNotes(rows, 'wetMarket')
  const grandLotusNotes = sumNotes(rows, 'lotus')
  const grandMakroNotes = sumNotes(rows, 'makro')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ตรวจสอบแผนผลิต</h1>
        <p className="text-gray-500 mt-1 text-sm">
          เทียบแผน 100% (ออเดอร์ที่อัพโหลด — Makro รอบ 14:00 / LOTUS และ Wet Market จากแผนผลิต 100%) กับแผนผลิตจริง แยกตามสายพานและ SKU
          วงเล็บใต้แผนผลิตอ่านจากเหตุผลที่บันทึกในแผน และแสดงยอดขาดหลังหักสต็อกแล้ว
        </p>
      </div>

      <div className="card flex flex-wrap items-center gap-4">
        <Calendar size={20} className="text-blue-500 shrink-0" />
        <label className="font-medium text-gray-700 whitespace-nowrap">วันที่ผลิต</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          รีโหลด
        </button>
        {rows.length > 0 && (
          <span className="text-sm text-gray-500 sm:ml-auto">{rows.length} รายการ</span>
        )}
      </div>

      {loading && (
        <div className="card text-center py-12 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังโหลด...</p>
        </div>
      )}

      {!loading && error && (
        <div className="card text-center py-12 text-red-500">{error}</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="card text-center py-12 text-gray-400">ไม่พบข้อมูลแผนสำหรับวันที่เลือก</div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="border border-gray-200 rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm bg-white min-w-[820px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th rowSpan={2} className="px-4 py-2 text-left font-semibold text-gray-700 align-bottom">สายพาน</th>
                <th rowSpan={2} className="px-4 py-2 text-left font-semibold text-gray-700 align-bottom">SKU</th>
                <th rowSpan={2} className="px-3 py-2 text-right font-semibold text-gray-700 align-bottom border-l border-gray-200">ปริมาณ สต็อกยกมา</th>
                <th colSpan={3} className="px-4 py-2 text-center font-semibold text-gray-700 border-l border-gray-200">แผน 100%</th>
                <th colSpan={3} className="px-4 py-2 text-center font-semibold text-gray-700 border-l border-gray-200">แผนผลิต</th>
              </tr>
              <tr className="text-xs text-gray-500">
                <th className="px-3 py-1.5 text-right font-medium border-l border-gray-200">Wet Market</th>
                <th className="px-3 py-1.5 text-right font-medium">LOTUS</th>
                <th className="px-3 py-1.5 text-right font-medium">Makro</th>
                <th className="px-3 py-1.5 text-right font-medium border-l border-gray-200">Wet Market</th>
                <th className="px-3 py-1.5 text-right font-medium">LOTUS</th>
                <th className="px-3 py-1.5 text-right font-medium">Makro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {grouped.map(({ station, items }) => (
                <Fragment key={station}>
                  <tr className="bg-slate-100/70">
                    <td colSpan={9} className="px-4 py-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATION_COLORS[station] ?? 'bg-gray-100 text-gray-700'}`}>
                        {station}
                      </span>
                    </td>
                  </tr>
                  {items.map((r, i) => (
                    <tr key={`${station}-${r.sku}-${i}`} className="hover:bg-gray-50">
                      <td />
                      <td className="px-4 py-2.5 text-gray-800">
                        <span className="font-medium">{r.skuName ?? r.sku}</span>
                        <span className="block text-xs text-gray-400 font-mono">{r.sku}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-700 border-l border-gray-200">{fmt(r.openingStockKg)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700 border-l border-gray-100">{fmt(r.plan100.wetMarket)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{fmt(r.plan100.lotus)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{fmt(r.plan100.makro)}</td>
                      <td className="px-3 py-2.5 text-right border-l border-gray-100">
                        <PlanQtyCell qty={r.produced.wetMarket} note={r.notes.wetMarket} supplementary={r.extra.supplementary} raw={r.extra.raw} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <PlanQtyCell qty={r.produced.lotus} note={r.notes.lotus} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <PlanQtyCell qty={r.produced.makro} note={r.notes.makro} />
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-right font-semibold text-gray-700">รวมทั้งหมด</td>
                <td className="px-3 py-3 text-right font-bold text-gray-900 border-l border-gray-200">{fmt(grandPlan100.wetMarket)}</td>
                <td className="px-3 py-3 text-right font-bold text-gray-900">{fmt(grandPlan100.lotus)}</td>
                <td className="px-3 py-3 text-right font-bold text-gray-900">{fmt(grandPlan100.makro)}</td>
                <td className="px-3 py-3 text-right border-l border-gray-200">
                  <PlanQtyCell qty={grandProduced.wetMarket} note={grandWetNotes} supplementary={grandExtraSupp} raw={grandExtraRaw} total />
                </td>
                <td className="px-3 py-3 text-right">
                  <PlanQtyCell qty={grandProduced.lotus} note={grandLotusNotes} total />
                </td>
                <td className="px-3 py-3 text-right">
                  <PlanQtyCell qty={grandProduced.makro} note={grandMakroNotes} total />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
