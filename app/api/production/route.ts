import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const date  = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  const table = req.nextUrl.searchParams.get('table') ?? ''
  const query = supabase
    .from('production_assignments')
    .select('*')
    .eq('production_date', date)
    .order('worker_name')
    .order('period')
    .order('seq', { nullsFirst: false })
  if (table) query.eq('table_name', table)
  const { data, error } = await query
  if (error) return NextResponse.json({ assignments: [] })
  return NextResponse.json({ assignments: data ?? [] })
}
