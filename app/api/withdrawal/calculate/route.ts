import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const PERIOD: Record<string, string> = { '1': 'เช้า', '2': 'บ่าย', '3': 'ค่ำ' }

// Round config per phase (minutes from midnight)
const PHASE_ROUND_MINS: Record<string, number[]> = {
  '1': [480, 600, 780],   // 08:00, 10:00, 13:00
  '2': [840],             // 14:00
  '3': [960, 1080, 1200], // 16:00, 18:00, 20:00
}

const DEFAULT_START_MINS: Record<string, number> = {
  '1': 480, '2': 840, '3': 960,
}

function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.floor(mins % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function timeStrToMins(t: string): number {
  const parts = String(t ?? '').split(':')
  return parseInt(parts[0] ?? '0') * 60 + parseInt(parts[1] ?? '0')
}

function getWithdrawalRound(startMins: number, phaseStr: string): number {
  const rounds = PHASE_ROUND_MINS[phaseStr] ?? PHASE_ROUND_MINS['1']
  let round = rounds[0]
  for (const r of rounds) {
    if (startMins >= r) round = r
    else break
  }
  return round
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
  const m = s.match(/[A-Z]+(\d{2})(\d{2})(\d{2})/)
  if (!m) return null
  return {
    factory:   m[1],
    prod_date: `${m[2]}/${m[3]}`,
    sortKey:   `${m[3]}${m[2]}`,
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
  const phaseStr = String(phase)
  const period = PERIOD[phaseStr]
  if (!date || !period) return NextResponse.json({ error: 'missing params' }, { status: 400 })

  // 1. ดึง production_assignments พร้อม deadline_time (= actual start time)
  const { data: assignments, error: e1 } = await supabase
    .from('production_assignments')
    .select('table_name, sku, sku_name, target_quantity, deadline_time')
    .eq('production_date', date)
    .eq('period', period)
    .in('table_name', ['สามชั้น', 'สะโพก', 'ไหล่'])

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
  if (!assignments?.length) {
    return NextResponse.json({ items: [], message: `ไม่พบคำสั่งผลิต Phase ${phase} วันที่ ${date}` })
  }

  // 2. Build startTimeMap: (table_name, sku) -> min start_mins (from deadline_time = actual start)
  const startTimeMap = new Map<string, number>()
  for (const a of assignments) {
    const key = `${a.table_name}|||${a.sku}`
    const mins = a.deadline_time ? timeStrToMins(String(a.deadline_time)) : DEFAULT_START_MINS[phaseStr]
    const existing = startTimeMap.get(key)
    if (existing === undefined || mins < existing) startTimeMap.set(key, mins)
  }

  // 3. รวม target_quantity ต่อ (station, finished_sku) พร้อม start_time
  interface FinEntry { station: string; sku: string; sku_name: string | null; qty: number; startMins: number }
  const finMap = new Map<string, FinEntry>()
  const skuSet = new Set<string>()
  for (const a of assignments) {
    const key = `${a.table_name}|||${a.sku}`
    const cur = finMap.get(key)
    const startMins = startTimeMap.get(key) ?? DEFAULT_START_MINS[phaseStr]
    if (cur) {
      cur.qty += Number(a.target_quantity)
      if (startMins < cur.startMins) cur.startMins = startMins
    } else {
      finMap.set(key, { station: a.table_name, sku: a.sku, sku_name: a.sku_name ?? null, qty: Number(a.target_quantity), startMins })
    }
    skuSet.add(a.sku)
  }

  // 4. ดึง BOM
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

  // 5. คำนวณ raw material ต่อ (station, raw_sap, round)
  interface RawEntry { station: string; raw_sap: string; raw_name: string | null; qty: number; roundMins: number }
  const rawMap = new Map<string, RawEntry>()
  const rawToProducts = new Map<string, { sku: string; sku_name: string | null; qty: number }[]>()
  const noBom: { station: string; sku: string; sku_name: string | null; qty: number; startMins: number }[] = []

  for (const { station, sku, sku_name, qty, startMins } of Array.from(finMap.values())) {
    const boms = bomMap.get(sku)
    if (!boms?.length) { noBom.push({ station, sku, sku_name, qty, startMins }); continue }

    const roundMins = getWithdrawalRound(startMins, phaseStr)

    for (const b of boms) {
      const rawQty = b.yield_pct > 0 ? qty / b.yield_pct : qty
      const key = `${station}|||${b.raw_sap}|||${roundMins}`
      const cur = rawMap.get(key)
      if (cur) { cur.qty += rawQty }
      else { rawMap.set(key, { station, raw_sap: b.raw_sap, raw_name: b.raw_name, qty: rawQty, roundMins }) }
      const prodList = rawToProducts.get(key) ?? []
      prodList.push({ sku, sku_name: sku_name ?? null, qty })
      rawToProducts.set(key, prodList)
    }
  }

  // 6. ดึง stock
  const rawSaps = Array.from(new Set(Array.from(rawMap.values()).map(v => v.raw_sap)))
  const stockRows: { material_code: string; spec_code: string; weight_total: number }[] = []
  if (rawSaps.length > 0) {
    const [res0010, res20] = await Promise.all([
      supabase.from('stock_0010').select('material_code, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
    ])
    stockRows.push(...(res0010.data ?? []), ...(res20.data ?? []))
  }

  const lotAgg = new Map<string, number>()
  for (const row of stockRows) {
    if (!row.material_code || !row.spec_code) continue
    const k = `${row.material_code}|||${row.spec_code}`
    lotAgg.set(k, (lotAgg.get(k) ?? 0) + Number(row.weight_total))
  }

  const stockByMat = new Map<string, { spec_code: string; weight: number; factory: string; prod_date: string; sortKey: string }[]>()
  for (const [k, weight] of Array.from(lotAgg.entries())) {
    const [matCode, spec_code] = k.split('|||')
    const parsed = parseSpecCode(spec_code)
    const lot = { spec_code, weight, factory: parsed?.factory ?? '-', prod_date: parsed?.prod_date ?? '-', sortKey: parsed?.sortKey ?? spec_code }
    const list = stockByMat.get(matCode) ?? []
    list.push(lot)
    stockByMat.set(matCode, list)
  }
  for (const list of Array.from(stockByMat.values())) {
    list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  }

  // 7. สร้าง output items พร้อม withdrawal_round
  const rawItems = Array.from(rawMap.values()).map(({ station, raw_sap, raw_name, qty, roundMins }) => {
    const needed = Math.round(qty * 100) / 100
    const lots   = stockByMat.get(raw_sap)
    const key    = `${station}|||${raw_sap}|||${roundMins}`
    return {
      sku:              raw_sap,
      sku_name:         raw_name,
      quantity:         needed,
      unit:             'กก.',
      work_station:     station,
      note:             'คำนวณจาก BOM',
      lots:             lots ? allocateFIFO(lots, needed) : [],
      for_products:     rawToProducts.get(key) ?? [],
      withdrawal_round: minsToTime(roundMins),
    }
  })

  const noBomItems = noBom.map(({ station, sku, sku_name, qty, startMins }) => ({
    sku,
    sku_name,
    quantity:         Math.round(qty * 100) / 100,
    unit:             'กก.',
    work_station:     station,
    note:             'ไม่พบ BOM — ใช้ปริมาณผลิตโดยตรง',
    lots:             [] as LotInfo[],
    withdrawal_round: minsToTime(getWithdrawalRound(startMins, phaseStr)),
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
