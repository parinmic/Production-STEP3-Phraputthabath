import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date) return NextResponse.json({ yieldMap: {} })

  const { data, error } = await supabase
    .from('yield_bags')
    .select('sap_code, bags, weight')
    .eq('work_date', date)

  if (error) return NextResponse.json({ yieldMap: {}, yieldWeightMap: {} }, { status: 500 })

  const yieldMap:       Record<string, number>      = {}
  const yieldWeightMap: Record<string, number|null> = {}
  for (const row of (data ?? [])) {
    yieldMap[row.sap_code] = (yieldMap[row.sap_code] ?? 0) + row.bags
    if (row.weight != null)
      yieldWeightMap[row.sap_code] = (yieldWeightMap[row.sap_code] ?? 0) + Number(row.weight)
  }

  return NextResponse.json({ yieldMap, yieldWeightMap })
}
