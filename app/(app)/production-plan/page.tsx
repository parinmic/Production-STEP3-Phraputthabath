'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Calendar, RefreshCw, ImageDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { todayBangkok } from '@/lib/date'

const STATION_DISPLAY: Record<string, string> = {
  'สามชั้น': 'สามชั้นพิเศษ',
  'สะโพก':   'สะโพกพิเศษ',
  'ไหล่':    'ไหล่พิเศษ',
  'หมูบด':   'หมูบดพิเศษ',
  'สไลด์':   'สไลด์พิเศษ',
  'เผาขา':   'เผาขาพิเศษ',
  'เลาะขา':  'เลาะขาพิเศษ',
}

const STATION_ORDER = ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์', 'เผาขา', 'เลาะขา']

const STATION_COLORS: Record<string, string> = {
  'สามชั้น': 'bg-blue-100 text-blue-700',
  'สะโพก':   'bg-orange-100 text-orange-700',
  'ไหล่':    'bg-green-100 text-green-700',
  'หมูบด':   'bg-red-100 text-red-700',
  'สไลด์':   'bg-purple-100 text-purple-700',
  'เผาขา':   'bg-fuchsia-100 text-fuchsia-700',
  'เลาะขา':  'bg-teal-100 text-teal-700',
}

interface PlanRow {
  station:   string
  sku:       string
  sku_name:  string | null
  totalQty:  number
  bags:      number | null
  channel:   string | null
  minSeq:    number
}

export default function ProductionPlanPage() {
  const today = todayBangkok()
  const [date, setDate]         = useState(today)
  const [rows, setRows]         = useState<PlanRow[]>([])
  const [bagMap, setBagMap]     = useState<Record<string, number>>({})
  const [loading, setLoading]   = useState(false)
  const [exporting, setExp]     = useState(false)
  const captureRef              = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/master/picking-unit')
      .then(r => r.json())
      .then(data => setBagMap(data.bagMap ?? {}))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('production_assignments')
        .select('table_name, sku, sku_name, target_quantity, channel, seq')
        .eq('production_date', date)
        .in('table_name', ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์', 'เผาขา', 'เลาะขา'])

      const map = new Map<string, { sku_name: string | null; qty: number; channel: string | null; minSeq: number }>()
      for (const r of data ?? []) {
        const key = `${r.table_name}|||${r.sku}`
        const cur = map.get(key) ?? { sku_name: r.sku_name ?? null, qty: 0, channel: r.channel ?? null, minSeq: r.seq ?? Infinity }
        cur.qty += Number(r.target_quantity ?? 0)
        if ((r.seq ?? Infinity) < cur.minSeq) cur.minSeq = r.seq ?? Infinity
        map.set(key, cur)
      }

      const result: PlanRow[] = Array.from(map.entries())
        .map(([key, { sku_name, qty, channel, minSeq }]) => {
          const [station, sku] = key.split('|||')
          const normSku = sku.replace(/^0+/, '')
          const wpb = bagMap[sku] ?? bagMap[normSku]
          return {
            station,
            sku,
            sku_name,
            totalQty: Math.round(qty * 100) / 100,
            bags:     wpb && wpb > 0 ? Math.floor(qty / wpb) : null,
            channel,
            minSeq,
          }
        })
        .sort((a, b) => {
          const si = STATION_ORDER.indexOf(a.station) - STATION_ORDER.indexOf(b.station)
          if (si !== 0) return si
          // sort by generation order (seq reflects channel priority — Makro first, WM next, LOTUS last)
          if (a.minSeq !== b.minSeq) return a.minSeq - b.minSeq
          return b.totalQty - a.totalQty
        })

      setRows(result)
    } finally {
      setLoading(false)
    }
  }, [date, bagMap])

  useEffect(() => { load() }, [load])

  const totalQty  = rows.reduce((s, r) => s + r.totalQty, 0)
  const totalBags = rows.reduce((s, r) => s + (r.bags ?? 0), 0)

  const exportImage = async () => {
    if (!captureRef.current) return
    setExp(true)
    try {
      const { toPng } = await import('html-to-image')
      const el = captureRef.current

      // scrollHeight = full content height regardless of parent clipping
      const fullW = el.offsetWidth
      const fullH = el.scrollHeight

      const dataUrl = await toPng(el, {
        backgroundColor: '#f9fafb',
        pixelRatio: 2,
        width:  fullW,
        height: fullH,
        // Override the cloned element's style so it isn't constrained by the
        // page's scrollable layout container
        style: {
          height:    `${fullH}px`,
          overflow:  'visible',
          maxHeight: 'none',
        },
      })

      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `แผนผลิต_${date}.png`
      a.click()
    } finally {
      setExp(false)
    }
  }

  const dateDisplay = new Date(date + 'T00:00:00').toLocaleDateString('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">แผนผลิต</h1>
        <p className="text-gray-500 mt-1">สรุปคำสั่งผลิตทุก Station รวมทุก Phase</p>
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
          <>
            <span className="text-sm text-gray-500 sm:ml-auto">
              {rows.length} รายการ · {totalQty.toLocaleString()} กก.
              {totalBags > 0 && ` · ${totalBags.toLocaleString()} ถุง`}
            </span>
            <button
              onClick={exportImage}
              disabled={exporting}
              className="hidden sm:flex items-center gap-2 text-emerald-700 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              <ImageDown size={15} />
              {exporting ? 'กำลังส่งออก...' : 'Export รูปภาพ'}
            </button>
          </>
        )}
      </div>

      {loading && (
        <div className="card text-center py-12 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังโหลด...</p>
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="card text-center py-12 text-gray-400">
          <p>ไม่พบแผนผลิตสำหรับวันที่เลือก</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div ref={captureRef} className="rounded-2xl overflow-hidden">
          {/* Header shown inside the captured image */}
          <div className="bg-white px-6 pt-5 pb-3 border border-b-0 border-gray-200 rounded-t-2xl">
            <p className="text-base font-bold text-gray-900">แผนผลิต</p>
            <p className="text-sm text-gray-500 mt-0.5">วันที่ผลิต: {dateDisplay} · รวมทุก Station · รวมทุก Phase</p>
          </div>

          <div className="border border-gray-200 rounded-b-2xl overflow-hidden">
            <table className="w-full text-sm bg-white">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Station</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">ชื่อ SKU</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">แผน (กก.)</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">แผน (ถุง)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => (
                  <tr key={`${r.station}-${r.sku}-${i}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATION_COLORS[r.station] ?? 'bg-gray-100 text-gray-700'}`}>
                        {STATION_DISPLAY[r.station] ?? r.station}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-800 font-medium">{r.sku_name ?? r.sku}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{r.totalQty.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-blue-700">
                      {r.bags != null ? r.bags.toLocaleString() : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td colSpan={2} className="px-4 py-3 font-semibold text-gray-700 text-right">รวม</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{totalQty.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-bold text-blue-700">{totalBags > 0 ? totalBags.toLocaleString() : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
