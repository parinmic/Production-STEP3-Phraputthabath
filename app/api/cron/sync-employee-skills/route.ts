import { NextRequest, NextResponse } from 'next/server'
import { runSync } from '@/lib/sync-employee-skills'

export const dynamic = 'force-dynamic'

// No longer wired to Vercel Cron — the "สร้าง Phase 1" button now triggers
// this sync itself (see app/api/production/generate/route.ts) so the roster
// is always fresh at generate time instead of depending on a fixed schedule.
// Kept as a manual/ops endpoint.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runSync()
  return NextResponse.json(result, { status: result.success ? 200 : 500 })
}

// Called manually from UI/ops (no auth required)
export async function POST() {
  const result = await runSync()
  return NextResponse.json(result, { status: result.success ? 200 : 500 })
}
