const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
  const date = '2026-05-21' // หรือวันที่ล่าสุดในระบบ
  
  // 1. ดู assignments สะโพกของวันนี้
  const { data: assignments } = await supabase
    .from('production_assignments')
    .select('*')
    .eq('production_date', date)
    .eq('table_name', 'สะโพก')
  
  console.log('--- ASSIGNMENTS IN DB FOR สะโพก ---')
  console.log(assignments ? assignments.map(a => `${a.sku} (${a.sku_name}) -> Qty: ${a.target_quantity}, Worker: ${a.worker_name}, Period: ${a.period}, Channel: ${a.channel}`).join('\n') : 'none')
  
  // 2. ดูยอดสั่งซื้อวันนี้ของ Lotus, Makro, WM สำหรับสะโพก
  // โดยหาจาก master_productivity ก่อนว่า SKU ไหนอยู่สะโพก
  const { data: prodMaster } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('calculation_type', 'Mas Productivity')
  
  const saphokSkus = new Set()
  const skuInfo = {}
  for (const r of prodMaster || []) {
    const station = String(r.row_data['จุดงาน'] || '').trim()
    const sku = String(r.row_data['SAP'] || '').trim().replace(/^0+/, '')
    const name = String(r.row_data['ชื่อสินค้า'] || '').trim()
    if (station.includes('สะโพก')) {
      saphokSkus.add(sku)
      skuInfo[sku] = { name, station }
    }
  }
  
  console.log('\n--- SAPHOK SKUS IN PRODUCTIVITY MASTER ---')
  console.log(Array.from(saphokSkus).map(sku => `${sku}: ${skuInfo[sku].name} (${skuInfo[sku].station})`).join('\n'))

  // ดึง order ของวันนี้
  const channels = ['wet_market_orders', 'lotus_orders', 'makro_orders']
  console.log('\n--- TODAY ORDERS FOR SAPHOK SKUS ---')
  for (const table of channels) {
    const { data: orders } = await supabase
      .from(table)
      .select('sku, sku_name, quantity, upload_round')
      .eq('delivery_date', date)
    
    const filtered = (orders || []).filter(o => saphokSkus.has(o.sku.replace(/^0+/, '')))
    console.log(`> ${table}:`)
    if (filtered.length) {
      console.log(filtered.map(o => `  ${o.sku} (${o.sku_name}) -> Qty: ${o.quantity}, Round: ${o.upload_round}`).join('\n'))
    } else {
      console.log('  none')
    }
  }
}

test()
