import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { date, phase, period, raw_materials, wipf_items } = body

    if (!date || !phase || !period) {
      return NextResponse.json({ error: 'missing required fields' }, { status: 400 })
    }

    // Upsert by (production_date, phase) — overwrite if already exists
    const { error } = await supabase
      .from('rm_allocation_snapshots')
      .upsert(
        { production_date: date, phase, period, raw_materials: raw_materials ?? [], wipf_items: wipf_items ?? [] },
        { onConflict: 'production_date,phase', ignoreDuplicates: false }
      )

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get('date')
    if (!date) return NextResponse.json({ error: 'missing date' }, { status: 400 })

    const { data, error } = await supabase
      .from('rm_allocation_snapshots')
      .select('*')
      .eq('production_date', date)
      .order('phase')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ snapshots: data ?? [] })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
