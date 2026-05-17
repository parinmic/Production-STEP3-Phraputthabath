import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const sku  = req.nextUrl.searchParams.get('sku') ?? ''
  const name = req.nextUrl.searchParams.get('name') ?? 'สันนอก'

  const [byCode0010, byCode20, byName0010, byName20, sample0010, sample20] = await Promise.all([
    supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').eq('material_code', sku).limit(5),
    supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').eq('material_code', sku).limit(5),
    supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').ilike('material_name', `%${name}%`).limit(5),
    supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').ilike('material_name', `%${name}%`).limit(5),
    supabase.from('stock_0010').select('material_code, material_name').limit(5),
    supabase.from('stock_20').select('material_code, material_name').limit(5),
  ])

  return NextResponse.json({
    sku,
    name_search: name,
    by_code:  { stock_0010: byCode0010.data ?? [], stock_20: byCode20.data ?? [] },
    by_name:  { stock_0010: byName0010.data ?? [], stock_20: byName20.data ?? [] },
    sample_rows: { stock_0010: sample0010.data ?? [], stock_20: sample20.data ?? [] },
  })
}
