const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  'https://jtjironqszdfsflvdvld.supabase.co',
  'sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui'
)

const today = new Date().toISOString().split('T')[0]

async function main() {
  console.log('=== DEBUG สะโพกแต่ง Phase 2 ===')
  console.log('Date:', today)

  // 1. Check production assignments for สะโพก today
  const { data: assignments } = await supabase
    .from('production_assignments')
    .select('*')
    .eq('production_date', today)
    .eq('table_name', 'สะโพก')

  console.log('\n--- 1. Production Assignments (สะโพก, today) ---')
  console.log('Total:', assignments?.length ?? 0)
  if (assignments?.length) {
    // Group by period and sku
    const byPeriod = {}
    for (const a of assignments) {
      const key = `${a.period} | ${a.sku} | ${a.sku_name}`
      byPeriod[key] = (byPeriod[key] ?? 0) + Number(a.target_quantity)
    }
    for (const [key, qty] of Object.entries(byPeriod)) {
      console.log(`  ${key}: ${qty} กก.`)
    }
    // Show สะโพกแต่ง specifically
    const saphokTaeng = assignments.filter(a => (a.sku_name ?? '').includes('สะโพกแต่ง'))
    console.log('\nสะโพกแต่ง specifically:', saphokTaeng.length, 'rows')
    for (const a of saphokTaeng) {
      console.log(`  Phase=${a.period} worker=${a.worker_name} qty=${a.target_quantity} channel=${a.channel}`)
    }
  }

  // 2. Check Productivity master for สะโพก station SKUs
  const { data: prodMaster } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('calculation_type', 'Mas Productivity')
    .order('uploaded_at', { ascending: false })

  console.log('\n--- 2. Productivity Master (สะโพก related) ---')
  const saphokProds = (prodMaster ?? [])
    .map(r => r.row_data)
    .filter(r => String(r['จุดงาน'] ?? '').includes('สะโพก'))

  for (const r of saphokProds) {
    console.log(`  จุดงาน=${r['จุดงาน']} กลุ่ม=${r['กลุ่มสินค้า']} SAP=${r['SAP']} ชื่อ=${r['ชื่อสินค้า']} rate=${r['กำลังการผลิต (กก./ชม./คน)']}`)
  }

  // Find สะโพกแต่ง SAP codes
  const saphokTaengSKUs = saphokProds.filter(r => String(r['ชื่อสินค้า'] ?? '').includes('สะโพกแต่ง'))
  console.log('\nสะโพกแต่ง SKU codes in master:', saphokTaengSKUs.map(r => r['SAP']))

  // 3. Check orders for those SKUs
  for (const skuCode of saphokTaengSKUs.map(r => String(r['SAP']))) {
    // Wet Market
    const { data: wmOrders } = await supabase
      .from('wet_market_orders')
      .select('sku, sku_name, quantity, delivery_date, upload_round')
      .eq('sku', skuCode)
      .eq('delivery_date', today)
    console.log(`\n  WM orders for ${skuCode}:`, wmOrders?.length ?? 0, 'rows',
      wmOrders?.map(r => `round=${r.upload_round} qty=${r.quantity}`))

    // LOTUS
    const { data: lotusOrders } = await supabase
      .from('lotus_orders')
      .select('sku, sku_name, quantity, delivery_date, upload_round')
      .eq('sku', skuCode)
      .eq('delivery_date', today)
    console.log(`  LOTUS orders for ${skuCode}:`, lotusOrders?.length ?? 0, 'rows',
      lotusOrders?.map(r => `round=${r.upload_round} qty=${r.quantity}`))

    // Makro
    const { data: makroOrders } = await supabase
      .from('makro_orders')
      .select('sku, sku_name, quantity, delivery_date, upload_round')
      .eq('sku', skuCode)
      .eq('delivery_date', today)
    console.log(`  Makro orders for ${skuCode}:`, makroOrders?.length ?? 0, 'rows',
      makroOrders?.map(r => `round=${r.upload_round} qty=${r.quantity}`))

    // BL3 history
    const d = new Date(today)
    const histDates = [1, 2, 3].map(n => {
      const h = new Date(d); h.setDate(d.getDate() - n)
      return h.toISOString().split('T')[0]
    })
    const { data: wmHist } = await supabase
      .from('wet_market_orders')
      .select('sku, quantity, delivery_date, upload_round')
      .eq('sku', skuCode)
      .in('delivery_date', histDates)
      .eq('upload_round', '1600')
    console.log(`  WM BL3 hist for ${skuCode}:`, wmHist?.length ?? 0, 'rows',
      wmHist?.map(r => `date=${r.delivery_date} qty=${r.quantity}`))
  }

  // 4. Check workers at สะโพกพิเศษ station
  const { data: workers0800 } = await supabase
    .from('daily_workforce')
    .select('emp_id, name, work_station, shift')
    .eq('work_date', today)
    .eq('upload_round', '0800')

  const { data: workers1300 } = await supabase
    .from('daily_workforce')
    .select('emp_id, name, work_station, shift')
    .eq('work_date', today)
    .eq('upload_round', '1300')

  const allWorkers = [...(workers0800 ?? []), ...(workers1300 ?? [])]

  console.log('\n--- 4. Workers at สะโพก-related stations ---')
  const stationGroups = {}
  for (const w of allWorkers) {
    const st = (w.work_station ?? '').replace(/[()]/g, '').trim()
    if (st.includes('สะโพก')) {
      stationGroups[st] ??= []
      stationGroups[st].push(w)
    }
  }
  for (const [st, ws] of Object.entries(stationGroups)) {
    console.log(`  Station "${st}": ${ws.length} workers`)
    for (const w of ws) {
      console.log(`    ${w.emp_id} ${w.name} shift=${w.shift}`)
    }
  }

  // Also show all distinct work_stations to check naming
  const distinctStations = [...new Set(allWorkers.map(w => (w.work_station ?? '').replace(/[()]/g, '').trim()))]
  console.log('\n  All distinct stations:', distinctStations.sort())

  // 5. Check job assign for สะโพก workers
  const { data: jobAssignRaw } = await supabase
    .from('master_logic_manpower')
    .select('row_data')

  console.log('\n--- 5. Job Assign (สะโพก workers) ---')
  const saphokWorkerNames = new Set(Object.values(stationGroups).flat().map(w => w.name.replace(/\s+/g, ' ').trim()))
  for (const row of (jobAssignRaw ?? [])) {
    const r = row.row_data
    const name = String(r['รายชื่อพนักงาน'] ?? '').replace(/\s+/g, ' ').trim()
    if (saphokWorkerNames.has(name)) {
      const groups = Object.entries(r).filter(([k]) => k.startsWith('กลุ่ม')).filter(([, v]) => v !== null && v !== undefined)
      console.log(`  ${name}: ${groups.map(([k, v]) => `${k.replace(/_\d+$/, '')}=${v}`).join(', ')}`)
    }
  }

  // 6. Check the SKU groups in productivity for สะโพกแต่ง
  console.log('\n--- 6. SKU groups for สะโพก products ---')
  const groupSet = new Set(saphokProds.map(r => r['กลุ่มสินค้า']))
  console.log('  Distinct groups:', [...groupSet])
}

main().catch(console.error)
