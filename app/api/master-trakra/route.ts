import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  // ดึง source_files ที่อัปโหลดเป็น mas-trakra จาก upload_log
  const { data: logs } = await supabase
    .from('upload_log')
    .select('source_file')
    .eq('table_name', 'master_logic_calc_mas_trakra')

  if (!logs?.length) return NextResponse.json([])

  const sourceFiles = logs.map(l => l.source_file)

  const { data } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .in('source_file', sourceFiles)

  if (!data?.length) return NextResponse.json([])

  const result = data
    .map(r => {
      const d = r.row_data as Record<string, unknown>
      const sap  = String(d['SAP'] ?? '').replace(/^0+/, '').trim()
      const rate = Number(d['ปริมาณต่อตะกร้า'] ?? 0)
      return { sku: sap, rate }
    })
    .filter(r => r.sku && r.rate > 0)

  return NextResponse.json(result)
}
