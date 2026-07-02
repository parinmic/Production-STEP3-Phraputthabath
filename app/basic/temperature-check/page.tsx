'use client'
import { Fragment, useState, useEffect, useRef } from 'react'
import { RefreshCw, Thermometer, CheckCircle2, XCircle, PlayCircle, ChevronDown, X } from 'lucide-react'

interface LotRow {
  spec_code: string
  qty_3:     number
  weight_3:  number
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
}

const POINTS: { key: keyof PointTemps; label: string }[] = [
  { key: 'hip',       label: 'สะโพก' },
  { key: 'outerLoin', label: 'สันนอก' },
  { key: 'neckLoin',  label: 'สันคอ' },
]
const ANIMALS: { key: keyof AnimalSet; label: string }[] = [
  { key: 'a1', label: 'ตัวที่ 1' },
  { key: 'a2', label: 'ตัวที่ 2' },
  { key: 'a3', label: 'ตัวที่ 3' },
]
const SETS: { key: keyof TempRecord; label: string }[] = [
  { key: 'start', label: 'ชุดต้น Lot' },
  { key: 'end',   label: 'ชุดท้าย Lot' },
]

const EMPTY_POINT: PointTemps = { hip: '', outerLoin: '', neckLoin: '' }
const EMPTY_ANIMAL_SET: AnimalSet = { a1: EMPTY_POINT, a2: EMPTY_POINT, a3: EMPTY_POINT }
const EMPTY_TEMP: TempRecord = { start: EMPTY_ANIMAL_SET, end: EMPTY_ANIMAL_SET }

function parseNum(v: string): number | null {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function allValues(t: TempRecord): string[] {
  return SETS.flatMap(s => ANIMALS.flatMap(a => POINTS.map(p => t[s.key][a.key][p.key])))
}

function calcAvg(t: TempRecord): number | null {
  const vals = allValues(t).map(parseNum).filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function hasAnyValue(t: TempRecord | undefined): boolean {
  if (!t) return false
  return allValues(t).some(v => v !== '')
}

function tempStatus(avg: number | null): 'green' | 'red' | 'none' {
  if (avg === null) return 'none'
  return avg >= 4 && avg <= 7 ? 'green' : 'red'
}

// Chars 5-7 of spec_code are the day-of-year (Julian day, 1-365/366) — sort by that to order lots by age.
function lotAgeKey(spec: string): number {
  const day = parseInt(spec.slice(4, 7), 10)
  return isNaN(day) ? Infinity : day
}

function PointInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      placeholder="—"
      className="w-16 text-right text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:bg-gray-100 disabled:text-gray-500"
    />
  )
}

