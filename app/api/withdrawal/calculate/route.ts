import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { allocateFIFOWithRules, RawMaterialRule } from '@/lib/withdrawal-rules'


const PERIOD: Record<string, string> = { '1': 'เช้า', '2': 'บ่าย', '3': 'ค่ำ' }

const PHASE_ROUND_MINS: Record<string, number[]> = {
  '1': [510, 600, 780],
  '2': [870],
  '3': [990, 1080, 1200],
}

const DEFAULT_START_MINS: Record<string, number> = {
  '1': 510, '2': 870, '3': 990,
}

function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.floor(mins % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// normalize material name สำหรับ fallback matching
// ทำให้ "สันนอก-Raw" และ "สันนอก - Raw" ตรงกัน
const normMatName = (s: string) => s.trim().toLowerCase().replace(/\s*-\s*/g, '-')

function timeStrToMins(t: string): number {
  const parts = String(t ?? '').split(':')
  return parseInt(parts[0] ?? '0') * 60 + parseInt(parts[1] ?? '0')
}

function getRoundMins(startMins: number, roundMins: number[]): number {
  let round = roundMins[0]
  for (const r of roundMins) {
    if (startMins >= r) round = r
    else break
  }
  return round
}

/** Parse "rounds:480=575;600=575" → Map<roundMins, qty> */
function parseRoundNote(note: string | null): Map<number, number> {
  const result = new Map<number, number>()
  if (!note?.startsWith('rounds:')) return result
  for (const part of note.replace('rounds:', '').split(';')) {
    const [rStr, qStr] = part.split('=')
    if (rStr && qStr) result.set(parseInt(rStr), parseFloat(qStr))
  }
  return result
}

export interface LotInfo {
  spec_code: string
  factory: string
  prod_date: string
  available: number
  to_withdraw: number
  insufficient?: boolean
}

function parseSpecCode(s: string): { factory: string; prod_date: string; sortKey: string } | null {
  // Format 1: letter(s) followed by 6 digits e.g. "AB030605K" or "03261250K030605"
  const m1 = s.match(/[A-Z]+(\d{2})(\d{2})(\d{2})/)
  if (m1) return {
    factory:   m1[1],
    prod_date: `${m1[2]}/${m1[3]}`,
    sortKey:   `${m1[3]}${m1[2]}`,
  }
  // Format 2: all-digit prefix + trailing letter e.g. "03261250K"
  // factory(2) + year(2) + month(2) + batch(2) + lot_letter(s)
  const m2 = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})[A-Z]/)
  if (m2) return {
    factory:   m2[1],
    prod_date: `${m2[3]}/${m2[2]}`,
    sortKey:   `${m2[2]}${m2[3]}${m2[4]}`,
  }
  return null
}

function allocateFIFO(
  lots: { spec_code: string; weight: number; factory: string; prod_date: string }[],
  needed: number,
): LotInfo[] {
  const result: LotInfo[] = []
  let remaining = needed
  for (const lot of lots) {
    if (remaining <= 0.005) break
    if (lot.weight <= 0.005) continue  // lot นี้ถูกใช้หมดแล้วจากรอบก่อน
    const take = Math.min(remaining, lot.weight)
    result.push({
      spec_code:   lot.spec_code,
      factory:     lot.factory,
      prod_date:   lot.prod_date,
      available:   Math.round(lot.weight * 100) / 100,
      to_withdraw: Math.round(take  * 100) / 100,
    })
    lot.weight -= take  // หักจาก stock จริง เพื่อให้รอบถัดไปเห็น stock ที่เหลือ
    remaining  -= take
  }
  if (remaining > 0.005) {
    result.push({
      spec_code:   '— ไม่เพียงพอ —',
      factory:     '-',
      prod_date:   '-',
      available:   0,
      to_withdraw: Math.round(remaining * 100) / 100,
      insufficient: true,
    })
  }
  return result
}

