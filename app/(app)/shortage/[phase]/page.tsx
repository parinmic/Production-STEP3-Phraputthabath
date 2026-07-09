'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { productionDay } from '@/lib/production-day'
import { Calendar, RefreshCw, AlertTriangle, Download } from 'lucide-react'

interface ShortageRow {
  sku: string
  sku_name: string | null
  quantity: number
  unit: string
  deficit: number | null
  productionTime: string | null
  work_station: string | null
  basicFinishTime?: string | null
  basicStatus?: 'on_time' | 'buffer_missed' | 'late' | null
}

interface BasicRawPlanRow {
  sku: string
  note: string | null
}

interface CalcLot {
  to_withdraw: number
  insufficient?: boolean
}

interface CalcItem {
  sku: string
  sku_name: string | null
  work_station: string | null
  withdrawal_round?: string
  shortage_kg?: number
  lots?: CalcLot[]
}

const PHASE_CONFIG = {
  '1': { label: 'Phase 1 — รอบเช้า',  dotColor: 'bg-blue-500' },
  '2': { label: 'Phase 2 — รอบบ่าย',  dotColor: 'bg-orange-500' },
  '3': { label: 'Phase 3 — แผน 100%', dotColor: 'bg-purple-500' },
} as const

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

const STATION_DISPLAY: Record<string, string> = {
  'สามชั้น': 'สามชั้นพิเศษ',
  'สะโพก':   'สะโพกพิเศษ',
  'ไหล่':    'ไหล่พิเศษ',
  'หมูบด':   'หมูบดพิเศษ',
  'สไลด์':   'สไลด์พิเศษ',
  'เผาขา':   'เผาขาพิเศษ',
  'เลาะขา':  'เลาะขาพิเศษ',
}


