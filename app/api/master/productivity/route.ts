import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { data, error } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('calculation_type', 'Mas Productivity')
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return maps: { [sku]: rate } and { [sku]: station (จุดงาน) }
  const rateMap: Record<string, number> = {}
  const stationMap: Record<string, string> = {}
  for (const row of data ?? []) {
    const r = row.row_data as Record<string, unknown>
    const sku     = String(r['SAP'] ?? '').trim()
    const rate    = Number(r['กำลังการผลิต (กก./ชม./คน)'] ?? 0)
    const station = String(r['จุดงาน'] ?? '').trim()
    if (sku && rate > 0 && !rateMap[sku]) rateMap[sku] = rate
    if (sku && station && !stationMap[sku]) stationMap[sku] = station
  }

  return NextResponse.json({ rateMap, stationMap })
}
