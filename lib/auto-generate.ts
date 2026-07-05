import { supabase } from '@/lib/supabase'
import { generatePlan } from '@/lib/generate-plan'

const PHASE2_UPLOAD_TABLES = ['makro_orders_1400', 'lotus_orders_1400', 'wet_market_orders_1400']

function todayBangkok(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
}

/**
 * Check if all 3 Phase 2 order files (Makro/Lotus/Wet 14:00) have been uploaded
 * today (Bangkok time). If all present, trigger Phase 2 generation and return
 * the generation message. Returns null if not all files are uploaded yet.
 */
export async function checkAndAutoGeneratePhase2(date?: string): Promise<string | null> {
  const workDate = date ?? todayBangkok()
  const dayStart = new Date(`${workDate}T00:00:00+07:00`)
  const dayEnd   = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  const { data } = await supabase
    .from('upload_log')
    .select('table_name')
    .in('table_name', PHASE2_UPLOAD_TABLES)
    .gte('uploaded_at', dayStart.toISOString())
    .lt('uploaded_at', dayEnd.toISOString())

  const uploaded = new Set((data ?? []).map(r => r.table_name as string))
  if (!PHASE2_UPLOAD_TABLES.every(t => uploaded.has(t))) return null

  const specialResult = await generatePlan({ date: workDate, phase: 2 })

  return specialResult.message
}

/**
 * Trigger Phase 3 generation for the given date.
 */
export async function autoGeneratePhase3(date: string): Promise<string> {
  const result = await generatePlan({ date, phase: 3 })
  return result.message
}