export async function POST(req: NextRequest) {
  try {
  const { date, phase } = await req.json()
  const phaseStr = String(phase)
  const period = PERIOD[phaseStr]
  if (!date || !period) return NextResponse.json({ error: 'missing params' }, { status: 400 })

  // ดึงกฎ Mas Raw Material
  const { data: rawMaterialRules } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('calculation_type', 'Mas Raw Material')
    .order('uploaded_at', { ascending: false })

  const rules: RawMaterialRule[] = (rawMaterialRules ?? []).map(r => {
    const data = (r.row_data ?? {}) as Record<string, any>
    return {
      productGroup: String(data['กลุ่มสินค้า'] ?? '').trim(),
      type: String(data['ประเภท'] ?? '').trim(),
      d16: String(data['D16'] ?? '').trim(),
      d17: String(data['D17'] ?? '').trim(),
    }
  })

  const roundMins = PHASE_ROUND_MINS[phaseStr] ?? PHASE_ROUND_MINS['1']

  // 1. ดึง production_assignments พร้อม note (round breakdown) และ deadline_time (fallback)
  const { data: assignments, error: e1 } = await supabase
    .from('production_assignments')
    .select('table_name, sku, sku_name, target_quantity, deadline_time, note')
    .eq('production_date', date)
    .eq('period', period)
    .in('table_name', ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์'])

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
  if (!assignments?.length) {
    return NextResponse.json({ items: [], message: `ไม่พบคำสั่งผลิต Phase ${phase} วันที่ ${date}` })
  }

  // Fetch SKUs that do not require withdrawal
  const { data: noWithdrawalRows } = await supabase
    .from('no_withdrawal_skus')
    .select('sap')

  const noWithdrawalSaps = new Set((noWithdrawalRows ?? []).map(r => String(r.sap ?? '').trim()))

  // Filter assignments: skip any whose SKU is in the no_withdrawal_skus master table
  const activeAssignments = assignments.filter(a => !noWithdrawalSaps.has(String(a.sku ?? '').trim()))
  if (!activeAssignments.length) {
    return NextResponse.json({ items: [], message: `ไม่พบรายการเบิก เนื่องจาก SKU ทั้งหมดในแผนผลิตเป็น SKU ที่ไม่ต้องเบิกของ` })
  }

  // 2. Build finRoundMap: (station|||sku) → Map<roundMins, qty>
  //    ใช้ข้อมูล per-round จาก note (ถ้ามี) หรือ fallback จาก deadline_time
  const finRoundMap = new Map<string, Map<number, number>>()
  const finNameMap  = new Map<string, string | null>()
  const skuSet      = new Set<string>()

  for (const a of activeAssignments) {
    const key = `${a.table_name}|||${a.sku}`
    if (!finRoundMap.has(key)) finRoundMap.set(key, new Map())
    finNameMap.set(key, a.sku_name ?? null)
    skuSet.add(a.sku)

    const roundQtys = finRoundMap.get(key)!
    const noteRounds = parseRoundNote(a.note)

    if (noteRounds.size > 0) {
      // มีข้อมูล per-round จาก generate → นำมา map เข้ากับ round boundary ของ withdrawal
      for (const [rm, q] of Array.from(noteRounds.entries())) {
        const mappedRm = getRoundMins(rm, roundMins)
        roundQtys.set(mappedRm, (roundQtys.get(mappedRm) ?? 0) + q)
      }
    } else {
      // fallback: ถ้าไม่มี round breakdown ใช้ deadline_time เป็น start time
      const startMins = a.deadline_time
        ? timeStrToMins(String(a.deadline_time))
        : DEFAULT_START_MINS[phaseStr]
      const rm = getRoundMins(startMins, roundMins)
      roundQtys.set(rm, (roundQtys.get(rm) ?? 0) + Number(a.target_quantity))
    }
  }

  // 3. ดึง BOM
  const skus = Array.from(skuSet)
  const { data: bomRows, error: e2 } = await supabase
    .from('bom_items')
    .select('product_sap, raw_sap, raw_name, yield_pct')
    .in('product_sap', skus)
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

  const bomMap = new Map<string, { raw_sap: string; raw_name: string | null; yield_pct: number }[]>()
  for (const b of bomRows ?? []) {
    if (!b.raw_sap) continue
    const list = bomMap.get(b.product_sap) ?? []
    list.push({ raw_sap: b.raw_sap, raw_name: b.raw_name ?? null, yield_pct: b.yield_pct ?? 0 })
    bomMap.set(b.product_sap, list)
  }

  // 4. คำนวณ raw material ต่อ (station, raw_sap, roundMins)
  interface RawEntry { station: string; raw_sap: string; raw_name: string | null; qty: number; roundMins: number }
  const rawMap = new Map<string, RawEntry>()
  const rawToProducts = new Map<string, { sku: string; sku_name: string | null; qty: number; rawQty: number }[]>()
  const noBom: { station: string; sku: string; sku_name: string | null; qty: number; roundMins: number }[] = []

  for (const [finKey, roundQtys] of Array.from(finRoundMap.entries())) {
    const [station, sku] = finKey.split('|||')
    const sku_name = finNameMap.get(finKey) ?? null
    const boms = bomMap.get(sku)

    for (const [rm, finQty] of Array.from(roundQtys.entries())) {
      if (!boms?.length) {
        noBom.push({ station, sku, sku_name, qty: finQty, roundMins: rm })
        continue
      }
      for (const b of boms) {
        const rawQty = b.yield_pct > 0 ? finQty / b.yield_pct : finQty
        const rawKey = `${station}|||${b.raw_sap}|||${rm}`
        const cur = rawMap.get(rawKey)
        if (cur) { cur.qty += rawQty }
        else { rawMap.set(rawKey, { station, raw_sap: b.raw_sap, raw_name: b.raw_name, qty: rawQty, roundMins: rm }) }
        const prodList = rawToProducts.get(rawKey) ?? []
        prodList.push({ sku, sku_name, qty: finQty, rawQty })
        rawToProducts.set(rawKey, prodList)
      }
    }
  }

  // 5. ดึง stock
  const rawSaps  = Array.from(new Set(Array.from(rawMap.values()).map(v => v.raw_sap)))
  const rawNames = Array.from(new Set(Array.from(rawMap.values()).map(v => v.raw_name).filter(Boolean) as string[]))

  type StockRow = { material_code: string; material_name: string | null; spec_code: string; weight_total: number }
  const stockRows: StockRow[] = []

  if (rawSaps.length > 0) {
    const [res0010, res20] = await Promise.all([
      supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
    ])
    stockRows.push(...(res0010.data ?? []) as StockRow[], ...(res20.data ?? []) as StockRow[])
  }

  // Name-based fallback: for any raw_sap that returned no stock rows, re-query by material_name
  // ขยาย names ให้ครอบทั้ง "สันนอก-Raw" และ "สันนอก - Raw" (stock ใช้ UNIX code ไม่ใช่ SAP)
  const foundCodes = new Set(stockRows.map(r => r.material_code))
  const missingNames = Array.from(new Set(
    Array.from(rawMap.values())
      .filter(v => !foundCodes.has(v.raw_sap))
      .map(v => v.raw_name)
      .filter(Boolean) as string[]
  ))
  if (missingNames.length > 0) {
    const expandedNames = Array.from(new Set(missingNames.flatMap(n => [
      n,
      n.replace(/\s*-\s*/g, '-'),     // "สันนอก - Raw" → "สันนอก-Raw"
      n.replace(/\s*-\s*/g, ' - '),   // "สันนอก-Raw"   → "สันนอก - Raw"
    ])))
    const [res0010n, res20n] = await Promise.all([
      supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
    ])
    stockRows.push(...(res0010n.data ?? []) as StockRow[], ...(res20n.data ?? []) as StockRow[])
  }

  type LotEntry = { spec_code: string; weight: number; factory: string; prod_date: string; sortKey: string }
  const lotAggCode = new Map<string, number>()
  const matCodeToName = new Map<string, string>()  // material_code → material_name
  for (const row of stockRows) {
    if (!row.material_code || !row.spec_code) continue
    const k = `${row.material_code}|||${row.spec_code}`
    lotAggCode.set(k, (lotAggCode.get(k) ?? 0) + Number(row.weight_total))
    if (row.material_name) matCodeToName.set(row.material_code, row.material_name)
  }

  const stockByMat  = new Map<string, LotEntry[]>()  // by material_code
  const stockByName = new Map<string, LotEntry[]>()  // by normalized material_name (fallback)
  for (const [k, weight] of Array.from(lotAggCode.entries())) {
    const [matCode, spec_code] = k.split('|||')
    const parsed = parseSpecCode(spec_code)
    const lot: LotEntry = { spec_code, weight, factory: parsed?.factory ?? '-', prod_date: parsed?.prod_date ?? '-', sortKey: parsed?.sortKey ?? spec_code }

    const codeList = stockByMat.get(matCode) ?? []
    codeList.push(lot)
    stockByMat.set(matCode, codeList)

    const matName = matCodeToName.get(matCode)
    if (matName) {
      const nameKey = normMatName(matName)
      const nameList = stockByName.get(nameKey) ?? []
      nameList.push(lot)
      stockByName.set(nameKey, nameList)
    }
  }
  for (const list of Array.from(stockByMat.values())) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  for (const list of Array.from(stockByName.values())) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  // 6. สร้าง output items พร้อม withdrawal_round
  // sort by roundMins ก่อน เพื่อให้ FIFO หักรอบเก่าออกก่อนเสมอ
  const rawItems = Array.from(rawMap.values())
    .sort((a, b) => a.roundMins - b.roundMins)
    .map(({ station, raw_sap, raw_name, qty, roundMins }) => {
    const needed  = Math.round(qty * 100) / 100
    const nameKey = normMatName(raw_name ?? '')
    const lots    = stockByMat.get(raw_sap) ?? stockByName.get(nameKey)
    const rawKey  = `${station}|||${raw_sap}|||${roundMins}`
    return {
      sku:              raw_sap,
      sku_name:         raw_name,
      quantity:         needed,
      unit:             'กก.',
      work_station:     station,
      note:             'คำนวณจาก BOM',
      lots:             lots ? allocateFIFOWithRules(raw_name ?? '', lots, rawToProducts.get(rawKey) ?? [], rules) : [],
      for_products:     rawToProducts.get(rawKey) ?? [],
      withdrawal_round: minsToTime(roundMins),
    }
  })

  const noBomItems = noBom.map(({ station, sku, sku_name, qty, roundMins }) => ({
    sku,
    sku_name,
    quantity:         Math.round(qty * 100) / 100,
    unit:             'กก.',
    work_station:     station,
    note:             'ไม่พบ BOM — ใช้ปริมาณผลิตโดยตรง',
    lots:             [] as LotInfo[],
    withdrawal_round: minsToTime(roundMins),
  }))

  const items = [...rawItems, ...noBomItems].sort((a, b) =>
    a.withdrawal_round.localeCompare(b.withdrawal_round) ||
    (a.work_station ?? '').localeCompare(b.work_station ?? '') ||
    (a.sku ?? '').localeCompare(b.sku ?? '')
  )

  return NextResponse.json({ items })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('calculate error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
