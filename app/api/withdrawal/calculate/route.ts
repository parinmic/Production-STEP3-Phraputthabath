import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { allocateFIFOWithRules, RawMaterialRule } from '@/lib/withdrawal-rules'
import { computeRmAllocation, buildRmAllocMap } from '@/lib/compute-rm-allocation'

const PERIOD: Record<string, string> = { '1': 'เช้า', '2': 'บ่าย', '3': 'ค่ำ' }

const PHASE_ROUND_MINS: Record<string, number[]> = {
  '1': [510, 600, 780],
  '2': [870],
  '3': [990, 1080, 1200],
}

const DEFAULT_START_MINS: Record<string, number> = {
  '1': 510, '2': 870, '3': 990,
}

export interface LotInfo {
  spec_code: string
  factory: string
  prod_date: string
  available: number
  to_withdraw: number
  insufficient?: boolean
}

type LotEntry = { spec_code: string; weight: number; factory: string; prod_date: string; sortKey: string }

interface MooIng {
  ingredient_type: string
  priority: number
  sap_code: string | null
  product_name: string
  fat_percent: number
}

function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.floor(mins % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

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

function parseRoundNote(note: string | null): Map<number, number> {
  const result = new Map<number, number>()
  if (!note?.startsWith('rounds:')) return result
  for (const part of note.replace('rounds:', '').split(';')) {
    const [rStr, qStr] = part.split('=')
    if (rStr && qStr) result.set(parseInt(rStr), parseFloat(qStr))
  }
  return result
}

function parseSpecCode(s: string): { factory: string; prod_date: string; sortKey: string } | null {
  const m1 = s.match(/[A-Z]+(\d{2})(\d{2})(\d{2})/)
  if (m1) return { factory: m1[1], prod_date: `${m1[2]}/${m1[3]}`, sortKey: `${m1[3]}${m1[2]}` }
  const m2 = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})[A-Z]/)
  if (m2) return { factory: m2[1], prod_date: `${m2[3]}/${m2[2]}`, sortKey: `${m2[2]}${m2[3]}${m2[4]}` }
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
    if (lot.weight <= 0.005) continue
    const take = Math.min(remaining, lot.weight)
    result.push({
      spec_code:   lot.spec_code,
      factory:     lot.factory,
      prod_date:   lot.prod_date,
      available:   Math.round(lot.weight * 100) / 100,
      to_withdraw: Math.round(take * 100) / 100,
    })
    lot.weight -= take
    remaining  -= take
  }
  if (remaining > 0.005) {
    result.push({ spec_code: '— ไม่เพียงพอ —', factory: '-', prod_date: '-', available: 0, to_withdraw: Math.round(remaining * 100) / 100, insufficient: true })
  }
  return result
}

// หมูบด: priority-based allocation
function allocateMooPriority(
  demandKg: number,
  ings: MooIng[],
  stockByCode: Map<string, LotEntry[]>,
  stockByName: Map<string, LotEntry[]>,
): { ing: MooIng; qty: number; lots: LotInfo[] }[] {
  const result: { ing: MooIng; qty: number; lots: LotInfo[] }[] = []
  let remaining = demandKg

  const byPriority = new Map<number, MooIng[]>()
  for (const ing of ings) {
    const list = byPriority.get(ing.priority) ?? []
    list.push(ing)
    byPriority.set(ing.priority, list)
  }

  for (const priority of Array.from(byPriority.keys()).sort((a, b) => a - b)) {
    if (remaining <= 0.005) break
    for (const ing of byPriority.get(priority)!) {
      if (remaining <= 0.005) break
      const lots = ing.sap_code
        ? (stockByCode.get(ing.sap_code.trim()) ?? stockByName.get(normMatName(ing.product_name)) ?? [])
        : (stockByName.get(normMatName(ing.product_name)) ?? [])
      const avail = lots.reduce((s, l) => s + l.weight, 0)
      if (avail <= 0.005) continue
      const take = Math.min(remaining, avail)
      result.push({ ing, qty: take, lots: allocateFIFO(lots, take) })
      remaining -= take
    }
  }

  if (remaining > 0.005) {
    result.push({
      ing:  { ingredient_type: '?', priority: 999, sap_code: null, product_name: '— ไม่เพียงพอ —', fat_percent: 0 },
      qty:  remaining,
      lots: [{ spec_code: '— ไม่เพียงพอ —', factory: '-', prod_date: '-', available: 0, to_withdraw: Math.round(remaining * 100) / 100, insufficient: true }],
    })
  }
  return result
}

