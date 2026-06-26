import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data: log } = await supabase
    .from('upload_log')
    .select('source_file')
    .eq('table_name', 'stock_20')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .single()

  let query = supabase
    .from('stock_20')
    .select('spec_code, qty_3, weight_3')
    .eq('material_code', '90007')

  if (log?.source_file) {
    query = query.eq('source_file', log.source_file)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ rows: data ?? [], source_file: log?.source_file ?? '' })
}
