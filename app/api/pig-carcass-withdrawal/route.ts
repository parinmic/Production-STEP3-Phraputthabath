import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

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

    const { data: qcRows, error: qcErr } = await supabase
      .from('qc_lot_round_items')
      .select('spec_code, qty_3, updated_at')
      .order('updated_at', { ascending: false })

    if (qcErr) return NextResponse.json({ error: qcErr.message }, { status: 500 })

    const latestQcQty = new Map<string, number>()
    for (const r of qcRows ?? []) {
      const spec = String(r.spec_code ?? '').trim()
      if (!spec || latestQcQty.has(spec)) continue
      latestQcQty.set(spec, num(r.qty_3))
    }

    rows = data.map(r => {
      const stockQty = num(r.qty_total)
      const stockWgt = num(r.weight_total)
      const qcQty    = latestQcQty.get(r.spec_code)
      const qty      = qcQty ?? stockQty
      const avgWgt   = stockQty > 0 ? stockWgt / stockQty : 0
      return {
        spec_code: r.spec_code,
        qty_3:     qty,
        weight_3:  qcQty != null ? avgWgt * qty : stockWgt,
      }
    })
    sourceFile = log.source_file ?? ''
    break
  }

  return NextResponse.json(
    { rows, source_file: sourceFile },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
