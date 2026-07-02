import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const ROUND_DURATION_MS  = 60 * 60 * 1000  // 1 hour
const BANGKOK_OFFSET_MS  = 7  * 60 * 60 * 1000  // UTC+7

interface LotRow {
  spec_code: string
  qty_3: number
  weight_3: number
}

interface LotSnapshotRow extends LotRow {
  round_number: number
  source_file: string | null
  sort_order: number
  updated_at: string
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

interface RoundRow {
  round_number:     number
  started_at:       string
  day_round_number?: number  // display rank within the work-day (1, 2, 3…)
}

// Start of the current work-day in UTC: 06:00 Asia/Bangkok = 23:00 UTC previous calendar day.
function getTodayStart(): Date {
  const bangkokNow = new Date(Date.now() + BANGKOK_OFFSET_MS)
  const y  = bangkokNow.getUTCFullYear()
  const mo = bangkokNow.getUTCMonth()
  const d  = bangkokNow.getUTCDate()
  const h  = bangkokNow.getUTCHours()
  // Before 06:00 Bangkok → work-day boundary was yesterday 06:00 Bangkok
  const dayOffset = h < 6 ? -1 : 0
  return new Date(Date.UTC(y, mo, d + dayOffset, 6, 0, 0) - BANGKOK_OFFSET_MS)
}

// Latest round on record (all-time), or null.
async function getLatestRound(): Promise<RoundRow | null> {
  const { data } = await supabase
    .from('qc_check_rounds')
    .select('round_number, started_at')
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

// Compute the live round.  A round expires when EITHER:
//   • 1 hour has elapsed since it started, OR
//   • it started before today's 06:00 Bangkok (new work-day → reset to round 1 of the day)
async function getCurrentRound(): Promise<RoundRow & { isNew: boolean }> {
  const latest    = await getLatestRound()
  const todayStart = getTodayStart()

  if (!latest) return { round_number: 1, started_at: new Date().toISOString(), isNew: true }

  const latestStarted = new Date(latest.started_at)
  const newDay  = latestStarted < todayStart
  const expired = Date.now() - latestStarted.getTime() >= ROUND_DURATION_MS

  if (newDay || expired) {
    // Always increment the global round_number to avoid unique-key conflicts.
    // The display number (1, 2, 3… per day) is computed separately in GET.
    return { round_number: latest.round_number + 1, started_at: new Date().toISOString(), isNew: true }
  }

  return { ...latest, isNew: false }
}

export async function GET(req: NextRequest) {
  const roundParam = req.nextUrl.searchParams.get('round')

  // All records across every round — used by the temperature report page.
  if (req.nextUrl.searchParams.get('all')) {
    const { data, error } = await supabase
      .from('qc_lot_temperature_checks')
      .select('spec_code, chill_room, temps, recorded_by, updated_at, round_number')
      .order('spec_code',    { ascending: true })
      .order('round_number', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ records: data ?? [] })
  }

  // Latest reading per lot regardless of round.
  if (req.nextUrl.searchParams.get('latest')) {
    const { data, error } = await supabase
      .from('qc_lot_temperature_checks')
      .select('spec_code, chill_room, temps, recorded_by, updated_at')
      .order('updated_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const temps:      Record<string, unknown> = {}
    const chillRoom:  Record<string, string>  = {}
    const savedAt:    Record<string, string>  = {}
    const recordedBy: Record<string, string>  = {}
    const seen = new Set<string>()
    for (const row of data ?? []) {
      if (seen.has(row.spec_code)) continue
      seen.add(row.spec_code)
      if (row.temps)       temps[row.spec_code]      = row.temps
      if (row.chill_room)  chillRoom[row.spec_code]  = row.chill_room
      if (row.updated_at)  savedAt[row.spec_code]    = row.updated_at
      if (row.recorded_by) recordedBy[row.spec_code] = row.recorded_by
    }
    return NextResponse.json({ temps, chillRoom, savedAt, recordedBy })
  }

  const current    = await getCurrentRound()
  const todayStart = getTodayStart()

  // Dropdown shows only today's rounds (since 06:00 Bangkok).
  const { data: history } = await supabase
    .from('qc_check_rounds')
    .select('round_number, started_at')
    .gte('started_at', todayStart.toISOString())
    .order('round_number', { ascending: false })

  // The live round always appears in the dropdown even before it's been saved.
  const todayRoundsAsc: RoundRow[] = [...(history ?? [])]
    .sort((a, b) => a.round_number - b.round_number)
  if (current.isNew) todayRoundsAsc.push({ round_number: current.round_number, started_at: current.started_at })

  // Assign display rank (1, 2, 3…) within the current work-day.
  const withDayRank: RoundRow[] = todayRoundsAsc
    .map((r, i) => ({ ...r, day_round_number: i + 1 }))
    .reverse() // dropdown: latest first

  const rounds = withDayRank

  const viewRound = roundParam ? parseInt(roundParam, 10) : current.round_number
  const isCurrent = viewRound === current.round_number
  const viewMeta  = rounds.find(r => r.round_number === viewRound)

  const { data, error } = await supabase
    .from('qc_lot_temperature_checks')
    .select('spec_code, chill_room, temps, recorded_by, updated_at')
    .eq('round_number', viewRound)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: itemRows, error: itemErr } = await supabase
    .from('qc_lot_round_items')
    .select('spec_code, qty_3, weight_3, source_file, sort_order')
    .eq('round_number', viewRound)
    .order('sort_order', { ascending: true })
    .order('spec_code', { ascending: true })

  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })

  const temps:      Record<string, unknown> = {}
  const chillRoom:  Record<string, string>  = {}
  const savedAt:    Record<string, string>  = {}
  const recordedBy: Record<string, string>  = {}
  for (const row of data ?? []) {
    if (row.temps)       temps[row.spec_code]      = row.temps
    if (row.chill_room)  chillRoom[row.spec_code]  = row.chill_room
    if (row.updated_at)  savedAt[row.spec_code]    = row.updated_at
    if (row.recorded_by) recordedBy[row.spec_code] = row.recorded_by
  }

  const sourceFile = (itemRows ?? []).find(r => r.source_file)?.source_file ?? ''
  const lotRows: LotRow[] = (itemRows ?? []).map(r => ({
    spec_code: r.spec_code,
    qty_3:     num(r.qty_3),
    weight_3:  num(r.weight_3),
  }))
  const fallbackLotRows: LotRow[] = lotRows.length
    ? lotRows
    : (data ?? []).map(r => ({ spec_code: r.spec_code, qty_3: 0, weight_3: 0 }))
  return NextResponse.json({
    temps, chillRoom, savedAt, recordedBy,
    lotRows:        fallbackLotRows,
    sourceFile,
    round:          viewRound,
    roundStartedAt: viewMeta?.started_at ?? null,
    isCurrent,
    liveRound:      current.round_number,
    rounds,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  const lotRowsInput = Array.isArray(body.lot_rows) ? body.lot_rows : Array.isArray(body.lotRows) ? body.lotRows : null
  if (lotRowsInput) {
    const round = await getCurrentRound()
    if (round.isNew) {
      await supabase.from('qc_check_rounds').insert({ round_number: round.round_number, started_at: round.started_at })
    }

    const sourceFile = String(body.source_file ?? body.sourceFile ?? '').trim() || null
    const updatedAt = new Date().toISOString()
    const rows: LotSnapshotRow[] = lotRowsInput
      .map((r: Record<string, unknown>, i: number) => ({
        round_number: round.round_number,
        spec_code:    String(r.spec_code ?? '').trim(),
        qty_3:        num(r.qty_3),
        weight_3:     num(r.weight_3),
        source_file:  sourceFile,
        sort_order:   i,
        updated_at:   updatedAt,
      }))
      .filter((r: { spec_code: string }) => r.spec_code)

    const { error: delErr } = await supabase
      .from('qc_lot_round_items')
      .delete()
      .eq('round_number', round.round_number)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    if (rows.length) {
      const { error: insertErr } = await supabase.from('qc_lot_round_items').insert(rows)
      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      round: round.round_number,
      lotRows: rows.map(r => ({ spec_code: r.spec_code, qty_3: r.qty_3, weight_3: r.weight_3 })),
      sourceFile: sourceFile ?? '',
    })
  }

  const spec_code = String(body.spec_code ?? '').trim()
  if (!spec_code) return NextResponse.json({ error: 'missing spec_code' }, { status: 400 })

  const round = await getCurrentRound()
  if (round.isNew) {
    await supabase.from('qc_check_rounds').insert({ round_number: round.round_number, started_at: round.started_at })
  }

  if (body.qty_3 !== undefined || body.weight_3 !== undefined) {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.qty_3 !== undefined) update.qty_3 = Math.max(0, num(body.qty_3))
    if (body.weight_3 !== undefined) update.weight_3 = Math.max(0, num(body.weight_3))

    const { data: existing, error: findErr } = await supabase
      .from('qc_lot_round_items')
      .select('source_file, sort_order')
      .eq('round_number', round.round_number)
      .eq('spec_code', spec_code)
      .maybeSingle()

    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })

    const { error } = existing
      ? await supabase
        .from('qc_lot_round_items')
        .update(update)
        .eq('round_number', round.round_number)
        .eq('spec_code', spec_code)
      : await supabase
        .from('qc_lot_round_items')
        .insert({
          round_number: round.round_number,
          spec_code,
          qty_3: body.qty_3 !== undefined ? Math.max(0, num(body.qty_3)) : 0,
          weight_3: body.weight_3 !== undefined ? Math.max(0, num(body.weight_3)) : 0,
          source_file: null,
          sort_order: 0,
          updated_at: update.updated_at,
        })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      success: true,
      round: round.round_number,
      spec_code,
      qty_3: update.qty_3,
      weight_3: update.weight_3,
    })
  }

  // Accumulate recorder names across saves in the same round.
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
