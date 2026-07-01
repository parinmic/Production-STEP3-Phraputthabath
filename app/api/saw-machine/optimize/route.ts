import { NextRequest, NextResponse } from 'next/server'
import { runSawMachineOptimize } from '@/lib/saw-machine-optimize'

export type { OptimizeChange, SawScheduleEntry } from '@/lib/saw-machine-optimize'

export async function POST(req: NextRequest) {
  try {
    const { date, phase, dryRun = true } = await req.json()
    if (!date || !phase) return NextResponse.json({ error: 'missing params' }, { status: 400 })
    const result = await runSawMachineOptimize({ date, phase: Number(phase), dryRun })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
