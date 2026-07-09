import { NextRequest, NextResponse } from 'next/server'
import { generatePlan } from '@/lib/generate-plan'
import { runSync } from '@/lib/sync-employee-skills'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    // Phase 1 no longer waits for the 8:05 cron — refresh the roster from
    // the source right before generating so it's always up to date. Best
    // effort: if the source is unreachable, fall through and generate with
    // whatever roster is already in employee_skills.
    if (body?.phase === 1) {
      const syncResult = await runSync()
      if (!syncResult.success) {
        console.error('sync-employee-skills (pre-Phase1) failed:', syncResult.error)
      }
    }
    const result = await generatePlan(body)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (e: unknown) {
    const msg = e instanceof Error
      ? e.message
      : (typeof e === 'object' && e !== null)
        ? ((e as any).message ?? (e as any).details ?? JSON.stringify(e))
        : String(e)
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}
