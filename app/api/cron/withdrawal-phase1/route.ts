import { NextRequest, NextResponse } from 'next/server'
import { autoGenerateWithdrawal } from '@/app/api/production/generate/route'

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

    console.log(`[Cron] Triggering auto withdrawal calculation for date: ${todayStr}, phase: 1`)
    
    // Call the shared auto-generation function for Phase 1 (เช้า)
    await autoGenerateWithdrawal(todayStr, 1)

    return NextResponse.json({ 
      success: true, 
      date: todayStr, 
      phase: 1, 
      message: `Successfully generated Phase 1 withdrawal plan for ${todayStr}` 
    })
  } catch (err: any) {
    const errorMsg = err.message || String(err)
    console.error('[Cron] Error calculating Phase 1 withdrawal:', errorMsg)
    return NextResponse.json({ error: errorMsg }, { status: 500 })
  }
}