export default function ShortagePage() {
  const { phase } = useParams() as { phase: string }
  const today = productionDay()
  const [date, setDate]     = useState(today)
  const [rows, setRows]         = useState<ShortageRow[]>([])
  const [loading, setLoad]      = useState(false)
  const [exporting, setExp]     = useState(false)
  const [basicBagMap,  setBasicBagMap]  = useState<Record<string, number>>({})
  const [basicMinsMap, setBasicMinsMap] = useState<Record<string, number>>({})
  const captureRef              = useRef<HTMLDivElement>(null)

  const cfg = PHASE_CONFIG[phase as keyof typeof PHASE_CONFIG] ?? PHASE_CONFIG['1']

  const PERIOD_MAP: Record<string, string> = { '1': 'เช้า', '2': 'บ่าย', '3': 'ค่ำ' }

  const load = useCallback(async () => {
    setLoad(true)
    try {
      const period = PERIOD_MAP[phase] ?? 'เช้า'

      // Source of truth: the exact same per-round shortage figures shown on the
      // withdrawal page (หน้าเบิก) — shortage_kg from the rm-allocation pool cap,
      // plus any lot marked insufficient during FIFO allocation. Reusing this
      // computation (instead of re-deriving deficit from scratch) guarantees the
      // two pages always agree on "ขาดเท่าไหร่" for the same item.
      const res = await fetch('/api/withdrawal/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, phase: Number(phase) }),
      })
      const { items } = await res.json() as { items?: CalcItem[] }

      const rawMap = new Map<string, ShortageRow>()
      for (const item of items ?? []) {
        const insufficientKg = (item.lots ?? [])
          .filter(l => l.insufficient)
          .reduce((s, l) => s + Number(l.to_withdraw ?? 0), 0)
        const deficitKg = (item.shortage_kg ?? 0) + insufficientKg
        if (deficitKg <= 0.005) continue

        const stn  = item.work_station ?? ''
        const time = (item.withdrawal_round ?? '').slice(0, 5)
        const key  = `${stn}|||${item.sku}`
        const ex   = rawMap.get(key)
        if (ex) {
          ex.quantity += deficitKg
          ex.deficit   = (ex.deficit ?? 0) + deficitKg
          if (time && (!ex.productionTime || time < ex.productionTime)) ex.productionTime = time
        } else {
          rawMap.set(key, {
            sku: item.sku, sku_name: item.sku_name, quantity: deficitKg, unit: 'กก.',
            deficit: deficitKg, productionTime: time || null, work_station: stn,
          })
        }
      }

      const merged = Array.from(rawMap.values())
        .map(r => ({ ...r, quantity: Math.round(r.quantity * 100) / 100, deficit: Math.round((r.deficit ?? 0) * 100) / 100 }))
        .sort((a, b) => {
          const sa = STATION_ORDER.indexOf(a.work_station ?? '')
          const sb = STATION_ORDER.indexOf(b.work_station ?? '')
          if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb)
          const ta = a.productionTime ?? '99:99'
          const tb = b.productionTime ?? '99:99'
          if (ta !== tb) return ta.localeCompare(tb)
          return (a.sku_name ?? a.sku).localeCompare(b.sku_name ?? b.sku)
        })

      const { data: basicRawRows } = await supabase
        .from('production_assignments')
        .select('sku, note')
        .eq('production_date', date)
        .eq('period', period)
        .like('note', '%raw-queue%')
        .in('table_name', ['สามชั้นเบสิค', 'สะโพกเบสิค', 'ไหล่เบสิค'])

      const planBySkuNeed = new Map<string, { finish: string; status: ShortageRow['basicStatus']; need: string | null }>()
      for (const row of (basicRawRows ?? []) as BasicRawPlanRow[]) {
        const info = rawPlanInfoFromNote(row.note)
        if (!info) continue
        const sku = String(row.sku ?? '').replace(/^0+/, '')
        const key = `${sku}|||${info.need ?? ''}`
        const cur = planBySkuNeed.get(key)
        if (!cur || info.finish > cur.finish) {
          planBySkuNeed.set(key, info)
        }
      }

      setRows(merged.map(r => {
        const sku = String(r.sku ?? '').replace(/^0+/, '')
        const plan = planBySkuNeed.get(`${sku}|||${r.productionTime ?? ''}`) ?? planBySkuNeed.get(`${sku}|||`)
        return plan
          ? { ...r, basicFinishTime: plan.finish, basicStatus: plan.status }
          : r
      }))
    } finally {
      setLoad(false)
    }
  }, [date, phase])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/basic/picking-unit')
      .then(r => r.json())
      .then(d => { setBasicBagMap(d.bagMap ?? {}); setBasicMinsMap(d.minsMap ?? {}) })
      .catch(() => {})
  }, [])

  const getBasketInfo = (sku: string, deficitKg: number) => {
    const norm = sku.replace(/^0+/, '')
    const wpb  = basicBagMap[sku] ?? basicBagMap[norm] ?? 0
    const mpb  = basicMinsMap[sku] ?? basicMinsMap[norm] ?? 0
    const baskets = wpb > 0 ? Math.ceil(deficitKg / wpb) : null
    const mins    = baskets != null && mpb > 0 ? baskets * mpb : null
    return { baskets, mins }
  }

  const rawPlanInfoFromNote = (note: string | null) => {
    if (!note?.includes('raw-queue')) return null
    const get = (key: string) => note.match(new RegExp(`(?:^|\\|)${key}=([^|]+)`))?.[1] ?? null
    const finish = get('finish')
    const status = get('status') as ShortageRow['basicStatus']
    const need = get('need')
    if (!finish || !status) return null
    return { finish, status, need }
  }

  const statusLabel = (status: ShortageRow['basicStatus']) => {
    if (status === 'on_time') return 'ทัน'
    if (status === 'buffer_missed') return 'ช้า buffer'
    if (status === 'late') return 'ช้า'
    return ''
  }

  const statusClass = (status: ShortageRow['basicStatus']) => {
    if (status === 'on_time') return 'text-emerald-700 bg-emerald-50 border-emerald-200'
    if (status === 'buffer_missed') return 'text-amber-700 bg-amber-50 border-amber-200'
    if (status === 'late') return 'text-red-700 bg-red-50 border-red-200'
    return 'text-gray-500 bg-gray-50 border-gray-200'
  }

  const exportImage = async () => {
    setExp(true)
    try {
      const dDisplay = new Date(date + 'T00:00:00').toLocaleDateString('th-TH', {
        day: 'numeric', month: 'long', year: 'numeric',
      })

      const DPR    = 2
      const COL_W  = [155, 130, 240, 130, 110]
      const W      = COL_W.reduce((a, b) => a + b, 0)
      const BANNER = 50
      const TH_H   = 42
      const RH     = 38
      const H      = BANNER + TH_H + rows.length * RH + 1

      const TH_FONT     = (sz: number, bold = false) => (bold ? 'bold ' : '') + sz + "px FreesiaUPC,Tahoma,sans-serif"
      const MONO_FONT   = (sz: number) => sz + "px 'Courier New',monospace"

      const canvas  = document.createElement('canvas')
      canvas.width  = W * DPR
      canvas.height = H * DPR
      const ctx     = canvas.getContext('2d')!
      ctx.scale(DPR, DPR)
      ctx.textBaseline = 'middle'

      // White bg
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, W, H)

      // Banner
      ctx.fillStyle = '#fef2f2'
      ctx.fillRect(0, 0, W, BANNER)
      ctx.strokeStyle = '#fca5a5'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, BANNER); ctx.lineTo(W, BANNER); ctx.stroke()
      ctx.fillStyle = '#b91c1c'
      ctx.font = TH_FONT(15, true)
      ctx.textAlign = 'left'
      ctx.fillText('Raw รอผลิต ' + rows.length + ' รายการ · ' + dDisplay + ' · ' + cfg.label, 16, BANNER / 2)

      // Header row
      ctx.fillStyle = '#f9fafb'
      ctx.fillRect(0, BANNER, W, TH_H)
      ctx.strokeStyle = '#e5e7eb'
      ctx.beginPath(); ctx.moveTo(0, BANNER + TH_H); ctx.lineTo(W, BANNER + TH_H); ctx.stroke()

      const headers  = ['Station', 'SAP', 'ชื่อวัตถุดิบ', 'ปริมาณที่ขาด', 'เวลาที่ต้องใช้']
      const hColors  = ['#374151','#374151','#374151','#dc2626','#374151']
      const hAlign: CanvasTextAlign[] = ['left','left','left','center','center']
      let hx = 0
      headers.forEach((h, i) => {
        ctx.fillStyle = hColors[i]
        ctx.font = TH_FONT(13, true)
        ctx.textAlign = hAlign[i]
        ctx.fillText(h, hAlign[i] === 'center' ? hx + COL_W[i] / 2 : hx + 14, BANNER + TH_H / 2)
        hx += COL_W[i]
      })

      const SC: Record<string, [string, string, string]> = {
        'สามชั้น': ['#dbeafe','#1d4ed8','สามชั้นพิเศษ'],
        'สะโพก':   ['#ffedd5','#c2410c','สะโพกพิเศษ'],
        'ไหล่':    ['#dcfce7','#15803d','ไหล่พิเศษ'],
      }

      rows.forEach((r, i) => {
        const y = BANNER + TH_H + i * RH
        ctx.fillStyle = i % 2 === 0 ? '#fff' : '#fafafa'
        ctx.fillRect(0, y, W, RH)
        ctx.strokeStyle = '#f3f4f6'
        ctx.beginPath(); ctx.moveTo(0, y + RH); ctx.lineTo(W, y + RH); ctx.stroke()

        const cy = y + RH / 2
        let cx = 0

        // Station badge
        const sc = SC[r.work_station ?? '']
        ctx.font = TH_FONT(12, true); ctx.textAlign = 'left'
        if (sc) {
          const [bg, fg, label] = sc
          const tw = ctx.measureText(label).width
          const bx = cx + 14, by = cy - 10, bw = tw + 14, bh = 20
          ctx.fillStyle = bg; ctx.fillRect(bx, by, bw, bh)
          ctx.fillStyle = fg; ctx.fillText(label, bx + 7, cy)
        } else {
          ctx.fillStyle = '#374151'; ctx.fillText(r.work_station ?? '—', cx + 14, cy)
        }
        cx += COL_W[0]

        // SAP
        ctx.fillStyle = '#4b5563'; ctx.font = MONO_FONT(12); ctx.textAlign = 'left'
        ctx.fillText(r.sku, cx + 14, cy)
        cx += COL_W[1]

        // Name (truncate if needed)
        ctx.font = TH_FONT(14); ctx.fillStyle = '#1f2937'; ctx.textAlign = 'left'
        let nm = r.sku_name ?? '—'
        const maxNmW = COL_W[2] - 28
        while (nm.length > 1 && ctx.measureText(nm).width > maxNmW) nm = nm.slice(0, -1)
        if (nm !== (r.sku_name ?? '—')) nm += '…'
        ctx.fillText(nm, cx + 14, cy)
        cx += COL_W[2]

        // Deficit
        ctx.fillStyle = '#dc2626'; ctx.font = TH_FONT(14, true); ctx.textAlign = 'center'
        ctx.fillText(r.deficit != null ? r.deficit.toLocaleString() + ' กก.' : '—', cx + COL_W[3] / 2, cy)
        cx += COL_W[3]

        // Time
        ctx.fillStyle = '#1f2937'; ctx.font = TH_FONT(14); ctx.textAlign = 'center'
        ctx.fillText(r.productionTime ? r.productionTime + ' น.' : '—', cx + COL_W[4] / 2, cy)
      })

      // Outer border
      ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1
      ctx.strokeRect(0.5, 0.5, W - 1, H - 1)

      canvas.toBlob(blob => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'Raw_รอผลิต_Phase' + phase + '_' + date + '.png'
        a.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
    } finally {
      setExp(false)
    }
  }

  const dateDisplay = new Date(date + 'T00:00:00').toLocaleDateString('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <AlertTriangle size={20} className="text-red-500" />
          <h1 className="text-xl font-bold text-gray-900">รายการ Raw รอผลิต</h1>
        </div>
        <p className="text-gray-500 text-sm mt-0.5">{cfg.label} · วัตถุดิบที่สต็อกไม่เพียงพอ รอ STEP 2</p>
      </div>

      {/* Toolbar — single row on mobile */}
      <div className="card py-3 px-4">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-blue-500 shrink-0" />
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={load} disabled={loading}
            className="flex items-center justify-center p-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50 shrink-0">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          {rows.length > 0 && (
            <button onClick={exportImage} disabled={exporting}
              className="flex items-center justify-center p-2 text-emerald-700 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-50 shrink-0">
              <Download size={15} className={exporting ? 'animate-pulse' : ''} />
            </button>
          )}
        </div>
        {rows.length > 0 && (
          <p className="text-xs text-gray-400 mt-2">{rows.length} รายการขาด · {dateDisplay}</p>
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
          <p className="text-sm mt-1">{cfg.label} · {dateDisplay}</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div ref={captureRef} className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-red-50 flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-500 shrink-0" />
            <span className="text-sm font-semibold text-red-700">
              Raw รอผลิต {rows.length} รายการ · {dateDisplay}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">Station</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">SAP</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-700">ชื่อวัตถุดิบ</th>
                  <th className="px-3 py-3 text-right font-semibold text-red-600 whitespace-nowrap">ปริมาณที่ขาด</th>
                  <th className="px-3 py-3 text-right font-semibold text-amber-600 whitespace-nowrap">ตะกร้า</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">เวลาผลิต</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 whitespace-nowrap">เวลาที่ต้องใช้</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => {
                  const { baskets, mins } = getBasketInfo(r.sku, r.deficit ?? 0)
                  return (
                    <tr key={`${r.sku}-${i}`} className="hover:bg-red-50/40">
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {r.work_station ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATION_COLORS[r.work_station] ?? 'bg-gray-100 text-gray-700'}`}>
                            {STATION_DISPLAY[r.work_station] ?? r.work_station}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap">{r.sku}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-800">{r.sku_name ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {r.deficit != null ? (
                          <span className="font-bold text-red-600">
                            {r.deficit.toLocaleString()} <span className="font-normal text-red-400 text-xs">กก.</span>
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {baskets != null ? (
                          <span className="font-semibold text-amber-700">
                            {baskets.toLocaleString()} <span className="font-normal text-amber-500 text-xs">ตะกร้า</span>
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {r.basicFinishTime ? (
                          <div className="flex flex-col items-end gap-1">
                            <span className="font-semibold text-gray-800">{r.basicFinishTime} <span className="text-gray-400 text-xs">น.</span></span>
                            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${statusClass(r.basicStatus)}`}>
                              {statusLabel(r.basicStatus)}
                            </span>
                          </div>
                        ) : mins != null ? (
                          <span className="text-gray-700">{mins} <span className="text-gray-400 text-xs">นาที</span></span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center whitespace-nowrap text-gray-800">
                        {r.productionTime ? r.productionTime + ' น.' : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
