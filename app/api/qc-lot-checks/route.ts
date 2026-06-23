import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDev } from '@/lib/sync-to-dev'

export async function GET() {
  const { data, error } = await supabase
    .from('qc_lot_temperature_checks')
    .select('spec_code, chill_room, temps')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const temps:     Record<string, unknown> = {}
  const chillRoom: Record<string, string>  = {}
  for (const row of data ?? []) {
    if (row.temps)      temps[row.spec_code]     = row.temps
    if (row.chill_room) chillRoom[row.spec_code] = row.chill_room
  }
  return NextResponse.json({ temps, chillRoom })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const spec_code  = String(body.spec_code ?? '').trim()
  if (!spec_code) return NextResponse.json({ error: 'missing spec_code' }, { status: 400 })

  const record = { spec_code, chill_room: body.chill_room ?? null, temps: body.temps ?? {}, updated_at: new Date().toISOString() }

  const { error } = await supabase
    .from('qc_lot_temperature_checks')
    .upsert(record, { onConflict: 'spec_code' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  syncToDev(async (dev) => {
    await dev.from('qc_lot_temperature_checks').upsert(record, { onConflict: 'spec_code' })
  })

  return NextResponse.json({ success: true })
}