function AnimalSetGrid({ title, value, onChange, disabled }: {
  title: string
  value: AnimalSet
  onChange: (animal: keyof AnimalSet, point: keyof PointTemps, v: string) => void
  disabled?: boolean
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-md p-2.5">
      <p className="text-xs font-semibold text-gray-600 mb-1.5">{title}</p>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left text-gray-400 font-normal pb-1.5 w-16"></th>
            {POINTS.map(p => (
              <th key={p.key} className="text-center text-cyan-600 font-semibold pb-1.5">{p.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ANIMALS.map(a => (
            <tr key={a.key}>
              <td className="text-gray-500 pr-2 py-1 whitespace-nowrap">{a.label}</td>
              {POINTS.map(p => (
                <td key={p.key} className="py-1 px-1">
                  <PointInput value={value[a.key][p.key]} onChange={v => onChange(a.key, p.key, v)} disabled={disabled} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function BasicTemperatureCheckPage() {
  const [rows,       setRows]       = useState<LotRow[]>([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [sourceFile, setSourceFile] = useState('')
  const [generated,  setGenerated]  = useState(false)
  const [temps,      setTemps]      = useState<Record<string, TempRecord>>({})
  const [draftTemps, setDraftTemps] = useState<Record<string, TempRecord>>({})
  const [expanded,   setExpanded]   = useState<Record<string, boolean>>({})
  const [chillRoom,  setChillRoom]  = useState<Record<string, string>>({})
  const [savedAt,    setSavedAt]    = useState<Record<string, string>>({})
  const [recordedBy, setRecordedBy] = useState<Record<string, string>>({})
  const [rounds,     setRounds]     = useState<{ round_number: number; started_at: string; day_round_number?: number }[]>([])
  const [viewRound,  setViewRound]  = useState<number | null>(null)
  const [isCurrent,  setIsCurrent]  = useState(true)
  const [confirmFor,    setConfirmFor]    = useState<string | null>(null)
  const [recorderName,  setRecorderName]  = useState('')
  const liveRoundRef   = useRef<number | null>(null)
  const followLiveRef  = useRef(true)

  // Pull data for a round. With no argument, follows whatever the backend says is the
  // *current* (live) round. A round isn't tied to the wall clock — it lasts 1 hr from
  // whenever the first save in that round happened. Once it expires, the API naturally
  // returns empty data for the next live round; we poll periodically while following
  // live so the form clears itself without the user needing to reload.
  function fetchRound(explicitRound?: number) {
    const qs = explicitRound != null ? `?round=${explicitRound}` : ''
    fetch(`/api/qc-lot-checks${qs}`)
      .then(res => res.json())
      .then(json => {
        setTemps(json.temps ?? {})
        setChillRoom(json.chillRoom ?? {})
        setSavedAt(json.savedAt ?? {})
        setRecordedBy(json.recordedBy ?? {})
        setRounds(json.rounds ?? [])
        setIsCurrent(!!json.isCurrent)
        setViewRound(json.round ?? null)
        if (Array.isArray(json.lotRows) && (json.lotRows.length > 0 || explicitRound != null)) {
          const roundRows = (json.lotRows as LotRow[])
            .sort((a, b) => lotAgeKey(a.spec_code) - lotAgeKey(b.spec_code) || a.spec_code.localeCompare(b.spec_code))
          setRows(roundRows)
          setSourceFile(json.sourceFile ?? '')
          setGenerated(roundRows.length > 0)
        }
        if (json.liveRound != null && liveRoundRef.current != null && json.liveRound !== liveRoundRef.current) {
          // Live round advanced — drop any in-progress edits from the old round.
          if (followLiveRef.current) {
            setDraftTemps({})
            setExpanded({})
            setRows([])
            setSourceFile('')
            setGenerated(false)
          }
          liveRoundRef.current = json.liveRound
        }
        if (json.liveRound != null && liveRoundRef.current == null) liveRoundRef.current = json.liveRound
      })
      .catch(() => { /* ignore */ })
  }

  function selectRound(n: number) {
    const goingLive = n === liveRoundRef.current
    followLiveRef.current = goingLive
    fetchRound(goingLive ? undefined : n)
  }

  // Restore the generated row list from localStorage (just a UI convenience), and load
  // saved temperatures/chill rooms from the backend.
  useEffect(() => {
    try {
      const savedRows = localStorage.getItem('qc_rows')
      const savedFile = localStorage.getItem('qc_source_file')
      const savedName = localStorage.getItem('qc_recorder_name')
      if (savedRows) { setRows(JSON.parse(savedRows)); setGenerated(true) }
      if (savedFile) setSourceFile(savedFile)
      if (savedName) setRecorderName(savedName)
    } catch { /* ignore */ }

    fetchRound()
    const interval = setInterval(() => { if (followLiveRef.current) fetchRound() }, 60_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => { localStorage.setItem('qc_rows', JSON.stringify(rows)) }, [rows])
  useEffect(() => { localStorage.setItem('qc_source_file', sourceFile) }, [sourceFile])

  async function persistLot(spec: string, chill: string, t: TempRecord, recordedByName?: string) {
    if (!isCurrent) return
    try {
      const res  = await fetch('/api/qc-lot-checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec_code: spec, chill_room: chill || null, temps: t, recorded_by: recordedByName || null }),
      })
      const json = await res.json()
      if (json.updated_at) setSavedAt(prev => ({ ...prev, [spec]: json.updated_at }))
      if (json.recordedBy !== undefined) setRecordedBy(prev => ({ ...prev, [spec]: json.recordedBy }))
      if (json.round != null) {
        liveRoundRef.current = json.round
        setViewRound(json.round)
        setIsCurrent(true)
      }
    } catch { /* ignore */ }
  }

  function fmtSavedAt(iso: string | undefined): string | null {
    if (!iso) return null
    return new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' น.'
  }

  async function generate() {
    if (!isCurrent) return
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/pig-carcass-withdrawal')
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      const sorted: LotRow[] = (json.rows as LotRow[])
        .filter(r => r.qty_3 > 0)
        .sort((a, b) => lotAgeKey(a.spec_code) - lotAgeKey(b.spec_code) || a.spec_code.localeCompare(b.spec_code))
      const snapRes = await fetch('/api/qc-lot-checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lotRows: sorted, sourceFile: json.source_file ?? '' }),
      })
      const snapJson = await snapRes.json()
      if (!snapRes.ok || snapJson.error) { setError(snapJson.error ?? 'บันทึก Snapshot Lot ไม่สำเร็จ'); return }
      setRows(sorted)
      setSourceFile(json.source_file ?? '')
      setGenerated(true)
      if (snapJson.round != null) {
        liveRoundRef.current = snapJson.round
        setViewRound(snapJson.round)
        setIsCurrent(true)
        fetchRound()
      }
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  function setPoint(spec: string, set: keyof TempRecord, animal: keyof AnimalSet, point: keyof PointTemps, value: string) {
    if (!isCurrent) return
    setDraftTemps(prev => {
      const cur = prev[spec] ?? temps[spec] ?? EMPTY_TEMP
      return {
        ...prev,
        [spec]: {
          ...cur,
          [set]: { ...cur[set], [animal]: { ...cur[set][animal], [point]: value } },
        },
      }
    })
  }

  function toggleExpanded(spec: string) {
    const opening = !expanded[spec]
    if (opening) {
      setDraftTemps(prev => ({ ...prev, [spec]: temps[spec] ?? EMPTY_TEMP }))
    }
    setExpanded(prev => ({ ...prev, [spec]: opening }))
  }

  function requestSave(spec: string) {
    if (!isCurrent) return
    setConfirmFor(spec)
  }

  function confirmSave() {
    const spec = confirmFor
    const name = recorderName.trim()
    if (!spec || !name) return
    localStorage.setItem('qc_recorder_name', name)
    const newTemp = draftTemps[spec] ?? temps[spec] ?? EMPTY_TEMP
    setTemps(prev => ({ ...prev, [spec]: newTemp }))
    setExpanded(prev => ({ ...prev, [spec]: false }))
    setRecordedBy(prev => ({ ...prev, [spec]: name }))
    setConfirmFor(null)
    persistLot(spec, chillRoom[spec] ?? '', newTemp, name)
  }

  function clearTemps(spec: string) {
    if (!isCurrent) return
    if (!confirm(`ยืนยันล้างค่าอุณหภูมิที่กรอกของ Lot ${spec} ทั้งหมด?`)) return
    setDraftTemps(prev => ({ ...prev, [spec]: EMPTY_TEMP }))
  }

  function saveChillRoom(spec: string, value: string) {
    if (!isCurrent) return
    setChillRoom(prev => ({ ...prev, [spec]: value }))
    // No new name here — the server keeps whatever names were already recorded for this lot.
    persistLot(spec, value, temps[spec] ?? EMPTY_TEMP)
  }

  const filledRows = rows.filter(r => hasAnyValue(temps[r.spec_code]))
  const goodCount  = filledRows.filter(r => tempStatus(calcAvg(temps[r.spec_code] ?? EMPTY_TEMP)) === 'green').length
  const badCount   = filledRows.filter(r => tempStatus(calcAvg(temps[r.spec_code] ?? EMPTY_TEMP)) === 'red').length

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Thermometer size={24} className="text-cyan-500" />
            ตรวจอุณหภูมิ (QC)
          </h1>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-2 sm:shrink-0">
          {rounds.length > 0 && (
            <select
              value={viewRound ?? ''}
              onChange={e => selectRound(Number(e.target.value))}
              className="text-xs font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500 self-end"
            >
              {rounds.map(r => (
                <option key={r.round_number} value={r.round_number}>
                  รอบที่ {r.day_round_number ?? r.round_number} ({new Date(r.started_at).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.)
                  {r.round_number === liveRoundRef.current ? ' ปัจจุบัน' : ''}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2">
            {generated && (
              <button
                onClick={generate}
                disabled={loading || !isCurrent}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2.5 sm:py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                รีโหลด
              </button>
            )}
            <button
              onClick={generate}
              disabled={loading || !isCurrent}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white px-5 py-2.5 sm:py-2 rounded text-sm font-semibold transition-colors disabled:opacity-50"
            >
              <PlayCircle size={16} />
              Generate
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md px-5 py-4 text-red-700 text-sm">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-14 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังดึงข้อมูล Lot...</p>
        </div>
      )}

      {/* Initial state — not yet generated */}
      {!loading && !generated && (
        <div className="text-center py-20 text-gray-400">
          <Thermometer size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">กด <span className="font-semibold text-cyan-600">Generate</span> เพื่อดึงข้อมูล Lot หมูซีก</p>
        </div>
      )}

      {/* No lots */}
      {!loading && generated && rows.length === 0 && !error && (
        <div className="text-center py-14 text-gray-400">
          <p>ไม่พบข้อมูล — กรุณาอัพโหลดไฟล์ Stock คลัง 20 ก่อน</p>
        </div>
      )}

      {/* Summary — mobile compact bar */}
      {!loading && rows.length > 0 && (
        <div className="sm:hidden rounded-md border bg-gray-50 border-gray-200 px-3 py-1.5 flex items-center gap-2.5 text-xs overflow-x-auto whitespace-nowrap">
          <span className="text-gray-500">Lot <b className="text-gray-800">{rows.length}</b></span>
          <span className="text-gray-300">|</span>
          <span className="text-gray-500">กรอกแล้ว <b className={filledRows.length > 0 ? 'text-blue-700' : 'text-gray-400'}>{filledRows.length}</b></span>
          <span className="text-gray-300">|</span>
          <span className="flex items-center gap-1 text-gray-500">
            <CheckCircle2 size={13} className={goodCount > 0 ? 'text-green-500' : 'text-gray-300'} />
            อุณหภูมิเหมาะสม (4–7 °C) <b className={goodCount > 0 ? 'text-green-600' : 'text-gray-400'}>{goodCount}</b>
          </span>
          {badCount > 0 && (
            <span className="flex items-center gap-1 text-gray-500">
              <XCircle size={13} className="text-red-400" />
              ไม่เหมาะสม <b className="text-red-500">{badCount}</b>
            </span>
          )}
        </div>
      )}

      {/* Summary — desktop */}
      {!loading && rows.length > 0 && (
        <div className="hidden sm:flex rounded-md border bg-gray-50 border-gray-200 px-5 py-4 flex-wrap gap-6 items-center">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Lot ทั้งหมด</p>
            <p className="text-2xl font-bold text-gray-700">{rows.length} <span className="text-sm font-normal">ล็อต</span></p>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          <div>
            <p className="text-xs text-gray-500 mb-0.5">กรอกแล้ว</p>
            <p className={`text-2xl font-bold ${filledRows.length > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
              {filledRows.length} <span className="text-sm font-normal">ล็อต</span>
            </p>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={18} className={goodCount > 0 ? 'text-green-500' : 'text-gray-300'} />
            <div>
              <p className="text-xs text-gray-500">เหมาะสม (4–7 °C)</p>
              <p className={`text-xl font-bold leading-tight ${goodCount > 0 ? 'text-green-600' : 'text-gray-300'}`}>
                {goodCount} <span className="text-sm font-normal">ล็อต</span>
              </p>
            </div>
          </div>
          {badCount > 0 && (
            <div className="flex items-center gap-1.5">
              <XCircle size={18} className="text-red-400" />
              <div>
                <p className="text-xs text-gray-500">ไม่เหมาะสม</p>
                <p className="text-xl font-bold leading-tight text-red-500">
                  {badCount} <span className="text-sm font-normal">ล็อต</span>
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mobile card list */}
      {!loading && rows.length > 0 && (
        <div className="md:hidden space-y-1.5">
          {rows.map(r => {
            const t      = temps[r.spec_code] ?? EMPTY_TEMP
            const draftT = draftTemps[r.spec_code] ?? t
            const tAvg   = calcAvg(t)
            const status = tempStatus(tAvg)
            const isOpen = !!expanded[r.spec_code]
            const cardBorder = status === 'green' ? 'border-green-300' : status === 'red' ? 'border-red-300' : 'border-gray-200'
            const cardBg     = status === 'green' ? 'bg-green-50' : status === 'red' ? 'bg-red-50' : 'bg-white'
            return (
              <div key={r.spec_code} className={`border rounded-lg overflow-hidden ${cardBorder} ${cardBg}`}>
                <div
                  onClick={() => toggleExpanded(r.spec_code)}
                  aria-label="กรอกอุณหภูมิ"
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggleExpanded(r.spec_code) }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer active:bg-gray-100 transition-colors"
                >
                  <span className="font-mono font-semibold text-gray-800 text-xs shrink-0">{r.spec_code}</span>
                  {chillRoom[r.spec_code] && (
                    <span className="text-xs font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 py-0.5 shrink-0">
                      Chill {chillRoom[r.spec_code]}
                    </span>
                  )}
                  <span className="text-blue-700 font-semibold text-xs shrink-0">{r.qty_3.toLocaleString('th-TH')} <span className="text-gray-400 font-normal">ตัว</span></span>
                  <span className="ml-auto shrink-0 text-right">
                    {tAvg !== null ? (
                      <>
                        <span className={`font-bold text-xs ${status === 'green' ? 'text-green-600' : status === 'red' ? 'text-red-500' : 'text-gray-500'}`}>
                          {tAvg.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°C
                          {status === 'green' && <span className="ml-0.5">✓</span>}
                          {status === 'red'   && <span className="ml-0.5">✗</span>}
                        </span>
                        {fmtSavedAt(savedAt[r.spec_code]) && (
                          <span className="block text-[10px] text-gray-400 leading-tight">
                            {fmtSavedAt(savedAt[r.spec_code])}
                            {recordedBy[r.spec_code] && <> · {recordedBy[r.spec_code]}</>}
                          </span>
                        )}
                      </>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </span>
                  <span
                    className={`shrink-0 flex items-center justify-center w-6 h-6 rounded transition-colors ${
                      isOpen ? 'bg-cyan-100 text-cyan-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </span>
                </div>
                {isOpen && (
                  <>
                    {!isCurrent && (
                      <div className="px-2.5 py-1.5 border-t border-gray-200 bg-amber-50 text-amber-700 text-xs font-medium">
                        ข้อมูลย้อนหลัง — ดูได้อย่างเดียว แก้ไขไม่ได้
                      </div>
                    )}
                    <div className="flex items-center gap-2 px-2.5 py-2 border-t border-gray-200 bg-white">
                      <label className="text-xs font-medium text-gray-600 shrink-0">ห้อง Chill</label>
                      <select
                        value={chillRoom[r.spec_code] ?? ''}
                        onChange={e => saveChillRoom(r.spec_code, e.target.value)}
                        disabled={!isCurrent}
                        className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white disabled:bg-gray-100"
                      >
                        <option value="">—</option>
                        {[1, 2, 3, 4].map(n => (
                          <option key={n} value={String(n)}>{n}</option>
                        ))}
                      </select>
                    </div>
                    {isCurrent && (
                      <div className="flex border-t border-gray-200">
                        <button
                          onClick={() => clearTemps(r.spec_code)}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 text-red-600 bg-red-50 active:bg-red-100 transition-colors"
                        >
                          ล้างค่า
                        </button>
                        <button
                          onClick={() => requestSave(r.spec_code)}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 text-white bg-cyan-600 active:bg-cyan-700 transition-colors"
                        >
                          บันทึก
                        </button>
                      </div>
                    )}
                    <div className="p-2.5 space-y-2.5 bg-gray-50 border-t border-gray-200">
                      {SETS.map(s => (
                        <AnimalSetGrid
                          key={s.key}
                          title={s.label}
                          value={draftT[s.key]}
                          onChange={(animal, point, v) => setPoint(r.spec_code, s.key, animal, point, v)}
                          disabled={!isCurrent}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Table (desktop) */}
      {!loading && rows.length > 0 && (
        <div className="hidden md:block border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Lot</th>
                  <th className="px-4 py-3 text-right font-semibold text-blue-700">
                    <div>จำนวน</div><div className="font-normal text-blue-400">(ตัว)</div>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">การตรวจอุณหภูมิ</th>
                  <th className="px-4 py-3 text-center font-semibold text-indigo-700">
                    <div>เฉลี่ย</div><div className="font-normal text-indigo-400">(°C)</div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const t       = temps[r.spec_code] ?? EMPTY_TEMP
                  const draftT  = draftTemps[r.spec_code] ?? t
                  const tAvg    = calcAvg(t)
                  const status  = tempStatus(tAvg)
                  const rowBg   = status === 'green' ? 'bg-green-50' : status === 'red' ? 'bg-red-50' : 'hover:bg-gray-50'
                  const isOpen  = !!expanded[r.spec_code]
                  return (
                    <Fragment key={r.spec_code}>
                      <tr className={`transition-colors ${rowBg}`}>
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
                        <td className="px-4 py-2.5 text-center">
                          {isOpen && isCurrent && (
                            <div className="inline-flex gap-1.5">
                              <button
                                onClick={() => clearTemps(r.spec_code)}
                                className="text-xs font-medium px-3 py-1.5 rounded border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
                              >
                                ล้างค่า
                              </button>
                              <button
                                onClick={() => requestSave(r.spec_code)}
                                className="text-xs font-semibold px-3 py-1.5 rounded border border-cyan-600 text-white bg-cyan-600 hover:bg-cyan-700 transition-colors"
                              >
                                บันทึก
                              </button>
                            </div>
                          )}
                          {!isOpen && (
                            <button
                              onClick={() => toggleExpanded(r.spec_code)}
                              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 transition-colors"
                            >
                              <ChevronDown size={14} />
                              {isCurrent ? (hasAnyValue(t) ? 'แก้ไขอุณหภูมิ' : 'กรอกอุณหภูมิ') : 'ดูอุณหภูมิ'}
                            </button>
                          )}
                          {isOpen && !isCurrent && (
                            <button
                              onClick={() => toggleExpanded(r.spec_code)}
                              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 transition-colors"
                            >
                              <ChevronDown size={14} className="rotate-180" />
                              ปิด
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {tAvg !== null ? (
                            <>
                              <span className={`font-bold text-sm ${status === 'green' ? 'text-green-600' : status === 'red' ? 'text-red-500' : 'text-gray-500'}`}>
                                {tAvg.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                {status === 'green' && <span className="ml-1 text-xs font-normal">✓</span>}
                                {status === 'red'   && <span className="ml-1 text-xs font-normal">✗</span>}
                              </span>
                              {fmtSavedAt(savedAt[r.spec_code]) && (
                                <span className="block text-[11px] text-gray-400">
                                  {fmtSavedAt(savedAt[r.spec_code])}
                                  {recordedBy[r.spec_code] && <> · {recordedBy[r.spec_code]}</>}
                                </span>
                              )}
                            </>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={4} className="bg-gray-50 px-4 py-4">
                            {!isCurrent && (
                              <div className="mb-3 px-3 py-2 rounded bg-amber-50 text-amber-700 text-xs font-medium">
                                ข้อมูลย้อนหลัง — ดูได้อย่างเดียว แก้ไขไม่ได้
                              </div>
                            )}
                            <div className="flex items-center gap-2 mb-3">
                              <label className="text-xs font-medium text-gray-600">ห้อง Chill</label>
                              <select
                                value={chillRoom[r.spec_code] ?? ''}
                                onChange={e => saveChillRoom(r.spec_code, e.target.value)}
                                disabled={!isCurrent}
                                className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white disabled:bg-gray-100"
                              >
                                <option value="">—</option>
                                {[1, 2, 3, 4].map(n => (
                                  <option key={n} value={String(n)}>{n}</option>
                                ))}
                              </select>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {SETS.map(s => (
                                <AnimalSetGrid
                                  key={s.key}
                                  title={s.label}
                                  value={draftT[s.key]}
                                  onChange={(animal, point, v) => setPoint(r.spec_code, s.key, animal, point, v)}
                                  disabled={!isCurrent}
                                />
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirm save — requires recorder name */}
      {confirmFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmFor(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-5 w-full max-w-xs z-10">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-gray-800 text-sm">ยืนยันบันทึกอุณหภูมิ</h3>
              <button onClick={() => setConfirmFor(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <p className="text-xs text-gray-400 mb-4 font-mono">Lot {confirmFor}</p>
            <label className="text-xs font-medium text-gray-600 block mb-1">ชื่อผู้บันทึก</label>
            <input
              type="text"
              autoFocus
              value={recorderName}
              onChange={e => setRecorderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && recorderName.trim()) confirmSave() }}
              placeholder="พิมพ์ชื่อผู้บันทึก"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmFor(null)}
                className="flex-1 text-sm font-medium px-3 py-2 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={confirmSave}
                disabled={!recorderName.trim()}
                className="flex-1 text-sm font-semibold px-3 py-2 rounded bg-cyan-600 text-white hover:bg-cyan-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ยืนยันบันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
