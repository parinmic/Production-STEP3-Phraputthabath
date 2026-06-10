import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { data, error } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('calculation_type', 'Mas Channel')
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).map(r => r.row_data as Record<string, unknown>)

  // Group by phase, sorted by priority
  const byPhase: Record<number, { channel: string; priority: number }[]> = {}
  for (const r of rows) {
    const phase    = Number(r['Phase'])
    const channel  = String(r['Channel'] ?? '').trim()
    const priority = Number(r['Priority'] ?? 0)
    if (!byPhase[phase]) byPhase[phase] = []
    byPhase[phase].push({ channel, priority })
  }
  for (const ph of Object.keys(byPhase)) {
    byPhase[Number(ph)].sort((a, b) => a.priority - b.priority)
  }

  return NextResponse.json({ total_rows: rows.length, by_phase: byPhase, raw: rows })
}
