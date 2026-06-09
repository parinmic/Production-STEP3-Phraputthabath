'use client'
import { useState, useEffect, useCallback } from 'react'
import { BarChart3, Calendar, RefreshCw, Download } from 'lucide-react'
import * as XLSX from 'xlsx'

const STATION_ORDER = ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์']
const STATION_COLORS: Record<string, string> = {
  'สามชั้น': 'bg-blue-100 text-blue-700',
  'สะโพก':   'bg-orange-100 text-orange-700',
  'ไหล่':    'bg-green-100 text-green-700',
  'หมูบด':   'bg-red-100 text-red-700',
  'สไลด์':   'bg-purple-100 text-purple-700',
}
const FILTER_STATIONS = ['ทั้งหมด', ...STATION_ORDER]

interface DashRow {
  station:    string
  sku:        string
  sku_name:   string
  order_qty:  number
  baseline:   number
  ph1:        number
  ph2:        number
  ph3:        number
  total_prod: number
  yield_bags: number
  yield_kg:   number | null
}

function fmt(n: number): string {
  if (n === 0) return '—'
  return n.toLocaleString('th-TH', { maximumFractionDigits: 1 })
}

// When "ทั้งหมด" is selected, collapse rows to one per SKU so Order/Baseline aren't counted twice
// Sort by station (STATION_ORDER) then by sku_name within each station
function aggregateBysku(rows: DashRow[]): DashRow[] {
  const map      = new Map<string, DashRow>()
  const skuPrimStation = new Map<string, string>() // sku → primary station (first in STATION_ORDER)
  for (const r of rows) {
    const cur = map.get(r.sku)
    if (!cur) {
      map.set(r.sku, { ...r, station: '' })
    } else {
      cur.ph1        += r.ph1
      cur.ph2        += r.ph2
      cur.ph3        += r.ph3
      cur.total_prod += r.total_prod
    }
    const prev = skuPrimStation.get(r.sku)
    if (!prev || STATION_ORDER.indexOf(r.station) < STATION_ORDER.indexOf(prev))
      skuPrimStation.set(r.sku, r.station)
  }
  return Array.from(map.values()).sort((a, b) => {
    const stA = STATION_ORDER.indexOf(skuPrimStation.get(a.sku) ?? '')
    const stB = STATION_ORDER.indexOf(skuPrimStation.get(b.sku) ?? '')
    if (stA !== stB) return stA - stB
    return a.sku_name.localeCompare(b.sku_name, 'th')
  })
}

