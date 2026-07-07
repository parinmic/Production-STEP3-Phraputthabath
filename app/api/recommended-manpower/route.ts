import { NextRequest, NextResponse } from 'next/server'
import { supabase, fetchLatestOrders } from '@/lib/supabase'

const TOTAL_PEOPLE = 36

function normSku(sku: string) {
  return String(sku).replace(/^0+/, '').trim()
}

function subDays(dateStr: string, n: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'missing date' }, { status: 400 })

  const histDates = [subDays(date, 1), subDays(date, 2), subDays(date, 3)]

  // ── 1. Fetch orders from all 3 channels ──────────────────────────────
  const [makroOrders, lotusOrders, wetOrders] = await Promise.all([
    fetchLatestOrders('makro_orders', histDates),
    fetchLatestOrders('lotus_orders', histDates),
    fetchLatestOrders('wet_market_orders', histDates),
  ])

  const allOrders = [...makroOrders, ...lotusOrders, ...wetOrders]

  // average qty per SKU across available days
  const bySkuDate: Record<string, Record<string, number>> = {}
  for (const r of allOrders) {
    const sku = normSku(r.sku)
    if (!bySkuDate[sku]) bySkuDate[sku] = {}
    bySkuDate[sku][r.delivery_date] = (bySkuDate[sku][r.delivery_date] ?? 0) + r.quantity
  }
  const avgQty = new Map<string, number>()
  for (const [sku, byDate] of Object.entries(bySkuDate)) {
    const vals = Object.values(byDate)
    avgQty.set(sku, vals.reduce((s, v) => s + v, 0) / vals.length)
  }

  // ── 2. Fetch Mas Productivity ─────────────────────────────────────────
  const { data: prodRaw } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('calculation_type', 'Mas Productivity')

  // ── 3. Calculate Man-Hr per station ──────────────────────────────────
  const stationManHr: Record<string, number> = {}
  const stationSkuDetail: Record<string, { sku: string; skuName: string; avgQty: number; rate: number; manHr: number }[]> = {}

  for (const row of prodRaw ?? []) {
    const r       = row.row_data as Record<string, unknown>
    const station = String(r['จุดงาน'] ?? '').trim()
    const sku     = normSku(String(r['SAP'] ?? '').trim())
    const skuName = String(r['ชื่อสินค้า'] ?? '').trim()
    const rate    = Number(r['กำลังการผลิต (กก./ชม./คน)'] ?? 0)

    if (!station || !sku || rate <= 0) continue

    const qty = avgQty.get(sku) ?? 0
    if (qty <= 0) continue

    const manHr = qty / rate
    stationManHr[station] = (stationManHr[station] ?? 0) + manHr
    if (!stationSkuDetail[station]) stationSkuDetail[station] = []
    stationSkuDetail[station].push({ sku, skuName, avgQty: qty, rate, manHr })
  }

  // ── 4. Allocate 36 people proportionally ─────────────────────────────
  const stations = Object.keys(stationManHr)
  const totalManHr = stations.reduce((s, st) => s + stationManHr[st], 0)

  const exact  = stations.map(st => ({ station: st, exact: TOTAL_PEOPLE * stationManHr[st] / totalManHr }))
  const floors = exact.map(e => ({ ...e, people: Math.floor(e.exact) }))
  const remainder = TOTAL_PEOPLE - floors.reduce((s, e) => s + e.people, 0)

  // give leftover to stations with largest fractional part
  const sorted = [...floors].sort((a, b) => (b.exact - b.people) - (a.exact - a.people))
  for (let i = 0; i < remainder; i++) sorted[i].people += 1

  const result = floors.map(f => {
    const manHr   = stationManHr[f.station]
    const people  = sorted.find(s => s.station === f.station)!.people
    const finishHr = people > 0 ? manHr / people : null
    return {
      station:    f.station,
      manHr:      Math.round(manHr * 100) / 100,
      people,
      finishHr:   finishHr != null ? Math.round(finishHr * 100) / 100 : null,
      skuDetail:  stationSkuDetail[f.station] ?? [],
    }
  })

  return NextResponse.json({ date, histDates, totalManHr: Math.round(totalManHr * 100) / 100, stations: result })
}
