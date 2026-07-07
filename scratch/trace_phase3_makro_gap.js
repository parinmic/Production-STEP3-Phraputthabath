// Read-only diagnostic: replicate the Phase 3 "append remaining Makro" calculation from
// lib/generate-plan.ts for a specific SKU/date, to find where the leftover qty disappears.
// Usage: node scratch/trace_phase3_makro_gap.js [date] [sku]
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').replace(/\r/g, '').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const date = process.argv[2] || '2026-07-07'
const targetSku = String(process.argv[3] || '23070475').replace(/^0+/, '')
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0
const norm = s => String(s ?? '').replace(/^0+/, '')

async function fetchAll(table, select, build) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(select).range(from, from + 999)
    if (build) q = build(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function main() {
  console.log(`\n=== Trace Phase 3 Makro append for sku=${targetSku} date=${date} ===\n`)

  const [makroToday, lotusToday, wmToday, fsToday, plan100Rows, assignP12, pickingUnit, prodRows, allP3] = await Promise.all([
    fetchAll('makro_orders', 'sku, sku_name, quantity, delivery_date, upload_round, upload_log_id, uploaded_at', q => q.eq('delivery_date', date).eq('upload_round', '1400')),
    fetchAll('lotus_orders', 'sku, quantity, delivery_date, upload_round', q => q.eq('delivery_date', date).eq('upload_round', '1400')),
    fetchAll('wet_market_orders', 'sku, quantity, delivery_date, upload_round', q => q.eq('delivery_date', date).eq('upload_round', '1400')),
    fetchAll('fs_orders', 'sku, quantity, delivery_date', q => q.eq('delivery_date', date)),
    fetchAll('production_plan_100', 'plan_date, sap, product_name, weight_total, upload_log_id, uploaded_at', q => q.eq('plan_date', date)),
    fetchAll('production_assignments', 'sku, sku_name, table_name, period, channel, target_quantity, status, effective_from', q => q.eq('production_date', date).in('period', ['เช้า', 'บ่าย'])),
    fetchAll('picking_unit_master', 'sap, weight_per_bag', q => q.eq('sap', targetSku)),
    fetchAll('master_logic_calculation', 'row_data, uploaded_at', q => q.eq('calculation_type', 'Mas Productivity').order('uploaded_at', { ascending: false }).limit(5000)),
    fetchAll('production_assignments', 'sku, sku_name, table_name, period, channel, target_quantity, status, effective_from, note', q => q.eq('production_date', date).eq('period', 'ค่ำ')),
  ])

  // --- Dedup plan_100 by latest upload_log_id per plan_date (mirrors fetchLatestPlan100) ---
  const latestByDate = new Map()
  for (const r of plan100Rows) {
    if (!r.uploaded_at || !r.upload_log_id) continue
    const cur = latestByDate.get(r.plan_date)
    if (!cur || r.uploaded_at > cur.uploadedAt) latestByDate.set(r.plan_date, { uploadedAt: r.uploaded_at, uploadLogId: r.upload_log_id })
  }
  const plan100Dedup = plan100Rows.filter(r => {
    const latest = latestByDate.get(r.plan_date)
    return !latest || r.upload_log_id === latest.uploadLogId
  })

  // --- wpb ---
  const wpb = n(pickingUnit[0]?.weight_per_bag) || 0
  console.log(`[wpb] weight_per_bag for ${targetSku} = ${wpb}`)

  // --- aggregateToday maps ---
  const aggregateToday = rows => {
    const m = {}
    for (const r of rows) {
      const sku = norm(r.sku)
      m[sku] = (m[sku] ?? 0) + n(r.quantity)
    }
    return m
  }
  const makroMap = aggregateToday(makroToday)
  const lotusMap = aggregateToday(lotusToday)
  const wmMap = aggregateToday(wmToday)
  const fsMap = aggregateToday(fsToday)
  console.log(`[order] makroMap[${targetSku}] = ${makroMap[targetSku]}`)
  console.log(`[order] lotusMap[${targetSku}] = ${lotusMap[targetSku] ?? 0}, wmMap = ${wmMap[targetSku] ?? 0}, fsMap = ${fsMap[targetSku] ?? 0}`)
  console.log(`[order] raw makro rows for sku:`, makroToday.filter(r => norm(r.sku) === targetSku))

  // --- phase1Assigned (total) + phase1ByChannel, deductMode='plan' (no status filter) ---
  const phase1Assigned = new Map()
  const phase1ByChannel = new Map()
  for (const a of assignP12) {
    const sku = norm(a.sku)
    const qty = n(a.target_quantity)
    phase1Assigned.set(sku, (phase1Assigned.get(sku) ?? 0) + qty)
    if (a.channel) {
      if (!phase1ByChannel.has(a.channel)) phase1ByChannel.set(a.channel, new Map())
      const m = phase1ByChannel.get(a.channel)
      m.set(sku, (m.get(sku) ?? 0) + qty)
    }
  }
  console.log(`\n[phase1+2] all rows for sku (เช้า+บ่าย):`, assignP12.filter(a => norm(a.sku) === targetSku))
  console.log(`[phase1+2] phase1Assigned.get(${targetSku}) [total] = ${phase1Assigned.get(targetSku)}`)
  console.log(`[phase1+2] phase1ByChannel.get('Makro').get(${targetSku}) = ${phase1ByChannel.get('Makro')?.get(targetSku)}`)

  // --- planMap (plan100) ---
  const planMap = new Map()
  for (const r of plan100Dedup) {
    const sap = norm(r.sap)
    const cur = planMap.get(sap) ?? { name: r.product_name ?? null, qty: 0 }
    cur.qty += n(r.weight_total)
    planMap.set(sap, cur)
  }
  console.log(`\n[plan100] planMap.get(${targetSku}) =`, planMap.get(targetSku))

  // --- allPhase3Targets initial pass (plan100-based) ---
  const useChannelDeduct = true // deductMode 'plan' !== 'yield'
  const allPhase3Targets = []
  for (const [sku, { name, qty }] of planMap.entries()) {
    const p12Actual = phase1Assigned.get(sku) ?? 0
    const wpbSku = sku === targetSku ? wpb : 0 // only care about our sku's wpb here
    const targetQty = wpbSku > 0 ? Math.floor(Math.max(0, qty - p12Actual) / wpbSku) * wpbSku : Math.max(0, qty - p12Actual)
    if (sku === targetSku) console.log(`[phase3-plan100-pass] qty=${qty} p12Actual=${p12Actual} wpb=${wpbSku} -> targetQty=${targetQty}`)
    if (targetQty > 0) allPhase3Targets.push({ sku, skuName: name, targetQty, channel: 'plan100' })
  }
  const phase3Plan100Skus = new Set(allPhase3Targets.map(t => norm(t.sku)))
  console.log(`[phase3-plan100-pass] phase3Plan100Skus.has(${targetSku}) = ${phase3Plan100Skus.has(targetSku)}`)

  // --- appendRemaining (Makro branch) ---
  console.log(`\n[appendRemaining] channel=Makro, sku=${targetSku}`)
  if (phase3Plan100Skus.has(targetSku)) {
    console.log(`  -> SKIPPED: sku already in phase3Plan100Skus`)
  } else {
    const orderQty = makroMap[targetSku] ?? 0
    const p12 = useChannelDeduct ? (phase1ByChannel.get('Makro') ?? new Map()) : phase1Assigned
    const p12Actual = p12.get(targetSku) ?? 0
    const targetQty = wpb > 0 ? Math.floor(Math.max(0, orderQty - p12Actual) / wpb) * wpb : Math.max(0, orderQty - p12Actual)
    console.log(`  orderQty=${orderQty} p12Actual=${p12Actual} wpb=${wpb} -> targetQty=${targetQty}`)
    if (targetQty > 0) {
      allPhase3Targets.push({ sku: targetSku, skuName: null, targetQty, channel: 'Makro' })
      console.log(`  -> APPENDED with targetQty=${targetQty}`)
    } else {
      console.log(`  -> NOT appended (targetQty <= 0)`)
    }
  }

  // --- crossChannelCap simulation for appended (non-plan100) skus ---
  console.log(`\n[crossChannelCap] simulating for sku=${targetSku}`)
  const p1Total = phase1Assigned.get(targetSku) ?? 0
  if (p1Total === 0) {
    console.log(`  -> SKIPPED (p1Total === 0)`)
  } else {
    const p3RawBySku = (wmMap[targetSku] ?? 0) + (makroMap[targetSku] ?? 0) + (lotusMap[targetSku] ?? 0) + (fsMap[targetSku] ?? 0)
    const budget = wpb > 0 ? Math.floor(Math.max(0, p3RawBySku - p1Total) / wpb) * wpb : Math.max(0, p3RawBySku - p1Total)
    const currentTotal = allPhase3Targets.filter(t => t.sku === targetSku && t.channel !== 'plan100').reduce((s, t) => s + t.targetQty, 0)
    console.log(`  p1Total=${p1Total} rawTotal(p3RawBySku)=${p3RawBySku} budget=${budget} currentTotal=${currentTotal}`)
    if (currentTotal <= budget) console.log(`  -> no cut needed`)
    else console.log(`  -> WOULD CUT excess=${currentTotal - budget}`)
  }

  // --- What actually exists in DB for ค่ำ (Phase 3) tonight for this sku ---
  console.log(`\n[actual DB state] ค่ำ (Phase 3) rows for sku=${targetSku}:`)
  console.log(allP3.filter(a => norm(a.sku) === targetSku))
  console.log(`\n[actual DB state] total ค่ำ rows (all skus) count = ${allP3.length}, distinct skus =`, new Set(allP3.map(a => norm(a.sku))).size)

  // --- Mas Productivity master entry (station) for this sku, to sanity-check produceable filter ---
  const prodEntry = prodRows.map(r => r.row_data).find(r => norm(String(r['SAP'] ?? '')) === targetSku)
  console.log(`\n[master] Mas Productivity entry for sku:`, prodEntry)
}

main().catch(e => { console.error(e); process.exit(1) })
