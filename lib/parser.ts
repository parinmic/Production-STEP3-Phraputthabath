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
