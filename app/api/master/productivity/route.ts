import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('calculation_type', 'Mas Productivity')
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return map: { [sku]: rate }
  const rateMap: Record<string, number> = {}
  for (const row of data ?? []) {
    const r = row.row_data as Record<string, unknown>
    const sku  = String(r['SAP'] ?? '').trim()
    const rate = Number(r['กำลังการผลิต (กก./ชม./คน)'] ?? 0)
    if (sku && rate > 0 && !rateMap[sku]) rateMap[sku] = rate
  }

  return NextResponse.json({ rateMap })
}
