import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const ROUND_DURATION_MS = 60 * 60 * 1000 // 1 hour, counted from the first save in the round

interface RoundRow {
  round_number: number
  started_at:   string
}

// Latest round on record, or null if none exist yet.
async function getLatestRound(): Promise<RoundRow | null> {
  const { data } = await supabase
    .from('qc_check_rounds')
    .select('round_number, started_at')
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

// Figures out the live/current round, expiring it (virtually — without writing
// anything) once 1 hr has passed since it started. Only a POST actually persists
// the advance to a new round.
async function getCurrentRound(): Promise<RoundRow & { isNew: boolean }> {
  const latest = await getLatestRound()
  if (!latest) return { round_number: 1, started_at: new Date().toISOString(), isNew: true }

  const expired = Date.now() - new Date(latest.started_at).getTime() >= ROUND_DURATION_MS
  if (expired) return { round_number: latest.round_number + 1, started_at: new Date().toISOString(), isNew: true }

  return { ...latest, isNew: false }
}

export async function GET(req: NextRequest) {
  const roundParam = req.nextUrl.searchParams.get('round')

  const current = await getCurrentRound()
  const { data: history } = await supabase
    .from('qc_check_rounds')
    .select('round_number, started_at')
    .order('round_number', { ascending: false })

  // The live round always belongs in the dropdown, even before anyone has saved
  // into it (i.e. before it's actually been written to qc_check_rounds).
  const rounds: RoundRow[] = current.isNew
    ? [{ round_number: current.round_number, started_at: current.started_at }, ...(history ?? [])]
    : (history ?? [])

  const viewRound = roundParam ? parseInt(roundParam, 10) : current.round_number
  const isCurrent = viewRound === current.round_number
  const viewMeta  = rounds.find(r => r.round_number === viewRound)

  const { data, error } = await supabase
    .from('qc_lot_temperature_checks')
    .select('spec_code, chill_room, temps, recorded_by, updated_at')
    .eq('round_number', viewRound)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const temps:      Record<string, unknown> = {}
  const chillRoom:  Record<string, string>  = {}
  const savedAt:    Record<string, string>  = {}
  const recordedBy: Record<string, string>  = {}
  for (const row of data ?? []) {
    if (row.temps)      temps[row.spec_code]      = row.temps
    if (row.chill_room) chillRoom[row.spec_code]  = row.chill_room
    if (row.updated_at) savedAt[row.spec_code]    = row.updated_at
    if (row.recorded_by) recordedBy[row.spec_code] = row.recorded_by
  }

  return NextResponse.json({
    temps, chillRoom, savedAt, recordedBy,
    round:          viewRound,
    roundStartedAt: viewMeta?.started_at ?? null,
    isCurrent,
    liveRound:      current.round_number,
    rounds,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const spec_code = String(body.spec_code ?? '').trim()
  if (!spec_code) return NextResponse.json({ error: 'missing spec_code' }, { status: 400 })

  const round = await getCurrentRound()
  if (round.isNew) {
    await supabase.from('qc_check_rounds').insert({ round_number: round.round_number, started_at: round.started_at })
  }

  // Multiple people can save the same lot in the same round — keep every distinct
  // name instead of letting the latest save overwrite who recorded it before.
  const { data: existing } = await supabase
    .from('qc_lot_temperature_checks')
    .select('recorded_by')
    .eq('spec_code', spec_code)
    .eq('round_number', round.round_number)
    .maybeSingle()

  const newName = String(body.recorded_by ?? '').trim()
  const names = (existing?.recorded_by ?? '').split(',').map((n: string) => n.trim()).filter(Boolean)
  if (newName && !names.includes(newName)) names.push(newName)
  const recordedBy = names.length ? names.join(', ') : null

  const record = {
    spec_code,
    chill_room:   body.chill_room ?? null,
    temps:        body.temps ?? {},
    recorded_by:  recordedBy,
    round_number: round.round_number,
    updated_at:   new Date().toISOString(),
  }

  const { error } = await supabase
    .from('qc_lot_temperature_checks')
    .upsert(record, { onConflict: 'spec_code,round_number' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, updated_at: record.updated_at, round: round.round_number, recordedBy })
}
