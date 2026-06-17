import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('mas_yield')
    .select('carcass_weight, product_group, yield_pct')
    .order('carcass_weight', { ascending: true })
    .order('product_group',  { ascending: true })
    .range(0, 1999)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ rows: data ?? [] })
}
