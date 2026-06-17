import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const PAGE = 1000
  let all: { carcass_weight: number; product_group: string; yield_pct: number }[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('mas_yield')
      .select('carcass_weight, product_group, yield_pct')
      .order('carcass_weight', { ascending: true })
      .order('product_group',  { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break

    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }

  return NextResponse.json({ rows: all })
}
