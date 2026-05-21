import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const date  = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  const table = req.nextUrl.searchParams.get('table') ?? ''
  const now   = new Date().toISOString()

  // Step 1: หา effective_from ล่าสุดที่ <= ตอนนี้ (แยกตาม period)
  // แผน B ที่ effective_from ยังไม่ถึง จะถูกกรองออก → แสดงแผน A แทน
  const periodQuery = supabase
    .from('production_assignments')
    .select('period, effective_from')
    .eq('production_date', date)
    .lte('effective_from', now)
    .order('effective_from', { ascending: false })

  if (table) periodQuery.eq('table_name', table)
  const { data: periodRows } = await periodQuery

  // หา max effective_from ต่อ period
  const maxEffective: Record<string, string> = {}
  for (const row of periodRows ?? []) {
    const p = row.period as string
    const e = row.effective_from as string
    if (!maxEffective[p] || e > maxEffective[p]) maxEffective[p] = e
  }

  if (Object.keys(maxEffective).length === 0) {
    return NextResponse.json({ assignments: [] })
  }

  // Step 2: ดึง assignments เฉพาะ batch ที่มี effective_from ตรงกับ max ของแต่ละ period
  const allAssignments: any[] = []
  for (const [period, effectiveFrom] of Object.entries(maxEffective)) {
    const q = supabase
      .from('production_assignments')
      .select('*')
      .eq('production_date', date)
      .eq('period', period)
      .eq('effective_from', effectiveFrom)
      .order('worker_name')
      .order('seq', { nullsFirst: false })
    if (table) q.eq('table_name', table)
    const { data } = await q
    if (data) allAssignments.push(...data)
  }

  return NextResponse.json({ assignments: allAssignments })
}
