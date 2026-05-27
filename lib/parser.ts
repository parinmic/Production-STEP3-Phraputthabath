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

/**
 * ประมวลผล sheet "แผน Makro 100%" จาก raw array-of-arrays
 * รองรับ rReq_date ที่ col A หรือ col B, รหัสสินค้าที่เป็น number หรือ string
 */
function processMakroPlan100Sheet(raw: (string | number | null)[][]): ParsedRow[] {
  // หาวันส่ง: rReq_date อาจอยู่ col A (index 0) หรือ col B (index 1)
  let deliveryDate = ''
  for (let i = 0; i < 10; i++) {
    const row = raw[i]
    if (!row) continue
    const a = String(row[0] ?? '').trim()
    const b = String(row[1] ?? '').trim()
    if (a === 'rReq_date') { deliveryDate = shiftISODate(thaiDateToISO(b), -1); break }
    if (b === 'rReq_date') { deliveryDate = shiftISODate(thaiDateToISO(String(row[2] ?? '')), -1); break }
  }

  // หา header row (col 1 = 'rProduct_code')
  const hIdx = raw.findIndex(row => row && String(row[1] ?? '') === 'rProduct_code')
  if (hIdx < 0) throw new Error('ไม่พบ header row (rProduct_code) ในชีท แผน Makro 100%')

  const hRow = raw[hIdx]
  const totalCol = hRow.findIndex(c =>
    String(c ?? '').includes('ผลรวม') || String(c ?? '').toLowerCase().includes('grand total')
  )

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

    // ถ้าหาคอลัมน์ผลรวมไม่เจอ ให้รวมค่าสาขาทั้งหมด (col 3 เป็นต้นไป)
    const qty = totalCol >= 0
      ? (Number(row[totalCol]) || 0)
      : (row.slice(3) as (string | number | null)[]).reduce<number>((s, v) => s + (Number(v) || 0), 0)
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
        const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null })
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
        if (wb.SheetNames.includes('แผน Makro 100%')) {
          const ws = wb.Sheets['แผน Makro 100%']
          const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null })
          resolve(processMakroPlan100Sheet(raw))
        } else {
          // rXxx format: ข้อมูลอยู่ sheet 2, Row 1 = ชื่อบริษัท → range:1
          const sheetName = wb.SheetNames[1] ?? wb.SheetNames[0]
          const sheet = wb.Sheets[sheetName]
          resolve(XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: null, range: 1 }))
        }
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
            return {
              step:           String(r[stepCol] ?? '').trim() || null,
              unix_code:      String(r[unixCol] ?? '').trim() || null,
              sap:            String(r[sapCol]  ?? '').trim(),
              product_name:   String(r[nameCol] ?? '').trim() || null,
              weight_per_bag: Number(r[wgtCol]) || 0,
              unit:           String(r[unitCol] ?? '').trim() || 'ถุง',
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
 * - แถวที่ 2 (index 1): ชื่อสินค้าที่มีรหัส SAP 8 หลัก
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

        // แถวที่ 2 (index 1): หา SAP codes 8 หลักพร้อม column position
        const productRow = raw[1] ?? []
        type ProductInfo = { sku: string; name: string; colStart: number }
        const products: ProductInfo[] = []
        for (let c = 0; c < productRow.length; c++) {
          const cell = String(productRow[c] ?? '').trim()
          if (!cell) continue
          const sapMatch = cell.match(/\b(\d{8})\b/)
          if (sapMatch) {
            const sku = sapMatch[1]
            const name = cell.replace(sapMatch[0], '').replace(/^[-\s]+|[-\s]+$/g, '').trim()
            products.push({ sku, name, colStart: c })
          }
        }
        if (!products.length) throw new Error('ไม่พบรหัส SAP 8 หลักในแถวที่ 2')

        // หา sub-header row ที่มี "แผน"
        let subHeaderRowIdx = -1
        const planColsByProduct: number[] = products.map(() => -1)
        for (let r = 2; r < Math.min(raw.length, 8); r++) {
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

        // อ่านข้อมูล
        const results: ParsedRow[] = []
        for (let r = subHeaderRowIdx + 1; r < raw.length; r++) {
          const row = raw[r] ?? []
          const dateCellRaw = row[2]
          if (!dateCellRaw) continue

          let deliveryDate = ''
          if (typeof dateCellRaw === 'number' && dateCellRaw > 40000) {
            const d = new Date(Math.round((dateCellRaw - 25569) * 86400 * 1000))
            deliveryDate = d.toISOString().split('T')[0]
          } else if (typeof dateCellRaw === 'string' && dateCellRaw.trim()) {
            deliveryDate = thaiDateToISO(dateCellRaw.trim())
          } else if (dateCellRaw instanceof Date) {
            deliveryDate = (dateCellRaw as Date).toISOString().split('T')[0]
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

