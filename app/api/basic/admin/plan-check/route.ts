import { NextRequest, NextResponse } from 'next/server'
import { fetchProductivityByGroup, buildSkuLookup, normalizeSku, fetchPaged, fetchLatestMakroOrders, fetchOpeningStock0010, lookupOpeningStockKg } from '@/lib/generate-plan-basic'

const BASIC_STATIONS = ['สะโพกเบสิค', 'ไหล่เบสิค', 'สามชั้นเบสิค']

interface ChannelQty { wetMarket: number; lotus: number; makro: number }
interface ExtraQty { supplementary: number; raw: number }
interface ReasonNote { label: string; quantity: number }
interface ChannelNote { stockCovered: number; shortage: number; surplus: number; shortageReasons: ReasonNote[]; surplusReasons: ReasonNote[] }
interface ChannelNotes { wetMarket: ChannelNote; lotus: ChannelNote; makro: ChannelNote }
interface ReasonQty { wetMarket: Map<string, number>; lotus: Map<string, number>; makro: Map<string, number> }
interface PlanCheckRow { station: string; sku: string; skuName: string | null; openingStockKg: number; plan100: ChannelQty; produced: ChannelQty; extra: ExtraQty; reasonQty: ReasonQty }

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function rebalanceLotusWetProduced(row: PlanCheckRow) {
  const wetDeficit = Math.max(0, row.plan100.wetMarket - row.produced.wetMarket)
  const wetSurplus = Math.max(0, row.produced.wetMarket - row.plan100.wetMarket)
  const lotusDeficit = Math.max(0, row.plan100.lotus - row.produced.lotus)
  const lotusSurplus = Math.max(0, row.produced.lotus - row.plan100.lotus)

  const lotusToWet = Math.min(wetDeficit, lotusSurplus)
  if (lotusToWet > 0) {
    row.produced.wetMarket += lotusToWet
    row.produced.lotus -= lotusToWet
  }

  const wetToLotus = Math.min(lotusDeficit, wetSurplus)
  if (wetToLotus > 0) {
    row.produced.lotus += wetToLotus
    row.produced.wetMarket -= wetToLotus
  }
}

const REASON_LABELS: Record<string, string> = {
  phase1_makro_0800_estimate: 'Phase 1 ประมาณแผนเกิน',
  phase1_wet_market_average: 'Phase 1 ใช้ค่าเฉลี่ย',
  phase1_lotus_average: 'Phase 1 ใช้ค่าเฉลี่ย',
  raw_yield_limited: 'เนื้อไม่พอ',
  rounded_to_bag: 'ปัดตามขนาดถุง',
  previous_phase_deducted: 'หักยอด Phase ก่อนหน้า',
  phase1_deducted: 'หักยอด Phase 1',
  phase2_deducted: 'หักยอด Phase 2',
}

function parseReasonCodes(note: string | null): string[] {
  return String(note ?? '')
    .split('|')
    .map(part => part.trim())
    .filter(part => part.startsWith('reason:'))
    .map(part => part.slice('reason:'.length))
    .filter(Boolean)
}

function addReasonQty(map: Map<string, number>, codes: string[], qty: number) {
  for (const code of codes) {
    map.set(code, (map.get(code) ?? 0) + qty)
  }
}

function reasonNotes(map: Map<string, number>, amount: number, preferredCodes: string[], fallbackLabel: string): ReasonNote[] {
  let remaining = round2(amount)
  const notes: ReasonNote[] = []
  for (const code of preferredCodes) {
    if (remaining <= 0) break
    const qty = map.get(code) ?? 0
    if (qty <= 0) continue
    const take = round2(Math.min(remaining, qty))
    if (take > 0) {
      notes.push({ label: REASON_LABELS[code] ?? code, quantity: take })
      remaining = round2(remaining - take)
    }
  }
  if (remaining > 0) notes.push({ label: fallbackLabel, quantity: remaining })
  return notes
}

function buildNotes(row: PlanCheckRow): ChannelNotes {
  const wetStockCovered = Math.min(row.openingStockKg, row.plan100.wetMarket)
  const wetNeed = Math.max(0, row.plan100.wetMarket - wetStockCovered)
  const lotusNeed = row.plan100.lotus
  const makroNeed = row.plan100.makro
  const wetShortage = round2(Math.max(0, wetNeed - row.produced.wetMarket))
  const wetSurplus = round2(Math.max(0, row.produced.wetMarket - wetNeed))
  const lotusShortage = round2(Math.max(0, lotusNeed - row.produced.lotus))
  const lotusSurplus = round2(Math.max(0, row.produced.lotus - lotusNeed))
  const makroShortage = round2(Math.max(0, makroNeed - row.produced.makro))
  const makroSurplus = round2(Math.max(0, row.produced.makro - makroNeed))

  return {
    wetMarket: {
      stockCovered: round2(wetStockCovered),
      shortage: wetShortage,
      surplus: wetSurplus,
      shortageReasons: reasonNotes(row.reasonQty.wetMarket, wetShortage, ['raw_yield_limited', 'rounded_to_bag'], 'ไม่ระบุสาเหตุ'),
      surplusReasons: reasonNotes(row.reasonQty.wetMarket, wetSurplus, ['phase1_wet_market_average'], 'ส่วนต่างบวกไม่ระบุสาเหตุ'),
    },
    lotus: {
      stockCovered: 0,
      shortage: lotusShortage,
      surplus: lotusSurplus,
      shortageReasons: reasonNotes(row.reasonQty.lotus, lotusShortage, ['raw_yield_limited', 'rounded_to_bag'], 'ไม่ระบุสาเหตุ'),
      surplusReasons: reasonNotes(row.reasonQty.lotus, lotusSurplus, ['phase1_lotus_average'], 'ส่วนต่างบวกไม่ระบุสาเหตุ'),
    },
    makro: {
      stockCovered: 0,
      shortage: makroShortage,
      surplus: makroSurplus,
      shortageReasons: reasonNotes(row.reasonQty.makro, makroShortage, ['raw_yield_limited', 'rounded_to_bag'], 'ไม่ระบุสาเหตุ'),
      surplusReasons: reasonNotes(row.reasonQty.makro, makroSurplus, ['phase1_makro_0800_estimate'], 'ส่วนต่างบวกไม่ระบุสาเหตุ'),
    },
  }
}

