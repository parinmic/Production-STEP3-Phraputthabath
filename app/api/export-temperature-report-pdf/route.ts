import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { supabase } from '@/lib/supabase'

/* ── Types ── */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000

interface CarcassPoint { hip: string; outerLoin: string; neckLoin: string }
interface CarcassSet   { a1: CarcassPoint; a2: CarcassPoint; a3: CarcassPoint }
interface CarcassTemps { start: CarcassSet; end: CarcassSet }

interface PartsPoint { hip: string; outerLoin: string; belly: string; shoulder: string; neckLoin: string }
interface PartsSet   { a1: PartsPoint; a2: PartsPoint; a3: PartsPoint }
interface PartsTemps { start: PartsSet; end: PartsSet }

interface LotRecord<T> { spec_code: string; updated_at: string | null; round_number: number; temps: T }
interface LotGroup<T>  { spec_code: string; rounds: LotRecord<T>[] }

const EC: CarcassPoint = { hip: '', outerLoin: '', neckLoin: '' }
const ES: CarcassSet   = { a1: EC, a2: EC, a3: EC }
const ET: CarcassTemps = { start: ES, end: ES }

const EP: PartsPoint = { hip: '', outerLoin: '', belly: '', shoulder: '', neckLoin: '' }
const EPS: PartsSet  = { a1: EP, a2: EP, a3: EP }
const EPT: PartsTemps = { start: EPS, end: EPS }

const SETS = [
  { key: 'start' as const, label: 'ชุดแรก' },
  { key: 'end'   as const, label: 'ชุดสุดท้าย' },
]

/* ── Helpers ── */
function todayBangkok() {
  return new Date(Date.now() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10)
}

function workDayBounds(dateStr: string) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const ms = Date.UTC(y, mo - 1, d, 6, 0, 0) - BANGKOK_OFFSET_MS
  return { start: new Date(ms), end: new Date(ms + 86400000) }
}

function buildGroups<T>(records: LotRecord<T>[], dateStr: string): LotGroup<T>[] {
  const { start, end } = workDayBounds(dateStr)
  const filtered = records.filter(r => {
    if (!r.updated_at) return false
    const t = new Date(r.updated_at)
    return t >= start && t < end
  })
  const map = new Map<string, LotRecord<T>[]>()
  for (const r of filtered) {
    const a = map.get(r.spec_code) ?? []; a.push(r); map.set(r.spec_code, a)
  }
  const age = (s: string) => { const n = parseInt(s.slice(4, 7), 10); return isNaN(n) ? Infinity : n }
  return [...map.entries()]
    .sort(([a], [b]) => age(a) - age(b) || a.localeCompare(b))
    .map(([spec_code, rounds]) => ({ spec_code, rounds }))
}

function avg(vals: string[]): number | null {
  const ns = vals.map(parseFloat).filter(n => !isNaN(n))
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null
}
function ac(s: CarcassSet, k: keyof CarcassPoint) { return avg([s.a1[k], s.a2[k], s.a3[k]]) }
function ap(s: PartsSet,   k: keyof PartsPoint)   { return avg([s.a1[k], s.a2[k], s.a3[k]]) }

function n(v: number | null): string {
  return v === null ? '—' : v.toFixed(1)
}
function t(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
}
function dl(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d, 6)).toLocaleDateString('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok',
  })
}

/* ── Find system browser (Edge always installed on Windows 10/11) ── */
function findBrowser(): string {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error('No Chrome or Edge found on this system')
}

