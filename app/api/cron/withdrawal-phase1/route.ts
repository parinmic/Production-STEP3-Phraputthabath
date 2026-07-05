import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Station (table_name) ฝั่งพิเศษ (STEP 3) เท่านั้น — ฝั่งเบสิคใช้ table_name ต่อท้าย "เบสิค"
const SPECIAL_STATIONS = ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์', 'เผาขา', 'เลาะขา']

export async function GET(req: NextRequest) {
  try {
    // Basic verification using CRON_SECRET if it exists
    const authHeader = req.headers.get('Authorization')
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get today's date in Bangkok (Thailand) time zone in YYYY-MM-DD format
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

    // เช็คก่อนว่ามีแผน Phase 1 (period เช้า) ฝั่งพิเศษของวันนี้อยู่แล้วหรือยัง — ถ้ามีแล้วไม่ต้องสร้างซ้ำ
    const { count: existingCount, error: checkErr } = await supabase
      .from('production_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('production_date', todayStr)
      .eq('period', 'เช้า')
      .in('table_name', SPECIAL_STATIONS)

    if (checkErr) throw new Error(`ตรวจสอบแผนเดิมไม่สำเร็จ: ${checkErr.message}`)

    if ((existingCount ?? 0) > 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        date: todayStr,
        existingCount,
        message: `มีแผน Phase 1 (พิเศษ) ของวันที่ ${todayStr} อยู่แล้ว ${existingCount} รายการ — ไม่สร้างซ้ำ`,
      })
    }

    const origin = req.nextUrl.origin
    const targetUrl = `${origin}/api/production/generate`

    console.log(`[Cron] ยังไม่มีแผน Phase 1 (พิเศษ) ของวันที่ ${todayStr} — สั่ง generate ที่ ${targetUrl}`)

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward authorization header if present
        ...(authHeader ? { 'Authorization': authHeader } : {})
      },
      body: JSON.stringify({
        date: todayStr,
        phase: 1,
        deductMode: 'plan'
      })
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Failed to trigger generate API: ${res.status} ${res.statusText} - ${errorText}`)
    }

    const data = await res.json()

    return NextResponse.json({
      success: true,
      skipped: false,
      date: todayStr,
      phase: 1,
      triggerResult: data,
      message: `Successfully triggered daily auto production plan and withdrawal generation for ${todayStr}`
    })
  } catch (err: any) {
    const errorMsg = err.message || String(err)
    console.error('[Cron] Error running daily auto plan & withdrawal generation:', errorMsg)
    return NextResponse.json({ error: errorMsg }, { status: 500 })
  }
}