// GET /api/basic/admin/plan-check?date=2026-07-05
// เทียบ "แผน 100%" (ออเดอร์ที่อัพโหลด) กับ "แผนผลิต" (production_assignments จริง) แยกตามสายพานและ SKU
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
    || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

  try {
    const productivityByGroup = await fetchProductivityByGroup()
    const skuLookup = buildSkuLookup(productivityByGroup)

    const [plan100Rows, makroRows, assignRows, openingStock] = await Promise.all([
      fetchPaged<{ sap: string; product_name: string | null; lotus_weight: number | null; cpft_weight: number | null }>(
        'production_plan_100',
        'sap, product_name, lotus_weight, cpft_weight',
        query => query.eq('plan_date', date),
      ),
      fetchLatestMakroOrders([date], ['1400']),
      fetchPaged<{ table_name: string; sku: string; target_quantity: number; channel: string | null; note: string | null }>(
        'production_assignments',
        'table_name, sku, target_quantity, channel, note',
        query => query.eq('production_date', date).in('table_name', BASIC_STATIONS)
          .in('channel', ['Wet Market', 'LOTUS', 'Makro', 'เสริม', 'Yield Balance']),
      ),
      fetchOpeningStock0010(date),
    ])

    const rowMap = new Map<string, PlanCheckRow>()
    const getRow = (norm: string): PlanCheckRow | null => {
      const prod = skuLookup.get(norm)
      if (!prod?.station) return null
      const key = `${prod.station}|||${norm}`
      let row = rowMap.get(key)
      if (!row) {
        row = {
          station: prod.station,
          sku: prod.sku,
          skuName: prod.skuName,
          openingStockKg: round2(lookupOpeningStockKg(openingStock, prod.sku, prod.skuName)),
          plan100: { wetMarket: 0, lotus: 0, makro: 0 },
          produced: { wetMarket: 0, lotus: 0, makro: 0 },
          extra: { supplementary: 0, raw: 0 },
          reasonQty: { wetMarket: new Map(), lotus: new Map(), makro: new Map() },
        }
        rowMap.set(key, row)
      }
      return row
    }

    for (const r of plan100Rows) {
      const row = getRow(normalizeSku(String(r.sap ?? '')))
      if (!row) continue
      row.plan100.wetMarket += Number(r.cpft_weight ?? 0) || 0
      row.plan100.lotus += Number(r.lotus_weight ?? 0) || 0
    }

    for (const r of makroRows) {
      const row = getRow(normalizeSku(String(r.sku ?? '')))
      if (!row) continue
      row.plan100.makro += Number(r.quantity ?? 0) || 0
    }

    for (const r of assignRows) {
      const row = getRow(normalizeSku(String(r.sku ?? '')))
      if (!row) continue
      const qty = Number(r.target_quantity ?? 0) || 0
      const reasons = parseReasonCodes(r.note)
      if (r.channel === 'Wet Market') { row.produced.wetMarket += qty; addReasonQty(row.reasonQty.wetMarket, reasons, qty) }
      else if (r.channel === 'LOTUS') { row.produced.lotus += qty; addReasonQty(row.reasonQty.lotus, reasons, qty) }
      else if (r.channel === 'Makro') { row.produced.makro += qty; addReasonQty(row.reasonQty.makro, reasons, qty) }
      else if (r.channel === 'เสริม') row.extra.supplementary += qty
      else if (r.channel === 'Yield Balance') row.extra.raw += qty
    }

    Array.from(rowMap.values()).forEach(row => rebalanceLotusWetProduced(row))

    const rows = Array.from(rowMap.values())
      .filter(r => r.plan100.wetMarket > 0 || r.plan100.lotus > 0 || r.plan100.makro > 0
        || r.produced.wetMarket > 0 || r.produced.lotus > 0 || r.produced.makro > 0
        || r.extra.supplementary > 0 || r.extra.raw > 0)
      .map(r => ({
        station: r.station,
        sku: r.sku,
        skuName: r.skuName,
        openingStockKg: r.openingStockKg,
        plan100: { wetMarket: round2(r.plan100.wetMarket), lotus: round2(r.plan100.lotus), makro: round2(r.plan100.makro) },
        produced: { wetMarket: round2(r.produced.wetMarket), lotus: round2(r.produced.lotus), makro: round2(r.produced.makro) },
        extra: { supplementary: round2(r.extra.supplementary), raw: round2(r.extra.raw) },
        notes: buildNotes(r),
      }))
      .sort((a, b) => BASIC_STATIONS.indexOf(a.station) - BASIC_STATIONS.indexOf(b.station) || a.sku.localeCompare(b.sku))

    return NextResponse.json({ date, rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
