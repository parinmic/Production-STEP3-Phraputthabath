import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  const url = process.env.DEV_SYNC_SUPABASE_URL
  const key = process.env.DEV_SYNC_SUPABASE_ANON_KEY

  if (!url || !key) {
    return NextResponse.json({ error: 'DEV_SYNC_SUPABASE_URL หรือ DEV_SYNC_SUPABASE_ANON_KEY ไม่ได้ตั้งค่าใน .env' })
  }

  const dev = createClient(url, key)

  // upload_log latest
  const { data: logRows } = await dev
    .from('upload_log')
    .select('table_name, source_file, uploaded_at')
    .eq('table_name', 'stock_20')
    .order('uploaded_at', { ascending: false })
    .limit(3)

  const latestSourceFile = logRows?.[0]?.source_file ?? null

  // stock_20 ทั้งหมด — group by source_file และ material_code
  const { data: sourceFiles } = await dev
    .from('stock_20')
    .select('source_file, material_code')
    .limit(1000)

  const bySource: Record<string, Set<string>> = {}
  for (const row of sourceFiles ?? []) {
    if (!bySource[row.source_file]) bySource[row.source_file] = new Set()
    bySource[row.source_file].add(row.material_code)
  }

  // จำนวนแถว material_code = '90007' แยกตาม source_file
  const { data: pigRows } = await dev
    .from('stock_20')
    .select('spec_code, source_file')
    .eq('material_code', '90007')

  // จำนวนแถวทั้งหมดใน stock_20
  const { count: totalRows } = await dev
    .from('stock_20')
    .select('*', { count: 'exact', head: true })

  return NextResponse.json({
    upload_log_latest: latestSourceFile,
    stock_20_total_rows: totalRows,
    stock_20_source_files: Object.fromEntries(
      Object.entries(bySource).map(([sf, codes]) => [sf, [...codes]])
    ),
    pig_carcass_90007: {
      count: pigRows?.length ?? 0,
      rows:  pigRows ?? [],
    },
    verdict: {
      source_file_match: latestSourceFile
        ? (pigRows ?? []).some(r => r.source_file === latestSourceFile)
        : null,
    },
  })
}
