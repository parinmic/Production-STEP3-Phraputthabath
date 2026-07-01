import { NextRequest, NextResponse } from 'next/server'
import { generatePlan } from '@/lib/generate-plan'
import { runSawMachineOptimize } from '@/lib/saw-machine-optimize'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await generatePlan(body)

    if (result.success && body.date && body.phase) {
      runSawMachineOptimize({ date: body.date, phase: Number(body.phase), dryRun: false }).catch(() => {})
    }

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
