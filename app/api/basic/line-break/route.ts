import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const date    = req.nextUrl.searchParams.get('date')
  const station = req.nextUrl.searchParams.get('station')
  if (!date) return NextResponse.json({ breaks: [] })

  let q = supabase.from('basic_line_breaks').select('*').eq('production_date', date).order('start_time')
  if (station) q = q.in('station', [station, 'ทั้งหมด'])

  const { data, error } = await q
  if (error) return NextResponse.json({ breaks: [], error: error.message }, { status: 500 })
  return NextResponse.json({ breaks: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { production_date, station, start_time, end_time, reason } = await req.json()
    if (!production_date || !station || !start_time || !end_time)
      return NextResponse.json({ success: false, message: 'ข้อมูลไม่ครบ' }, { status: 400 })
    if (start_time >= end_time)
      return NextResponse.json({ success: false, message: 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด' }, { status: 400 })

    const { data, error } = await supabase.from('basic_line_breaks').insert({
      production_date, station, start_time, end_time, reason: reason || null,
    }).select().single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, break: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ success: false, message: 'ไม่พบ id' }, { status: 400 })
  const { error } = await supabase.from('basic_line_breaks').delete().eq('id', id)
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
