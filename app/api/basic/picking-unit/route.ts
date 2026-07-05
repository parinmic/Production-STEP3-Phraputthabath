import { NextResponse } from 'next/server'
import { fetchBasicPickingUnitMaps } from '@/lib/generate-plan-basic'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { bagMap, minsMap } = await fetchBasicPickingUnitMaps()
  return NextResponse.json({ bagMap, minsMap })
}
