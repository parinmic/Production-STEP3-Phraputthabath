import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const ROUND_DURATION_MS = 60 * 60 * 1000
const BANGKOK_OFFSET_MS = 7  * 60 * 60 * 1000

interface RoundRow {
  round_number:      number
  started_at:        string
  day_round_number?: number
}

function getTodayStart(): Date {
  const bangkokNow = new Date(Date.now() + BANGKOK_OFFSET_MS)
  const y  = bangkokNow.getUTCFullYear()
  const mo = bangkokNow.getUTCMonth()
  const d  = bangkokNow.getUTCDate()
  const h  = bangkokNow.getUTCHours()
  const dayOffset = h < 6 ? -1 : 0
  return new Date(Date.UTC(y, mo, d + dayOffset, 6, 0, 0) - BANGKOK_OFFSET_MS)
}

async function getLatestRound(): Promise<RoundRow | null> {
  const { data } = await supabase
    .from('qc_check_rounds')
    .select('round_number, started_at')
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

async function getCurrentRound(): Promise<RoundRow & { isNew: boolean }> {
  const latest     = await getLatestRound()
  const todayStart = getTodayStart()

  if (!latest) return { round_number: 1, started_at: new Date().toISOString(), isNew: true }

  const latestStarted = new Date(latest.started_at)
  const newDay  = latestStarted < todayStart
  const expired = Date.now() - latestStarted.getTime() >= ROUND_DURATION_MS

  if (newDay || expired)
    return { round_number: latest.round_number + 1, started_at: new Date().toISOString(), isNew: true }

  return { ...latest, isNew: false }
}

export async function GET(req: NextRequest) {
  const roundParam = req.nextUrl.searchParams.get('round')

  // All records — used by report page
  if (req.nextUrl.searchParams.get('all')) {
    const { data, error } = await supabase
      .from('qc_parts_temperature_checks')
      .select('spec_code, temps, recorded_by, updated_at, round_number')
      .order('spec_code',    { ascending: true })
      .order('round_number', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ records: data ?? [] })
  }

  const current    = await getCurrentRound()
  const todayStart = getTodayStart()

  const { data: history } = await supabase
    .from('qc_check_rounds')
    .select('round_number, started_at')
    .gte('started_at', todayStart.toISOString())
    .order('round_number', { ascending: false })

  const todayRoundsAsc: RoundRow[] = [...(history ?? [])]
    .sort((a, b) => a.round_number - b.round_number)
  if (current.isNew) todayRoundsAsc.push({ round_number: current.round_number, started_at: current.started_at })

  const rounds: RoundRow[] = todayRoundsAsc
    .map((r, i) => ({ ...r, day_round_number: i + 1 }))
    .reverse()

  const viewRound = roundParam ? parseInt(roundParam, 10) : current.round_number
  const isCurrent = viewRound === current.round_number
  const viewMeta  = rounds.find(r => r.round_number === viewRound)

  const { data, error } = await supabase
    .from('qc_parts_temperature_checks')
    .select('spec_code, temps, recorded_by, updated_at')
    .eq('round_number', viewRound)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const temps:      Record<string, unknown> = {}
  const savedAt:    Record<string, string>  = {}
  const recordedBy: Record<string, string>  = {}
  for (const row of data ?? []) {
    if (row.temps)       temps[row.spec_code]      = row.temps
    if (row.updated_at)  savedAt[row.spec_code]    = row.updated_at
    if (row.recorded_by) recordedBy[row.spec_code] = row.recorded_by
  }

  return NextResponse.json({
    temps, savedAt, recordedBy,
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

  const { data: existing } = await supabase
    .from('qc_parts_temperature_checks')
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
    temps:        body.temps ?? {},
    recorded_by:  recordedBy,
    round_number: round.round_number,
    updated_at:   new Date().toISOString(),
  }

  const { error } = await supabase
    .from('qc_parts_temperature_checks')
    .upsert(record, { onConflict: 'spec_code,round_number' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, updated_at: record.updated_at, round: round.round_number, recordedBy })
}
