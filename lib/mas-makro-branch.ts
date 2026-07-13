import type { SupabaseClient } from '@supabase/supabase-js'

// Master สาขา Makro (rCv_code -> ชื่อสาขา) — อัพโหลดผ่านเมนู Master Logic > Calculation > Mas Makro สาขา
// เก็บใน master_logic_calculation (calculation_type = CALCULATION_TYPE) เหมือน master data อื่นๆ
const CALCULATION_TYPE = 'Mas Makro สาขา'
const TABLE_NAME = 'master_logic_calc_mas_makro_branch'

function extractCode(row: Record<string, unknown>): string {
  return String(row['rCv_code'] ?? row['รหัสสาขา'] ?? row['code'] ?? '').trim()
}

function extractName(row: Record<string, unknown>): string {
  return String(row['rCv_name'] ?? row['ชื่อสาขา'] ?? row['name'] ?? '').trim()
}

export async function fetchLatestMakroBranchMap(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data: latestLog, error: logError } = await supabase
    .from('upload_log')
    .select('id')
    .eq('table_name', TABLE_NAME)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (logError) throw logError
  if (!latestLog?.id) return {}

  const { data, error } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('upload_log_id', latestLog.id)
    .eq('calculation_type', CALCULATION_TYPE)

  if (error) throw error

  const map: Record<string, string> = {}
  for (const row of (data ?? []) as { row_data: Record<string, unknown> }[]) {
    const code = extractCode(row.row_data)
    const name = extractName(row.row_data)
    if (code && name) map[code] = name
  }
  return map
}

export function mapMakroBranch(branchMap: Record<string, string>, code: string | null): string | null {
  if (!code) return null
  return branchMap[code] ?? code
}