export default function ExecutiveDashboardPage() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [date,    setDate]    = useState(today)
  const [station, setStation] = useState('ทั้งหมด')
  const [rows,    setRows]    = useState<DashRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/executive-dashboard?date=${date}`)
      const { rows: data } = await res.json()
      setRows(data ?? [])
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])

  const displayed: DashRow[] = station === 'ทั้งหมด'
    ? aggregateBysku(rows)
    : rows.filter(r => r.station === station)

  // Footer totals
  const totals = displayed.reduce(
    (acc, r) => ({
      order_qty:  acc.order_qty  + r.order_qty,
      baseline:   acc.baseline   + r.baseline,
      ph1:        acc.ph1        + r.ph1,
      ph2:        acc.ph2        + r.ph2,
      ph3:        acc.ph3        + r.ph3,
      total_prod: acc.total_prod + r.total_prod,
      yield_kg:   acc.yield_kg   + (r.yield_kg ?? 0),
    }),
    { order_qty: 0, baseline: 0, ph1: 0, ph2: 0, ph3: 0, total_prod: 0, yield_kg: 0 }
  )

  const exportExcel = () => {
    const headers = [
      ...(station === 'ทั้งหมด' ? ['Station'] : []),
      'ชื่อสินค้า', 'Order (กก.)', 'Baseline avg 3 วัน (กก.)',
      'Phase 1 (กก.)', 'Phase 2 (กก.)', 'Phase 3 (กก.)',
      'รวมผลิต (กก.)', 'รับผลได้ (กก.)',
    ]
    const dataRows = displayed.map(r => [
      ...(station === 'ทั้งหมด'
        ? [rows.filter(rr => rr.sku === r.sku).map(rr => rr.station).join(', ')]
        : []),
      r.sku_name,
      r.order_qty || '',
      r.baseline  || '',
      r.ph1       || '',
      r.ph2       || '',
      r.ph3       || '',
      r.total_prod || '',
      r.yield_kg ?? '',
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Dashboard')
    XLSX.writeFile(wb, `dashboard-${date}.xlsx`)
  }

  const dateDisplay = new Date(date + 'T00:00:00').toLocaleDateString('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard บริหาร</h1>
        <p className="text-gray-500 mt-1">ภาพรวมการผลิตรายวัน — Order · Baseline · แผนผลิต · รับผลได้</p>
      </div>

      {/* ── Filters ── */}
      <div className="card flex flex-wrap items-center gap-4">
        <Calendar size={20} className="text-blue-500 shrink-0" />
        <label className="font-medium text-gray-700 whitespace-nowrap">วันที่ผลิต</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="flex gap-1.5 flex-wrap">
          {FILTER_STATIONS.map(s => (
            <button
              key={s}
              onClick={() => setStation(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                station === s
                  ? 'bg-blue-600 text-white'
                  : s === 'ทั้งหมด'
                    ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    : `${STATION_COLORS[s]} opacity-70 hover:opacity-100`
              }`}
            >
              {s === 'ทั้งหมด' ? 'ทั้งหมด' : `Station ${s}`}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            รีโหลด
          </button>
          <button
            onClick={exportExcel}
            disabled={displayed.length === 0}
            className="flex items-center gap-2 text-green-700 border border-green-300 bg-green-50 hover:bg-green-100 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Download size={14} />
            Export Excel
          </button>
        </div>

        {displayed.length > 0 && !loading && (
          <span className="text-sm text-gray-400 whitespace-nowrap">
            {displayed.length} รายการ · {dateDisplay}
          </span>
        )}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="card text-center py-14 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังโหลดข้อมูล...</p>
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && displayed.length === 0 && (
        <div className="card text-center py-14 text-gray-400">
          <BarChart3 size={36} className="mx-auto mb-3 opacity-30" />
          <p>ไม่พบข้อมูลแผนผลิตสำหรับวันที่เลือก</p>
        </div>
      )}

      {/* ── Table ── */}
      {!loading && displayed.length > 0 && (
        <div className="border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs">
                <tr>
                  {station === 'ทั้งหมด' && (
                    <th className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap">Station</th>
                  )}
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">ชื่อสินค้า</th>
                  <th className="px-4 py-3 text-right font-semibold text-blue-700 whitespace-nowrap">
                    <div>Order</div>
                    <div className="font-normal text-blue-400">(กก.)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-purple-700 whitespace-nowrap">
                    <div>Baseline</div>
                    <div className="font-normal text-purple-400">avg 3 วัน (กก.)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-sky-700 whitespace-nowrap">
                    <div>Phase 1</div>
                    <div className="font-normal text-sky-400">(กก.)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-amber-700 whitespace-nowrap">
                    <div>Phase 2</div>
                    <div className="font-normal text-amber-400">(กก.)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-violet-700 whitespace-nowrap">
                    <div>Phase 3</div>
                    <div className="font-normal text-violet-400">(กก.)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-emerald-700 whitespace-nowrap">
                    <div>รวมผลิต</div>
                    <div className="font-normal text-emerald-400">(กก.)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-orange-700 whitespace-nowrap">
                    <div>รับผลได้</div>
                    <div className="font-normal text-orange-400">(กก.)</div>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-500 whitespace-nowrap">หมายเหตุ</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {displayed.map((r, i) => (
                  <tr key={`${r.station}-${r.sku}-${i}`} className="hover:bg-gray-50 transition-colors">
                    {station === 'ทั้งหมด' && (
                      <td className="px-4 py-2.5">
                        {/* Show all station badges for this SKU when "ทั้งหมด" */}
                        <div className="flex flex-wrap gap-1">
                          {rows.filter(rr => rr.sku === r.sku).map(rr => (
                            <span key={rr.station} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATION_COLORS[rr.station] ?? 'bg-gray-100 text-gray-600'}`}>
                              {rr.station}
                            </span>
                          ))}
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-gray-800 font-medium">{r.sku_name}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-blue-700">{fmt(r.order_qty)}</td>
                    <td className="px-4 py-2.5 text-right text-purple-700">{fmt(r.baseline)}</td>
                    <td className="px-4 py-2.5 text-right text-sky-700">{fmt(r.ph1)}</td>
                    <td className="px-4 py-2.5 text-right text-amber-700">{fmt(r.ph2)}</td>
                    <td className="px-4 py-2.5 text-right text-violet-700">{fmt(r.ph3)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">{fmt(r.total_prod)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-orange-700">
                      {r.yield_kg != null && r.yield_kg > 0
                        ? fmt(r.yield_kg)
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      {!(r.order_qty > 0)
                        ? <span className="text-gray-400 text-xs">-</span>
                        : r.yield_kg != null && r.yield_kg > r.order_qty
                          ? <span className="text-red-600 text-xs font-medium">ผลิต &gt; order</span>
                          : r.total_prod > r.order_qty
                            ? <span className="text-amber-600 text-xs font-medium">แผน &gt; order</span>
                            : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>

              <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                <tr className="font-bold text-sm">
                  {station === 'ทั้งหมด' && <td className="px-4 py-3" />}
                  <td className="px-4 py-3 text-gray-700">รวมทั้งหมด</td>
                  <td className="px-4 py-3 text-right text-blue-700">{fmt(totals.order_qty)}</td>
                  <td className="px-4 py-3 text-right text-purple-700">{fmt(totals.baseline)}</td>
                  <td className="px-4 py-3 text-right text-sky-700">{fmt(totals.ph1)}</td>
                  <td className="px-4 py-3 text-right text-amber-700">{fmt(totals.ph2)}</td>
                  <td className="px-4 py-3 text-right text-violet-700">{fmt(totals.ph3)}</td>
                  <td className="px-4 py-3 text-right text-emerald-700">{fmt(totals.total_prod)}</td>
                  <td className="px-4 py-3 text-right text-orange-700">
                    {totals.yield_kg > 0 ? fmt(totals.yield_kg) : '—'}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
