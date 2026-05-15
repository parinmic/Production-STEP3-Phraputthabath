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
  console.log('Today:', today)
  console.log('Hist dates:', histDates)

  // With limit(10000) - same as fixed code
  const { data: wmHist, error } = await supabase
    .from('wet_market_orders')
    .select('sku, sku_name, quantity, delivery_date')
    .in('delivery_date', histDates)
    .eq('upload_round', '1600')
    .limit(10000)

  console.log('WM hist rows (with limit 10000):', wmHist?.length, error ? 'ERROR: ' + error.message : '')

  // Build avg
  const bySkuDate = {}
  for (const r of (wmHist ?? [])) {
    if (!bySkuDate[r.sku]) bySkuDate[r.sku] = {}
    bySkuDate[r.sku][r.delivery_date] = (bySkuDate[r.sku][r.delivery_date] ?? 0) + r.quantity
  }
  
  // Show avg for 23015177
  const sku = '23015177'
  const skuDates = bySkuDate[sku] ?? {}
  const vals = Object.values(skuDates)
  const avg = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
  
  console.log(`\n23015177 (สะโพกแต่ง):`)
  console.log('  Dates:', skuDates)
  console.log('  AVG BL3:', avg)

  // Compare: without limit (default 1000)
  const { data: wmHistSmall } = await supabase
    .from('wet_market_orders')
    .select('sku, sku_name, quantity, delivery_date')
    .in('delivery_date', histDates)
    .eq('upload_round', '1600')
    // no .limit() → default 1000

  console.log('\nWM hist rows (default limit 1000):', wmHistSmall?.length)
  
  const bySkuDate2 = {}
  for (const r of (wmHistSmall ?? [])) {
    if (!bySkuDate2[r.sku]) bySkuDate2[r.sku] = {}
    bySkuDate2[r.sku][r.delivery_date] = (bySkuDate2[r.sku][r.delivery_date] ?? 0) + r.quantity
  }
  const skuDates2 = bySkuDate2[sku] ?? {}
  const vals2 = Object.values(skuDates2)
  const avg2 = vals2.length > 0 ? vals2.reduce((s, v) => s + v, 0) / vals2.length : 0

  console.log(`23015177 with default limit:`)
  console.log('  Dates:', skuDates2)
  console.log('  AVG BL3:', avg2)

  // Also check WM order for TODAY
  const { data: wmToday } = await supabase
    .from('wet_market_orders')
    .select('sku, sku_name, quantity, delivery_date, upload_round')
    .eq('sku', sku)
    .eq('delivery_date', today)
  
  console.log(`\nWM orders for TODAY (${today}):`)
  const byRound = {}
  for (const r of (wmToday ?? [])) {
    byRound[r.upload_round] = (byRound[r.upload_round] ?? 0) + r.quantity
  }
  console.log('  By round:', byRound)
  console.log('  Round 0800:', byRound['0800'] ?? 'N/A')
  console.log('  Round 1400:', byRound['1400'] ?? 'N/A')
}

main().catch(console.error)