/* ── HTML template ── */
function buildHtml(
  carcassGroups: LotGroup<CarcassTemps>[],
  partsGroups:   LotGroup<PartsTemps>[],
  dateStr: string,
): string {
  /* Carcass rows */
  let cRows = ''
  for (const g of carcassGroups) {
    const span = g.rounds.length * 2
    g.rounds.forEach((rec, ri) => {
      SETS.forEach((s, si) => {
        const set = (rec.temps ?? ET)[s.key]
        cRows += `<tr>
          ${ri === 0 && si === 0 ? `<td class="lot" rowspan="${span}">${g.spec_code}</td>` : ''}
          <td class="sub">${s.label}</td>
          <td class="sub">${t(rec.updated_at)}</td>
          <td>${n(ac(set, 'hip'))}</td>
          <td>${n(ac(set, 'outerLoin'))}</td>
          <td>${n(ac(set, 'neckLoin'))}</td>
        </tr>`
      })
    })
  }

  /* Parts rows */
  let pRows = ''
  for (const g of partsGroups) {
    const span = g.rounds.length * 2
    g.rounds.forEach((rec, ri) => {
      SETS.forEach((s, si) => {
        const set = (rec.temps ?? EPT)[s.key]
        pRows += `<tr>
          ${ri === 0 && si === 0 ? `<td class="lot" rowspan="${span}">${g.spec_code}</td>` : ''}
          <td class="sub">${s.label}</td>
          <td class="sub">${t(rec.updated_at)}</td>
          <td>${n(ap(set, 'hip'))}</td>
          <td>${n(ap(set, 'outerLoin'))}</td>
          <td>${n(ap(set, 'belly'))}</td>
          <td>${n(ap(set, 'shoulder'))}</td>
          <td>${n(ap(set, 'neckLoin'))}</td>
        </tr>`
      })
    })
  }

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'FreesiaUPC', 'Freesia UPC', 'Tahoma', sans-serif;
    font-size: 9.5pt;
    color: #111;
    background: #fff;
  }
  .page {
    padding: 8mm 10mm;
    width: 277mm;
  }
  .title {
    text-align: center;
    font-size: 13pt;
    font-weight: bold;
    margin-bottom: 2px;
  }
  .subtitle {
    text-align: center;
    font-size: 9pt;
    color: #555;
  }
  .date {
    text-align: center;
    font-size: 9pt;
    color: #444;
    margin-top: 3px;
    margin-bottom: 10px;
  }
  .tables-row {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  .table-wrap { flex: 1; min-width: 0; }
  .section-label {
    font-size: 8pt;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 3px;
  }
  .cyan-label { color: #0e7490; }
  .blue-label  { color: #1d4ed8; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.5pt;
  }
  th, td {
    border: 1px solid #9ca3af;
    padding: 2.5px 4px;
    text-align: center;
    vertical-align: middle;
  }
  .cyan-head th { background: #cffafe; }
  .blue-head th  { background: #dbeafe; }
  .lot {
    font-weight: bold;
    font-family: monospace;
    font-size: 8pt;
  }
  .sub { color: #6b7280; font-size: 8pt; white-space: nowrap; }

  .notes {
    margin-top: 10px;
    font-size: 8pt;
    color: #555;
    border-top: 1px solid #e5e7eb;
    padding-top: 6px;
    line-height: 1.5;
  }
  .sigs {
    display: flex;
    justify-content: space-between;
    margin-top: 14px;
    font-size: 9pt;
    color: #777;
  }
</style>
</head>
<body>
<div class="page">
  <div class="title">รายงานการตรวจสอบอุณหภูมิซีกและชิ้นส่วนสุกร</div>
  <div class="subtitle">บริษัท ซีพีเอฟ (ประเทศไทย) จำกัด (มหาชน) โรงชำแหละ (สุกร) พระพุทธบาท</div>
  <div class="date">วันที่ ${dl(dateStr)}</div>

  <div class="tables-row">
    <!-- ซีกสุกร -->
    <div class="table-wrap">
      <table>
        <thead class="cyan-head">
          <tr>
            <th rowspan="2">Lot</th>
            <th rowspan="2">ซีกสุกร</th>
            <th rowspan="2">เวลา</th>
            <th colspan="3" style="color:#0e7490">อุณหภูมิซีกสุกร (°C)</th>
          </tr>
          <tr>
            <th>สะโพก</th><th>สันนอก</th><th>สันคอ</th>
          </tr>
        </thead>
        <tbody>${cRows || '<tr><td colspan="6" style="color:#aaa;padding:8px">ไม่มีข้อมูล</td></tr>'}</tbody>
      </table>
    </div>

    <!-- ชิ้นส่วน -->
    <div class="table-wrap">
      <table>
        <thead class="blue-head">
          <tr>
            <th rowspan="2">Lot</th>
            <th rowspan="2">ชิ้นส่วน</th>
            <th rowspan="2">เวลา</th>
            <th colspan="5" style="color:#1d4ed8">อุณหภูมิชิ้นส่วน (°C)</th>
          </tr>
          <tr>
            <th>สะโพก</th><th>สันนอก</th><th>สามชั้น</th><th>ไหล่</th><th>สันคอ</th>
          </tr>
        </thead>
        <tbody>${pRows || '<tr><td colspan="8" style="color:#aaa;padding:8px">ไม่มีข้อมูล</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <div class="notes">
    <b>หมายเหตุ:</b>
    ตรวจสอบอุณหภูมิซีกสุกรในห้อง Chill ก่อนเบิกผลิต โดยใช้เทอร์มิเตอร์ชนิด Prove แทงเข้าบริเวณใจกลางเนื้อสะโพก สันอก และ สันคอ มาตรฐานอุณหภูมิเนื้อก่อนผลิต ≤ 7 °C<br>
    ตรวจสอบอุณหภูมิชิ้นส่วนระหว่างผลิตตัดแต่ง โดยใช้เทอร์มิเตอร์ชนิด Prove แทงเข้าบริเวณใจกลางเนื้อสะโพก สันนอก สามชั้น สันคอ เนื้อไหล่ (ตัวแทนกลุ่มชิ้นส่วนที่มีความหนามากที่สุด) มาตรฐานอุณหภูมิเนื้อระหว่างผลิต ≤ 10 °C
  </div>

  <div class="sigs">
    <span>ผู้รายงาน………………………………………</span>
    <span>ผู้ตรวจสอบ………………………………………</span>
  </div>
</div>
</body>
</html>`
}

/* ── Route ── */
export async function GET(req: NextRequest) {
  const dateStr = req.nextUrl.searchParams.get('date') ?? todayBangkok()

  const [{ data: carcassData }, { data: partsData }] = await Promise.all([
    supabase.from('qc_lot_temperature_checks')
      .select('spec_code, temps, updated_at, round_number')
      .order('spec_code',    { ascending: true })
      .order('round_number', { ascending: true }),
    supabase.from('qc_parts_temperature_checks')
      .select('spec_code, temps, updated_at, round_number')
      .order('spec_code',    { ascending: true })
      .order('round_number', { ascending: true }),
  ])

  const carcassGroups = buildGroups<CarcassTemps>(carcassData ?? [], dateStr)
  const partsGroups   = buildGroups<PartsTemps>(partsData ?? [], dateStr)
  const html          = buildHtml(carcassGroups, partsGroups, dateStr)

  const executablePath = findBrowser()
  const puppeteer      = (await import('puppeteer-core')).default
  const browser        = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format:          'A4',
      landscape:       true,
      printBackground: true,
      margin:          { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
    })

    return new NextResponse(pdf as unknown as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`รายงานอุณหภูมิ_${dateStr}`)}.pdf`,
      },
    })
  } finally {
    await browser.close()
  }
}