function buildStockMaps(stockRows: { material_code: string; material_name: string | null; spec_code: string; weight_total: number }[]): {
  byCode: Map<string, LotEntry[]>; byName: Map<string, LotEntry[]>
} {
  const lotAgg      = new Map<string, number>()
  const codeToName  = new Map<string, string>()
  for (const row of stockRows) {
    if (!row.material_code || !row.spec_code) continue
    const k = `${row.material_code}|||${row.spec_code}`
    lotAgg.set(k, (lotAgg.get(k) ?? 0) + Number(row.weight_total))
    if (row.material_name) codeToName.set(row.material_code, row.material_name)
  }
  const byCode = new Map<string, LotEntry[]>()
  const byName = new Map<string, LotEntry[]>()
  for (const [k, weight] of Array.from(lotAgg.entries())) {
    const [matCode, spec_code] = k.split('|||')
    const parsed = parseSpecCode(spec_code)
    const lot: LotEntry = { spec_code, weight, factory: parsed?.factory ?? '-', prod_date: parsed?.prod_date ?? '-', sortKey: parsed?.sortKey ?? spec_code }
    const codeList = byCode.get(matCode) ?? []; codeList.push(lot); byCode.set(matCode, codeList)
    const matName = codeToName.get(matCode)
    if (matName) {
      const nameKey = normMatName(matName)
      const nameList = byName.get(nameKey) ?? []; nameList.push(lot); byName.set(nameKey, nameList)
    }
  }
  for (const list of Array.from(byCode.values())) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  for (const list of Array.from(byName.values())) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  return { byCode, byName }
}

type StockRow = { material_code: string; material_name: string | null; spec_code: string; weight_total: number }

