import { NextRequest, NextResponse } from 'next/server'
import { generateBasicPlan } from '@/lib/generate-plan-basic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await generateBasicPlan(body)
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
