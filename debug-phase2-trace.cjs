const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(
  'https://jtjironqszdfsflvdvld.supabase.co',
  'sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui'
)
const today = new Date().toISOString().split('T')[0]

async function main() {
  const d = new Date(today)
  const histDates = [1, 2, 3].map(n => {
    const h = new Date(d); h.setDate(d.getDate() - n)
    return h.toISOString().split('T')[0]
  })

  // Exactly replicate Phase 2 logic for WM
  const [
    { data: wmToday },
    { data: wmHist },
    { data: lotusToday },
    { data: lotusHist },
    { data: prevAssigned },
    { data: channelMaster },
  ] = await Promise.all([
    supabase.from('wet_market_orders').select('sku, sku_name, quantity').eq('delivery_date', today).eq('upload_round', '1400'),
    supabase.from('wet_market_orders').select('sku, sku_name, quantity, delivery_date').in('delivery_date', histDates).eq('upload_round', '1600'),
    supabase.from('lotus_orders').select('sku, sku_name, quantity').eq('delivery_date', today).eq('upload_round', '1400'),
    supabase.from('lotus_orders').select('sku, sku_name, quantity, delivery_date').in('delivery_date', histDates).eq('upload_round', '1600'),
    supabase.from('production_assignments').select('sku, target_quantity, channel').eq('production_date', today).in('period', ['เช้า']),
    supabase.from('master_logic_calculation').select('row_data').eq('calculation_type', 'Mas Channel').order('uploaded_at', { ascending: false }),
  ])

  // Channel priority for Phase 2
  const channelPriority = {}
  for (const row of (channelMaster ?? [])) {
    const r = row.row_data
    if (Number(r['Phase']) === 2) channelPriority[String(r['Channel'])] = Number(r['Priority'])
  }
  console.log('Channel priority Phase 2:', channelPriority)

  // Aggregate today orders
  const aggregate = (rows) => {
    const m = {}
    for (const r of rows) m[r.sku] = { qty: (m[r.sku]?.qty ?? 0) + r.quantity, name: m[r.sku]?.name ?? r.sku_name }
    return m
  }
  const wmMap = aggregate(wmToday ?? [])
  const lotusMap = aggregate(lotusToday ?? [])

  // BL3 averages
  const buildAvg = (rows) => {
    const bySkuDate = {}
    for (const r of rows) {
      if (!bySkuDate[r.sku]) bySkuDate[r.sku] = {}
      bySkuDate[r.sku][r.delivery_date] = (bySkuDate[r.sku][r.delivery_date] ?? 0) + r.quantity
    }
    const result = new Map()
    for (const sku of Object.keys(bySkuDate)) {
      const vals = Object.values(bySkuDate[sku])
      result.set(sku, vals.reduce((s, v) => s + v, 0) / vals.length)
    }
    return result
  }
  const avgWM = buildAvg(wmHist ?? [])
  const avgLotus = buildAvg(lotusHist ?? [])

  // Phase 1 assigned by channel
  const phase1ByChannel = new Map()
  for (const a of (prevAssigned ?? [])) {
    const ch = a.channel ?? 'unknown'
    if (!phase1ByChannel.has(ch)) phase1ByChannel.set(ch, new Map())
    const m = phase1ByChannel.get(ch)
    m.set(a.sku, (m.get(a.sku) ?? 0) + Number(a.target_quantity))
  }

  // --- Trace WM Phase 2 target for 23015177 ---
  const sku = '23015177'
  const p1WM = phase1ByChannel.get('Wet Market') ?? new Map()
  const orderQty = wmMap[sku]?.qty ?? 0
  const avg = avgWM.get(sku) ?? 0
  const base = avg > 0 ? Math.min(avg, orderQty) : orderQty
  const p1Deduct = p1WM.get(sku) ?? 0
  const target = Math.max(0, base - p1Deduct)

  console.log('\n=== WM Phase 2 target for 23015177 (สะโพกแต่ง) ===')
  console.log('  WM order (1400):', orderQty)
  console.log('  WM avg BL3:', avg)
  console.log('  base = min(avg, order):', base)
  console.log('  Phase 1 WM deduct:', p1Deduct)
  console.log('  >>> TARGET:', target)

  // --- Trace LOTUS Phase 2 target for 23086964 ---
  const sku2 = '23086964'
  const p1LOTUS = phase1ByChannel.get('LOTUS') ?? new Map()
  const lotusOrder = lotusMap[sku2]?.qty ?? 0
  const lotusAvg = avgLotus.get(sku2) ?? 0
  const lotusBase = lotusAvg > 0 ? Math.min(lotusAvg, lotusOrder) : lotusOrder
  const lotusP1 = p1LOTUS.get(sku2) ?? 0
  const lotusTarget = Math.max(0, lotusBase - lotusP1)

  console.log('\n=== LOTUS Phase 2 target for 23086964 (สะโพกแต่งตัดชิ้น SIS) ===')
  console.log('  LOTUS order (1400):', lotusOrder)
  console.log('  LOTUS avg BL3:', lotusAvg)
  console.log('  base = min(avg, order):', lotusBase)
  console.log('  Phase 1 LOTUS deduct:', lotusP1)
  console.log('  >>> TARGET:', lotusTarget)

  // --- Show ALL Phase 2 targets for สะโพก SKUs ---
  console.log('\n=== ALL Phase 2 targets at สะโพก ===')

  // Get productivity for สะโพก
  const { data: prodMaster } = await supabase.from('master_logic_calculation').select('row_data').eq('calculation_type', 'Mas Productivity')
  const saphokSKUs = new Set()
  for (const r of (prodMaster ?? [])) {
    if (String(r.row_data['จุดงาน'] ?? '').includes('สะโพก')) {
      saphokSKUs.add(String(r.row_data['SAP']))
    }
  }

  // Build all channel targets for Phase 2
  const channels = { 'Wet Market': wmMap, 'LOTUS': lotusMap }
  for (const [ch, orderMap] of Object.entries(channels)) {
    const p1 = phase1ByChannel.get(ch) ?? new Map()
    const avgMap = ch === 'Wet Market' ? avgWM : avgLotus
    for (const [s, { qty, name }] of Object.entries(orderMap)) {
      if (!saphokSKUs.has(s)) continue
      const a = avgMap.get(s) ?? 0
      const b = a > 0 ? Math.min(a, qty) : qty
      const deduct = p1.get(s) ?? 0
      const t = Math.max(0, b - deduct)
      console.log(`  ${ch} | ${s} | ${name}: order=${qty} avg=${a.toFixed(0)} base=${b.toFixed(0)} deduct=${deduct} TARGET=${t.toFixed(0)}`)
    }
  }

  // Show Phase 1 assigned per channel per SKU (สะโพก only)
  console.log('\n=== Phase 1 assigned (สะโพก SKUs) ===')
  for (const [ch, m] of phase1ByChannel) {
    for (const [s, qty] of m) {
      if (saphokSKUs.has(s)) console.log(`  ${ch} | ${s}: ${qty} กก.`)
    }
  }
}
main().catch(console.error)
