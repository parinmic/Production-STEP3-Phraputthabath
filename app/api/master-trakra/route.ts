import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('calculation_type', 'Mas ตระกร้า')

  if (!data?.length) return NextResponse.json([])

  const result = data
    .map(r => {
      const d = r.row_data as Record<string, unknown>
      const sap  = String(d['SAP'] ?? '').replace(/^0+/, '').trim()
      const rate = Number(d['ปริมาณต่อตะกร้า'] ?? 0)
      return { sku: sap, rate }
    })
    .filter(r => r.sku && r.rate > 0)

  return NextResponse.json(result)
}
