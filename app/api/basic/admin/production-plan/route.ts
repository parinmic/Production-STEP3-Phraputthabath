import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date) return NextResponse.json({ rows: [] })

  const { data, error } = await supabase
    .from('production_plan_100')
    .select('*')
    .eq('plan_date', date)
    .order('station')
    .order('seq')

  if (error) return NextResponse.json({ rows: [], error: error.message }, { status: 500 })
  return NextResponse.json({ rows: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, qty_bags, weight_total } = await req.json()
    if (!id) return NextResponse.json({ success: false, message: 'ไม่พบ id' }, { status: 400 })

    const { error } = await supabase
      .from('production_plan_100')
      .update({ qty_bags, weight_total })
      .eq('id', id)

    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ success: false, message: 'ไม่พบ id' }, { status: 400 })

  const { error } = await supabase.from('production_plan_100').delete().eq('id', id)
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
