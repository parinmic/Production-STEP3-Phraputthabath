const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.DEV_SYNC_SUPABASE_URL, process.env.DEV_SYNC_SUPABASE_ANON_KEY)
const date = process.argv[2] || '2026-07-03'
const sku = String(process.argv[3] || '23057812').replace(/^0+/, '')

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

const n = v => Number.isFinite(Number(v)) ? Number(v) : 0

async function main() {
  const [assignments, makroToday, makro0800Hist, makro1400Hist, prodRows, varianceRows] = await Promise.all([
    fetchAll('production_assignments', 'table_name,sku,sku_name,target_quantity,worker_name,period,channel,deadline_time,note,effective_from,seq', q => q.eq('production_date', date)),
    fetchAll('makro_orders', 'sku,sku_name,quantity,delivery_date,upload_round,upload_log_id', q => q.eq('delivery_date', date)),
    fetchAll('makro_orders', 'sku,sku_name,quantity,delivery_date,upload_round', q => q.eq('upload_round', '0800')),
    fetchAll('makro_orders', 'sku,sku_name,quantity,delivery_date,upload_round', q => q.eq('upload_round', '1400')),
    fetchAll('master_logic_calculation', 'calculation_type,row_data,uploaded_at', q => q.eq('calculation_type', 'Mas Productivity Basic').order('uploaded_at', { ascending: false })),
    fetchAll('master_logic_calculation', 'calculation_type,row_data,uploaded_at', q => q.eq('calculation_type', 'Mas %Variance Makro Basic').order('uploaded_at', { ascending: false })),
  ])

  const latestByStationPeriod = new Map()
  for (const r of assignments) {
    const key = `${r.table_name}|||${r.period}`
    if (!latestByStationPeriod.has(key) || (r.effective_from || '') > latestByStationPeriod.get(key)) {
      latestByStationPeriod.set(key, r.effective_from || '')
    }
  }
  const skuAssignments = assignments
    .filter(r => String(r.sku || '').replace(/^0+/, '') === sku)
    .filter(r => latestByStationPeriod.get(`${r.table_name}|||${r.period}`) === (r.effective_from || ''))

  const makroRows = makroToday.filter(r => String(r.sku || '').replace(/^0+/, '') === sku)
  const byRound = {}
  for (const r of makroRows) {
    const key = r.upload_round || '(blank)'
    byRound[key] ||= { rows: 0, qty: 0, uploadLogs: new Set() }
    byRound[key].rows += 1
    byRound[key].qty += n(r.quantity)
    if (r.upload_log_id) byRound[key].uploadLogs.add(r.upload_log_id)
  }

  const prod = prodRows
    .map(r => r.row_data || {})
    .find(r => String(r.SAP || r.sap || '').replace(/^0+/, '') === sku)
  const group = prod ? String(prod['กลุ่มสินค้า'] || prod.product_group || '') : ''

  const varianceMatches = varianceRows
    .map(r => r.row_data || {})
    .filter(r => String(r['กลุ่มสินค้า'] || r.product_group || '') === group)

  const histDates = []
  const d = new Date(`${date}T00:00:00Z`)
  for (let i = 1; i <= 14; i += 1) {
    const x = new Date(d)
    x.setUTCDate(d.getUTCDate() - i)
    histDates.push(x.toISOString().slice(0, 10))
  }
  const hist0800Qty = makro0800Hist
    .filter(r => histDates.includes(r.delivery_date) && String(r.sku || '').replace(/^0+/, '') === sku)
    .reduce((s, r) => s + n(r.quantity), 0)
  const hist1400Qty = makro1400Hist
    .filter(r => histDates.includes(r.delivery_date) && String(r.sku || '').replace(/^0+/, '') === sku)
    .reduce((s, r) => s + n(r.quantity), 0)
  const trend = hist1400Qty > 0 ? hist0800Qty / hist1400Qty : null

  console.log(JSON.stringify({
    date,
    sku,
    product: prod || null,
    latestAssignmentTotal: skuAssignments.reduce((s, r) => s + n(r.target_quantity), 0),
    assignments: skuAssignments.map(r => ({
      qty: n(r.target_quantity),
      worker: r.worker_name,
      note: r.note,
      deadline: r.deadline_time,
      seq: r.seq,
    })),
    makroTodayRows: makroRows,
    makroByRound: Object.fromEntries(Object.entries(byRound).map(([k, v]) => [k, {
      rows: v.rows,
      qty: v.qty,
      uploadLogs: Array.from(v.uploadLogs),
    }])),
    group,
    makroTrendLast14Days: { hist0800Qty, hist1400Qty, trend },
    varianceRowsForGroup: varianceMatches,
  }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
