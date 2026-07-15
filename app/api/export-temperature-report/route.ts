import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import ExcelJS from 'exceljs'
import { todayBangkok } from '@/lib/date'

/* ── Constants ── */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000

const CARCASS_SETS = [
  { key: 'start' as const, label: 'ชุดแรก' },
  { key: 'end'   as const, label: 'ชุดสุดท้าย' },
]

/* ── Types ── */
interface CarcassPoint { hip: string; outerLoin: string; neckLoin: string }
interface CarcassSet   { a1: CarcassPoint; a2: CarcassPoint; a3: CarcassPoint }
interface CarcassTemps { start: CarcassSet; end: CarcassSet; chillAirTemp?: string }

interface PartsPoint { hip: string; outerLoin: string; belly: string; shoulder: string; neckLoin: string }
interface PartsSet   { a1: PartsPoint; a2: PartsPoint; a3: PartsPoint }
interface PartsTemps { start: PartsSet; end: PartsSet }

interface LotRecord<T> { spec_code: string; chill_room?: string | null; updated_at: string | null; round_number: number; temps: T }
interface LotGroup<T>  { spec_code: string; rounds: LotRecord<T>[] }

const EMPTY_CP: CarcassPoint = { hip: '', outerLoin: '', neckLoin: '' }
const EMPTY_CS: CarcassSet   = { a1: EMPTY_CP, a2: EMPTY_CP, a3: EMPTY_CP }
const EMPTY_CT: CarcassTemps = { start: EMPTY_CS, end: EMPTY_CS, chillAirTemp: '' }

const EMPTY_PP: PartsPoint = { hip: '', outerLoin: '', belly: '', shoulder: '', neckLoin: '' }
const EMPTY_PS: PartsSet   = { a1: EMPTY_PP, a2: EMPTY_PP, a3: EMPTY_PP }
const EMPTY_PT: PartsTemps = { start: EMPTY_PS, end: EMPTY_PS }

/* ── Helpers ── */
function workDayBounds(dateStr: string) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const startMs = Date.UTC(y, mo - 1, d, 6, 0, 0) - BANGKOK_OFFSET_MS
  return { start: new Date(startMs), end: new Date(startMs + 24 * 60 * 60 * 1000) }
}

function filterByDate<T>(records: LotRecord<T>[], dateStr: string): LotRecord<T>[] {
  const { start, end } = workDayBounds(dateStr)
  return records.filter(r => {
    if (!r.updated_at) return false
    const t = new Date(r.updated_at)
    return t >= start && t < end
  })
}

function buildGroups<T>(records: LotRecord<T>[], dateStr: string): LotGroup<T>[] {
  const filtered = filterByDate(records, dateStr)
  const map = new Map<string, LotRecord<T>[]>()
  for (const rec of filtered) {
    const list = map.get(rec.spec_code) ?? []
    list.push(rec)
    map.set(rec.spec_code, list)
  }
  const lotAge = (s: string) => { const d = parseInt(s.slice(4, 7), 10); return isNaN(d) ? Infinity : d }
  return [...map.entries()]
    .sort(([a], [b]) => lotAge(a) - lotAge(b) || a.localeCompare(b))
    .map(([spec_code, rounds]) => ({ spec_code, rounds }))
}

function avg(vals: string[]): number | null {
  const ns = vals.map(parseFloat).filter(n => !isNaN(n))
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null
}

function avgCP(set: CarcassSet, k: keyof CarcassPoint): number | null {
  return avg([set.a1[k], set.a2[k], set.a3[k]])
}

function avgPP(set: PartsSet, k: keyof PartsPoint): number | null {
  return avg([set.a1[k], set.a2[k], set.a3[k]])
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
  })
}

function fmtDateLong(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d, 6)).toLocaleDateString('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok',
  })
}

function round1(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10
}

/* ── Excel styles ── */
const THIN: ExcelJS.BorderStyle = 'thin'
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: THIN, color: { argb: 'FF9CA3AF' } },
  left: { style: THIN, color: { argb: 'FF9CA3AF' } },
  bottom: { style: THIN, color: { argb: 'FF9CA3AF' } },
  right: { style: THIN, color: { argb: 'FF9CA3AF' } },
}
const CENTER: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' }
const CYAN_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCFFAFE' } }
const BLUE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }

