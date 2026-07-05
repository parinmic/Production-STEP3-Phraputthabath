const { createClient } = require('@supabase/supabase-js')

const url = process.env.DEV_SYNC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.DEV_SYNC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const dates = process.argv.slice(2).length ? process.argv.slice(2) : ['2026-07-01', '2026-07-02']

if (!url || !key) {
  console.error('Missing Supabase env')
  process.exit(1)
}

const supabase = createClient(url, key)
const BASIC_STATIONS = ['สะโพกเบสิค', 'สามชั้นเบสิค', 'ไหล่เบสิค']

function normSku(v) {
  return String(v ?? '').trim().replace(/^0+/, '')
}
function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function rowVal(row, names) {
  for (const name of names) {
    if (row && Object.prototype.hasOwnProperty.call(row, name)) return row[name]
  }
  return undefined
}

async function fetchAll(table, select, build) {
  const rows = []
  const page = 1000
  for (let from = 0; ; from += page) {
    let q = supabase.from(table).select(select).range(from, from + page - 1)
    q = build ? build(q) : q
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < page) break
  }
  return rows
}

async function auditDate(date) {
  const [
    assignments,
    prodRowsRaw,
    wmRows,
    lotusRows,
    makroRows,
    plan100RowsRaw,
  ] = await Promise.all([
    fetchAll('production_assignments', 'table_name,sku,sku_name,target_quantity,period,channel,note,effective_from,is_deficit', q => q.eq('production_date', date).in('table_name', BASIC_STATIONS)),
    fetchAll('master_logic_calculation', 'calculation_type,row_data,uploaded_at', q => q.eq('calculation_type', 'Mas Productivity Basic').order('uploaded_at', { ascending: false })),
    fetchAll('wet_market_orders', 'sku,sku_name,quantity,delivery_date,upload_round', q => q.eq('delivery_date', date).eq('upload_round', '1400')),
    fetchAll('lotus_orders', 'sku,sku_name,quantity,delivery_date,upload_round', q => q.eq('delivery_date', date).eq('upload_round', '1400')),
    fetchAll('makro_orders', 'sku,sku_name,quantity,delivery_date,upload_round', q => q.eq('delivery_date', date)),
    fetchAll('production_plan_100', 'plan_date,sap,product_name,weight_total,uploaded_at', q => q.eq('plan_date', date)),
  ])

  // latest snapshot per table/period
  const latestKey = new Map()
  for (const r of assignments) {
    const k = `${r.table_name}|||${r.period}`
    const eff = r.effective_from || ''
    if (!latestKey.has(k) || eff > latestKey.get(k)) latestKey.set(k, eff)
  }
  const latestAssignments = assignments.filter(r => latestKey.get(`${r.table_name}|||${r.period}`) === (r.effective_from || ''))

  const latestPlanUpload = plan100RowsRaw.reduce((m, r) => r.uploaded_at && (!m || r.uploaded_at > m) ? r.uploaded_at : m, '')
  const plan100Rows = latestPlanUpload ? plan100RowsRaw.filter(r => r.uploaded_at === latestPlanUpload) : plan100RowsRaw

  const prodBySku = new Map()
  for (const r of prodRowsRaw) {
    const d = r.row_data || {}
    const sku = normSku(rowVal(d, ['SAP', 'sap', 'sku']))
    if (!sku || prodBySku.has(sku)) continue
    prodBySku.set(sku, {
      sku,
      name: String(rowVal(d, ['ชื่อสินค้า', 'sku_name', 'product_name']) ?? '').trim(),
      group: String(rowVal(d, ['กลุ่มสินค้า', 'product_group']) ?? '').trim(),
    })
  }

  // aggregate orders per sku (only basic-master skus)
  const orderBySku = new Map()
  const addSource = (channel, rows) => {
    for (const r of rows) {
      const sku = normSku(r.sku ?? r.sap)
      if (!sku || !prodBySku.has(sku)) continue
      const qty = num(r.quantity ?? r.weight_total)
      if (qty <= 0) continue
      const cur = orderBySku.get(sku) || { sku, name: r.sku_name || r.product_name || prodBySku.get(sku).name, byChannel: {}, total: 0 }
      cur.byChannel[channel] = (cur.byChannel[channel] || 0) + qty
      cur.total += qty
      orderBySku.set(sku, cur)
    }
  }
  addSource('Wet Market', wmRows)
  addSource('LOTUS', lotusRows)
  addSource('Makro', makroRows)
  addSource('Plan100', plan100Rows.map(r => ({ sku: r.sap, sku_name: r.product_name, quantity: r.weight_total })))

  // assigned sku set (any qty, any deficit status) + non-deficit assigned qty
  const assignedBySku = new Map()
  for (const r of latestAssignments) {
    const sku = normSku(r.sku)
    if (!sku) continue
    const cur = assignedBySku.get(sku) || { total: 0, nonDeficitTotal: 0, deficitTotal: 0, rows: 0 }
    const qty = num(r.target_quantity)
    cur.total += qty
    cur.rows += 1
    if (r.is_deficit || String(r.note || '').includes('|deficit')) cur.deficitTotal += qty
    else cur.nonDeficitTotal += qty
    assignedBySku.set(sku, cur)
  }

  const noPlanAtAll = []
  const onlyDeficitPlan = []
  for (const o of orderBySku.values()) {
    const a = assignedBySku.get(o.sku)
    if (!a || a.rows === 0) {
      noPlanAtAll.push({ sku: o.sku, name: o.name, orderQty: Math.round(o.total * 100) / 100, byChannel: o.byChannel })
    } else if (a.nonDeficitTotal <= 0 && a.deficitTotal > 0) {
      onlyDeficitPlan.push({ sku: o.sku, name: o.name, orderQty: Math.round(o.total * 100) / 100, deficitQty: Math.round(a.deficitTotal * 100) / 100, byChannel: o.byChannel })
    }
  }

  return {
    date,
    ordersCheckedSkus: orderBySku.size,
    assignmentRows: assignments.length,
    latestAssignmentRows: latestAssignments.length,
    noPlanAtAllCount: noPlanAtAll.length,
    noPlanAtAll: noPlanAtAll.sort((a, b) => b.orderQty - a.orderQty),
    onlyDeficitPlanCount: onlyDeficitPlan.length,
    onlyDeficitPlan: onlyDeficitPlan.sort((a, b) => b.orderQty - a.orderQty),
  }
}

async function main() {
  const results = []
  for (const date of dates) {
    results.push(await auditDate(date))
  }
  console.log(JSON.stringify({ source: url, results }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
