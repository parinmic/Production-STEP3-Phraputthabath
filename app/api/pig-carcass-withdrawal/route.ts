import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data: log } = await supabase
    .from('upload_log')
    .select('id, source_file')
    .eq('table_name', 'stock_20')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!log) return NextResponse.json({ rows: [], source_file: '' })

  // Try filtering by upload_log_id (new batch-aware approach)
  let { data, error } = await supabase
    .from('stock_20')
    .select('spec_code, qty_total, weight_total')
    .eq('material_code', '90007')
    .eq('upload_log_id', log.id)

  // Fallback: column may not exist or data was uploaded before batch tracking
  if (error || !data?.length) {
    const fb = await supabase
      .from('stock_20')
      .select('spec_code, qty_total, weight_total')
      .eq('material_code', '90007')
      .eq('source_file', log.source_file)
    if (!fb.error) { data = fb.data; error = null }
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).map(r => ({
    spec_code: r.spec_code,
    qty_3:     r.qty_total   ?? 0,
    weight_3:  r.weight_total ?? 0,
  }))

  return NextResponse.json({ rows, source_file: log.source_file ?? '' })
}