/* ── Route ── */
export async function GET(req: NextRequest) {
  const dateStr = req.nextUrl.searchParams.get('date') ?? todayBangkok()

  const [{ data: carcassData }, { data: partsData }] = await Promise.all([
    supabase.from('qc_lot_temperature_checks')
      .select('spec_code, chill_room, temps, updated_at, round_number')
      .order('spec_code',    { ascending: true })
      .order('round_number', { ascending: true }),
    supabase.from('qc_parts_temperature_checks')
      .select('spec_code, temps, updated_at, round_number')
      .order('spec_code',    { ascending: true })
      .order('round_number', { ascending: true }),
  ])

  const carcassGroups = buildGroups<CarcassTemps>(carcassData ?? [], dateStr)
  const partsGroups   = buildGroups<PartsTemps>(partsData ?? [], dateStr)

  /* ── Workbook ── */
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('รายงานอุณหภูมิ')

  // Column widths (A=1 … Q=17)
  ws.columns = [
    { width: 16 }, // A  Lot. (carcass)
    { width: 11 }, // B  ซีกสุกร
    { width: 10 }, // C  ห้อง Chill
    { width: 10 }, // D  อุณหภูมิห้อง
    { width: 12 }, // E  เวลาวัดอุณหภูมิ
    { width: 9  }, // F  สะโพก
    { width: 10 }, // G  หมายเหตุ
    { width: 2  }, // H  gap
    { width: 16 }, // I  Lot. (parts)
    { width: 11 }, // J  ชิ้นส่วน
    { width: 10 }, // K  เวลาตัดแต่ง
    { width: 9  }, // L  สะโพก
    { width: 9  }, // M  สันนอก
    { width: 9  }, // N  สามชั้น
    { width: 9  }, // O  ไหล่
    { width: 9  }, // P  สันคอ
    { width: 10 }, // Q  หมายเหตุ
  ]

  // Helper: apply border + alignment to a cell
  function style(cell: ExcelJS.Cell, opts: {
    bold?: boolean; fill?: ExcelJS.Fill; border?: boolean; align?: Partial<ExcelJS.Alignment>
  } = {}) {
    if (opts.border !== false) cell.border = THIN_BORDER
    if (opts.fill)  cell.fill  = opts.fill
    if (opts.bold)  cell.font  = { bold: true }
    cell.alignment = opts.align ?? CENTER
  }

  // ── Row 1: Title ──
  ws.mergeCells('A1:Q1')
  ws.getCell('A1').value = 'รายงานการตรวจสอบอุณหภูมิซีกและชิ้นส่วนสุกร'
  ws.getCell('A1').font  = { bold: true, size: 13, name: 'FreesiaUPC' }
  ws.getCell('A1').alignment = CENTER
  ws.getRow(1).height = 22

  // ── Row 2: Date ──
  ws.mergeCells('A2:Q2')
  ws.getCell('A2').value = `วันที่ ${fmtDateLong(dateStr)}`
  ws.getCell('A2').font  = { size: 11, name: 'FreesiaUPC' }
  ws.getCell('A2').alignment = CENTER
  ws.getRow(2).height = 18

  // ── Row 3: Spacer ──
  ws.getRow(3).height = 6

  // ── Rows 4–5: Headers ──
  function hdr(addr: string, value: string, fill: ExcelJS.Fill) {
    const c = ws.getCell(addr)
    c.value = value
    c.font  = { bold: true, size: 10, name: 'FreesiaUPC' }
    c.fill  = fill
    c.border = THIN_BORDER
    c.alignment = { ...CENTER, wrapText: true }
  }

  // Carcass header (cyan)
  ws.mergeCells('A4:A5'); hdr('A4', 'Lot.',                   CYAN_FILL)
  ws.mergeCells('B4:B5'); hdr('B4', 'ซีกสุกร',               CYAN_FILL)
  ws.mergeCells('C4:C5'); hdr('C4', 'ห้อง Chill',             CYAN_FILL)
  ws.mergeCells('D4:D5'); hdr('D4', 'อุณหภูมิห้อง',          CYAN_FILL)
  ws.mergeCells('E4:E5'); hdr('E4', 'เวลาวัดอุณหภูมิ',       CYAN_FILL)
  hdr('F4', 'อุณหภูมิ(°C)', CYAN_FILL)
  hdr('F5', 'สะโพก', CYAN_FILL)
  ws.mergeCells('G4:G5'); hdr('G4', 'หมายเหตุ',               CYAN_FILL)

  // Parts header (blue)
  ws.mergeCells('I4:I5'); hdr('I4', 'Lot.',                    BLUE_FILL)
  ws.mergeCells('J4:J5'); hdr('J4', 'ชิ้นส่วน',               BLUE_FILL)
  ws.mergeCells('K4:K5'); hdr('K4', 'เวลาตัดแต่ง',           BLUE_FILL)
  ws.mergeCells('L4:P4'); hdr('L4', 'อุณหภูมิ(°C)',           BLUE_FILL)
  hdr('L5', 'สะโพก', BLUE_FILL); hdr('M5', 'สันนอก', BLUE_FILL)
  hdr('N5', 'สามชั้น', BLUE_FILL); hdr('O5', 'ไหล่', BLUE_FILL); hdr('P5', 'สันคอ', BLUE_FILL)
  ws.mergeCells('Q4:Q5'); hdr('Q4', 'หมายเหตุ',               BLUE_FILL)

  ws.getRow(4).height = 16
  ws.getRow(5).height = 14

  // ── Data rows (start row 6) ──
  const allSpecs = [...new Set([
    ...carcassGroups.map(g => g.spec_code),
    ...partsGroups.map(g => g.spec_code),
  ])]

  let ri = 6

  for (const spec of allSpecs) {
    const cg = carcassGroups.find(g => g.spec_code === spec)
    const pg = partsGroups.find(g => g.spec_code === spec)

    // Flatten carcass sub-rows
    const cRows: { label: string; time: string; chillRoom: string | null; chillAirTemp: number|null; hip: number|null }[] = []
    if (cg) {
      for (const rec of cg.rounds) {
        for (const s of CARCASS_SETS) {
          const recTemps = rec.temps ?? EMPTY_CT
          const set = recTemps[s.key]
          cRows.push({ label: s.label, time: fmtTime(rec.updated_at), chillRoom: rec.chill_room ?? null, chillAirTemp: round1(avg([recTemps.chillAirTemp ?? ''])), hip: round1(avgCP(set, 'hip')) })
        }
      }
    }

    // Flatten parts sub-rows
    const pRows: { label: string; time: string; hip: number|null; outerLoin: number|null; belly: number|null; shoulder: number|null; neckLoin: number|null }[] = []
    if (pg) {
      for (const rec of pg.rounds) {
        for (const s of CARCASS_SETS) {
          const set = (rec.temps ?? EMPTY_PT)[s.key]
          pRows.push({ label: s.label, time: fmtTime(rec.updated_at), hip: round1(avgPP(set, 'hip')), outerLoin: round1(avgPP(set, 'outerLoin')), belly: round1(avgPP(set, 'belly')), shoulder: round1(avgPP(set, 'shoulder')), neckLoin: round1(avgPP(set, 'neckLoin')) })
        }
      }
    }

    const span   = Math.max(cRows.length, pRows.length, 1)
    const endRow = ri + span - 1

    // Lot cells (merged + bold)
    if (span > 1) {
      ws.mergeCells(ri, 1, endRow, 1)
      if (cRows.length) ws.mergeCells(ri, 4, endRow, 4)
      ws.mergeCells(ri, 9, endRow, 9)
    }
    for (const col of [1, 9]) {
      const c = ws.getCell(ri, col)
      c.value = spec
      style(c, { bold: true })
    }

    // Carcass data cells
    for (let i = 0; i < span; i++) {
      const row = cRows[i]
      const setC = (col: number, v: string | number | null) => {
        const c = ws.getCell(ri + i, col)
        c.value = v
        style(c)
        if (typeof v === 'number') c.numFmt = '0.0'
      }
      if (row) {
        setC(2, row.label)
        setC(3, row.chillRoom ? `Chill ${row.chillRoom}` : null)
        if (i === 0) setC(4, row.chillAirTemp)
        setC(5, row.time)
        setC(6, row.hip)
        setC(7, null)
      } else {
        const blankCols = cRows.length ? [2, 3, 5, 6, 7] : [2, 3, 4, 5, 6, 7]
        for (const col of blankCols) setC(col, null)
      }
    }

    // Parts data cells
    for (let i = 0; i < span; i++) {
      const row = pRows[i]
      const setP = (col: number, v: string | number | null) => {
        const c = ws.getCell(ri + i, col)
        c.value = v
        style(c)
        if (typeof v === 'number') c.numFmt = '0.0'
      }
      if (row) {
        setP(10, row.label)
        setP(11, row.time)
        setP(12, row.hip)
        setP(13, row.outerLoin)
        setP(14, row.belly)
        setP(15, row.shoulder)
        setP(16, row.neckLoin)
        setP(17, null)
      } else {
        for (const col of [10, 11, 12, 13, 14, 15, 16, 17]) setP(col, null)
      }
    }

    ri += span
  }

  // ── Spacer ──
  ri += 2

  // ── Notes ──
  const noteFont = { size: 9, name: 'FreesiaUPC' }
  ws.mergeCells(ri, 1, ri, 17)
  ws.getCell(ri, 1).value = 'หมายเหตุ: ตรวจสอบอุณหภูมิห้อง Chill และอุณหภูมิซีกสุกรก่อนเบิกผลิต โดยใช้เทอร์มิเตอร์ชนิด Prove แทงเข้าบริเวณใจกลางเนื้อสะโพก มาตรฐานอุณหภูมิเนื้อก่อนผลิต ≤ 7 °C'
  ws.getCell(ri, 1).font  = noteFont
  ws.getCell(ri, 1).alignment = { vertical: 'middle' }
  ri++

  ws.mergeCells(ri, 1, ri, 17)
  ws.getCell(ri, 1).value = 'ตรวจสอบอุณหภูมิชิ้นส่วนระหว่างผลิตตัดแต่ง โดยใช้เทอร์มิเตอร์ชนิด Prove แทงเข้าบริเวณใจกลางเนื้อสะโพก สันนอก สามชั้น สันคอ เนื้อไหล่ (ตัวแทนกลุ่มชิ้นส่วนที่มีความหนามากที่สุด) มาตรฐานอุณหภูมิเนื้อระหว่างผลิต ≤ 10 °C'
  ws.getCell(ri, 1).font  = noteFont
  ws.getCell(ri, 1).alignment = { vertical: 'middle' }

  /* ── Stream response ── */
  const buffer = await wb.xlsx.writeBuffer()
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`รายงานอุณหภูมิ_${dateStr}`)}.xlsx`,
    },
  })
}
