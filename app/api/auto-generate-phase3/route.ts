import { NextRequest, NextResponse } from 'next/server'
import { autoGeneratePhase3 } from '@/lib/auto-generate'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { date } = await req.json()
    if (!date) return NextResponse.json({ error: 'missing date' }, { status: 400 })
    const message = await autoGeneratePhase3(date)
    return NextResponse.json({ message })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'error' },
      { status: 500 }
    )
  }
}
