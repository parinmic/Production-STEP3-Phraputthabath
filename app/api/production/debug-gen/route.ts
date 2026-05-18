import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Trace why a SKU does or doesn't appear in the production plan
// Usage: GET /api/production/debug-gen?sku=23086965&date=2026-05-18&phase=1
export async function GET(req: NextRequest) {
  const rawSku  = (req.nextUrl.searchParams.get('sku') ?? '').trim()
  const date    = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  const phase   = Number(req.nextUrl.searchParams.get('phase') ?? '1')

  if (!rawSku) return NextResponse.json({ error: 'ต้องระบุ ?sku=' }, { status: 400 })

  const sku     = rawSku.replace(/^0+/, '')           // normalized (no leading zeros)
  const skuPad  = rawSku.padStart(8, '0')             // 8-digit padded
  const isPhase2 = phase === 2
  const isPhase3 = phase === 3

  // Historical BL3 dates
  const d = new Date(date)
  const histDates = [1, 2, 3].map(n => {
    const h = new Date(d); h.setDate(d.getDate() - n)
    return h.toISOString().split('T')[0]
  })

  const orderRound = isPhase2 ? '1400' : '0800'

  // ── Load all relevant data ──────────────────────────────────────────
  const [
    { data: prodMaster },
    { data: channelMaster },
    { data: jobAssign },
    { data: workforce0800 },
    { data: workforce1300 },
    wmToday, wmHist,
    lotusToday, lotusHist,
    makroToday, makroHist,
    { data: prevAssigned },
    { data: plan100 },
    { data: pickingUnit },
  ] = await Promise.all([
    supabase.from('master_logic_calculation').select('row_data').eq('calculation_type', 'Mas Productivity').order('uploaded_at', { ascending: false }),
    supabase.from('master_logic_calculation').select('row_data').eq('calculation_type', 'Mas Channel').order('uploaded_at', { ascending: false }),
    supabase.from('master_logic_manpower').select('row_data'),
    supabase.from('daily_workforce').select('emp_id, name, work_station, shift').eq('work_date', date).eq('upload_round', '0800'),
    supabase.from('daily_workforce').select('emp_id, name, work_station, shift').eq('work_date', date).eq('upload_round', '1300'),
    supabase.from('wet_market_orders').select('sku, sku_name, quantity, delivery_date, upload_round')
      .or(`sku.eq.${sku},sku.eq.${skuPad}`).eq('delivery_date', date).eq('upload_round', orderRound),
    supabase.from('wet_market_orders').select('sku, sku_name, quantity, delivery_date')
      .or(`sku.eq.${sku},sku.eq.${skuPad}`).in('delivery_date', histDates).eq('upload_round', '1600'),
    supabase.from('lotus_orders').select('sku, sku_name, quantity, delivery_date, upload_round')
      .or(`sku.eq.${sku},sku.eq.${skuPad}`).eq('delivery_date', date).eq('upload_round', orderRound),
    supabase.from('lotus_orders').select('sku, sku_name, quantity, delivery_date')
      .or(`sku.eq.${sku},sku.eq.${skuPad}`).in('delivery_date', histDates).eq('upload_round', '1600'),
    supabase.from('makro_orders').select('sku, sku_name, quantity, delivery_date, upload_round')
      .or(`sku.eq.${sku},sku.eq.${skuPad}`).eq('delivery_date', date).eq('upload_round', orderRound),
    supabase.from('makro_orders').select('sku, sku_name, quantity, delivery_date')
      .or(`sku.eq.${sku},sku.eq.${skuPad}`).in('delivery_date', histDates).eq('upload_round', '1400'),
    supabase.from('production_assignments').select('sku, target_quantity, channel, period, worker_name')
      .or(`sku.eq.${sku},sku.eq.${skuPad}`)
      .eq('production_date', date)
      .in('period', isPhase3 ? ['เช้า', 'บ่าย'] : ['เช้า']),
    supabase.from('production_plan_100').select('sap, product_name, weight_total').eq('plan_date', date)
      .or(`sap.eq.${sku},sap.eq.${skuPad}`),
    supabase.from('picking_unit_master').select('sap, weight_per_bag')
      .or(`sap.eq.${sku},sap.eq.${skuPad}`),
  ])

  // ── 1. Mas Productivity ─────────────────────────────────────────────
  const allProdRows = (prodMaster ?? []).map(r => r.row_data as Record<string, unknown>)
  const prodMatches = allProdRows.filter(r => {
    const s = String(r['SAP'] ?? '').trim()
    return s === sku || s === skuPad || s.replace(/^0+/, '') === sku
  })

  // ── 2. Channel master (active channels for this phase) ──────────────
  const channelPriority: Record<string, number> = {}
  for (const row of (channelMaster ?? [])) {
    const r = row.row_data as Record<string, unknown>
    if (Number(r['Phase']) === phase)
      channelPriority[String(r['Channel'])] = Number(r['Priority'])
  }
  const activeChannels = Object.entries(channelPriority).sort((a, b) => a[1] - b[1]).map(([ch]) => ch)

  // ── 3. Job assignment (can workers do this SKU?) ────────────────────
  const skuProductGroups = prodMatches.map(r => String(r['กลุ่มสินค้า'] ?? '').trim()).filter(Boolean)
  const eligibleWorkers: string[] = []
  for (const row of (jobAssign ?? [])) {
    const r        = row.row_data as Record<string, unknown>
    const name     = String(r['รายชื่อพนักงาน'] ?? '').trim()
    const isWeigher = Number(r['ชั่งน้ำหนัก'] ?? 0) === 1
    if (isWeigher) continue  // ชั่งน้ำหนัก ไม่นับเป็น production worker
    for (const grp of skuProductGroups) {
      const key = Object.keys(r).find(k => k.replace(/_\d+$/, '') === grp)
      if (key && (r[key] === 1 || r[key] === 2)) { eligibleWorkers.push(name); break }
    }
  }

  // ── 4. Workforce today ──────────────────────────────────────────────
  const wf0800 = workforce0800 ?? []
  const wf1300 = workforce1300 ?? []
  const allWf  = [...wf1300, ...wf0800]
  const seen   = new Set<string>()
  const wfDedup: typeof wf0800 = []
  for (const w of allWf) {
    const k = w.name.replace(/\s+/g, ' ').trim()
    if (!seen.has(k)) { seen.add(k); wfDedup.push(w) }
  }
  const wfMatchProd = prodMatches.length
    ? wfDedup.filter(w => {
        const station = w.work_station?.replace(/[()]/g, '').trim() ?? ''
        const stationMap: Record<string, string> = { 'สามชั้นพิเศษ': 'สามชั้น', 'ไหล่พิเศษ': 'ไหล่', 'สะโพกพิเศษ': 'สะโพก' }
        const mapped  = stationMap[station] ?? station
        return prodMatches.some(p => {
          const ps = String(p['จุดงาน'] ?? '').trim()
          return ps === mapped || ps === station
        })
      })
    : []
  const wfEligible = wfMatchProd.filter(w =>
    eligibleWorkers.some(e => e.replace(/\s+/g, ' ').trim() === w.name.replace(/\s+/g, ' ').trim())
  )

  // ── 5. Orders & BL3 averages ────────────────────────────────────────
  const sumQty = (rows: { quantity: number }[]) => rows.reduce((s, r) => s + r.quantity, 0)

  const avgBL3 = (rows: { quantity: number; delivery_date: string }[]) => {
    const byDate: Record<string, number> = {}
    for (const r of rows) byDate[r.delivery_date] = (byDate[r.delivery_date] ?? 0) + r.quantity
    const vals = Object.values(byDate)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
  }

  const wmOrderQty    = sumQty(wmToday?.data ?? [])
  const wmAvgBL3      = avgBL3(wmHist?.data ?? [])
  const lotusOrderQty = sumQty(lotusToday?.data ?? [])
  const lotusAvgBL3   = avgBL3(lotusHist?.data ?? [])
  const makroOrderQty = sumQty(makroToday?.data ?? [])
  const makroAvgBL3   = avgBL3(makroHist?.data ?? [])

  // ── 6. makroSkuSet check ────────────────────────────────────────────
  // All SKUs in Makro orders today (globally) — affects WM+LOTUS Phase 1 exclusion
  const { data: allMakroToday } = await supabase.from('makro_orders')
    .select('sku').eq('delivery_date', date).eq('upload_round', orderRound)
  const makroSkuSet = new Set((allMakroToday ?? []).map(r => r.sku.replace(/^0+/, '')))
  const excludedByMakroSet = makroSkuSet.has(sku)

  // ── 7. Target calculation ───────────────────────────────────────────
  const prevTotalQty = (prevAssigned ?? []).reduce((s: number, r: { target_quantity: number }) => s + Number(r.target_quantity), 0)
  const plan100qty   = (plan100 ?? []).reduce((s, r) => s + Number(r.weight_total ?? 0), 0)
  const wpb          = (pickingUnit ?? [])[0]?.weight_per_bag ?? null

  const targets: Record<string, { channel: string; rawBase: number; afterDeduct: number; reason: string }> = {}

  // Wet Market
  if (phase === 1) {
    const base = wmAvgBL3
    const excluded = excludedByMakroSet
    targets['Wet Market'] = {
      channel: 'Wet Market', rawBase: base,
      afterDeduct: excluded ? 0 : base,
      reason: excluded ? 'ถูกข้ามเพราะ SKU นี้มีใน Makro order วันนี้' : (base <= 0 ? 'BL3 avg = 0 (ไม่มีประวัติ)' : 'ผ่าน'),
    }
  } else if (phase === 2) {
    const base = wmAvgBL3 > 0 ? Math.min(wmAvgBL3, wmOrderQty) : wmOrderQty
    const deduct = (prevAssigned ?? []).filter((r: { channel: string | null }) => r.channel === 'Wet Market').reduce((s: number, r: { target_quantity: number }) => s + Number(r.target_quantity), 0)
    targets['Wet Market'] = { channel: 'Wet Market', rawBase: base, afterDeduct: Math.max(0, base - deduct), reason: wmOrderQty <= 0 ? 'ไม่มี Order Wet Market วันนี้' : 'ผ่าน' }
  }

  // Makro
  if (phase === 1) {
    targets['Makro'] = { channel: 'Makro', rawBase: makroOrderQty, afterDeduct: makroOrderQty, reason: makroOrderQty <= 0 ? 'ไม่มี Order Makro วันนี้' : 'ผ่าน' }
  } else if (phase === 2) {
    const deduct = (prevAssigned ?? []).filter((r: { channel: string | null }) => r.channel === 'Makro').reduce((s: number, r: { target_quantity: number }) => s + Number(r.target_quantity), 0)
    targets['Makro'] = { channel: 'Makro', rawBase: makroOrderQty, afterDeduct: Math.max(0, makroOrderQty - deduct), reason: makroOrderQty <= 0 ? 'ไม่มี Order Makro วันนี้' : 'ผ่าน' }
  }

  // LOTUS
  if (phase === 1) {
    const base = lotusAvgBL3
    const excluded = excludedByMakroSet
    targets['LOTUS'] = { channel: 'LOTUS', rawBase: base, afterDeduct: excluded ? 0 : base, reason: excluded ? 'ถูกข้ามเพราะ SKU นี้มีใน Makro order วันนี้' : (base <= 0 ? 'BL3 avg = 0 (ไม่มีประวัติ)' : 'ผ่าน') }
  } else if (phase === 2) {
    const base = lotusAvgBL3 > 0 ? Math.min(lotusAvgBL3, lotusOrderQty) : lotusOrderQty
    const deduct = (prevAssigned ?? []).filter((r: { channel: string | null }) => r.channel === 'LOTUS').reduce((s: number, r: { target_quantity: number }) => s + Number(r.target_quantity), 0)
    targets['LOTUS'] = { channel: 'LOTUS', rawBase: base, afterDeduct: Math.max(0, base - deduct), reason: lotusOrderQty <= 0 ? 'ไม่มี Order LOTUS วันนี้' : 'ผ่าน' }
  }

  // Phase 3
  if (phase === 3) {
    targets['plan100'] = { channel: 'plan100', rawBase: plan100qty, afterDeduct: Math.max(0, plan100qty - prevTotalQty), reason: plan100qty <= 0 ? 'ไม่พบ production_plan_100 วันนี้' : 'ผ่าน' }
  }

  // ── Summary ─────────────────────────────────────────────────────────
  const hasProductivity    = prodMatches.length > 0
  const hasEligibleWorkers = wfEligible.length > 0
  const bestTarget         = Object.values(targets).filter(t => activeChannels.includes(t.channel)).reduce((best, t) => t.afterDeduct > best ? t.afterDeduct : best, 0)
  const channelWithTarget  = Object.values(targets).find(t => t.afterDeduct > 0 && activeChannels.includes(t.channel))

  const verdict = !hasProductivity
    ? '❌ ไม่พบ SKU ใน Mas Productivity — จะไม่ถูก assign งาน'
    : wfMatchProd.length === 0
    ? '❌ ไม่มีพนักงานใน station ที่ตรงกับ SKU นี้'
    : wfEligible.length === 0
    ? '⚠️ มีพนักงานใน station แต่ไม่มีใครมีทักษะกลุ่มสินค้านี้ (Mas Manpower)'
    : !channelWithTarget
    ? '❌ targetQty = 0 ทุก channel (ดูรายละเอียด targets)'
    : `✅ ควรมีแผนผลิต — channel=${channelWithTarget.channel} targetQty=${Math.round(bestTarget)} กก.`

  return NextResponse.json({
    input:  { sku_raw: rawSku, sku_normalized: sku, date, phase, hist_dates: histDates, order_round: orderRound },
    verdict,
    checks: {
      '1_mas_productivity': {
        found: hasProductivity,
        matches: prodMatches.map(r => ({
          station:       r['จุดงาน'],
          product_group: r['กลุ่มสินค้า'],
          sku_name:      r['ชื่อสินค้า'],
          rate:          r['กำลังการผลิต (กก./ชม./คน)'],
        })),
      },
      '2_active_channels': {
        phase,
        active_channels: activeChannels,
        note: activeChannels.length === 0 ? 'ไม่มี channel master สำหรับ phase นี้ — ใช้ default [WM, Makro, LOTUS]' : '',
      },
      '3_orders_and_bl3': {
        wet_market:  { order_today: wmOrderQty,    bl3_avg: Math.round(wmAvgBL3),    bl3_days: (wmHist?.data ?? []).map(r => r.delivery_date) },
        lotus:       { order_today: lotusOrderQty,  bl3_avg: Math.round(lotusAvgBL3), bl3_days: (lotusHist?.data ?? []).map(r => r.delivery_date) },
        makro:       { order_today: makroOrderQty,  bl3_avg: Math.round(makroAvgBL3), bl3_days: (makroHist?.data ?? []).map(r => r.delivery_date) },
        excluded_from_wm_lotus_because_in_makro: excludedByMakroSet,
      },
      '4_target_per_channel': targets,
      '5_prev_assignments': {
        total_deducted: prevTotalQty,
        rows: prevAssigned ?? [],
      },
      '6_plan100': {
        qty: plan100qty,
        rows: plan100 ?? [],
        weight_per_bag: wpb,
      },
      '7_workforce': {
        station_match_count:  wfMatchProd.length,
        eligible_count:       wfEligible.length,
        station_workers:      wfMatchProd.map(w => ({ name: w.name, station: w.work_station, shift: w.shift })),
        eligible_workers:     wfEligible.map(w => w.name),
        product_groups_needed: skuProductGroups,
      },
    },
  })
}
