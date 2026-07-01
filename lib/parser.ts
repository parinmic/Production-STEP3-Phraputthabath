import * as XLSX from 'xlsx'
import Papa from 'papaparse'

export type ParsedRow = Record<string, string | number | null>

export async function parseFile(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsv(file)
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseExcel(file)
  throw new Error('รองรับเฉพาะไฟล์ .xlsx, .xls และ .csv เท่านั้น')
}

function parseCsv(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true, encoding: 'UTF-8',
      complete: (result) => resolve(result.data as ParsedRow[]),
      error: (err) => reject(new Error(err.message)),
    })
  })
}

// Parser สำหรับไฟล์ CSV จากระบบ Makro (TIS-620, มีบรรทัดชื่อรายงานอยู่บรรทัดแรก)
export function parseMakroFile(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        let text = e.target!.result as string
        // บรรทัดแรกคือชื่อบริษัท ไม่ใช่ header → ตัดออก
        const nl = text.indexOf('\n')
        if (nl !== -1 && !text.trimStart().startsWith('"rDate1"')) {
          text = text.slice(nl + 1)
        }
        Papa.parse(text, {
          header: true, skipEmptyLines: true,
          complete: (result) => resolve(result.data as ParsedRow[]),
          error: (err: { message: string }) => reject(new Error(err.message)),
        })
      } catch {
        reject(new Error('ไม่สามารถอ่านไฟล์ Makro ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsText(file, 'windows-874')
  })
}

function parseExcel(file: File, sheetName?: string): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array', cellDates: true })
        const targetSheet = sheetName && workbook.Sheets[sheetName]
          ? workbook.Sheets[sheetName]
          : workbook.Sheets[workbook.SheetNames[0]]
        resolve(XLSX.utils.sheet_to_json<ParsedRow>(targetSheet, { defval: null }))
      } catch { reject(new Error('ไม่สามารถอ่านไฟล์ Excel ได้')) }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Parser สำหรับไฟล์คำสั่งซื้อ LOTUS / Wet Market (รูปแบบ rXxx 66 คอลัมน์)
 * - XLSX: ข้อมูลอยู่ที่ Sheet 2 (index 1)
 * - CSV: TIS-620, ตัดบรรทัดแรก (ชื่อบริษัท) เหมือน parseMakroFile
 */
export function parseLotusWetMarketFile(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseMakroFile(file)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        // ข้อมูลอยู่ที่ sheet 2 (index 1) ถ้ามี ไม่งั้นใช้ sheet 1
        // Row 1 = ชื่อบริษัท, Row 2 = headers (rXxx) → range:1 ข้าม Row 1
        const sheetName = wb.SheetNames[1] ?? wb.SheetNames[0]
        const sheet = wb.Sheets[sheetName]
        resolve(XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: null, range: 1 }))
      } catch { reject(new Error('ไม่สามารถอ่านไฟล์ Excel ได้')) }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

