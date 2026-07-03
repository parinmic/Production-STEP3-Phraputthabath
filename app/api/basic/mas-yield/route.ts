import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchLatestMasYield } from '@/lib/mas-yield'

export async function GET() {
  try {
    const rows = await fetchLatestMasYield(supabase)
    return NextResponse.json({ rows })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load mas_yield'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
