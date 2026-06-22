import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [{ data: basicData, error }, { data: rawData }] = await Promise.all([
    supabase.from('picking_unit_master_basic').select('sap, weight_per_bag, mins_per_basket'),
    supabase.from('mas_raw_basket').select('sap_code, kg_per_basket'),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bagMap: Record<string, number> = {}
  const minsMap: Record<string, number> = {}

  for (const row of basicData ?? []) {
    const sku  = String(row.sap ?? '').trim()
    const wpb  = Number(row.weight_per_bag ?? 0)
    const mpb  = row.mins_per_basket != null ? Number(row.mins_per_basket) : 0
    const norm = sku.replace(/^0+/, '')
    if (sku && wpb > 0) { bagMap[sku] = wpb; bagMap[norm] = wpb }
    if (sku && mpb > 0) { minsMap[sku] = mpb; minsMap[norm] = mpb }
  }

  // Merge Raw basket sizes (no mins available from this source)
  for (const row of rawData ?? []) {
    const sku  = String(row.sap_code ?? '').trim()
    const wpb  = Number(row.kg_per_basket ?? 0)
    const norm = sku.replace(/^0+/, '')
    if (sku && wpb > 0 && !bagMap[sku]) {
      bagMap[sku]  = wpb
      bagMap[norm] = wpb
    }
  }

  return NextResponse.json({ bagMap, minsMap })
}