function shiftISODate(iso: string, days: number): string {
  if (!iso) return iso
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

function thaiDateToISO(s: string): string {
  const t = s.trim()
  const parts = t.split('/')
  if (parts.length === 3) {
    const [d, m, y] = parts
    const year = parseInt(y) > 2400 ? parseInt(y) - 543 : parseInt(y)
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // Excel serial จากปฏิทิน BE (Thai locale เก็บปี พ.ศ. เป็น CE) → แปลงแล้วลบ 543
  const num = parseFloat(t)
  if (!isNaN(num) && num > 40000) {
    const d = new Date(Math.round((num - 25569) * 86400 * 1000))
    const y = d.getUTCFullYear() > 2400 ? d.getUTCFullYear() - 543 : d.getUTCFullYear()
    return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  return t
}

// แปลงค่าจาก cell (Date object จาก cellDates:true, serial number, หรือ text) → ISO date string
function cellToISO(v: string | number | Date | null | undefined): string {
  if (v instanceof Date) {
    // ใช้ local time (ไม่ใช่ UTC) เพราะ XLSX cellDates สร้าง Date ที่ local midnight
    // UTC+7: June 4 00:00 local = June 3 17:00 UTC → getUTCDate() ผิด
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return thaiDateToISO(String(v ?? ''))
}

// ถ้า Excel ใช้ M/D/Y format จะทำให้ "3/6/2569" หมายถึง มี.ค. 6 ไม่ใช่ มิ.ย. 3
// ตรวจ: ถ้าวันที่ที่ได้อยู่ในอดีต (> 20 วันที่แล้ว) ให้ลอง swap เดือน/วัน
function resolveDeliveryDate(raw: string | number | Date | null | undefined): string {
  const iso = cellToISO(raw)
  if (!iso || iso.includes('NaN')) return ''
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const cutoff = shiftISODate(todayStr, -20)
  if (iso >= cutoff) return iso
  // วันที่ในอดีตเกิน 20 วัน → ลอง swap เดือน/วัน (M/D → D/M)
  const [y, mo, dd] = iso.split('-')
  const swapped = `${y}-${dd}-${mo}`
  return swapped >= cutoff ? swapped : iso
}

/**
 * ประมวลผล sheet "แผน Makro 100%" จาก raw array-of-arrays
 * รองรับ rReq_date ที่ col A หรือ col B, รหัสสินค้าที่เป็น number หรือ string
 */
function processMakroPlan100Sheet(raw: (string | number | Date | null)[][]): ParsedRow[] {
  // หาวันส่ง: rReq_date อาจอยู่ col A (index 0) หรือ col B (index 1)
  let deliveryDate = ''
  for (let i = 0; i < 10; i++) {
    const row = raw[i]
    if (!row) continue
    const a = String(row[0] ?? '').trim()
    const b = String(row[1] ?? '').trim()
    if (a === 'rReq_date') { deliveryDate = shiftISODate(resolveDeliveryDate(row[1]), -1); break }
    if (b === 'rReq_date') { deliveryDate = shiftISODate(resolveDeliveryDate(row[2]), -1); break }
  }

  // หา header row (col 1 = 'rProduct_code')
  const hIdx = raw.findIndex(row => row && String(row[1] ?? '') === 'rProduct_code')
  if (hIdx < 0) throw new Error('ไม่พบ header row (rProduct_code) ในชีท แผน Makro 100%')

  const hRow = raw[hIdx]
  const totalCol = hRow.findIndex(c =>
    String(c ?? '').includes('ผลรวม') || String(c ?? '').toLowerCase().includes('grand total')
  )
  // Branch cols = all numeric cols between col 3 and totalCol (exclusive), or all from col 3 if no totalCol
  const branchCols = hRow
    .map((_, i) => i)
    .filter(i => i >= 3 && i !== totalCol && typeof hRow[i] !== 'string')

  const results: ParsedRow[] = []
  let currentStation = ''

  for (let i = hIdx + 1; i < raw.length; i++) {
    const row = raw[i]
    if (!row) continue
    const col1 = row[1]
    if (col1 === null || col1 === '') continue
    // รองรับรหัสสินค้าทั้ง number และ string-number; ข้าม text ที่ไม่ใช่ตัวเลข (subtotal, header)
    if (typeof col1 === 'string' && isNaN(Number(col1))) continue

    const stationVal = String(row[0] ?? '').trim()
    if (stationVal) currentStation = stationVal

    // ใช้ totalCol ถ้ามีและมีค่า; ถ้า null/undefined (formula ไม่มี cached value) ให้ sum branch cols แทน
    let qty = 0
    if (totalCol >= 0 && row[totalCol] != null && row[totalCol] !== '') {
      qty = Number(row[totalCol]) || 0
    }
    if (!qty) {
      qty = (branchCols.length > 0 ? branchCols : hRow.map((_, i) => i).filter(i => i >= 3))
        .reduce<number>((s, ci) => s + (Number(row[ci]) || 0), 0)
    }
    if (!qty) continue

    results.push({
      delivery_date: deliveryDate || null,
      order_date:    deliveryDate || null,
      sku:           String(col1),
      sku_name:      String(row[2] ?? '').trim(),
      quantity:      qty,
      period:        currentStation || null,
    })
  }

  if (!results.length) throw new Error('ไม่พบข้อมูลในชีท แผน Makro 100%')
  return results
}

export function parseMakroPlan100(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets['แผน Makro 100%']
        if (!ws) throw new Error('ไม่พบชีท "แผน Makro 100%"')
        const raw = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(ws, { header: 1, defval: null })
        resolve(processMakroPlan100Sheet(raw))
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ แผน Makro 100% ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Auto-detect parser สำหรับ Makro 14:00
 * - CSV → parseMakroFile (TIS-620)
 * - XLSX มีชีท "แผน Makro 100%" → parseMakroPlan100
 * - XLSX ไม่มี → parseLotusWetMarketFile (Sheet 2, rXxx)
 */
export function parseMakroAuto(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseMakroFile(file)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        if (!wb.SheetNames.includes('แผน Makro 100%')) throw new Error('ไม่พบชีท "แผน Makro 100%" ในไฟล์')
        const ws = wb.Sheets['แผน Makro 100%']
        const raw = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(ws, { header: 1, defval: null })
        resolve(processMakroPlan100Sheet(raw))
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ Makro ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

export function parseQuotaForecast(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseExcel(file, 'FC 7Days แยกรายวัน')
  }
  return parseCsv(file)
}

/**
 * Parser สำหรับไฟล์ Stock Raw Material (STOCK 0010 / STOCK 20)
 * - Header row ระบุด้วย "หน่วยสินค้า"
 * - รหัสสินค้า/ชื่อสินค้า carry-forward (ปรากฏครั้งเดียวต่อกลุ่ม)
 * - ข้าม row "รวมตามสินค้า" และ row ว่าง
 * - เก็บเฉพาะ row ที่มี รหัส Spec
 */
export function parseStockRawMaterial(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, defval: null })

        const hIdx = raw.findIndex(row => row.some(c => String(c ?? '').trim() === 'หน่วยสินค้า'))
        if (hIdx < 0) throw new Error('ไม่พบ header row (หน่วยสินค้า) ในไฟล์')

        const hRow = raw[hIdx]
        const colOf = (kw: string) => hRow.findIndex(c => String(c ?? '').includes(kw))

        const C_CODE = colOf('หน่วยสินค้า')
        const C_NAME = colOf('หน่วยบรรจุ')
        const C_SPEC = colOf('รหัส Spec')
        if (C_SPEC < 0) throw new Error('ไม่พบคอลัมน์ "รหัส Spec" ในไฟล์')

        const result: ParsedRow[] = []
        let curCode = ''
        let curName = ''

        for (let i = hIdx + 1; i < raw.length; i++) {
          const row = raw[i]
          if (!row || row.every(c => c === null || c === '')) continue

          const cell0 = String(row[C_CODE] ?? '').trim()
          if (cell0.startsWith('รวมตาม')) continue

          if (cell0) curCode = cell0
          const nameVal = C_NAME >= 0 ? String(row[C_NAME] ?? '').trim() : ''
          if (nameVal) curName = nameVal

          const specVal = String(row[C_SPEC] ?? '').trim()
          if (!specVal) continue

          // Collect numeric values after spec column
          const nums: number[] = []
          const strs: string[] = []
          for (let c = C_SPEC + 1; c < row.length; c++) {
            const v = row[c]
            if (v === null || v === '') continue
            if (typeof v === 'number') {
              nums.push(v)
            } else {
              const n = parseFloat(String(v))
              if (!isNaN(n)) nums.push(n)
              else strs.push(String(v).trim())
            }
          }

          result.push({
            'รหัสสินค้า':  curCode,
            'ชื่อสินค้า':  curName,
            'รหัส Spec':   specVal,
            'ปริมาณ_1':   nums[0] ?? 0,
            'น้าหนัก_1':  nums[1] ?? 0,
            'ปริมาณ_2':   nums[2] ?? 0,
            'น้าหนัก_2':  nums[3] ?? 0,
            'ปริมาณ_3':   nums[4] ?? 0,
            'น้าหนัก_3':  nums[5] ?? 0,
            'ปริมาณรวม':  nums[6] ?? 0,
            'น้าหนักรวม': nums[7] ?? 0,
            'หน่วย':       strs[strs.length - 1] ?? '',
          })
        }

        resolve(result)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ Stock ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

export function parseBom(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null })

        // Row 0 = internal RM codes, row 3 = RM names, row 4 = RM SAP codes (all from col 11+)
        const rmNames = raw[3] ?? []
        const rmSaps  = raw[4] ?? []
        const rmCols: { idx: number; name: string; sap: string }[] = []
        for (let c = 11; c < rmNames.length; c++) {
          const name = String(rmNames[c] ?? '').trim()
          const sap  = String(rmSaps[c] ?? '').trim()
          if (name && sap) rmCols.push({ idx: c, name, sap })
        }

        // Deduplicate by product_sap keeping highest PG (latest revision)
        const bomMap: Record<string, { pg: number; row: ParsedRow }> = {}
        for (let i = 6; i < raw.length; i++) {
          const r = raw[i]
          if (!r) continue
          const sap = String(r[3] ?? '').trim()
          if (!sap) continue
          const pg = Number(r[0]) || 0
          const existing = bomMap[sap]
          if (existing && existing.pg >= pg) continue
          const byProducts = rmCols
            .filter(rm => Number(r[rm.idx]) > 0)
            .map(rm => ({ sap: rm.sap, name: rm.name, yield_pct: Number(r[rm.idx]) }))
          bomMap[sap] = {
            pg,
            row: {
              pg,
              pg_name:          String(r[1] ?? '').trim(),
              product_code:     String(r[2] ?? '').trim(),
              product_sap:      sap,
              product_name:     String(r[4] ?? '').trim(),
              raw_code:         String(r[5] ?? '').trim(),
              raw_sap:          String(r[6] ?? '').trim(),
              raw_name:         String(r[7] ?? '').trim(),
              yield_pct:        Number(r[8]) || 0,
              loss_pct:         Number(r[9]) || 0,
              by_products_json: JSON.stringify(byProducts),
              priority: (r[11] !== null && r[11] !== undefined && r[11] !== '') ? (Number(r[11]) || null) : null,
            },
          }
        }
        resolve(Object.values(bomMap).map(v => v.row))
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ BOM ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

export function toDateString(val: unknown): string {
  if (!val) return ''
  if (val instanceof Date) return val.toISOString().split('T')[0]
  return String(val).trim()
}

const THAI_MONTHS_ABBR = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

function parseSupplLoadingTime(raw: unknown): string {
  if (raw instanceof Date) {
    return `${String(raw.getHours()).padStart(2,'0')}:${String(raw.getMinutes()).padStart(2,'0')}`
  }
  const num = Number(raw)
  if (!isNaN(num) && num > 0 && num < 1) {
    const totalMins = Math.round(num * 24 * 60)
    return `${String(Math.floor(totalMins/60)).padStart(2,'0')}:${String(totalMins%60).padStart(2,'0')}`
  }
  const s = String(raw ?? '').trim()
  const mc = s.match(/(\d{1,2}):(\d{2})/); if (mc) return `${mc[1].padStart(2,'0')}:${mc[2]}`
  const md = s.match(/(\d{1,2})\.(\d{2})/); if (md) return `${md[1].padStart(2,'0')}:${md[2]}`
  return '10:00'
}

function parseSupplProductionDate(raw: unknown): string {
  if (raw instanceof Date) {
    const y = raw.getFullYear() > 2400 ? raw.getFullYear() - 543 : raw.getFullYear()
    return `${y}-${String(raw.getMonth()+1).padStart(2,'0')}-${String(raw.getDate()).padStart(2,'0')}`
  }
  const num = Number(raw)
  if (!isNaN(num) && num > 40000) {
    const d = new Date(Math.round((num - 25569) * 86400000))
    const y = d.getUTCFullYear() > 2400 ? d.getUTCFullYear() - 543 : d.getUTCFullYear()
    return `${y}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
  }
  const s = String(raw ?? '').trim()
  for (let i = 0; i < THAI_MONTHS_ABBR.length; i++) {
    if (s.includes(THAI_MONTHS_ABBR[i])) {
      const cleaned = s.replace(THAI_MONTHS_ABBR[i], '').trim()
      const nums = cleaned.split(/[\s/]+/).map(p => parseInt(p)).filter(n => !isNaN(n))
      const day = nums[0] ?? 1
      const yearRaw = nums[1] ?? new Date().getFullYear() + 543
      const year = yearRaw > 2400 ? yearRaw - 543 : yearRaw < 100 ? yearRaw + 2000 : yearRaw
      return `${year}-${String(i+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const y = parseInt(s); return y > 2400 ? `${y-543}${s.slice(4)}` : s }
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
}

/**
 * Parser สำหรับไฟล์แผนรอบเสริม — sheet "แผนรอบเสริม"
 * D1 = เวลาโหลดจ่าย, H2 = วันที่ผลิต
 * Column D (row 4+) = SAP, Column H (row 4+) = น้ำหนักสั่ง (กก.)
 */
export function parseSupplementaryPlanFile(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        const sheetName = wb.SheetNames.find(n => n.trim() === 'แผนรอบเสริม')
          ?? wb.SheetNames.find(n => n.includes('เสริม'))
          ?? wb.SheetNames[0]
        const sheet = wb.Sheets[sheetName]
        if (!sheet) throw new Error('ไม่พบ sheet "แผนรอบเสริม" ในไฟล์ที่เลือก')

        const loadingTime = parseSupplLoadingTime(sheet['D1']?.v ?? sheet['D1']?.w ?? '')
        const orderDate   = parseSupplProductionDate(sheet['H2']?.v ?? sheet['H2']?.w ?? '')

        const ref = sheet['!ref']
        if (!ref) { resolve([]); return }
        const range = XLSX.utils.decode_range(ref)

        const rows: ParsedRow[] = []
        for (let r = 3; r <= range.e.r; r++) {
          const skuCell = sheet[XLSX.utils.encode_cell({ r, c: 3 })] // Column D
          const qtyCell = sheet[XLSX.utils.encode_cell({ r, c: 7 })] // Column H
          const sku = String(skuCell?.v ?? '').trim()
          const qty = Number(qtyCell?.v ?? 0)
          if (!sku || isNaN(qty) || qty <= 0) continue
          rows.push({ sku, quantity: qty, loading_time: loadingTime, order_date: orderDate })
        }

        if (!rows.length) throw new Error('ไม่พบรายการในแผนรอบเสริม — ตรวจสอบว่าน้ำหนัก (คอลัมน์ H) มีค่า > 0')
        resolve(rows)
      } catch (err) {
        reject(err instanceof Error ? err : new Error('ไม่สามารถอ่านไฟล์ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Parser สำหรับไฟล์ Template แผนผลิต — ชีท "แผน 100%"
 * โครงสร้าง: หลายเซคชัน แต่ละเซคชันขึ้นต้นด้วยแถว "แพลนผลิต"
 * Col 0: ลำดับ | Col 1: Step | Col 3: SAP | Col 4: ชื่อสินค้า
 * Col 5: น้ำหนักต่อถุง | Col 6: จำนวนถุง | Col 7: น้ำหนักรวม
 * Col 8-13: Lotus's/CPFT/Makro (bags/weight)
 */
export function parsePlan100(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets['แผน 100%']
        if (!ws) throw new Error('ไม่พบชีท "แผน 100%" ในไฟล์')
        const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null })

        const results: ParsedRow[] = []
        let currentStation = ''
        let planDate = ''

        for (let i = 0; i < raw.length; i++) {
          const row = raw[i]
          if (!row) continue

          // Section header: col 0 starts with "แพลนผลิต"
          if (typeof row[0] === 'string' && row[0].includes('แพลนผลิต')) {
            currentStation = String(row[8] ?? '').trim()
            const dateSerial = row[5]
            if (typeof dateSerial === 'number' && dateSerial > 0) {
              // Excel serial → ISO date (accounting for Excel 1900 leap year bug)
              planDate = new Date((dateSerial - 25569) * 86400000).toISOString().split('T')[0]
            }
            continue
          }

          // Data row: col 0 is a number (sequence)
          if (typeof row[0] !== 'number') continue
          const sap = String(row[3] ?? '').trim()
          if (!sap || !currentStation) continue

          results.push({
            plan_date:      planDate,
            station:        currentStation,
            seq:            Number(row[0]),
            step:           String(row[1] ?? '').trim(),
            unix_code:      String(row[2] ?? '').trim(),
            sap:            sap,
            product_name:   String(row[4] ?? '').trim(),
            weight_per_bag: Number(row[5]) || 0,
            qty_bags:       Number(row[6]) || 0,
            weight_total:   Number(row[7]) || 0,
            lotus_bags:     Number(row[8]) || 0,
            lotus_weight:   Number(row[9]) || 0,
            cpft_bags:      Number(row[10]) || 0,
            cpft_weight:    Number(row[11]) || 0,
            makro_bags:     Number(row[12]) || 0,
            makro_weight:   Number(row[13]) || 0,
          })
        }

        if (!results.length) throw new Error('ไม่พบข้อมูลในชีท "แผน 100%"')
        resolve(results)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ แผน 100% ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Parser สำหรับไฟล์ Mas หน่วยหยิบสินค้า
 * รองรับ Excel/CSV คอลัมน์: SAP, ชื่อสินค้า, น้ำหนักต่อถุง (กก.), หน่วย
 */
export function parsePickingUnit(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsv(file)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
        const results: ParsedRow[] = raw
          .map(r => {
            const keys = Object.keys(r)
            const find = (...kws: string[]) =>
              keys.find(k => kws.every(kw => k.toLowerCase().includes(kw))) ?? ''
            const stepCol = keys.includes('step') ? 'step' : find('step') || ''
            const unixCol = keys.includes('unix') ? 'unix' : find('unix') || ''
            const sapCol  = keys.includes('sap')  ? 'sap'  : find('sap')  || find('รหัส') || ''
            const nameCol = keys.includes('product_name') ? 'product_name'
                          : find('sku', 'name') || find('ชื่อ') || find('name') || ''
            const wgtCol  = keys.includes('weight_per_bag') ? 'weight_per_bag'
                          : find('น้ำหนัก') || find('weight') || find('กก') || ''
            const unitCol = keys.includes('unit') ? 'unit' : find('หน่วย') || find('unit') || ''
            const minsCol = keys.includes('mins_per_basket') ? 'mins_per_basket'
                          : find('นาที') || find('mins') || ''
            const minsRaw = minsCol ? r[minsCol] : null
            return {
              step:            String(r[stepCol] ?? '').trim() || null,
              unix_code:       String(r[unixCol] ?? '').trim() || null,
              sap:             String(r[sapCol]  ?? '').trim(),
              product_name:    String(r[nameCol] ?? '').trim() || null,
              weight_per_bag:  Number(r[wgtCol]) || 0,
              unit:            String(r[unitCol] ?? '').trim() || 'ถุง',
              mins_per_basket: minsRaw != null && minsRaw !== '' ? Number(minsRaw) || null : null,
            }
          })
          .filter((r: { sap: string }) => r.sap)
        if (!results.length) throw new Error('ไม่พบรายการที่มีรหัส SAP')
        resolve(results)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Parser สำหรับไฟล์ Mas SKU ที่ไม่ต้องเบิกของ
 * คอลัมน์: จุดงาน, กลุ่มสินค้า, SAP, ชื่อสินค้า
 */
/**
 * Parser สำหรับไฟล์คำสั่งซื้อ BKP (รูปแบบ pivot)
 * - Scan rows 0-7: หา row แรกที่มีรหัส SAP 8 หลัก → product header row
 * - Column C (index 2): วันที่ส่งถึง → production date = date - 1
 * - Sub-column "แผน" ของแต่ละสินค้า = ปริมาณ
 */
export function parseBKPFile(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null })

        // Scan rows 0-7 หา row ที่มี SAP 8 หลัก (flexible — รองรับ title row หลายบรรทัด)
        type ProductInfo = { sku: string; name: string; colStart: number }
        let productRowIdx = -1
        let products: ProductInfo[] = []

        for (let r = 0; r < Math.min(raw.length, 8); r++) {
          const row = raw[r] ?? []
          const found: ProductInfo[] = []
          for (let c = 0; c < row.length; c++) {
            const cell = String(row[c] ?? '').trim()
            if (!cell) continue
            const sapMatch = cell.match(/(?<!\d)(\d{8})(?!\d)/)
            if (sapMatch) {
              const sku = sapMatch[1]
              const name = cell.replace(sapMatch[0], '').replace(/^[-\s]+|[-\s]+$/g, '').trim()
              found.push({ sku, name, colStart: c })
            }
          }
          if (found.length > 0) { productRowIdx = r; products = found; break }
        }
        if (!products.length) throw new Error('ไม่พบรหัส SAP 8 หลักในไฟล์ (scan 8 แถวแรก)')

        // หา sub-header row ที่มี "แผน" (ค้นหาจาก productRowIdx+1)
        let subHeaderRowIdx = -1
        const planColsByProduct: number[] = products.map(() => -1)
        for (let r = productRowIdx + 1; r < Math.min(raw.length, productRowIdx + 6); r++) {
          const row = raw[r] ?? []
          if (!row.some(c => String(c ?? '').trim() === 'แผน')) continue
          subHeaderRowIdx = r
          for (let p = 0; p < products.length; p++) {
            const nextCol = p + 1 < products.length ? products[p + 1].colStart : row.length
            for (let c = products[p].colStart; c < nextCol; c++) {
              if (String(row[c] ?? '').trim() === 'แผน') { planColsByProduct[p] = c; break }
            }
          }
          break
        }
        if (subHeaderRowIdx < 0) throw new Error('ไม่พบ header "แผน" ในไฟล์ BKP')

        // หา date column จาก sub-header row ("วันที่ส่งถึง") — fallback = index 2 (column C)
        const subHeaderRow = raw[subHeaderRowIdx] ?? []
        const dateColIdx = (() => {
          const idx = subHeaderRow.findIndex((c: string | number | null) => String(c ?? '').includes('วันที่ส่งถึง') || String(c ?? '').includes('วันที่'))
          return idx >= 0 ? idx : 2
        })()

        // อ่านข้อมูล
        const results: ParsedRow[] = []
        for (let r = subHeaderRowIdx + 1; r < raw.length; r++) {
          const row = raw[r] ?? []
          const dateCellRaw = row[dateColIdx]
          if (!dateCellRaw) continue

          let deliveryDate = ''
          if (typeof dateCellRaw === 'number' && dateCellRaw > 40000) {
            const d = new Date(Math.round((dateCellRaw - 25569) * 86400 * 1000))
            deliveryDate = d.toISOString().split('T')[0]
          } else if (typeof dateCellRaw === 'string' && dateCellRaw.trim()) {
            deliveryDate = thaiDateToISO(dateCellRaw.trim())
          }
          if (!deliveryDate || deliveryDate.length < 8) continue

          const productionDate = shiftISODate(deliveryDate, -1)

          for (let p = 0; p < products.length; p++) {
            const planCol = planColsByProduct[p]
            if (planCol < 0) continue
            const qty = Number(row[planCol] ?? 0)
            if (!qty || qty <= 0) continue
            results.push({
              production_date: productionDate,
              delivery_date:   deliveryDate,
              sku:             products[p].sku,
              sku_name:        products[p].name || null,
              quantity:        qty,
            })
          }
        }
        if (!results.length) throw new Error('ไม่พบข้อมูลในไฟล์ BKP')
        resolve(results)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ BKP ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

export function parseNoWithdrawalSkus(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsv(file)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
        const results: ParsedRow[] = raw
          .map(r => {
            const keys = Object.keys(r)
            const find = (...kws: string[]) =>
              keys.find(k => kws.every(kw => k.toLowerCase().includes(kw))) ?? ''

            const stationCol = find('จุดงาน') || find('station') || find('work') || ''
            const groupCol   = find('กลุ่ม') || find('group') || ''
            const sapCol     = find('sap')   || find('รหัส') || ''
            const nameCol    = find('ชื่อ')  || find('name') || find('product') || ''

            return {
              work_station:  String(r[stationCol] ?? '').trim() || null,
              product_group: String(r[groupCol]   ?? '').trim() || null,
              sap:           String(r[sapCol]     ?? '').trim(),
              product_name:  String(r[nameCol]    ?? '').trim() || null,
            }
          })
          .filter(r => r.sap)
        if (!results.length) throw new Error('ไม่พบรายการที่มีรหัส SAP')
        resolve(results)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

export function parseMooChōdMaster(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsv(file)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
        const results: ParsedRow[] = raw
          .map(r => {
            const keys = Object.keys(r)
            const find = (...kws: string[]) =>
              keys.find(k => kws.every(kw => k.toLowerCase().includes(kw))) ?? ''

            const stationCol = find('จุดงาน') || find('station') || find('work') || ''
            const groupCol   = find('กลุ่ม')   || find('group')   || ''
            const sapCol     = find('sap')     || find('รหัส')    || ''
            const nameCol    = find('ชื่อ')    || find('name')    || find('product') || ''
            const fatCol     = find('ไขมัน')   || find('fat')     || ''

            const fatRaw = r[fatCol]
            let fat_percent: number | null = null
            if (fatRaw != null && fatRaw !== '') {
              const num = parseFloat(String(fatRaw).replace('%', '').trim())
              if (!isNaN(num)) fat_percent = num <= 1 ? Math.round(num * 100) : num
            }

            return {
              work_station:  String(r[stationCol] ?? '').trim() || null,
              product_group: String(r[groupCol]   ?? '').trim() || null,
              sap_code:      String(r[sapCol]     ?? '').trim(),
              product_name:  String(r[nameCol]    ?? '').trim() || null,
              fat_percent,
            }
          })
          .filter(r => !!(r as Record<string, unknown>).sap_code)
        if (!results.length) throw new Error('ไม่พบรายการที่มีรหัส SAP')
        resolve(results)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

// Parser สำหรับ Master เบิกของหมูบด — ไฟล์ 2 กลุ่มเคียงกัน: เนื้อ (ซ้าย) + มัน (ขวา)
// Header: Priority | Sap เนื้อ | ชื่อเนื้อ | %ไขมัน | Priority | Sap มัน | ชื่อมัน | %ไขมัน
export function parseMooChōdWithdrawalMaster(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null })

        if (!aoa.length) throw new Error('ไม่พบข้อมูล')

        let hIdx = 0
        for (let i = 0; i < Math.min(5, aoa.length); i++) {
          const row = aoa[i]
          if (row.some(c => String(c ?? '').toLowerCase().includes('priority') || String(c ?? '').includes('%ไขมัน'))) {
            hIdx = i; break
          }
        }

        const headers = aoa[hIdx].map(c => String(c ?? '').trim().toLowerCase())

        const allPriority = headers.reduce<number[]>((a, h, i) => h.includes('priority') ? [...a, i] : a, [])
        const allSap      = headers.reduce<number[]>((a, h, i) => h.includes('sap') ? [...a, i] : a, [])
        const allName     = headers.reduce<number[]>((a, h, i) => (h.includes('ชื่อ') || (h.includes('name') && !h.includes('%'))) ? [...a, i] : a, [])
        const allFat      = headers.reduce<number[]>((a, h, i) => (h.includes('ไขมัน') || (h.includes('fat') && !h.includes('name'))) ? [...a, i] : a, [])

        const mPri = allPriority[0] ?? -1; const fPri = allPriority[1] ?? -1
        const mSap = allSap[0]      ?? -1; const fSap = allSap[1]      ?? -1
        const mNam = allName[0]     ?? -1; const fNam = allName[1]     ?? -1
        const mFat = allFat[0]      ?? -1; const fFat = allFat[1]      ?? -1

        const parseFatVal = (v: string | number | null): number | null => {
          if (v == null || v === '') return null
          const n = parseFloat(String(v).replace('%', '').trim())
          if (isNaN(n)) return null
          return n <= 1 ? Math.round(n * 100) : n
        }
        const parsePriority = (v: string | number | null) =>
          parseInt(String(v ?? '').replace(/[^\d]/g, '')) || 0

        const results: ParsedRow[] = []

        for (let i = hIdx + 1; i < aoa.length; i++) {
          const row = aoa[i]

          const mSapStr = String(row[mSap] ?? '').trim()
          const mNamStr = String(row[mNam] ?? '').trim()
          if (row[mPri] != null || mSapStr || mNamStr) {
            results.push({
              ingredient_type: 'เนื้อ',
              priority:    parsePriority(row[mPri]),
              sap_code:    mSapStr || null,
              product_name: mNamStr || null,
              fat_percent:  parseFatVal(row[mFat]),
            })
          }

          const fSapStr = String(row[fSap] ?? '').trim()
          const fNamStr = String(row[fNam] ?? '').trim()
          if (row[fPri] != null || fSapStr || fNamStr) {
            results.push({
              ingredient_type: 'มัน',
              priority:    parsePriority(row[fPri]),
              sap_code:    fSapStr || null,
              product_name: fNamStr || null,
              fat_percent:  parseFatVal(row[fFat]),
            })
          }
        }

        const filtered = results.filter(r => (r.priority as number) > 0 || r.sap_code || r.product_name)
        if (!filtered.length) throw new Error('ไม่พบรายการที่ถูกต้อง')
        resolve(filtered)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

export function parseMasPriorityWithdrawal(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsv(file)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
        const results: ParsedRow[] = raw
          .map(r => {
            const keys = Object.keys(r)
            const find = (...kws: string[]) =>
              keys.find(k => kws.every(kw => k.toLowerCase().includes(kw))) ?? ''

            const phaseCol     = find('phase') || find('เฟส') || find('ขั้น') || ''
            const stationCol   = find('station') || find('สถานี') || find('สาย') || ''
            const orderCol     = find('ลำดับ') || find('order') || find('priority') || ''
            const conditionCol = find('เงื่อนไข') || find('condition') || find('cond') || ''

            return {
              phase:          String(r[phaseCol]     ?? '').trim() || null,
              station:        String(r[stationCol]   ?? '').trim() || null,
              priority_order: Number(r[orderCol]     ?? 0) || 0,
              condition:      String(r[conditionCol] ?? '').trim() || null,
            }
          })
          .filter(r => r.phase && r.station)
        if (!results.length) throw new Error('ไม่พบรายการที่มี Phase และ Station')
        resolve(results)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

export function parseSawMachineSku(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsv(file)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
        const results: ParsedRow[] = raw
          .map(r => {
            const keys = Object.keys(r)
            const find = (...kws: string[]) =>
              keys.find(k => kws.every(kw => k.toLowerCase().includes(kw))) ?? ''

            const stationCol = find('จุดงาน') || find('station') || ''
            const groupCol   = find('กลุ่ม')   || find('group')   || ''
            const sapCol     = find('sap')     || find('รหัส')    || ''
            const nameCol    = find('ชื่อ')    || find('name')    || ''
            const rateCol    = find('กำลังการผลิต') || find('rate') || find('กำลัง') || ''
            const timingCol  = find('ช่วงเวลา') || find('ประเภท') || find('timing') || ''

            return {
              station:       String(r[stationCol] ?? '').trim() || null,
              product_group: String(r[groupCol]   ?? '').trim() || null,
              sku:           String(r[sapCol]      ?? '').trim(),
              sku_name:      String(r[nameCol]     ?? '').trim() || null,
              rate:          Number(r[rateCol]     ?? 0) || 0,
              timing:        String(r[timingCol]   ?? '').trim() || null,
            }
          })
          .filter(r => r.sku)
        if (!results.length) throw new Error('ไม่พบรายการที่มีรหัส SAP')
        resolve(results)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

export function parseMasSpecialRaw(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsv(file)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
        const results: ParsedRow[] = raw
          .map(r => {
            const keys = Object.keys(r)
            const find = (...kws: string[]) =>
              keys.find(k => kws.every(kw => k.toLowerCase().includes(kw.toLowerCase()))) ?? ''
            const groupCol   = find('กลุ่มสินค้า') || find('group') || ''
            const stationCol = find('จุดงาน')      || find('station') || ''
            const d16Col     = find('D16') || find('d16') || ''
            const d17Col     = find('D17') || find('d17') || ''
            return {
              product_group: String(r[groupCol]   ?? '').trim() || null,
              station:       String(r[stationCol] ?? '').trim() || null,
              d16:           String(r[d16Col]     ?? '').trim() || null,
              d17:           String(r[d17Col]     ?? '').trim() || null,
            }
          })
          .filter(r => r.product_group && r.station)
        if (!results.length) throw new Error('ไม่พบรายการที่มีกลุ่มสินค้าและจุดงาน')
        resolve(results)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

export function parseMasBeikKha(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsv(file)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
        const results: ParsedRow[] = raw
          .map(r => {
            const keys = Object.keys(r)
            const find = (...kws: string[]) =>
              keys.find(k => kws.every(kw => k.toLowerCase().includes(kw))) ?? ''
            const groupCol  = find('กลุ่ม')  || find('group')  || ''
            const sapCol    = find('sap')    || find('รหัส')   || ''
            const nameCol   = find('ชื่อ')   || find('name')   || ''
            const sourceCol = find('ต้นทาง') || find('source') || ''
            const destCol   = find('ปลายทาง') || find('dest')  || ''
            return {
              product_group:  String(r[groupCol]  ?? '').trim() || null,
              sap:            String(r[sapCol]     ?? '').trim(),
              sku_name:       String(r[nameCol]    ?? '').trim() || null,
              source_station: String(r[sourceCol]  ?? '').trim() || null,
              dest_station:   String(r[destCol]    ?? '').trim() || null,
            }
          })
          .filter(r => r.sap)
        if (!results.length) throw new Error('ไม่พบรายการที่มีรหัส SAP')
        resolve(results)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}

// BOM พิเศษ — row 0: headers ["Code","Sap","สินค้า","รหัส Raw","SAP RAW","ชื่อ Raw","น้ำหนักต่อตะกร้า","% Yield สินค้า"]
// Data rows: one row per (product, raw, weight_condition), e.g. "< 17.6" / ">= 17.6"
export function parseBomSpecial(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null })

        const results: ParsedRow[] = []
        for (let i = 1; i < raw.length; i++) {
          const r = raw[i]
          if (!r) continue
          const productSap      = String(r[1] ?? '').trim()
          const rawSap          = String(r[4] ?? '').trim()
          const weightCondition = String(r[6] ?? '').trim()
          if (!productSap || !rawSap || !weightCondition) continue
          results.push({
            product_code:     String(r[0] ?? '').trim() || null,
            product_sap:      productSap,
            product_name:     String(r[2] ?? '').trim() || null,
            raw_code:         String(r[3] ?? '').trim() || null,
            raw_sap:          rawSap,
            raw_name:         String(r[5] ?? '').trim() || null,
            weight_condition:  weightCondition,
            yield_pct:        Number(r[7]) || 0,
          })
        }
        if (!results.length) throw new Error('ไม่พบรายการที่มี SAP สินค้า, SAP Raw และเงื่อนไขน้ำหนัก')
        resolve(results)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('ไม่สามารถอ่านไฟล์ BOM พิเศษ ได้'))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}
