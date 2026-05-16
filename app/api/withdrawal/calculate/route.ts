import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const PERIOD: Record<string, string> = { '1': 'เช้า', '2': 'บ่าย', '3': 'ค่ำ' }

export interface LotInfo {
  spec_code: string
  factory: string
  prod_date: string   // "DD/MM"
  available: number
  to_withdraw: number
  insufficient?: boolean
}

// spec_code format: [product][LETTER(s)][factory 2d][DD 2d][MM 2d][optional trailing letters]
// e.g. "03261250G030605K" → letter G → factory=03, DD=06, MM=05
function parseSpecCode(s: string): { factory: string; prod_date: string; sortKey: string } | null {
  const m = s.match(/[A-Z]+(\d{2})(\d{2})(\d{2})/)
  if (!m) return null
  return {
    factory:   m[1],
    prod_date: `${m[2]}/${m[3]}`,
    sortKey:   `${m[3]}${m[2]}`,  // MMDD → sort chronologically (oldest first)
  }
}

function allocateFIFO(
  lots: { spec_code: string; weight: number; factory: string; prod_date: string }[],
  needed: number,
): LotInfo[] {
  const result: LotInfo[] = []
  let remaining = needed
  for (const lot of lots) {
    if (remaining <= 0.005) break
    const take = Math.min(remaining, lot.weight)
    result.push({
      spec_code:   lot.spec_code,
      factory:     lot.factory,
      prod_date:   lot.prod_date,
      available:   Math.round(lot.weight * 100) / 100,
      to_withdraw: Math.round(take  * 100) / 100,
    })
    remaining -= take
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
  const period = PERIOD[String(phase)]
  if (!date || !period) return NextResponse.json({ error: 'missing params' }, { status: 400 })

  // 1. ดึง production_assignments เฉพาะ 3 station พิเศษ
  const { data: assignments, error: e1 } = await supabase
    .from('production_assignments')
    .select('table_name, sku, sku_name, target_quantity')
    .eq('production_date', date)
    .eq('period', period)
    .in('table_name', ['สามชั้น', 'สะโพก', 'ไหล่'])

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
  if (!assignments?.length) {
    return NextResponse.json({ items: [], message: `ไม่พบคำสั่งผลิต Phase ${phase} วันที่ ${date}` })
  }

  // 2. รวม target_quantity ต่อ (station, finished_sku)
  const finMap = new Map<string, { station: string; sku: string; sku_name: string | null; qty: number }>()
  const skuSet = new Set<string>()
  for (const a of assignments) {
    const key = `${a.table_name}|||${a.sku}`
    const cur = finMap.get(key)
    if (cur) { cur.qty += Number(a.target_quantity) }
    else { finMap.set(key, { station: a.table_name, sku: a.sku, sku_name: a.sku_name ?? null, qty: Number(a.target_quantity) }) }
    skuSet.add(a.sku)
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

  // 4. คำนวณปริมาณวัตถุดิบ raw_qty = finished_qty / yield_pct
  const rawMap = new Map<string, { station: string; raw_sap: string; raw_name: string | null; qty: number }>()
  const rawToProducts = new Map<string, { sku: string; sku_name: string | null; qty: number }[]>()
  const noBom: { station: string; sku: string; sku_name: string | null; qty: number }[] = []

  for (const { station, sku, sku_name, qty } of Array.from(finMap.values())) {
    const boms = bomMap.get(sku)
    if (!boms?.length) { noBom.push({ station, sku, sku_name, qty }); continue }
    for (const b of boms) {
      const rawQty = b.yield_pct > 0 ? qty / b.yield_pct : qty
      const key = `${station}|||${b.raw_sap}`
      const cur = rawMap.get(key)
      if (cur) { cur.qty += rawQty }
      else { rawMap.set(key, { station, raw_sap: b.raw_sap, raw_name: b.raw_name, qty: rawQty }) }
      // inverse: raw → which finished goods use it
      const prodList = rawToProducts.get(key) ?? []
      prodList.push({ sku, sku_name: sku_name ?? null, qty })
      rawToProducts.set(key, prodList)
    }
  }

  // 5. ดึง stock จากทั้ง stock_0010 และ stock_20
  const rawSaps = Array.from(new Set(
    Array.from(rawMap.values() as Iterable<{ raw_sap: string }>).map(v => v.raw_sap)
  ))

  // ถ้าไม่มีวัตถุดิบจาก BOM เลย ข้ามขั้นตอน stock
  const stockRows: { material_code: string; spec_code: string; weight_total: number }[] = []
  if (rawSaps.length > 0) {
    const [res0010, res20] = await Promise.all([
      supabase.from('stock_0010').select('material_code, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
    ])
    if (res0010.error) console.error('stock_0010 error:', res0010.error.message)
    if (res20.error)   console.error('stock_20 error:',   res20.error.message)
    stockRows.push(...(res0010.data ?? []), ...(res20.data ?? []))
  }

  // รวม weight_total ต่อ (material_code, spec_code) จากทั้งสองตาราง
  const lotAgg = new Map<string, number>()  // key = `${material_code}|||${spec_code}`
  for (const row of stockRows) {
    if (!row.material_code || !row.spec_code) continue
    const k = `${row.material_code}|||${row.spec_code}`
    lotAgg.set(k, (lotAgg.get(k) ?? 0) + Number(row.weight_total))
  }

  // จัดกลุ่มและเรียง FIFO (วันผลิตเก่าสุดก่อน)
  const stockByMat = new Map<string, { spec_code: string; weight: number; factory: string; prod_date: string; sortKey: string }[]>()
  for (const [k, weight] of Array.from(lotAgg.entries())) {
    const [matCode, spec_code] = k.split('|||')
    const parsed = parseSpecCode(spec_code)
    const lot = {
      spec_code,
      weight,
      factory:   parsed?.factory  ?? '-',
      prod_date: parsed?.prod_date ?? '-',
      sortKey:   parsed?.sortKey  ?? spec_code,
    }
    const list = stockByMat.get(matCode) ?? []
    list.push(lot)
    stockByMat.set(matCode, list)
  }
  for (const list of Array.from(stockByMat.values())) {
    list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  }

  // 6. สร้าง output items พร้อม lot breakdown
  const rawItems = Array.from(
    rawMap.values() as Iterable<{ station: string; raw_sap: string; raw_name: string | null; qty: number }>
  ).map(({ station, raw_sap, raw_name, qty }) => {
    const needed = Math.round(qty * 100) / 100
    const lots   = stockByMat.get(raw_sap)
    const key    = `${station}|||${raw_sap}`
    return {
      sku:          raw_sap,
      sku_name:     raw_name,
      quantity:     needed,
      unit:         'กก.',
      work_station: station,
      note:         'คำนวณจาก BOM',
      lots:         lots ? allocateFIFO(lots, needed) : [],
      for_products: rawToProducts.get(key) ?? [],
    }
  })

  const noBomItems = noBom.map(({ station, sku, sku_name, qty }) => ({
    sku,
    sku_name,
    quantity:     Math.round(qty * 100) / 100,
    unit:         'กก.',
    work_station: station,
    note:         'ไม่พบ BOM — ใช้ปริมาณผลิตโดยตรง',
    lots:         [] as LotInfo[],
  }))

  const items = [...rawItems, ...noBomItems].sort((a, b) =>
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
