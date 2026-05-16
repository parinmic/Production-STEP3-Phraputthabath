import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date) return NextResponse.json({ yieldMap: {} })

  const { data, error } = await supabase
    .from('yield_bags')
    .select('sap_code, bags')
    .eq('work_date', date)

  if (error) return NextResponse.json({ yieldMap: {} }, { status: 500 })

  const yieldMap: Record<string, number> = {}
  for (const row of (data ?? [])) {
    yieldMap[row.sap_code] = (yieldMap[row.sap_code] ?? 0) + row.bags
  }

  return NextResponse.json({ yieldMap })
}
