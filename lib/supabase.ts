import { createClient } from '@supabase/supabase-js'

function resolveSchema(): string {
  if (typeof window !== 'undefined') {
    // Client-side (browser): use exact hostname — no build-time env var needed
    return window.location.hostname === 'production-step-3-phraputthabath.vercel.app'
      ? 'public'
      : 'dev'
  }
  // Server-side (API routes / SSR): VERCEL_ENV has no NEXT_PUBLIC_ prefix so it is
  // read at runtime — not baked into the bundle at build time.
  // production deployment → 'public', preview / local → 'dev'
  return process.env.VERCEL_ENV === 'production' ? 'public' : 'dev'
}

export const supabaseSchema = resolveSchema()

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
