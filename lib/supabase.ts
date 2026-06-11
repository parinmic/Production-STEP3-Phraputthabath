import { createClient } from '@supabase/supabase-js'

export const supabaseSchema = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA ?? 'public'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
<<<<<<< HEAD
  { db: { schema: supabaseSchema } },
=======
  { db: { schema: 'public' } },
>>>>>>> 0059cc5 (fix: force public schema on supabase client to prevent dev schema routing)
)

export const externalSupabase = createClient(
  process.env.EXTERNAL_SUPABASE_URL ?? 'https://placeholder.supabase.co',
  process.env.EXTERNAL_SUPABASE_ANON_KEY ?? 'placeholder-key',
)

export type TableName = 'สามชั้น' | 'สะโพก' | 'ไหล่' | 'หมูบด' | 'สไลด์'
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
