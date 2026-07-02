import { createClient } from '@supabase/supabase-js'

export const supabaseSchema = 'public'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { db: { schema: 'public' } },
)

export const externalSupabase = createClient(
  process.env.EXTERNAL_SUPABASE_URL ?? 'https://placeholder.supabase.co',
  process.env.EXTERNAL_SUPABASE_ANON_KEY ?? 'placeholder-key',
)

export type TableName = 'สามชั้น' | 'สะโพก' | 'ไหล่' | 'หมูบด' | 'สไลด์' | 'เผาขา' | 'เลาะขา'
export type Shift = 'เช้า' | 'บ่าย' | 'ค่ำ'
export type AssignmentStatus = 'รอดำเนินการ' | 'กำลังผลิต' | 'เสร็จแล้ว'

export interface ProductionAssignment {
  id?: string
  production_date: string
  table_name: TableName
  worker_code: string
  worker_name: string
  sku: string
  sku_name?: string
  target_quantity: number
  unit?: string
  period: string
  deadline_time?: string
  status: AssignmentStatus
  note?: string
}

export interface Plan100Row {
  plan_date: string
  sap: string
  product_name: string | null
  weight_total: number
}

// A re-upload of the same plan_date's file leaves the old rows in place (no replace-on-upload),
// so querying by plan_date alone can double-count. Keep only rows from each date's most recent
// upload_log_id. Dates with no upload_log_id on any row (legacy rows predating that column) are
// returned unfiltered.
export async function fetchLatestPlan100(dates: string[]): Promise<Plan100Row[]> {
  if (!dates.length) return []
  const PAGE = 1000
  type RawRow = Plan100Row & { upload_log_id: string | null; uploaded_at: string | null }
  const all: RawRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('production_plan_100')
      .select('plan_date, sap, product_name, weight_total, upload_log_id, uploaded_at')
      .in('plan_date', dates)
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...((data ?? []) as RawRow[]))
    if (!data || data.length < PAGE) break
    from += PAGE
  }

  const latestByDate = new Map<string, { uploadedAt: string; uploadLogId: string }>()
  for (const r of all) {
    if (!r.uploaded_at || !r.upload_log_id) continue
    const cur = latestByDate.get(r.plan_date)
    if (!cur || r.uploaded_at > cur.uploadedAt) {
      latestByDate.set(r.plan_date, { uploadedAt: r.uploaded_at, uploadLogId: r.upload_log_id })
    }
  }

  return all
    .filter(r => {
      const latest = latestByDate.get(r.plan_date)
      return !latest || r.upload_log_id === latest.uploadLogId
    })
    .map(({ plan_date, sap, product_name, weight_total }) => ({ plan_date, sap, product_name, weight_total }))
}
