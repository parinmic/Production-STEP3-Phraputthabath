import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const date = searchParams.get('date')
    const station = searchParams.get('station')

    if (!date || !station) {
      return NextResponse.json({ success: false, message: 'กรุณาระบุข้อมูลให้ครบถ้วน (date, station)' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('workforce_daily_status')
      .select('work_date, weekly_type, worker_name, status')
      .eq('work_date', date)
      .eq('weekly_type', station)

    if (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล'
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { date, station, workerName, status } = body

    if (!date || !station || !workerName || !status) {
      return NextResponse.json({ success: false, message: 'กรุณาระบุข้อมูลให้ครบถ้วน (date, station, workerName, status)' }, { status: 400 })
    }

    const { error } = await supabase
      .from('workforce_daily_status')
      .upsert({
        work_date: date,
        weekly_type: station,
        worker_name: workerName,
        status: status,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'work_date,weekly_type,worker_name'
      })

    if (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'บันทึกสถานะพนักงานเรียบร้อยแล้ว' })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
