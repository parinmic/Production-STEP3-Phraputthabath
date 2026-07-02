'use client'
import { useState, useEffect, useRef } from 'react'
import { Thermometer, RefreshCw, ChevronDown, FileText, FileSpreadsheet } from 'lucide-react'

/* ── Carcass (ซีกสุกร) types ── */
interface CarcassPoint {
  hip: string; outerLoin: string; neckLoin: string
}
interface CarcassSet { a1: CarcassPoint; a2: CarcassPoint; a3: CarcassPoint }
interface CarcassTemps { start: CarcassSet; end: CarcassSet; chillAirTemp?: string }

/* ── Parts (ชิ้นส่วน) types ── */
interface PartsPoint {
  hip: string; outerLoin: string; belly: string; shoulder: string; neckLoin: string
}
interface PartsSet { a1: PartsPoint; a2: PartsPoint; a3: PartsPoint }
interface PartsTemps { start: PartsSet; end: PartsSet }

/* ── Generic lot record ── */
interface LotRecord<T> {
  spec_code:    string
  chill_room?:  string | null
  updated_at:   string | null
  round_number: number
  temps:        T
}
interface LotGroup<T> {
  spec_code: string
  rounds:    LotRecord<T>[]
}

/* ── Constants ── */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000

const EMPTY_CARCASS_POINT: CarcassPoint = { hip: '', outerLoin: '', neckLoin: '' }
const EMPTY_CARCASS_SET: CarcassSet = { a1: EMPTY_CARCASS_POINT, a2: EMPTY_CARCASS_POINT, a3: EMPTY_CARCASS_POINT }
const EMPTY_CARCASS: CarcassTemps = { start: EMPTY_CARCASS_SET, end: EMPTY_CARCASS_SET, chillAirTemp: '' }

const EMPTY_PARTS_POINT: PartsPoint = { hip: '', outerLoin: '', belly: '', shoulder: '', neckLoin: '' }
const EMPTY_PARTS_SET: PartsSet = { a1: EMPTY_PARTS_POINT, a2: EMPTY_PARTS_POINT, a3: EMPTY_PARTS_POINT }
const EMPTY_PARTS: PartsTemps = { start: EMPTY_PARTS_SET, end: EMPTY_PARTS_SET }

const CARCASS_SETS = [
  { key: 'start' as const, label: 'ชุดแรก' },
  { key: 'end'   as const, label: 'ชุดสุดท้าย' },
]
const PARTS_SETS = CARCASS_SETS

/* ── Helpers ── */
function todayBangkok(): string {
  return new Date(Date.now() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10)
}

function workDayBounds(dateStr: string): { start: Date; end: Date } {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const startMs = Date.UTC(y, mo - 1, d, 6, 0, 0) - BANGKOK_OFFSET_MS
  return { start: new Date(startMs), end: new Date(startMs + 24 * 60 * 60 * 1000) }
}

function buildGroups<T>(records: LotRecord<T>[], dateStr: string): LotGroup<T>[] {
  const { start, end } = workDayBounds(dateStr)
  const filtered = records.filter(r => {
    if (!r.updated_at) return false
    const t = new Date(r.updated_at)
    return t >= start && t < end
  })
  const map = new Map<string, LotRecord<T>[]>()
  for (const rec of filtered) {
    const list = map.get(rec.spec_code) ?? []
    list.push(rec)
    map.set(rec.spec_code, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => lotAgeKey(a) - lotAgeKey(b) || a.localeCompare(b))
    .map(([spec_code, rounds]) => ({ spec_code, rounds }))
}

function lotAgeKey(spec: string): number {
  const d = parseInt(spec.slice(4, 7), 10)
  return isNaN(d) ? Infinity : d
}

function avg(vals: string[]): number | null {
  const ns = vals.map(parseFloat).filter(n => !isNaN(n))
  if (!ns.length) return null
  return ns.reduce((a, b) => a + b, 0) / ns.length
}

function parseNum(v: string): number | null {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function fmtVal(v: number | null): string {
  return v === null ? '—' : v.toFixed(1)
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
}

function fmtDateLong(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d, 6)).toLocaleDateString('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok',
  })
}

