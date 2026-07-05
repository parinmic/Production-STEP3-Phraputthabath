import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('calculation_type', 'Mas Productivity Basic')
    .order('uploaded_at', { ascending: false })
    .limit(5000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows: { sku: string; sku_name: string; product_group: string; station: string; product: string }[] = []
  const seen = new Set<string>()

  for (const row of data ?? []) {
    const r = row.row_data as Record<string, unknown>
    const sku           = String(r['SAP'] ?? '').trim()
    const sku_name      = String(r['ชื่อสินค้า'] ?? '').trim()
    const product_group = String(r['กลุ่มสินค้า'] ?? '').trim()
    const station       = String(r['สายพาน'] ?? '').trim()
    const product       = String(r['Product'] ?? '').trim()
    if (!sku || seen.has(sku)) continue
    seen.add(sku)
    rows.push({ sku, sku_name, product_group, station, product })
  }

  return NextResponse.json({ rows })
}
