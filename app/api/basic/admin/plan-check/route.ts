import { NextRequest, NextResponse } from 'next/server'
import { fetchProductivityByGroup, buildSkuLookup, normalizeSku, fetchPaged, fetchLatestMakroOrders, fetchOpeningStock0010, lookupOpeningStockKg } from '@/lib/generate-plan-basic'

const BASIC_STATIONS = ['สะโพกเบสิค', 'ไหล่เบสิค', 'สามชั้นเบสิค']

interface ChannelQty { wetMarket: number; lotus: number; makro: number }
interface ExtraQty { supplementary: number; raw: number }
interface PlanCheckRow { station: string; sku: string; skuName: string | null; openingStockKg: number; plan100: ChannelQty; produced: ChannelQty; extra: ExtraQty }

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
      fetchPaged<{ table_name: string; sku: string; target_quantity: number; channel: string | null }>(
        'production_assignments',
        'table_name, sku, target_quantity, channel',
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
      if (r.channel === 'Wet Market') row.produced.wetMarket += qty
      else if (r.channel === 'LOTUS') row.produced.lotus += qty
      else if (r.channel === 'Makro') row.produced.makro += qty
      else if (r.channel === 'เสริม') row.extra.supplementary += qty
      else if (r.channel === 'Yield Balance') row.extra.raw += qty
    }

    for (const row of rowMap.values()) {
      rebalanceLotusWetProduced(row)
    }

    const rows = Array.from(rowMap.values())
      .filter(r => r.plan100.wetMarket > 0 || r.plan100.lotus > 0 || r.plan100.makro > 0
        || r.produced.wetMarket > 0 || r.produced.lotus > 0 || r.produced.makro > 0
        || r.extra.supplementary > 0 || r.extra.raw > 0)
      .map(r => ({
        ...r,
        plan100: { wetMarket: round2(r.plan100.wetMarket), lotus: round2(r.plan100.lotus), makro: round2(r.plan100.makro) },
        produced: { wetMarket: round2(r.produced.wetMarket), lotus: round2(r.produced.lotus), makro: round2(r.produced.makro) },
        extra: { supplementary: round2(r.extra.supplementary), raw: round2(r.extra.raw) },
      }))
      .sort((a, b) => BASIC_STATIONS.indexOf(a.station) - BASIC_STATIONS.indexOf(b.station) || a.sku.localeCompare(b.sku))

    return NextResponse.json({ date, rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
