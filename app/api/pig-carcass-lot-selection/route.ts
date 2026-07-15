import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { todayBangkok } from '@/lib/date'

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') || todayBangkok()

  const { data, error } = await supabase
    .from('pig_carcass_lot_selection')
    .select('selected, trimming_qty, rate, updated_at')
    .eq('production_date', date)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    selected:    data?.selected ?? [],
    trimmingQty: data?.trimming_qty ?? '',
    rate:        data?.rate ?? 90,
    updatedAt:   data?.updated_at ?? null,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const date = body.date || todayBangkok()

  // Only include fields the caller actually sent — e.g. carcass-cycle only ever posts
  // { rate }, and including selected/trimming_qty with a default here would upsert them
  // to empty on every conflict, wiping out whatever another page just saved.
  const record: Record<string, unknown> = {
    production_date: date,
    updated_at:      new Date().toISOString(),
  }
  if (body.selected !== undefined)    record.selected = body.selected
  if (body.trimmingQty !== undefined) record.trimming_qty = body.trimmingQty
  if (body.rate != null)              record.rate = Number(body.rate)

  const { error } = await supabase
    .from('pig_carcass_lot_selection')
    .upsert(record, { onConflict: 'production_date' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, updatedAt: record.updated_at })
}
