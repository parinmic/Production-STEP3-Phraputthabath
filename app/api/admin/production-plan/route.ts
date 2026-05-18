import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/admin/production-plan?date=2026-05-18&period=เช้า
// Returns data aggregated by SKU
export async function GET(req: NextRequest) {
  const date   = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  const period = req.nextUrl.searchParams.get('period')

  let q = supabase
    .from('production_assignments')
    .select('table_name, sku, sku_name, target_quantity, period, channel')
    .eq('production_date', date)
    .order('period')

  if (period) q = q.eq('period', period)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate by period + table_name + sku + channel
  const map = new Map<string, {
    period: string; table_name: string; sku: string
    sku_name: string | null; channel: string | null; total_qty: number
  }>()
  for (const r of data ?? []) {
    const key = `${r.period}||${r.table_name}||${r.sku}||${r.channel ?? ''}`
    const cur = map.get(key)
    if (cur) {
      cur.total_qty += Number(r.target_quantity)
    } else {
      map.set(key, {
        period:     r.period,
        table_name: r.table_name,
        sku:        r.sku,
        sku_name:   r.sku_name ?? null,
        channel:    r.channel ?? null,
        total_qty:  Number(r.target_quantity),
      })
    }
  }

  return NextResponse.json({ data: Array.from(map.values()) })
}

// PATCH /api/admin/production-plan
// body: { date, period, sku, new_qty } — update all worker rows proportionally
export async function PATCH(req: NextRequest) {
  const { date, period, sku, new_qty } = await req.json()
  if (!date || !period || !sku || new_qty == null)
    return NextResponse.json({ error: 'ต้องระบุ date, period, sku, new_qty' }, { status: 400 })

  // Fetch existing rows for this SKU
  const { data: rows, error: fetchErr } = await supabase
    .from('production_assignments')
    .select('id, target_quantity')
    .eq('production_date', date)
    .eq('period', period)
    .eq('sku', sku)

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!rows?.length) return NextResponse.json({ error: 'ไม่พบรายการ' }, { status: 404 })

  const oldTotal = rows.reduce((s, r) => s + Number(r.target_quantity), 0)
  const ratio = oldTotal > 0 ? Number(new_qty) / oldTotal : 0

  // Update each worker row proportionally
  const updates = rows.map(r => ({
    id:              r.id,
    target_quantity: Math.round(Number(r.target_quantity) * ratio),
  }))

  for (const u of updates) {
    const { error } = await supabase
      .from('production_assignments')
      .update({ target_quantity: u.target_quantity })
      .eq('id', u.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, updated: updates.length })
}

// DELETE /api/admin/production-plan
// body: { date, period } — delete all rows for that date+period
export async function DELETE(req: NextRequest) {
  const body = await req.json()

  if (body.date && body.period) {
    const { error, count } = await supabase
      .from('production_assignments')
      .delete({ count: 'exact' })
      .eq('production_date', body.date)
      .eq('period', body.period)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, deleted: count ?? 0 })
  }

  return NextResponse.json({ error: 'ต้องระบุ date และ period' }, { status: 400 })
}

// POST /api/admin/production-plan
// body: { production_date, period, table_name, sku, sku_name, target_quantity, channel }
export async function POST(req: NextRequest) {
  const body = await req.json()

  const row = {
    production_date:  body.production_date,
    table_name:       body.table_name,
    worker_code:      '-',
    worker_name:      '-',
    sku:              String(body.sku ?? '').trim(),
    sku_name:         body.sku_name ?? null,
    target_quantity:  Number(body.target_quantity ?? 0),
    unit:             'กก.',
    period:           body.period,
    channel:          body.channel ?? null,
    status:           'รอดำเนินการ',
  }

  if (!row.production_date || !row.table_name || !row.sku || !row.period)
    return NextResponse.json({ error: 'กรุณากรอก production_date, table_name, sku, period' }, { status: 400 })

  const { error } = await supabase.from('production_assignments').insert(row)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
