import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]

  const [
    { data: workforce },
    { data: quotas },
    { data: masterProd },
    { data: allWorkforceDates },
    { data: allQuotaDates },
  ] = await Promise.all([
    supabase.from('daily_workforce').select('emp_id, name, work_station, shift').eq('work_date', date).limit(200),
    supabase.from('channel_quotas').select('channel, sku, sku_name, quantity').eq('quota_date', date).limit(200),
    supabase.from('master_logic_calculation').select('row_data').eq('calculation_type', 'Mas Productivity'),
    supabase.from('daily_workforce').select('work_date').order('work_date', { ascending: false }).limit(500),
    supabase.from('channel_quotas').select('quota_date').order('quota_date', { ascending: false }).limit(500),
  ])

  const prodRows = (masterProd ?? []).map(r => r.row_data as Record<string, unknown>)
  const prodSapSet = new Set(prodRows.map(r => String(r['SAP'] ?? '')))
  const prodStations = Array.from(new Set(prodRows.map(r => String(r['จุดงาน'] ?? ''))))

  const workStations = Array.from(new Set((workforce ?? []).map(w => w.work_station).filter(Boolean)))
  const quotaSaps = Array.from(new Set((quotas ?? []).map(q => q.sku)))
  const overlapSaps = quotaSaps.filter(s => prodSapSet.has(s))

  const workforceDates = Array.from(new Set((allWorkforceDates ?? []).map(r => r.work_date)))
  const quotaDates = Array.from(new Set((allQuotaDates ?? []).map(r => r.quota_date)))

  return NextResponse.json({
    date,
    workforce: {
      total: workforce?.length ?? 0,
      work_stations: workStations,
      available_dates: workforceDates,
      sample: workforce?.slice(0, 3),
    },
    quota: {
      total: quotas?.length ?? 0,
      unique_skus: quotaSaps.length,
      channels: Array.from(new Set((quotas ?? []).map(q => q.channel))),
      available_dates: quotaDates,
      sample_skus: quotaSaps.slice(0, 10),
    },
    mas_productivity: {
      total_rows: prodRows.length,
      จุดงาน: prodStations,
      sample_saps: Array.from(prodSapSet).slice(0, 10),
    },
    sku_overlap: {
      matching_count: overlapSaps.length,
      matching_skus: overlapSaps.slice(0, 10),
      non_matching_sample: quotaSaps.filter(s => !prodSapSet.has(s)).slice(0, 10),
    },
  })
}
