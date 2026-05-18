import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const date  = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  const round = req.nextUrl.searchParams.get('round') ?? '0800'
  const skuFilter = req.nextUrl.searchParams.get('sku')

  // Historical dates (BL3)
  const d = new Date(date)
  const histDates = [1, 2, 3].map(n => {
    const h = new Date(d); h.setDate(d.getDate() - n)
    return h.toISOString().split('T')[0]
  })

  const [
    { data: workforce },
    { data: makroToday },
    { data: makroHist },
    { data: wmToday },
    { data: wmHist },
    { data: lotusToday },
    { data: lotusHist },
    { data: masterProd },
    { data: allWorkforceDates },
  ] = await Promise.all([
    supabase.from('daily_workforce')
      .select('emp_id, name, work_station, shift')
      .eq('work_date', date)
      .eq('upload_round', round)
      .limit(200),
    supabase.from('makro_orders')
      .select('sku, sku_name, quantity, delivery_date, upload_round')
      .eq('delivery_date', date)
      .eq('upload_round', round)
      .limit(200),
    supabase.from('makro_orders')
      .select('sku, sku_name, quantity, delivery_date')
      .in('delivery_date', histDates)
      .limit(200),
    supabase.from('wet_market_orders')
      .select('sku, sku_name, quantity, delivery_date, upload_round')
      .eq('delivery_date', date)
      .eq('upload_round', round)
      .limit(200),
    supabase.from('wet_market_orders')
      .select('sku, sku_name, quantity, delivery_date')
      .in('delivery_date', histDates)
      .limit(200),
    supabase.from('lotus_orders')
      .select('sku, sku_name, quantity, delivery_date, upload_round')
      .eq('delivery_date', date)
      .eq('upload_round', round)
      .limit(200),
    supabase.from('lotus_orders')
      .select('sku, sku_name, quantity, delivery_date')
      .in('delivery_date', histDates)
      .limit(200),
    supabase.from('master_logic_calculation')
      .select('row_data')
      .eq('calculation_type', 'Mas Productivity'),
    supabase.from('daily_workforce')
      .select('work_date')
      .order('work_date', { ascending: false })
      .limit(500),
  ])

  const prodRows = (masterProd ?? []).map(r => r.row_data as Record<string, unknown>)
  const prodSapSet = new Set(prodRows.map(r => String(r['SAP'] ?? '')))
  const workStations = Array.from(new Set((workforce ?? []).map(w => w.work_station).filter(Boolean)))
  const workforceDates = Array.from(new Set((allWorkforceDates ?? []).map(r => r.work_date)))

  // Aggregate by SKU
  const agg = (rows: { sku: string; sku_name: string | null; quantity: number }[]) => {
    const m: Record<string, { sku_name: string | null; quantity: number }> = {}
    for (const r of rows) {
      const sku = r.sku.replace(/^0+/, '') || r.sku
      m[sku] = { sku_name: m[sku]?.sku_name ?? r.sku_name, quantity: (m[sku]?.quantity ?? 0) + r.quantity }
    }
    return Object.entries(m).map(([sku, v]) => ({ sku, ...v }))
  }

  // SKU filter: show per-channel detail across all dates
  let skuDetail: unknown = null
  if (skuFilter) {
    const [{ data: mk }, { data: wm }, { data: lo }] = await Promise.all([
      supabase.from('makro_orders').select('sku, sku_name, quantity, delivery_date, upload_round')
        .eq('sku', skuFilter).order('delivery_date', { ascending: false }).limit(30),
      supabase.from('wet_market_orders').select('sku, sku_name, quantity, delivery_date, upload_round')
        .eq('sku', skuFilter).order('delivery_date', { ascending: false }).limit(30),
      supabase.from('lotus_orders').select('sku, sku_name, quantity, delivery_date, upload_round')
        .eq('sku', skuFilter).order('delivery_date', { ascending: false }).limit(30),
    ])
    skuDetail = {
      sku: skuFilter,
      makro:      mk ?? [],
      wet_market: wm ?? [],
      lotus:      lo ?? [],
    }
  }

  return NextResponse.json({
    date,
    round,
    hist_dates: histDates,
    workforce: {
      total: workforce?.length ?? 0,
      work_stations: workStations,
      available_dates: workforceDates,
    },
    orders_today: {
      makro:      { count: makroToday?.length ?? 0, skus: agg(makroToday ?? []) },
      wet_market: { count: wmToday?.length ?? 0,    skus: agg(wmToday ?? []) },
      lotus:      { count: lotusToday?.length ?? 0, skus: agg(lotusToday ?? []) },
    },
    bl3_history: {
      makro:      { days: Array.from(new Set((makroHist ?? []).map(r => r.delivery_date))), skus: agg(makroHist ?? []) },
      wet_market: { days: Array.from(new Set((wmHist ?? []).map(r => r.delivery_date))),   skus: agg(wmHist ?? []) },
      lotus:      { days: Array.from(new Set((lotusHist ?? []).map(r => r.delivery_date))), skus: agg(lotusHist ?? []) },
    },
    mas_productivity: {
      total_rows: prodRows.length,
      sample_saps: Array.from(prodSapSet).slice(0, 10),
    },
    ...(skuFilter && { sku_detail: skuDetail }),
  })
}
