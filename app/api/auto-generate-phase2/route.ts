import { NextRequest, NextResponse } from 'next/server'
import { checkAndAutoGeneratePhase2 } from '@/lib/auto-generate'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const date = (body as { date?: string }).date
    const message = await checkAndAutoGeneratePhase2(date)
    return NextResponse.json({ triggered: message !== null, message })
  } catch (err) {
    return NextResponse.json(
      { triggered: false, error: err instanceof Error ? err.message : 'error' },
      { status: 500 }
    )
  }
}
