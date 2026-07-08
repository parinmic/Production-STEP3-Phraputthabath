'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Package, Save } from 'lucide-react'

interface LotRow {
  spec_code: string
  qty_3:     number
  weight_3:  number
}

interface SelectedLot {
  spec_code:  string
  qty:        number
  avg_weight: number
  order:      number
}

function computeSelected(rows: LotRow[], lotOrder: Record<string, string>): SelectedLot[] {
  return rows
    .filter(r => lotOrder[r.spec_code])
    .map(r => ({
      spec_code:  r.spec_code,
      qty:        r.qty_3,
      avg_weight: r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0,
      order:      Number(lotOrder[r.spec_code]),
    }))
    .sort((a, b) => a.order - b.order)
}

interface PointTemps {
  hip:       string // สะโพก
  outerLoin: string // สันนอก
  neckLoin:  string // สันคอ
}

interface AnimalSet {
  a1: PointTemps
  a2: PointTemps
  a3: PointTemps
}

interface TempRecord {
  start: AnimalSet // ชุดต้น Lot
  end:   AnimalSet // ชุดท้าย Lot
  chillAirTemp?: string
}

type TempSetKey = 'start' | 'end'

const POINTS: (keyof PointTemps)[] = ['hip']
const ANIMALS: (keyof AnimalSet)[] = ['a1', 'a2', 'a3']
const SETS: TempSetKey[] = ['start', 'end']

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function parseNum(v: string): number | null {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function calcAvgTemp(t: TempRecord | undefined): number | null {
  if (!t) return null
  const vals = SETS.flatMap(s => ANIMALS.flatMap(a => POINTS.map(p => parseNum(t[s][a][p]))))
    .filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function avgTempStatus(avg: number | null): 'green' | 'red' | 'none' {
  if (avg === null) return 'none'
  return avg >= 4 && avg <= 7 ? 'green' : 'red'
}

function fmtSavedAt(iso: string | undefined): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' น.'
}

function fmtSavedTime(iso: string | undefined): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.'
}

function getAvailableOrderNumbers(rowsLength: number, lotOrder: Record<string, string>, specCode: string, validSpecCodes: Set<string>): number[] {
  const currentValue = lotOrder[specCode] ?? ''
  return Array.from({ length: rowsLength }, (_, k) => k + 1).filter(n => {
    const value = String(n)
    // Only consider spec_codes that belong to today's rows — otherwise stale order picks
    // left over from a previous day (different spec_codes) would keep blocking 1, 2, 3...
    const usedByOther = Object.entries(lotOrder).some(([otherSpec, otherValue]) =>
      otherSpec !== specCode && otherValue === value && validSpecCodes.has(otherSpec))
    return !usedByOther || currentValue === value
  })
}

// Chars 5-7 of spec_code are the day-of-year (Julian day, 1-365/366) — sort by that to order lots by age.
function lotAgeKey(spec: string): number {
  const day = parseInt(spec.slice(4, 7), 10)
  return isNaN(day) ? Infinity : day
}

function todayBangkok(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
}