function avgCarcassPoint(set: CarcassSet, key: keyof CarcassPoint): number | null {
  return avg((['a1', 'a2', 'a3'] as const).map(a => set[a][key]))
}
function carcassHasData(set: CarcassSet): boolean {
  return (['a1', 'a2', 'a3'] as const).some(a =>
    set[a].hip !== ''
  )
}

function avgPartsPoint(set: PartsSet, key: keyof PartsPoint): number | null {
  return avg((['a1', 'a2', 'a3'] as const).map(a => set[a][key]))
}
function partsHasData(set: PartsSet): boolean {
  return (['a1', 'a2', 'a3'] as const).some(a =>
    (['hip', 'outerLoin', 'belly', 'shoulder', 'neckLoin'] as const).some(k => set[a][k] !== '')
  )
}

/* ── Table components ── */
function CarcassTable({ groups }: { groups: LotGroup<CarcassTemps>[] }) {
  if (groups.length === 0)
    return <p className="text-xs text-gray-400 text-center py-4">ไม่มีข้อมูลอุณหภูมิซีกสุกร</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-cyan-50 text-gray-700">
            <th className="border border-gray-400 px-2 py-1.5 text-center" rowSpan={2}>Lot.</th>
            <th className="border border-gray-400 px-2 py-1.5 text-center" rowSpan={2}>ซีกสุกร</th>
            <th className="border border-gray-400 px-2 py-1.5 text-center" rowSpan={2}>ห้อง Chill</th>
            <th className="border border-gray-400 px-2 py-1.5 text-center" rowSpan={2}>อุณหภูมิห้อง</th>
            <th className="border border-gray-400 px-2 py-1.5 text-center" rowSpan={2}>เวลาวัดอุณหภูมิ</th>
            <th className="border border-gray-400 px-3 py-1.5 text-center font-semibold text-cyan-700" colSpan={1}>
              อุณหภูมิ(°C)
            </th>
            <th className="border border-gray-400 px-2 py-1.5 text-center" rowSpan={2}>หมายเหตุ</th>
          </tr>
          <tr className="bg-cyan-50 text-gray-600">
            <th className="border border-gray-400 px-2 py-1 text-center">สะโพก</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group, gi) => {
            const rowBase = gi % 2 === 1 ? 'bg-gray-50' : 'bg-white'
            return group.rounds.map((rec, ri) =>
              CARCASS_SETS.map((s, si) => {
                const recTemps = rec.temps ?? EMPTY_CARCASS
                const set     = recTemps[s.key]
                const hasData = carcassHasData(set)
                const cls     = `border border-gray-400 px-2 py-1 text-center font-mono ${hasData ? 'text-gray-800' : 'text-gray-300'}`
                return (
                  <tr key={`${group.spec_code}-r${rec.round_number}-${s.key}`} className={rowBase}>
                    {ri === 0 && si === 0 && (
                      <td className="border border-gray-400 px-2 py-1.5 font-mono font-semibold text-center align-middle text-gray-800"
                        rowSpan={group.rounds.length * 2}>
                        {group.spec_code}
                      </td>
                    )}
                    <td className="border border-gray-400 px-2 py-1 text-center text-gray-500 whitespace-nowrap">{s.label}</td>
                    <td className="border border-gray-400 px-2 py-1 text-center text-gray-700">{rec.chill_room ? `Chill ${rec.chill_room}` : '—'}</td>
                    <td className={cls}>{fmtVal(parseNum(recTemps.chillAirTemp ?? ''))}</td>
                    <td className="border border-gray-400 px-2 py-1 text-center text-gray-500 whitespace-nowrap">{fmtTime(rec.updated_at)}</td>
                    <td className={cls}>{fmtVal(avgCarcassPoint(set, 'hip'))}</td>
                    <td className="border border-gray-400 px-2 py-1 text-center text-gray-400"></td>
                  </tr>
                )
              })
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PartsTable({ groups }: { groups: LotGroup<PartsTemps>[] }) {
  if (groups.length === 0)
    return <p className="text-xs text-gray-400 text-center py-4">ไม่มีข้อมูลอุณหภูมิชิ้นส่วน</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-blue-50 text-gray-700">
            <th className="border border-gray-400 px-2 py-1.5 text-center" rowSpan={2}>Lot.</th>
            <th className="border border-gray-400 px-2 py-1.5 text-center" rowSpan={2}>ชิ้นส่วน</th>
            <th className="border border-gray-400 px-2 py-1.5 text-center" rowSpan={2}>เวลาตัดแต่ง</th>
            <th className="border border-gray-400 px-3 py-1.5 text-center font-semibold text-blue-700" colSpan={5}>
              อุณหภูมิ(°C)
            </th>
            <th className="border border-gray-400 px-2 py-1.5 text-center" rowSpan={2}>หมายเหตุ</th>
          </tr>
          <tr className="bg-blue-50 text-gray-600">
            <th className="border border-gray-400 px-2 py-1 text-center">สะโพก</th>
            <th className="border border-gray-400 px-2 py-1 text-center">สันนอก</th>
            <th className="border border-gray-400 px-2 py-1 text-center">สามชั้น</th>
            <th className="border border-gray-400 px-2 py-1 text-center">ไหล่</th>
            <th className="border border-gray-400 px-2 py-1 text-center">สันคอ</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group, gi) => {
            const rowBase = gi % 2 === 1 ? 'bg-gray-50' : 'bg-white'
            return group.rounds.map((rec, ri) =>
              PARTS_SETS.map((s, si) => {
                const set     = (rec.temps ?? EMPTY_PARTS)[s.key]
                const hasData = partsHasData(set)
                const cls     = `border border-gray-400 px-2 py-1 text-center font-mono ${hasData ? 'text-gray-800' : 'text-gray-300'}`
                return (
                  <tr key={`${group.spec_code}-r${rec.round_number}-${s.key}`} className={rowBase}>
                    {ri === 0 && si === 0 && (
                      <td className="border border-gray-400 px-2 py-1.5 font-mono font-semibold text-center align-middle text-gray-800"
                        rowSpan={group.rounds.length * 2}>
                        {group.spec_code}
                      </td>
                    )}
                    <td className="border border-gray-400 px-2 py-1 text-center text-gray-500 whitespace-nowrap">{s.label}</td>
                    <td className="border border-gray-400 px-2 py-1 text-center text-gray-500 whitespace-nowrap">{fmtTime(rec.updated_at)}</td>
                    <td className={cls}>{fmtVal(avgPartsPoint(set, 'hip'))}</td>
                    <td className={cls}>{fmtVal(avgPartsPoint(set, 'outerLoin'))}</td>
                    <td className={cls}>{fmtVal(avgPartsPoint(set, 'belly'))}</td>
                    <td className={cls}>{fmtVal(avgPartsPoint(set, 'shoulder'))}</td>
                    <td className={cls}>{fmtVal(avgPartsPoint(set, 'neckLoin'))}</td>
                    <td className="border border-gray-400 px-2 py-1 text-center text-gray-400"></td>
                  </tr>
                )
              })
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ── Page ── */
export default function TemperatureCheckReportPage() {
  const [carcassRecords, setCarcassRecords] = useState<LotRecord<CarcassTemps>[]>([])
  const [partsRecords,   setPartsRecords]   = useState<LotRecord<PartsTemps>[]>([])
  const [selectedDate,   setSelectedDate]   = useState(todayBangkok)
  const [loading,        setLoading]        = useState(true)
  const [showExport,     setShowExport]     = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  function load() {
    setLoading(true)
    Promise.all([
      fetch('/api/qc-lot-checks?all=1').then(r => r.json()),
      fetch('/api/qc-parts-checks?all=1').then(r => r.json()),
    ])
      .then(([carcassJson, partsJson]) => {
        setCarcassRecords(carcassJson.records ?? [])
        setPartsRecords(partsJson.records ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node))
        setShowExport(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const carcassGroups = buildGroups(carcassRecords, selectedDate)
  const partsGroups   = buildGroups(partsRecords,   selectedDate)

  function exportPDF() {
    setShowExport(false)
    const a = document.createElement('a')
    a.href = `/api/export-temperature-report-pdf?date=${selectedDate}`
    a.download = `report_${selectedDate}.pdf`
    a.click()
  }

  function exportExcel() {
    setShowExport(false)
    const a = document.createElement('a')
    a.href = `/api/export-temperature-report?date=${selectedDate}`
    a.download = `report_${selectedDate}.xlsx`
    a.click()
  }

  return (
    <div className="space-y-4">

      {/* Controls */}
      <div className="print:hidden flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Thermometer size={22} className="text-amber-500 shrink-0" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">รายงานการตรวจอุณหภูมิ</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="text-sm border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white" />
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            รีโหลด
          </button>
          <div className="relative" ref={exportRef}>
            <button onClick={() => setShowExport(v => !v)}
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded text-sm font-semibold transition-colors">
              Export
              <ChevronDown size={14} />
            </button>
            {showExport && (
              <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                <button onClick={exportPDF}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  <FileText size={14} className="text-red-500" /> PDF
                </button>
                <button onClick={exportExcel}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  <FileSpreadsheet size={14} className="text-green-600" /> Excel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="text-center py-16 text-gray-400 print:hidden">
          <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
          <p className="text-sm">กำลังโหลดข้อมูล...</p>
        </div>
      )}

      {!loading && (
        <div id="report-content" className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">

          {/* Title */}
          <div className="text-center space-y-0.5">
            <h2 className="text-base font-bold">รายงานการตรวจสอบอุณหภูมิซีกและชิ้นส่วนสุกร</h2>
            <p className="text-xs text-gray-600">บริษัท ซีพีเอฟ (ประเทศไทย) จำกัด (มหาชน) โรงชำแหละ (สุกร) พระพุทธบาท</p>
            <p className="text-xs text-gray-500 pt-1">วันที่ {fmtDateLong(selectedDate)}</p>
          </div>

          {/* ซีกสุกร + ชิ้นส่วน side by side */}
          <div className="grid grid-cols-2 gap-4 items-start">
            <div className="min-w-0">
              <CarcassTable groups={carcassGroups} />
            </div>
            <div className="min-w-0">
              <PartsTable groups={partsGroups} />
            </div>
          </div>

          {/* Notes */}
          <div className="text-[9px] text-gray-600 border-t border-gray-200 pt-3">
            <p className="leading-relaxed">
              <span className="font-semibold">หมายเหตุ:</span>{' '}
              ตรวจสอบอุณหภูมิห้อง Chill และอุณหภูมิซีกสุกรก่อนเบิกผลิต โดยใช้เทอร์มิเตอร์ชนิด Prove แทงเข้าบริเวณใจกลางเนื้อสะโพก มาตรฐานอุณหภูมิเนื้อก่อนผลิต ≤ 7 °C
            </p>
            <p className="leading-relaxed mt-0.5 whitespace-nowrap">
              <span className="opacity-0 select-none">หมายเหตุ: </span>
              ตรวจสอบอุณหภูมิชิ้นส่วนระหว่างผลิตตัดแต่ง โดยใช้เทอร์มิเตอร์ชนิด Prove แทงเข้าบริเวณใจกลางเนื้อสะโพก สันนอก สามชั้น สันคอ เนื้อไหล่ (ตัวแทนกลุ่มชิ้นส่วนที่มีความหนามากที่สุด) มาตรฐานอุณหภูมิเนื้อระหว่างผลิต ≤ 10 °C
            </p>
          </div>

          {/* Signatures */}
          <div className="flex justify-between text-xs text-gray-500 pt-4">
            <span>ผู้รายงาน………………………………………</span>
            <span>ผู้ตรวจสอบ………………………………………</span>
          </div>

        </div>
      )}
    </div>
  )
}
