const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(
  'https://jtjironqszdfsflvdvld.supabase.co',
  'sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui'
)
const today = new Date().toISOString().split('T')[0]
const d = new Date(today)
const histDates = [1, 2, 3].map(n => {
  const h = new Date(d); h.setDate(d.getDate() - n)
  return h.toISOString().split('T')[0]
})

async function main() {
  const sku = '23015177'
  console.log(`=== SKU ${sku} (สะโพกแต่ง) ===`)
  console.log(`วันนี้: ${today}`)
  console.log(`BL3 dates: ${histDates.join(', ')}`)

  // 1. WM BL3 (ทุก round)
  const { data: wmBL3 } = await supabase
    .from('wet_market_orders')
    .select('sku, sku_name, quantity, delivery_date, upload_round')
    .eq('sku', sku)
    .in('delivery_date', histDates)
    .order('delivery_date', { ascending: false })

  console.log('\n--- WM BL3 History (ทุก round) ---')
  let totalBL3 = 0
  for (const r of (wmBL3 ?? [])) {
    console.log(`  ${r.delivery_date} | round=${r.upload_round} | qty=${r.quantity} | ${r.sku_name}`)
    totalBL3 += r.quantity
  }
  // เฉพาะ round 1600
  const bl3_1600 = (wmBL3 ?? []).filter(r => r.upload_round === '1600')
  const bl3ByDate = {}
  for (const r of bl3_1600) {
    bl3ByDate[r.delivery_date] = (bl3ByDate[r.delivery_date] ?? 0) + r.quantity
  }
  const dateCount = Object.keys(bl3ByDate).length
  const bl3Total = Object.values(bl3ByDate).reduce((s, v) => s + v, 0)
  console.log(`\n  BL3 round=1600 only: ${bl3_1600.length} rows, ${dateCount} วัน`)
  for (const [dt, qty] of Object.entries(bl3ByDate)) {
    console.log(`    ${dt}: ${qty} กก.`)
  }
  console.log(`  Avg BL3 = ${bl3Total} / ${dateCount} = ${dateCount > 0 ? (bl3Total / dateCount).toFixed(1) : 'N/A'} กก.`)

  // 2. WM Order วันนี้ (ทุก round)
  const { data: wmToday } = await supabase
    .from('wet_market_orders')
    .select('sku, sku_name, quantity, delivery_date, upload_round')
    .eq('sku', sku)
    .eq('delivery_date', today)

  console.log('\n--- WM Order วันนี้ (ทุก round) ---')
  const byRound = {}
  for (const r of (wmToday ?? [])) {
    byRound[r.upload_round] = (byRound[r.upload_round] ?? 0) + r.quantity
  }
  for (const [round, qty] of Object.entries(byRound)) {
    console.log(`  round=${round}: ${qty} กก. (${(wmToday ?? []).filter(r => r.upload_round === round).length} rows)`)
  }

  // 3. LOTUS BL3
  const { data: lotusBL3 } = await supabase
    .from('lotus_orders')
    .select('sku, sku_name, quantity, delivery_date, upload_round')
    .eq('sku', sku)
    .in('delivery_date', histDates)

  console.log('\n--- LOTUS BL3 History ---')
  if (!(lotusBL3 ?? []).length) console.log('  (ไม่มีข้อมูล)')
  for (const r of (lotusBL3 ?? [])) {
    console.log(`  ${r.delivery_date} | round=${r.upload_round} | qty=${r.quantity}`)
  }

  // 4. LOTUS Order วันนี้
  const { data: lotusToday } = await supabase
    .from('lotus_orders')
    .select('sku, sku_name, quantity, delivery_date, upload_round')
    .eq('sku', sku)
    .eq('delivery_date', today)

  console.log('\n--- LOTUS Order วันนี้ ---')
  if (!(lotusToday ?? []).length) console.log('  (ไม่มีข้อมูล)')
  for (const r of (lotusToday ?? [])) {
    console.log(`  round=${r.upload_round} | qty=${r.quantity}`)
  }

  // 5. Makro
  const { data: makroToday } = await supabase
    .from('makro_orders')
    .select('sku, sku_name, quantity, delivery_date, upload_round')
    .eq('sku', sku)
    .eq('delivery_date', today)

  console.log('\n--- Makro Order วันนี้ ---')
  if (!(makroToday ?? []).length) console.log('  (ไม่มีข้อมูล)')
  for (const r of (makroToday ?? [])) {
    console.log(`  round=${r.upload_round} | qty=${r.quantity}`)
  }

  console.log('\n==========================================')
  console.log('สรุป:')
  console.log(`  WM Avg BL3 (round 1600) = ${dateCount > 0 ? (bl3Total / dateCount).toFixed(1) : 'N/A'} กก.`)
  console.log(`  WM Order วันนี้ round 1400 = ${byRound['1400'] ?? 0} กก.`)
  console.log(`  Phase 2 target = min(${dateCount > 0 ? (bl3Total / dateCount).toFixed(0) : '?'}, ${byRound['1400'] ?? 0}) - Phase1 deduct`)
}

main().catch(console.error)
