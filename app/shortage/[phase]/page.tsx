'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Calendar, RefreshCw, AlertTriangle } from 'lucide-react'

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

interface ShortageRow {
  sku: string
  sku_name: string | null
  quantity: number
  unit: string
  deficit: number | null
  roundTime: string | null
  work_station: string | null
}

const PHASE_CONFIG = {
  '1': { label: 'Phase 1 — รอบเช้า',  dotColor: 'bg-blue-500' },
  '2': { label: 'Phase 2 — รอบบ่าย',  dotColor: 'bg-orange-500' },
  '3': { label: 'Phase 3 — แผน 100%', dotColor: 'bg-purple-500' },
} as const

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

function parseRound(note: string | null): string | null {
  if (!note) return null
  const m = note.match(/\[Round:\s*(\d{1,2}:\d{2})\]/)
  return m ? m[1] : null
}

function parseDeficit(note: string | null): number | null {
  if (!note) return null
  const m = note.match(/ขาด\s*([\d,.]+)\s*กก\./)
  if (!m) return null
  return parseFloat(m[1].replace(/,/g, ''))
}

export default function ShortagePage() {
  const { phase } = useParams() as { phase: string }
  const today = new Date().toISOString().split('T')[0]
  const [date, setDate]     = useState(today)
  const [rows, setRows]     = useState<ShortageRow[]>([])
  const [loading, setLoad]  = useState(false)

  const cfg = PHASE_CONFIG[phase as keyof typeof PHASE_CONFIG] ?? PHASE_CONFIG['1']

  const load = useCallback(async () => {
    setLoad(true)
    try {
      const res  = await fetch(`/api/withdrawal?date=${date}&phase=${phase}`)
      const data = await res.json()
      const items: WithdrawalItem[] = data.items ?? []

      const shortage = items
        .filter(i => i.note?.includes('ไม่เพียงพอ'))
        .map(i => ({
          sku:          i.sku,
          sku_name:     i.sku_name,
          quantity:     i.quantity,
          unit:         i.unit,
          deficit:      parseDeficit(i.note),
          roundTime:    parseRound(i.note),
          work_station: i.work_station,
        }))
        .sort((a, b) => {
          const ta = a.roundTime ?? '99:99'
          const tb = b.roundTime ?? '99:99'
          if (ta !== tb) return ta.localeCompare(tb)
          return (a.sku_name ?? a.sku).localeCompare(b.sku_name ?? b.sku)
        })

      setRows(shortage)
    } finally {
      setLoad(false)
    }
  }, [date, phase])

  useEffect(() => { load() }, [load])

  const dateDisplay = new Date(date + 'T00:00:00').toLocaleDateString('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <AlertTriangle size={22} className="text-red-500" />
          <h1 className="text-2xl font-bold text-gray-900">รายการ Raw รอผลิต</h1>
        </div>
        <p className="text-gray-500 mt-1">{cfg.label} · วัตถุดิบที่สต็อกไม่เพียงพอ รอจัดหา</p>
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
          <span className="text-sm text-gray-500 sm:ml-auto">
            {rows.length} รายการขาด
          </span>
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
          <AlertTriangle size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">ไม่พบสินค้าขาด</p>
          <p className="text-sm mt-1">{cfg.label} · วันที่ {dateDisplay}</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 bg-red-50 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500 shrink-0" />
            <span className="text-sm font-semibold text-red-700">
              Raw รอผลิต {rows.length} รายการ · {dateDisplay}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Station</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">วัตถุดิบ</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">ปริมาณที่ต้องการ</th>
                  <th className="px-4 py-3 text-right font-semibold text-red-600">ปริมาณที่ขาด</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">เวลาที่ต้องใช้</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => (
                  <tr key={`${r.sku}-${i}`} className="hover:bg-red-50/40">
                    <td className="px-4 py-2.5">
                      {r.work_station ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATION_COLORS[r.work_station] ?? 'bg-gray-100 text-gray-700'}`}>
                          {STATION_DISPLAY[r.work_station] ?? r.work_station}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-800">{r.sku_name ?? r.sku}</p>
                      {r.sku_name && <p className="text-xs text-gray-400">{r.sku}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">
                      {r.quantity.toLocaleString()} <span className="text-gray-400 font-normal">{r.unit}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.deficit != null ? (
                        <span className="font-bold text-red-600">
                          {r.deficit.toLocaleString()} <span className="font-normal text-red-400">กก.</span>
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {r.roundTime ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                          {r.roundTime} น.
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
