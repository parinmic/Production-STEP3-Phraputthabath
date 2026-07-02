import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date) return NextResponse.json({ yieldMap: {} })

  // Find all upload_log_ids for this date, then pick the latest one
  const { data: logRows } = await supabase
    .from('yield_bags')
    .select('upload_log_id')
    .eq('work_date', date)
    .not('upload_log_id', 'is', null)

  const uniqueLogIds = [...new Set((logRows ?? []).map((r: { upload_log_id: string | null }) => r.upload_log_id).filter(Boolean))] as string[]
  if (!uniqueLogIds.length) return NextResponse.json({ yieldMap: {}, yieldWeightMap: {} })

  const { data: logs } = await supabase
    .from('upload_log')
    .select('id')
    .in('id', uniqueLogIds)
    .order('uploaded_at', { ascending: false })
    .limit(1)

  const latestLogId = logs?.[0]?.id
  if (!latestLogId) return NextResponse.json({ yieldMap: {}, yieldWeightMap: {} })

  const { data, error } = await supabase
    .from('yield_bags')
    .select('sap_code, bags, weight')
    .eq('work_date', date)
    .eq('upload_log_id', latestLogId)

  if (error) return NextResponse.json({ yieldMap: {}, yieldWeightMap: {} }, { status: 500 })

  const yieldMap:       Record<string, number>      = {}
  const yieldWeightMap: Record<string, number|null> = {}
  for (const row of (data ?? [])) {
    yieldMap[row.sap_code] = (yieldMap[row.sap_code] ?? 0) + row.bags
    if (row.weight != null)
      yieldWeightMap[row.sap_code] = (yieldWeightMap[row.sap_code] ?? 0) + Number(row.weight)
  }

  return NextResponse.json({ yieldMap, yieldWeightMap })
}
