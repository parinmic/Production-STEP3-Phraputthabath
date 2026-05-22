import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

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

    const origin = req.nextUrl.origin
    const targetUrl = `${origin}/api/production/generate`

    console.log(`[Cron] Triggering auto plan & withdrawal generation at ${targetUrl} for date: ${todayStr}`)

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