export default function PigCarcassWithdrawalPage() {
  const [rows,        setRows]        = useState<LotRow[]>([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [sourceFile,  setSourceFile]  = useState('')
  const [lotOrder,    setLotOrder]    = useState<Record<string, string>>({})
  const [qcTemps,     setQcTemps]     = useState<Record<string, TempRecord>>({})
  const [chillRoom,   setChillRoom]   = useState<Record<string, string>>({})
  const [savedAt,     setSavedAt]     = useState<Record<string, string>>({})
  const [trimmingQty, setTrimmingQty] = useState('')
  const [selectionLoaded, setSelectionLoaded] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [saveError,  setSaveError]  = useState('')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  // Snapshot of the lotOrder/trimmingQty that is actually saved on the server. Anything the
  // user picks that diverges from this is "unsaved" — see `dirty` below.
  const [savedSnapshot, setSavedSnapshot] = useState<{ lotOrder: Record<string, string>; trimmingQty: string } | null>(null)
  // Chain saves through this so a slow earlier request can never land after (and overwrite)
  // a later, more complete one.
  const pendingSaveRef = useRef<Promise<void>>(Promise.resolve())
  // Mirrors `dirty` for use inside loadSelection (a stable useCallback) without needing it as a dep.
  const dirtyRef = useRef(false)

  const dirty = savedSnapshot !== null &&
    (JSON.stringify(lotOrder) !== JSON.stringify(savedSnapshot.lotOrder) || trimmingQty !== savedSnapshot.trimmingQty)

  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  function persistSelection(selected: SelectedLot[], trimming: string): Promise<string | null> {
    const run = async (): Promise<string | null> => {
      const res = await fetch('/api/pig-carcass-lot-selection', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ date: todayBangkok(), selected, trimmingQty: trimming }),
      })
      const json = await res.json()
      return typeof json.updatedAt === 'string' ? json.updatedAt : null
    }
    const result = pendingSaveRef.current.then(run, run)
    pendingSaveRef.current = result.then(() => undefined, () => undefined)
    return result
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    try {
      const selected  = computeSelected(rows, lotOrder)
      const updatedAt = await persistSelection(selected, trimmingQty)
      setSavedSnapshot({ lotOrder, trimmingQty })
      setLastSavedAt(updatedAt)
    } catch {
      setSaveError('บันทึกไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setSaving(false)
    }
  }

  const loadSelection = useCallback(async () => {
    try {
      const res  = await fetch(`/api/pig-carcass-lot-selection?date=${todayBangkok()}`)
      const json = await res.json()
      // A failed fetch (network blip, DB error) returns no `selected` field — treating that as
      // "empty" would blank the on-screen selection even though the saved DB row is untouched.
      if (json.error) return
      // Don't clobber a selection the user has picked but not yet saved.
      if (dirtyRef.current) return
      const serverUpdatedAt = typeof json.updatedAt === 'string' ? json.updatedAt : null
      const sel  = (json.selected ?? []) as SelectedLot[]
      const order: Record<string, string> = {}
      for (const s of sel) order[s.spec_code] = String(s.order)
      const trimming = json.trimmingQty ?? ''
      setLotOrder(order)
      setTrimmingQty(trimming)
      setSavedSnapshot({ lotOrder: order, trimmingQty: trimming })
      setLastSavedAt(serverUpdatedAt)
    } catch { /* ignore */ } finally {
      setSelectionLoaded(true)
    }
  }, [])

  const loadQcTemps = useCallback(async () => {
    try {
      const res  = await fetch('/api/qc-lot-checks?latest=1')
      const json = await res.json()
      if (json.temps)     setQcTemps(json.temps)
      if (json.chillRoom) setChillRoom(json.chillRoom)
      if (json.savedAt)   setSavedAt(json.savedAt)
    } catch { /* ignore */ }
  }, [])

  // Pin to the day's first QC round — if QC starts a later round during the day
  // (as pigs get processed), we don't want the withdrawal headcount to shift.
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/qc-lot-checks?firstOfDay=1')
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      const sorted: LotRow[] = (json.lotRows as LotRow[])
        .filter(r => r.qty_3 > 0)
        .sort((a, b) => lotAgeKey(a.spec_code) - lotAgeKey(b.spec_code) || a.spec_code.localeCompare(b.spec_code))
      setRows(sorted)
      setSourceFile(json.sourceFile ?? '')
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
    loadQcTemps()
  }, [loadQcTemps])

  useEffect(() => {
    try {
      // The local cache isn't scoped to a production day — a lot that carries over
      // unfinished from yesterday must still start with a blank order today, so only
      // apply the cache when it was actually written for today.
      if (localStorage.getItem('pig_carcass_lot_order_date') === todayBangkok()) {
        const savedOrder    = localStorage.getItem('pig_carcass_lot_order')
        const savedTrimming = localStorage.getItem('pig_carcass_trimming')
        if (savedOrder)    setLotOrder(JSON.parse(savedOrder))
        if (savedTrimming) setTrimmingQty(savedTrimming)
      } else {
        localStorage.removeItem('pig_carcass_lot_order')
        localStorage.removeItem('pig_carcass_selected')
        localStorage.removeItem('pig_carcass_trimming')
        localStorage.removeItem('pig_carcass_lot_order_date')
      }
    } catch { /* ignore */ }
    loadSelection()
    load()
  }, [load, loadSelection])

  // Re-pull the shared selection periodically so changes made on other machines show up here too.
  useEffect(() => {
    const id = window.setInterval(loadSelection, 10_000)
    const handleFocus = () => loadSelection()
    const handleOnline = () => loadSelection()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadSelection()
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [loadSelection])

  // Local-only mirror so a refresh before hitting "บันทึก" doesn't lose the in-progress pick.
  // Actually saving to the server (so other machines see it) only happens via handleSave().
  useEffect(() => {
    localStorage.setItem('pig_carcass_lot_order', JSON.stringify(lotOrder))
    localStorage.setItem('pig_carcass_selected', JSON.stringify(computeSelected(rows, lotOrder)))
    localStorage.setItem('pig_carcass_lot_order_date', todayBangkok())
  }, [lotOrder, rows])

  useEffect(() => {
    localStorage.setItem('pig_carcass_trimming', trimmingQty)
  }, [trimmingQty])

  const totalQty  = rows.reduce((s, r) => s + r.qty_3,    0)
  const totalWgt  = rows.reduce((s, r) => s + r.weight_3, 0)
  const totalAvg  = totalQty > 0 ? totalWgt / totalQty : 0
  const selRows   = rows.filter(r => lotOrder[r.spec_code])
  const selQty    = selRows.reduce((s, r) => s + r.qty_3,    0)
  const selWgt    = selRows.reduce((s, r) => s + r.weight_3, 0)
  const selAvg    = selQty > 0 ? selWgt / selQty : 0

  const trimmingNum = parseInt(trimmingQty) || 0
  const diff        = trimmingNum > 0 ? trimmingNum - selQty : null
  const validSpecCodes = new Set(rows.map(r => r.spec_code))

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">เบิกหมูซีก</h1>
        </div>
        <div className="shrink-0">
          <button onClick={load} disabled={loading} className="flex items-center justify-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />รีโหลด
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-14 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังโหลดข้อมูล...</p>
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">{error}</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-14 text-gray-400">
          <Package size={36} className="mx-auto mb-3 opacity-30" />
          <p>ไม่พบข้อมูล — กรุณากด Generate ในหน้าตรวจอุณหภูมิ (QC) ก่อน</p>
        </div>
      )}

      {/* Save bar */}
      {!loading && rows.length > 0 && (
        <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors ${dirty ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'}`}>
          <div className="text-sm min-w-0">
            {dirty ? (
              <span className="text-amber-700 font-medium">มีการเปลี่ยนแปลงที่ยังไม่บันทึก — กด &quot;บันทึก&quot; เพื่อ sync ให้เครื่องอื่นเห็น</span>
            ) : lastSavedAt ? (
              <span className="text-gray-500">บันทึกล่าสุดเมื่อ {fmtSavedAt(lastSavedAt)}</span>
            ) : (
              <span className="text-gray-400">ยังไม่มีข้อมูลบันทึก</span>
            )}
            {saveError && <span className="block text-red-600 mt-0.5">{saveError}</span>}
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !selectionLoaded || !dirty}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2.5 sm:py-2 rounded-lg text-sm font-semibold transition-colors shrink-0"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            บันทึก
          </button>
        </div>
      )}

      {/* Summary card */}
      {!loading && rows.length > 0 && (
        <div className={`rounded-xl border px-3 sm:px-5 py-3 sm:py-4 grid grid-cols-3 sm:flex sm:flex-wrap gap-3 sm:gap-6 sm:items-center transition-colors ${selRows.length > 0 ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">ล็อตที่เลือก</p>
            <p className={`text-lg sm:text-2xl font-bold ${selRows.length > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
              {selRows.length} <span className="text-sm font-normal">ล็อต</span>
            </p>
          </div>
          <div className="hidden sm:block w-px h-10 bg-gray-200" />
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">จำนวนตัวที่เลือก</p>
            <p className={`text-lg sm:text-2xl font-bold ${selRows.length > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
              {selRows.length > 0 ? selQty.toLocaleString('th-TH') : '—'} <span className="text-sm font-normal">ตัว</span>
            </p>
          </div>
          <div className="hidden sm:block w-px h-10 bg-gray-200" />
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">น้ำหนักเฉลี่ย</p>
            <p className={`text-lg sm:text-2xl font-bold ${selRows.length > 0 ? 'text-orange-600' : 'text-gray-300'}`}>
              {selRows.length > 0 ? fmt(selAvg) : '—'} <span className="text-sm font-normal">กก./ตัว</span>
            </p>
          </div>
        </div>
      )}

      {/* จำนวนตัดแต่ง */}
      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 bg-white border border-gray-200 rounded-xl px-4 sm:px-5 py-3">
          <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">จำนวนตัดแต่งหมู</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={trimmingQty}
              onChange={e => setTrimmingQty(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="กรอกจำนวนตัว..."
              className="w-28 sm:w-36 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
            <span className="text-sm text-gray-500">ตัว</span>
          </div>
          {trimmingNum > 0 && selQty > 0 && (
            <>
              <span className="text-sm text-gray-500">หมูซีกที่เลือก <b className="text-blue-700">{selQty.toLocaleString('th-TH')}</b> ตัว</span>
              <span className={`text-sm font-semibold ${diff === 0 ? 'text-green-600' : 'text-orange-600'}`}>
                {diff === 0 ? 'ครบพอดี' : diff! > 0 ? `ขาด ${diff!.toLocaleString('th-TH')} ตัว` : `เกิน ${Math.abs(diff!).toLocaleString('th-TH')} ตัว`}
              </span>
            </>
          )}
          {trimmingNum > 0 && selQty === 0 && (
            <span className="text-sm text-gray-400">— ยังไม่ได้เลือก Lot</span>
          )}
        </div>
      )}

      {/* Mobile card list */}
      {!loading && rows.length > 0 && (
        <div className="md:hidden space-y-1.5">
          {rows.map(r => {
            const avg     = r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0
            const picked  = !!lotOrder[r.spec_code]
            const tAvg    = calcAvgTemp(qcTemps[r.spec_code])
            const tStatus = avgTempStatus(tAvg)

            const availableNums = getAvailableOrderNumbers(rows.length, lotOrder, r.spec_code, validSpecCodes)

            const lead = r.spec_code.slice(-1)

            return (
              <div key={r.spec_code} className={`flex items-center gap-1 border rounded-2xl overflow-hidden pl-2 pr-1.5 py-2 transition-colors ${picked ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}>
                <span className="text-4xl font-bold text-gray-900 leading-none shrink-0 w-8 text-center">{lead}</span>

                <div className="min-w-0 shrink-0 w-14 self-stretch flex flex-col justify-center gap-0.5">
                  <div className="font-mono font-semibold text-gray-800 text-[10px] truncate">{r.spec_code}</div>
                  <span className="text-[11px] font-bold text-gray-400 leading-none whitespace-nowrap">{fmt(avg, 0)} กก./ตัว</span>
                </div>

                <div className="flex items-stretch flex-1 justify-end gap-1 mr-5 text-center min-w-0">
                  <div className="shrink-0 w-12 flex flex-col items-center">
                    <span className="text-[9px] leading-none invisible">น้ำหนัก</span>
                    <div className="flex-1 flex items-center">
                      <span className="text-4xl font-bold text-gray-900 leading-none whitespace-nowrap">
                        {r.qty_3.toLocaleString('th-TH')} <span className="text-[9px] font-medium text-cyan-700">ตัว</span>
                      </span>
                    </div>
                    <span className="text-[9px] leading-none invisible">น้ำหนัก</span>
                  </div>
                  <div className="shrink-0 w-16 flex flex-col items-center">
                    <span className="text-[9px] leading-none invisible">น้ำหนัก</span>
                    <div className="flex-1 flex items-center">
                      {chillRoom[r.spec_code] ? (
                        <span className="flex flex-col items-center justify-center w-12 h-12 text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-xl leading-tight shrink-0">
                          <span className="text-[10px] font-medium">Chill</span>
                          <span className="text-lg font-bold">{chillRoom[r.spec_code]}</span>
                        </span>
                      ) : <span className="w-12 h-12 invisible" />}
                    </div>
                    <span className="text-[9px] leading-none invisible">น้ำหนัก</span>
                  </div>
                  <div className="shrink-0 w-16 flex flex-col items-center">
                    <span className="text-[9px] leading-none invisible">น้ำหนัก</span>
                    <div className="flex-1 flex items-center">
                      {tAvg !== null ? (
                        <span className={`text-2xl font-bold leading-none ${tStatus === 'green' ? 'text-green-600' : tStatus === 'red' ? 'text-red-500' : 'text-gray-500'}`}>
                          {tAvg.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°C
                        </span>
                      ) : <span className="text-[10px] text-gray-300">ยังไม่ได้ตรวจ</span>}
                    </div>
                    <span className={`text-[9px] text-gray-400 whitespace-nowrap ${fmtSavedTime(savedAt[r.spec_code]) ? '' : 'invisible'}`}>
                      วัดเมื่อ {fmtSavedTime(savedAt[r.spec_code]) ?? '00:00 น.'}
                    </span>
                  </div>
                </div>

                <select
                  value={lotOrder[r.spec_code] ?? ''}
                  onChange={e => setLotOrder(prev => ({ ...prev, [r.spec_code]: e.target.value }))}
                  className={`shrink-0 w-11 h-11 ml-0.5 rounded-xl border text-center text-xl font-bold appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                    picked ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-500'
                  }`}
                >
                  <option value="">-</option>
                  {availableNums.map(n => (
                    <option key={n} value={String(n)}>{n}</option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      )}

      {/* Table (desktop) */}
      {!loading && rows.length > 0 && (
        <div className="hidden md:block border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Lot</th>
                  <th className="px-4 py-3 text-right font-semibold text-blue-700">
                    <div>จำนวน</div><div className="font-normal text-blue-400">(ตัว)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-emerald-700">
                    <div>น้ำหนัก</div><div className="font-normal text-emerald-400">(กก.)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-orange-700">
                    <div>น้ำหนักเฉลี่ย</div><div className="font-normal text-orange-400">(กก./ตัว)</div>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-cyan-700">
                    <div>อุณหภูมิเฉลี่ย</div><div className="font-normal text-cyan-400">(°C จาก QC)</div>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-cyan-700">
                    <div>เวลาวัดอุณหภูมิ</div>
                  </th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-500 w-28">ลำดับตัดแต่ง</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const avg      = r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0
                  const picked   = !!lotOrder[r.spec_code]
                  const tAvg     = calcAvgTemp(qcTemps[r.spec_code])
                  const tStatus  = avgTempStatus(tAvg)

                  // Available order numbers: not used by others (or currently selected by this row)
                  const availableNums = getAvailableOrderNumbers(rows.length, lotOrder, r.spec_code, validSpecCodes)

                  return (
                    <tr key={r.spec_code} className={`transition-colors ${picked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">
                        <span className="flex items-center gap-2">
                          {r.spec_code}
                          {chillRoom[r.spec_code] && (
                            <span className="text-xs font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 py-0.5">
                              Chill {chillRoom[r.spec_code]}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-blue-700 font-semibold">{r.qty_3.toLocaleString('th-TH')}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(r.weight_3)}</td>
                      <td className="px-4 py-2.5 text-right text-orange-700">{fmt(avg)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {tAvg !== null ? (
                          <span className={`font-bold text-sm ${
                            tStatus === 'green' ? 'text-green-600' :
                            tStatus === 'red'   ? 'text-red-500'   : 'text-gray-500'
                          }`}>
                            {tAvg.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C
                            {tStatus === 'green' && <span className="ml-1 text-xs font-normal">✓</span>}
                            {tStatus === 'red'   && <span className="ml-1 text-xs font-normal">✗</span>}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">ยังไม่ได้ตรวจ</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs text-gray-500">
                        {fmtSavedAt(savedAt[r.spec_code]) ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <select
                          value={lotOrder[r.spec_code] ?? ''}
                          onChange={e => setLotOrder(prev => ({ ...prev, [r.spec_code]: e.target.value }))}
                          className={`text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors ${
                            picked ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-500'
                          }`}
                        >
                          <option value="">—</option>
                          {availableNums.map(n => (
                            <option key={n} value={String(n)}>{n}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                <tr className="font-bold text-sm">
                  <td className="px-4 py-3 text-gray-700">รวมทั้งหมด ({rows.length} ล็อต)</td>
                  <td className="px-4 py-3 text-right text-blue-700">{totalQty.toLocaleString('th-TH')}</td>
                  <td className="px-4 py-3 text-right text-emerald-700">{fmt(totalWgt)}</td>
                  <td className="px-4 py-3 text-right text-orange-700">{fmt(totalAvg)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-3 py-3 text-center text-xs text-gray-400">
                    {selRows.length > 0 ? `${selRows.length} เลือก` : ''}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
