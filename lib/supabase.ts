import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
// Dynamically resolve schema based on environment to isolate dev and production environments
let resolvedSchema = 'public'

if (typeof window !== 'undefined') {
  const hostname = window.location.hostname
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    resolvedSchema = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA ?? 'dev'
  } else if (hostname.includes('production-step-3-phraputthabath.vercel.app')) {
    resolvedSchema = 'public'
  } else {
    resolvedSchema = 'dev'
  }
} else {
  const env = process.env.VERCEL_ENV || process.env.NODE_ENV
  if (env === 'production') {
    resolvedSchema = 'public'
  } else if (env === 'preview') {
    resolvedSchema = 'dev'
  } else {
    resolvedSchema = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA ?? 'dev'
  }
}

export const supabaseSchema = resolvedSchema

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: supabaseSchema },
})

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
