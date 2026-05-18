import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/admin/production-plan?date=2026-05-18&period=เช้า
export async function GET(req: NextRequest) {
  const date   = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  const period = req.nextUrl.searchParams.get('period')

  let q = supabase
    .from('production_assignments')
    .select('id, production_date, table_name, worker_code, worker_name, sku, sku_name, target_quantity, unit, period, deadline_time, status, channel, seq')
    .eq('production_date', date)
    .order('period')
    .order('seq', { ascending: true, nullsFirst: false })

  if (period) q = q.eq('period', period)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

// DELETE /api/admin/production-plan
// body: { ids: string[] }  — delete specific rows
// body: { date, period }   — delete all rows for that date+period
export async function DELETE(req: NextRequest) {
  const body = await req.json()

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    const { error } = await supabase
      .from('production_assignments')
      .delete()
      .in('id', body.ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, deleted: body.ids.length })
  }

  if (body.date && body.period) {
    const { error, count } = await supabase
      .from('production_assignments')
      .delete({ count: 'exact' })
      .eq('production_date', body.date)
      .eq('period', body.period)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, deleted: count ?? 0 })
  }

  return NextResponse.json({ error: 'ต้องระบุ ids หรือ date+period' }, { status: 400 })
}

// POST /api/admin/production-plan
// body: single assignment row to insert
export async function POST(req: NextRequest) {
  const body = await req.json()

  const row = {
    production_date:  body.production_date,
    table_name:       body.table_name,
    worker_code:      body.worker_code ?? '-',
    worker_name:      body.worker_name ?? '-',
    sku:              String(body.sku ?? '').trim(),
    sku_name:         body.sku_name ?? null,
    target_quantity:  Number(body.target_quantity ?? 0),
    unit:             body.unit ?? 'กก.',
    period:           body.period,
    channel:          body.channel ?? null,
    status:           body.status ?? 'รอดำเนินการ',
    deadline_time:    body.deadline_time ?? null,
    note:             body.note ?? null,
  }

  if (!row.production_date || !row.table_name || !row.sku || !row.period)
    return NextResponse.json({ error: 'กรุณากรอก production_date, table_name, sku, period' }, { status: 400 })

  const { error } = await supabase.from('production_assignments').insert(row)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
