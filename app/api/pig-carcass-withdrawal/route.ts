import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Get recent upload_log entries and use the latest one that has actual rows
  // (skips orphaned upload_log entries caused by mid-flight Vercel timeouts)
  const { data: logs } = await supabase
    .from('upload_log')
    .select('id, source_file')
    .eq('table_name', 'stock_20')
    .order('uploaded_at', { ascending: false })
    .limit(5)

  let rows: { spec_code: string; qty_3: number; weight_3: number }[] = []
  let sourceFile = ''

  for (const log of (logs ?? [])) {
    const { data, error } = await supabase
      .from('stock_20')
      .select('spec_code, qty_total, weight_total')
      .eq('material_code', '90007')
      .eq('upload_log_id', log.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) continue

    rows = data.map(r => ({
      spec_code: r.spec_code,
      qty_3:     r.qty_total   ?? 0,
      weight_3:  r.weight_total ?? 0,
    }))
    sourceFile = log.source_file ?? ''
    break
  }

  return NextResponse.json({ rows, source_file: sourceFile })
}
