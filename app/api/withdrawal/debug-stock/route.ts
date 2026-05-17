import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const sku = req.nextUrl.searchParams.get('sku') ?? ''

  const [byCode0010, byCode20] = await Promise.all([
    supabase.from('stock_0010').select('material_code, material_name, spec_code, weight_total').eq('material_code', sku).limit(10),
    supabase.from('stock_20').select('material_code, material_name, spec_code, weight_total').eq('material_code', sku).limit(10),
  ])

  return NextResponse.json({
    sku,
    stock_0010_by_code: byCode0010.data ?? [],
    stock_20_by_code:   byCode20.data ?? [],
    note: 'ถ้าทั้งสองว่าง แปลว่าไม่มีสต็อกหรือ material_code ไม่ตรง',
  })
}
