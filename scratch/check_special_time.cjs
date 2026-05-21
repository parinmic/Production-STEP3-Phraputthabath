const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(
  'https://jtjironqszdfsflvdvld.supabase.co',
  'sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui'
)

const parseExcelTime = (val) => {
  if (val === null || val === undefined || val === '') return null
  const num = Number(val)
  if (isNaN(num)) return null
  return Math.round(num * 24 * 60)
}

async function main() {
  const { data: masterSpecialRaw, error } = await supabase
    .from('master_logic_calculation')
    .select('row_data')
    .eq('calculation_type', 'Mas Special')
    .order('uploaded_at', { ascending: false })

  if (error) {
    console.error('Supabase error:', error)
    return
  }

  console.log('Total Master Special raw rows:', masterSpecialRaw?.length)

  const specialTimeMap = new Map()
  if (masterSpecialRaw?.length) {
    for (const row of masterSpecialRaw) {
      const r = row.row_data
      const sap = String(r['SAP'] ?? '').trim()
      if (!sap) continue
      const startVal = r['ช่วงเวลาเริ่มผลิต']
      const stopVal = r['ช่วงเวลาหยุดผลิต']
      const startMins = parseExcelTime(startVal)
      const stopMins = parseExcelTime(stopVal)
      if (startMins !== null || stopMins !== null) {
        const entry = { startMins, stopMins, rawStart: startVal, rawStop: stopVal, name: r['ชื่อสินค้า'] }
        specialTimeMap.set(sap, entry)
        specialTimeMap.set(sap.replace(/^0+/, ''), entry)
      }
    }
  }

  const sku = '23015177'
  console.log('Lookup SKU:', sku)
  console.log('Time Entry for original SKU:', specialTimeMap.get(sku))
  console.log('Time Entry for clean SKU:', specialTimeMap.get(sku.replace(/^0+/, '')))
}

main().catch(console.error)
