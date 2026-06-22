import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { data, error } = await supabase
    .from('picking_unit_master_basic')
    .select('sap, weight_per_bag, mins_per_basket')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bagMap: Record<string, number> = {}
  const minsMap: Record<string, number> = {}
  for (const row of data ?? []) {
    const sku  = String(row.sap ?? '').trim()
    const wpb  = Number(row.weight_per_bag ?? 0)
    const mpb  = row.mins_per_basket != null ? Number(row.mins_per_basket) : 0
    const norm = sku.replace(/^0+/, '')
    if (sku && wpb > 0) {
      bagMap[sku]  = wpb
      bagMap[norm] = wpb
    }
    if (sku && mpb > 0) {
      minsMap[sku]  = mpb
      minsMap[norm] = mpb
    }
  }

  return NextResponse.json({ bagMap, minsMap })
}
