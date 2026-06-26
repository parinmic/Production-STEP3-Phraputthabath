import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('pig_carcass_lot_selection')
    .select('selected, trimming_qty, updated_at')
    .eq('id', 1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    selected:    data?.selected ?? [],
    trimmingQty: data?.trimming_qty ?? '',
    updatedAt:   data?.updated_at ?? null,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  const record = {
    id:           1,
    selected:     body.selected ?? [],
    trimming_qty: body.trimmingQty ?? null,
    updated_at:   new Date().toISOString(),
  }

  const { error } = await supabase
    .from('pig_carcass_lot_selection')
    .upsert(record, { onConflict: 'id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
