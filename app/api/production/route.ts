import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const date  = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  const table = req.nextUrl.searchParams.get('table') ?? ''

  // Step 1: หา effective_from ล่าสุดต่อ period (รวม future batch — แผนใหม่แสดงทันทีไม่รอ checkpoint)
  let periodQuery = supabase
    .from('production_assignments')
    .select('period, effective_from')
    .eq('production_date', date)
    .order('effective_from', { ascending: false })

  if (table) periodQuery = periodQuery.eq('table_name', table)
  const { data: periodRows } = await periodQuery

  // หา max effective_from ต่อ period
  const maxEffective: Record<string, string> = {}
  for (const row of periodRows ?? []) {
    const p = row.period as string
    const e = row.effective_from as string
    if (!maxEffective[p] || e > maxEffective[p]) maxEffective[p] = e
  }

  if (Object.keys(maxEffective).length === 0) {
    // Debug: check if there's data at all for this date (ignoring table)
    const { count } = await supabase
      .from('production_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('production_date', date)
    return NextResponse.json({ assignments: [], _debug: { table, period_rows_for_table: 0, total_rows_for_date: count } })
  }

  // Step 2: ดึง assignments เฉพาะ batch ที่มี effective_from ตรงกับ max ของแต่ละ period
  const allAssignments: any[] = []
  for (const [period, effectiveFrom] of Object.entries(maxEffective)) {
    let q = supabase
      .from('production_assignments')
      .select('*')
      .eq('production_date', date)
      .eq('period', period)
      .eq('effective_from', effectiveFrom)
      .order('worker_name')
      .order('seq', { nullsFirst: false })
    if (table) q = q.eq('table_name', table)
    const { data } = await q
    if (data) allAssignments.push(...data)
  }

  return NextResponse.json({ assignments: allAssignments })
}
