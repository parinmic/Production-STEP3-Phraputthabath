import { NextRequest, NextResponse } from 'next/server'
import { generateBasicPlan } from '@/lib/generate-plan-basic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const result = await generateBasicPlan(body)
  return NextResponse.json(result, { status: result.success ? 200 : 400 })
}