export async function POST(req: NextRequest) {
  try {
  const { date, phase } = await req.json()
  const phaseStr = String(phase)
  const period = PERIOD[phaseStr]
  if (!date || !period) return NextResponse.json({ error: 'missing params' }, { status: 400 })

  // Fetch rules
  const { data: rawMaterialRules } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('calculation_type', 'Mas Raw Material')
    .order('uploaded_at', { ascending: false })

  const rules: RawMaterialRule[] = (rawMaterialRules ?? []).map(r => {
    const data = (r.row_data ?? {}) as Record<string, unknown>
    return {
      productGroup: String(data['กลุ่มสินค้า'] ?? '').trim(),
      type:         String(data['ประเภท']     ?? '').trim(),
      d16:          String(data['D16']        ?? '').trim(),
      d17:          String(data['D17']        ?? '').trim(),
    }
  })

  const roundMins = PHASE_ROUND_MINS[phaseStr] ?? PHASE_ROUND_MINS['1']

  // 1. Fetch assignments
  const { data: assignments, error: e1 } = await supabase
    .from('production_assignments')
    .select('table_name, sku, sku_name, target_quantity, deadline_time, note')
    .eq('production_date', date)
    .eq('period', period)
    .in('table_name', ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์', 'เผาขา', 'เลาะขา'])

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
  if (!assignments?.length) {
    return NextResponse.json({ items: [], message: `ไม่พบคำสั่งผลิต Phase ${phase} วันที่ ${date}` })
  }

  // 2. Fetch masters in parallel
  const [noWithdrawalRes, mooMasterRes, mooWithdrawalRes, beikKhaRes] = await Promise.all([
    supabase.from('no_withdrawal_skus').select('sap'),
    supabase.from('moo_chod_master').select('sap_code, fat_percent'),
    supabase.from('moo_chod_withdrawal_master')
      .select('ingredient_type, priority, sap_code, product_name, fat_percent')
      .order('ingredient_type').order('priority').order('id'),
    supabase.from('mas_phlit_tor_kan').select('sap, source_station, dest_station'),
  ])

  const noWithdrawalSaps = new Set((noWithdrawalRes.data ?? []).map(r => String(r.sap ?? '').trim()))
  // beikKhaMap: SAP (normalized) → { source_station: ต้นทาง (ผลิต WIP), dest_station: ปลายทาง (รับ WIP) }
  const beikKhaMap = new Map<string, { source_station: string; dest_station: string }>()
  for (const r of beikKhaRes.data ?? []) {
    const src = String(r.source_station ?? '').trim()
    const dst = String(r.dest_station   ?? '').trim()
    if (!src || !dst) continue
    const sapNorm = String(r.sap ?? '').replace(/^0+/, '').trim()
    const sapRaw  = String(r.sap ?? '').trim()
    if (sapNorm) beikKhaMap.set(sapNorm, { source_station: src, dest_station: dst })
    if (sapRaw && sapRaw !== sapNorm) beikKhaMap.set(sapRaw, { source_station: src, dest_station: dst })
  }

  // Build moo_chod fat map: sap_code → fat_percent
  const normSku = (s: string) => String(s ?? '').trim().replace(/^0+/, '') || String(s ?? '').trim()
  const mooFatMap = new Map<string, number>()
  for (const r of mooMasterRes.data ?? []) {
    if (!r.sap_code) continue
    for (const c of [r.sap_code.trim(), normSku(r.sap_code)].filter(Boolean))
      mooFatMap.set(c, Number(r.fat_percent ?? 0))
  }

  const mooWithdrawalIngs = (mooWithdrawalRes.data ?? []) as MooIng[]
  const mooMeatIngs = mooWithdrawalIngs.filter(i => i.ingredient_type === 'เนื้อ')
  const mooFatIngs  = mooWithdrawalIngs.filter(i => i.ingredient_type === 'มัน')

  const activeAssignments = assignments.filter(a => !noWithdrawalSaps.has(String(a.sku ?? '').trim()))
  if (!activeAssignments.length) {
    return NextResponse.json({ items: [], message: 'ไม่พบรายการเบิก เนื่องจาก SKU ทั้งหมดในแผนผลิตเป็น SKU ที่ไม่ต้องเบิกของ' })
  }

  // Split: หมูบด กลุ่มสินค้าหมูบด (in moo_chod_master) vs regular
  const isMooChōdSku = (a: { table_name: string; sku: string }) =>
    a.table_name === 'หมูบด' && mooFatMap.size > 0 &&
    (mooFatMap.has(normSku(a.sku)) || mooFatMap.has(String(a.sku ?? '').trim()))

  const mooChōdAssignments = activeAssignments.filter(isMooChōdSku)
  const regularAssignments  = activeAssignments.filter(a => !isMooChōdSku(a))

  // ── Regular path: BOM-based ────────────────────────────────────

  // 3. Build finRoundMap
  const finRoundMap = new Map<string, Map<number, number>>()
  const finNameMap  = new Map<string, string | null>()
  const skuSet      = new Set<string>()

  for (const a of regularAssignments) {
    const key = `${a.table_name}|||${a.sku}`
    if (!finRoundMap.has(key)) finRoundMap.set(key, new Map())
    finNameMap.set(key, a.sku_name ?? null)
    skuSet.add(a.sku)

    const qty = Number(a.target_quantity)
    if (qty <= 0) continue

    const roundQtys  = finRoundMap.get(key)!
    const noteRounds = parseRoundNote(a.note)

    if (noteRounds.size > 0) {
      for (const [rm, q] of Array.from(noteRounds.entries())) {
        const mappedRm = getRoundMins(rm, roundMins)
        roundQtys.set(mappedRm, (roundQtys.get(mappedRm) ?? 0) + q)
      }
    } else {
      const startMins = a.deadline_time ? timeStrToMins(String(a.deadline_time)) : DEFAULT_START_MINS[phaseStr]
      const rm = getRoundMins(startMins, roundMins)
      roundQtys.set(rm, (roundQtys.get(rm) ?? 0) + qty)
    }
  }

  // 4. Fetch BOM
  const skus = Array.from(skuSet)
  const { data: bomRows, error: e2 } = skus.length > 0
    ? await supabase.from('bom_items').select('product_sap, raw_sap, raw_name, yield_pct, priority').in('product_sap', skus)
    : { data: [], error: null }
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

  const bomMap = new Map<string, { raw_sap: string; raw_name: string | null; yield_pct: number; priority: number | null }[]>()
  for (const b of bomRows ?? []) {
    if (!b.raw_sap) continue
    const list = bomMap.get(b.product_sap) ?? []
    list.push({ raw_sap: b.raw_sap, raw_name: b.raw_name ?? null, yield_pct: b.yield_pct ?? 0, priority: (b as { priority?: number | null }).priority ?? null })
    bomMap.set(b.product_sap, list)
  }

  // 5. Calculate raw material per (station, raw_sap, round)
  interface RawEntry { station: string; raw_sap: string; raw_name: string | null; qty: number; roundMins: number; bom_priority: number | null }
  const rawMap      = new Map<string, RawEntry>()
  const rawToProducts = new Map<string, { sku: string; sku_name: string | null; qty: number; rawQty: number }[]>()
  const noBom: { station: string; sku: string; sku_name: string | null; qty: number; roundMins: number }[] = []

  for (const [finKey, roundQtys] of Array.from(finRoundMap.entries())) {
    const [station, sku] = finKey.split('|||')
    const sku_name = finNameMap.get(finKey) ?? null
    const boms     = bomMap.get(sku)

    for (const [rm, finQty] of Array.from(roundQtys.entries())) {
      if (!boms?.length) {
        noBom.push({ station, sku, sku_name, qty: finQty, roundMins: rm })
        continue
      }
      for (const b of boms) {
        const rawQty = b.yield_pct > 0 ? finQty / b.yield_pct : finQty
        const rawKey = `${station}|||${b.raw_sap}|||${rm}`
        const cur = rawMap.get(rawKey)
        if (cur) {
          cur.qty += rawQty
          // keep the lowest (most urgent) priority
          if (b.priority !== null && (cur.bom_priority === null || b.priority < cur.bom_priority)) {
            cur.bom_priority = b.priority
          }
        } else {
          rawMap.set(rawKey, { station, raw_sap: b.raw_sap, raw_name: b.raw_name, qty: rawQty, roundMins: rm, bom_priority: b.priority })
        }
        const prodList = rawToProducts.get(rawKey) ?? []
        prodList.push({ sku, sku_name, qty: finQty, rawQty })
        rawToProducts.set(rawKey, prodList)
      }
    }
  }

  // 6. Fetch stock (regular path)
  const rawSaps = Array.from(new Set(Array.from(rawMap.values()).map(v => v.raw_sap)))
  const regularStockRows: StockRow[] = []

  if (rawSaps.length > 0) {
    const [res0010, res20] = await Promise.all([
      supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_code', rawSaps).gt('weight_total', 0),
    ])
    regularStockRows.push(...(res0010.data ?? []) as StockRow[], ...(res20.data ?? []) as StockRow[])
  }

  // Name-based fallback
  const foundCodes = new Set(regularStockRows.map(r => r.material_code))
  const missingNames = Array.from(new Set(
    Array.from(rawMap.values())
      .filter(v => !foundCodes.has(v.raw_sap))
      .map(v => v.raw_name).filter(Boolean) as string[]
  ))
  if (missingNames.length > 0) {
    const expandedNames = Array.from(new Set(missingNames.flatMap(n => [
      n, n.replace(/\s*-\s*/g, '-'), n.replace(/\s*-\s*/g, ' - '),
    ])))
    const [res0010n, res20n] = await Promise.all([
      supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
      supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
    ])
    regularStockRows.push(...(res0010n.data ?? []) as StockRow[], ...(res20n.data ?? []) as StockRow[])
  }

  const { byCode: stockByMat, byName: stockByName } = buildStockMaps(regularStockRows)

  // 6.5 Apply rm-allocation cap: scale rawMap quantities to match pool-allocated amounts
  const rmGroups   = await computeRmAllocation(date)
  const rmAllocMap = buildRmAllocMap(rmGroups, parseInt(phaseStr))

  if (rmAllocMap.size > 0) {
    // Sum total needed per (station, rawNorm) across all rounds
    const stationRawTotal = new Map<string, number>()
    for (const entry of Array.from(rawMap.values())) {
      const key = `${entry.station}|||${normMatName(entry.raw_name ?? '')}`
      stationRawTotal.set(key, (stationRawTotal.get(key) ?? 0) + entry.qty)
    }

    // Scale each entry proportionally to rm-allocation cap
    for (const entry of Array.from(rawMap.values())) {
      // WIP materials produced in-house (mas ผลิตต่อกัน) are not subject to rm-allocation caps
      const normSapEntry = entry.raw_sap.replace(/^0+/, '')
      const beikEntryAlloc = beikKhaMap.get(normSapEntry) ?? beikKhaMap.get(entry.raw_sap)
      if (beikEntryAlloc && entry.station === beikEntryAlloc.dest_station) continue

      const key = `${entry.station}|||${normMatName(entry.raw_name ?? '')}`
      const totalNeeded = stationRawTotal.get(key) ?? 0
      const rmAllocated = rmAllocMap.get(key)
      if (rmAllocated !== undefined && totalNeeded > 0.005 && rmAllocated < totalNeeded) {
        const scale = rmAllocated / totalNeeded
        entry.qty = entry.qty * scale
        const rawKey = `${entry.station}|||${entry.raw_sap}|||${entry.roundMins}`
        const prods = rawToProducts.get(rawKey)
        if (prods) {
          for (const p of prods) {
            p.qty    = p.qty    * scale
            p.rawQty = p.rawQty * scale
          }
        }
      }
    }
  }

  // 7. Build regular output items — sorted by station priority so shared lots are consumed in order
  // สไลด์(P1) → สามชั้น/สะโพก/ไหล่(P2) → หมูบด(P3), then by round time
  const STATION_PRIORITY: Record<string, number> = {
    'สไลด์':   1,
    'สามชั้น': 2,
    'สะโพก':   2,
    'ไหล่':    2,
    'เผาขา':   2,
    'เลาะขา':  2,
    'หมูบด':   3,
  }

  const rawItems = Array.from(rawMap.values())
    .sort((a, b) =>
      (a.bom_priority ?? 99) - (b.bom_priority ?? 99) ||
      (STATION_PRIORITY[a.station] ?? 9) - (STATION_PRIORITY[b.station] ?? 9) ||
      a.roundMins - b.roundMins
    )
    .flatMap(({ station, raw_sap, raw_name, qty, roundMins, bom_priority }) => {
      const needed  = Math.round(qty * 100) / 100
      const nameKey = normMatName(raw_name ?? '')
      const lots    = stockByMat.get(raw_sap) ?? stockByName.get(nameKey)
      const rawKey  = `${station}|||${raw_sap}|||${roundMins}`

      if (!lots) {
        // WIP produced in-house: check mas ผลิตต่อกัน for source/dest station mapping
        const normSapRaw  = raw_sap.replace(/^0+/, '')
        const beikEntry   = beikKhaMap.get(normSapRaw) ?? beikKhaMap.get(raw_sap)
        const isBeikKha   = !!beikEntry && station === beikEntry.dest_station
        if (!isBeikKha) return []

        const forProds      = rawToProducts.get(rawKey) ?? []
        const sourceStation = beikEntry.source_station
        const destStation   = beikEntry.dest_station
        const sourceRound   = Math.max(roundMins - 30, 510) // ต้นทางผลิตก่อน 30 นาที (floor 08:30)
        const noteDestLabel = bom_priority !== null ? `P${bom_priority} — WIP จาก${sourceStation}` : `WIP จาก${sourceStation}`
        return [
          {
            sku:              raw_sap,
            sku_name:         raw_name,
            quantity:         needed,
            unit:             'กก.',
            work_station:     destStation,
            note:             noteDestLabel,
            lots:             [] as LotInfo[],
            for_products:     forProds,
            withdrawal_round: minsToTime(roundMins),
            bom_priority,
          },
          {
            sku:              raw_sap,
            sku_name:         raw_name,
            quantity:         needed,
            unit:             'กก.',
            work_station:     sourceStation,
            note:             `แผนผลิต WIP สำหรับ${destStation}`,
            lots:             [] as LotInfo[],
            for_products:     forProds,
            withdrawal_round: minsToTime(sourceRound),
            bom_priority:     null,
          },
        ]
      }

      const lotsResult = allocateFIFOWithRules(raw_name ?? '', lots, rawToProducts.get(rawKey) ?? [], rules)
      const allocated = Math.round(lotsResult.filter(l => !l.insufficient).reduce((s, l) => s + l.to_withdraw, 0) * 100) / 100
      if (allocated <= 0.005 && lotsResult.every(l => l.insufficient)) return []
      const noteBase = bom_priority !== null ? `P${bom_priority} — คำนวณจาก BOM` : 'คำนวณจาก BOM'
      return [{
        sku:              raw_sap,
        sku_name:         raw_name,
        quantity:         allocated,
        unit:             'กก.',
        work_station:     station,
        note:             noteBase,
        lots:             lotsResult,
        for_products:     rawToProducts.get(rawKey) ?? [],
        withdrawal_round: minsToTime(roundMins),
        bom_priority,
      }]
    })

  const noBomItems = noBom.map(({ station, sku, sku_name, qty, roundMins }) => ({
    sku,
    sku_name,
    quantity:         Math.round(qty * 100) / 100,
    unit:             'กก.',
    work_station:     station,
    note:             'ไม่พบ BOM — ใช้ปริมาณผลิตโดยตรง',
    lots:             [] as LotInfo[],
    for_products:     [] as { sku: string; sku_name: string | null; qty: number; rawQty: number }[],
    withdrawal_round: minsToTime(roundMins),
    bom_priority:     null as number | null,
  }))

  // ── หมูบด priority path ────────────────────────────────────────

  const mooItems: typeof rawItems = []

  if (mooChōdAssignments.length > 0 && mooWithdrawalIngs.length > 0) {
    // คำนวณ demand แยก fatKg + meatKg ต่อ round
    const mooRoundDemand = new Map<number, { fatKg: number; meatKg: number }>()
    const mooForProducts: { sku: string; sku_name: string | null; qty: number; rawQty: number }[] = []

    for (const a of mooChōdAssignments) {
      const fatPct = mooFatMap.get(normSku(a.sku)) ?? mooFatMap.get(String(a.sku ?? '').trim()) ?? 0
      const noteRounds = parseRoundNote(a.note)
      const roundEntries: [number, number][] = noteRounds.size > 0
        ? Array.from(noteRounds.entries()).map(([rm, q]) => [getRoundMins(rm, roundMins), q] as [number, number])
        : [[DEFAULT_START_MINS[phaseStr], Number(a.target_quantity)]]

      const totalQty = Number(a.target_quantity)
      if (!mooForProducts.find(p => p.sku === a.sku))
        mooForProducts.push({ sku: a.sku, sku_name: a.sku_name ?? null, qty: totalQty, rawQty: totalQty })

      for (const [rm, qty] of roundEntries) {
        const cur = mooRoundDemand.get(rm) ?? { fatKg: 0, meatKg: 0 }
        cur.fatKg  += qty * fatPct / 100
        cur.meatKg += qty * (1 - fatPct / 100)
        mooRoundDemand.set(rm, cur)
      }
    }

    // Fetch stock สำหรับ withdrawal ingredients (แยกจาก regular stock)
    const mooAllSaps  = mooWithdrawalIngs.map(i => i.sap_code).filter(Boolean) as string[]
    const mooAllNames = mooWithdrawalIngs.map(i => i.product_name).filter(Boolean) as string[]
    const mooStockRows: StockRow[] = []

    const mooStockPromises = []
    if (mooAllSaps.length > 0) {
      mooStockPromises.push(
        supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_code', mooAllSaps).gt('weight_total', 0),
        supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_code', mooAllSaps).gt('weight_total', 0),
      )
    }
    if (mooAllNames.length > 0) {
      mooStockPromises.push(
        supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').in('material_name', mooAllNames).gt('weight_total', 0),
        supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').in('material_name', mooAllNames).gt('weight_total', 0),
      )
    }
    const mooStockResults = await Promise.all(mooStockPromises)
    for (const r of mooStockResults) mooStockRows.push(...((r.data ?? []) as StockRow[]))

    const { byCode: mooByCode, byName: mooByName } = buildStockMaps(mooStockRows)

    // Cap shared-pool ingredient lots to rm-allocated amounts for หมูบด.
    // P3 own-stock ingredients (not in rmAllocMap) keep their full stock weight.
    if (rmAllocMap.size > 0) {
      for (const [nameKey, lots] of Array.from(mooByName.entries())) {
        const rmAllocated = rmAllocMap.get(`หมูบด|||${nameKey}`)
        if (rmAllocated === undefined) continue
        const totalAvail = lots.reduce((s, l) => s + l.weight, 0)
        if (totalAvail <= rmAllocated + 0.005) continue
        const scale = rmAllocated / totalAvail
        for (const lot of lots) lot.weight = Math.round(lot.weight * scale * 100) / 100
      }
    }

    // Build items per round
    for (const [rm, demand] of Array.from(mooRoundDemand.entries()).sort(([a], [b]) => a - b)) {
      const fatAllocs  = demand.fatKg  > 0.005 ? allocateMooPriority(demand.fatKg,  mooFatIngs,  mooByCode, mooByName) : []
      const meatAllocs = demand.meatKg > 0.005 ? allocateMooPriority(demand.meatKg, mooMeatIngs, mooByCode, mooByName) : []

      for (const { ing, qty, lots } of [...fatAllocs, ...meatAllocs]) {
        mooItems.push({
          sku:              ing.sap_code ?? ing.product_name,
          sku_name:         ing.product_name,
          quantity:         Math.round(qty * 100) / 100,
          unit:             'กก.',
          work_station:     'หมูบด',
          note:             `หมูบด — กลุ่ม${ing.ingredient_type} P${ing.priority}`,
          lots,
          for_products:     mooForProducts,
          withdrawal_round: minsToTime(rm),
          bom_priority:     null,
        })
      }
    }
  }

  // Combine and sort: round first, then bom_priority (P1 before null), then station, sku
  const allItems = [...rawItems, ...noBomItems, ...mooItems].sort((a, b) =>
    a.withdrawal_round.localeCompare(b.withdrawal_round) ||
    ((a as { bom_priority?: number | null }).bom_priority ?? 99) - ((b as { bom_priority?: number | null }).bom_priority ?? 99) ||
    (a.work_station ?? '').localeCompare(b.work_station ?? '') ||
    (a.sku ?? '').localeCompare(b.sku ?? '')
  )

  // Fetch BOM raws for เผาขา WIP production items
  const wipPaoKhaItems = allItems.filter(i => i.work_station === 'เผาขา' && String(i.note ?? '').includes('แผนผลิต WIP'))
  if (wipPaoKhaItems.length > 0) {
    const wipSkus    = Array.from(new Set(wipPaoKhaItems.flatMap(i => [String(i.sku ?? ''), String(i.sku ?? '').replace(/^0+/, '')])))
    const { data: wipBomRows } = await supabase
      .from('bom_items').select('product_sap, raw_sap, raw_name, yield_pct').in('product_sap', wipSkus)
    const wipBomMap  = new Map<string, { raw_sap: string; raw_name: string | null; yield_pct: number }[]>()
    for (const b of wipBomRows ?? []) {
      const entry = { raw_sap: String(b.raw_sap ?? ''), raw_name: b.raw_name ?? null, yield_pct: Number(b.yield_pct ?? 0) }
      for (const k of [String(b.product_sap ?? ''), String(b.product_sap ?? '').replace(/^0+/, '')]) {
        const list = wipBomMap.get(k) ?? []
        if (!list.some(e => e.raw_sap === entry.raw_sap)) list.push(entry)
        wipBomMap.set(k, list)
      }
    }
    for (const item of wipPaoKhaItems) {
      const boms = wipBomMap.get(String(item.sku ?? '')) ?? wipBomMap.get(String(item.sku ?? '').replace(/^0+/, '')) ?? []
      if (boms.length === 0) continue

      // Save WIP info, then transform: raw material becomes the main withdrawal row
      const wipSku     = String(item.sku ?? '')
      const wipSkuName = item.sku_name
      const wipQty     = item.quantity
      const primaryBom = boms[0]
      const rawQty     = primaryBom.yield_pct > 0 ? Math.round(wipQty / primaryBom.yield_pct * 10) / 10 : wipQty

      item.sku      = primaryBom.raw_sap
      item.sku_name = primaryBom.raw_name
      item.quantity = rawQty
      item.note     = 'เบิกวัตถุดิบผลิต WIP'
      ;(item as Record<string, unknown>)['for_products'] = [{ sku: wipSku, sku_name: wipSkuName, qty: wipQty, rawQty }]
    }
  }

  // Filter out zero-quantity items
  const items = allItems.filter(i => i.quantity > 0.005)

  return NextResponse.json({ items })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('calculate error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
