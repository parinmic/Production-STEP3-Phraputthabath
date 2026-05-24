import { createClient } from '@supabase/supabase-js'

// Each Vercel deployment (production / preview) points to its own Supabase project
// via separate NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.
// Both projects use the 'public' schema by default.
export const supabaseSchema = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA ?? 'public'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { db: { schema: supabaseSchema } },
)

export type TableName = 'สามชั้น' | 'สะโพก' | 'ไหล่'
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
